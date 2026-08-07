import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fal } from "@fal-ai/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { checkAndIncrementUsage } from "./_lib/creditCap";
import { isUserOnFreePlan } from "./_lib/plan";

// Best-effort default model ids — fal.ai's catalog moves fast, so these are
// overridable via env without a code change if they drift.
const MODEL_TEXT_TO_IMAGE = process.env.FAL_MODEL_TEXT_TO_IMAGE || "fal-ai/flux/dev";
const MODEL_WITH_REFERENCE = process.env.FAL_MODEL_WITH_REFERENCE || "fal-ai/flux-pro/kontext/multi";
const MODEL_QUALITY = process.env.FAL_MODEL_QUALITY || "fal-ai/nano-banana-pro/edit";

const MAX_MODIFIER_CHARS = 200;
const MAX_SEED = 2_147_483_647;

interface FalImageResult {
  data?: { images?: { url: string }[]; image?: { url: string }; seed?: number };
}

async function generateImage(modelId: string, input: Record<string, unknown>): Promise<{ url: string }> {
  const result = (await fal.subscribe(modelId, { input, logs: false })) as FalImageResult;
  const url = result.data?.images?.[0]?.url ?? result.data?.image?.url;
  if (!url) throw new Error(`fal.ai model "${modelId}" returned no image URL.`);
  return { url };
}

// Up to one automatic retry on failure, per the idempotent-generation guardrail.
async function generateWithRetry(modelId: string, input: Record<string, unknown>): Promise<{ url: string }> {
  try {
    return await generateImage(modelId, input);
  } catch (err) {
    console.warn("panel generation failed, retrying once", err);
    return await generateImage(modelId, input);
  }
}

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

async function uploadPanelImage(supabase: SupabaseClient, sourceUrl: string, basePath: string): Promise<string> {
  const imageRes = await fetch(sourceUrl);
  if (!imageRes.ok) throw new Error("Failed to download generated image from fal.ai.");
  const buffer = Buffer.from(await imageRes.arrayBuffer());
  const contentType = imageRes.headers.get("content-type") || "image/png";
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType] || "png";
  const path = `${basePath}.${extension}`;

  const { error: uploadError } = await supabase.storage.from("panels").upload(path, buffer, {
    contentType,
    upsert: true,
  });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("panels").getPublicUrl(path);
  return data.publicUrl;
}

const PANELS_BUCKET_PREFIX = "/storage/v1/object/public/panels/";

// Regenerating a panel inserts a fresh row (see the insert below) rather
// than updating in place, so older attempts for the same beat would
// otherwise pile up as orphaned rows and blobs forever — nothing else ever
// deletes them. Only called after a new panel finishes successfully, so a
// failed regenerate never touches the still-good previous one.
async function deleteStalePanels(supabase: SupabaseClient, beatId: string, keepPanelId: string): Promise<void> {
  const { data: stale, error: staleError } = await supabase
    .from("panels")
    .select("id, image_url")
    .eq("beat_id", beatId)
    .neq("id", keepPanelId);
  if (staleError || !stale || stale.length === 0) return;

  const paths = stale
    .map((p) => p.image_url as string | null)
    .filter((url): url is string => !!url && url.includes(PANELS_BUCKET_PREFIX))
    .map((url) => url.split(PANELS_BUCKET_PREFIX)[1]);
  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage.from("panels").remove(paths);
    if (removeError) console.error("failed to remove stale panel blobs", removeError);
  }

  const { error: deleteError } = await supabase
    .from("panels")
    .delete()
    .in("id", stale.map((p) => p.id));
  if (deleteError) console.error("failed to remove stale panel rows", deleteError);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (process.env.GENERATION_ENABLED === "false") {
    res.status(503).json({ error: "Generation is temporarily disabled. Please try again later." });
    return;
  }
  if (!process.env.FAL_API_KEY) {
    res.status(500).json({ error: "Server is missing FAL_API_KEY." });
    return;
  }
  fal.config({ credentials: process.env.FAL_API_KEY });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "Server is missing Supabase configuration." });
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!token) {
    res.status(401).json({ error: "Missing Authorization header." });
    return;
  }

  const {
    beat_id: beatId,
    modifier,
    quality,
  } = (req.body ?? {}) as { beat_id?: unknown; modifier?: unknown; quality?: unknown };
  if (typeof beatId !== "string" || !beatId) {
    res.status(400).json({ error: "Missing beat_id." });
    return;
  }
  if (modifier !== undefined && (typeof modifier !== "string" || modifier.length > MAX_MODIFIER_CHARS)) {
    res.status(400).json({ error: `Modifier must be ${MAX_MODIFIER_CHARS} characters or fewer.` });
    return;
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    res.status(401).json({ error: "Invalid or expired session. Please sign in again." });
    return;
  }

  // The board's "Higher quality" toggle is also gated client-side, but the
  // plan check has to happen here too — a client can always send
  // quality: "high" directly, and the whole point of a paywall is that it
  // doesn't trust the client to enforce itself.
  const wantsQuality = quality === "high" && !(await isUserOnFreePlan(supabase, user.id));

  const { data: beat, error: beatError } = await supabase
    .from("beats")
    .select("id, territory_id, shot_prompt, territories!inner(id, project_id, projects!inner(user_id))")
    .eq("id", beatId)
    .maybeSingle();
  if (beatError || !beat) {
    res.status(404).json({ error: "Beat not found." });
    return;
  }
  const territory = Array.isArray(beat.territories) ? beat.territories[0] : beat.territories;
  const project = territory ? (Array.isArray(territory.projects) ? territory.projects[0] : territory.projects) : null;
  if (!project || project.user_id !== user.id) {
    res.status(403).json({ error: "You do not have access to this beat." });
    return;
  }

  const { data: lookProfile, error: lookProfileError } = await supabase
    .from("look_profiles")
    .select("*")
    .eq("territory_id", beat.territory_id)
    .maybeSingle();
  if (lookProfileError || !lookProfile) {
    res.status(400).json({ error: "Generate a look profile for this territory first." });
    return;
  }

  const usage = await checkAndIncrementUsage(supabase, user.id, "image_calls");
  if (!usage.allowed) {
    res.status(429).json({ error: usage.message });
    return;
  }

  const { data: panel, error: panelInsertError } = await supabase
    .from("panels")
    .insert({ beat_id: beatId, status: "pending" })
    .select()
    .single();
  if (panelInsertError) {
    console.error("panel row creation failed", panelInsertError);
    res.status(502).json({ error: "Failed to start panel generation. Please retry." });
    return;
  }

  const referenceUrls = [
    ...((lookProfile.cast_json as { ref_image_url: string }[] | null)?.map((c) => c.ref_image_url) ?? []),
    lookProfile.product_ref_url,
  ].filter((url): url is string => !!url);

  const seed: number = lookProfile.locked_seed ?? Math.floor(Math.random() * MAX_SEED);
  const prompt = modifier ? `${beat.shot_prompt} ${modifier}` : beat.shot_prompt;

  const modelId =
    referenceUrls.length > 0 ? (wantsQuality ? MODEL_QUALITY : MODEL_WITH_REFERENCE) : MODEL_TEXT_TO_IMAGE;

  const input: Record<string, unknown> =
    referenceUrls.length > 0
      ? { prompt, image_urls: referenceUrls, seed, num_images: 1 }
      : { prompt, seed, num_images: 1 };

  try {
    const { url: falImageUrl } = await generateWithRetry(modelId, input);
    const basePath = `${project.user_id}/${beat.territory_id}/${panel.id}`;
    const imageUrl = await uploadPanelImage(supabase, falImageUrl, basePath);

    const { data: updatedPanel, error: updateError } = await supabase
      .from("panels")
      .update({ image_url: imageUrl, seed, model: modelId, status: "done" })
      .eq("id", panel.id)
      .select()
      .single();
    if (updateError) throw updateError;

    if (lookProfile.locked_seed === null) {
      await supabase.from("look_profiles").update({ locked_seed: seed }).eq("id", lookProfile.id);
    }

    await deleteStalePanels(supabase, beatId, panel.id);

    res.status(200).json({ panel: updatedPanel });
  } catch (err) {
    console.error("panel generation failed", err);
    await supabase.from("panels").update({ status: "failed" }).eq("id", panel.id);
    res.status(502).json({ error: "Panel generation failed. Please retry." });
  }
}
