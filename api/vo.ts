import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { checkAndIncrementUsage } from "./_lib/creditCap";
import { VOICE_OPTIONS } from "../src/lib/voices";
import type { DbBeat } from "../src/types";

// Default voice/model. "Eric" is one of the curated American-accent premade
// voices in src/lib/voices.ts (confirmed live via GET /v1/voices — accent
// and gender are account metadata, not guessable from a voice's name).
// eleven_v3 is ElevenLabs' flagship model as of 2026: most natural,
// emotionally expressive delivery, recommended for polished short-form
// narration. Its higher latency doesn't matter here since VO is generated
// once and cached (src/pages/AnimaticPage.tsx), never streamed live.
// Override either via env if these ever change.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "cjVigY5qzO86Huf0OWal";
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_v3";
const ALLOWED_VOICE_IDS = new Set(VOICE_OPTIONS.map((v) => v.id));

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (process.env.GENERATION_ENABLED === "false") {
    res.status(503).json({ error: "Generation is temporarily disabled. Please try again later." });
    return;
  }
  if (!process.env.ELEVENLABS_API_KEY) {
    res.status(500).json({ error: "Server is missing ELEVENLABS_API_KEY." });
    return;
  }
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

  const { territory_id: territoryId, voice_id: requestedVoiceIdRaw } = (req.body ?? {}) as {
    territory_id?: unknown;
    voice_id?: unknown;
  };
  if (typeof territoryId !== "string" || !territoryId) {
    res.status(400).json({ error: "Missing territory_id." });
    return;
  }
  if (requestedVoiceIdRaw !== undefined && !ALLOWED_VOICE_IDS.has(requestedVoiceIdRaw as string)) {
    res.status(400).json({ error: "Unknown voice_id." });
    return;
  }
  const requestedVoiceId = typeof requestedVoiceIdRaw === "string" ? requestedVoiceIdRaw : null;

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    res.status(401).json({ error: "Invalid or expired session. Please sign in again." });
    return;
  }

  const { data: territory, error: territoryError } = await supabase
    .from("territories")
    .select("id, vo_url, vo_voice_id, project_id, projects!inner(user_id)")
    .eq("id", territoryId)
    .maybeSingle();
  if (territoryError || !territory) {
    res.status(404).json({ error: "Territory not found." });
    return;
  }
  const project = Array.isArray(territory.projects) ? territory.projects[0] : territory.projects;
  if (!project || project.user_id !== user.id) {
    res.status(403).json({ error: "You do not have access to this territory." });
    return;
  }

  const effectiveVoiceId = requestedVoiceId || VOICE_ID;
  const cachedVoiceId = territory.vo_voice_id || VOICE_ID;

  // Cached from a prior call. If the caller didn't ask for a specific voice
  // (Play / export just want "whatever's there"), or asked for the same
  // voice that's already cached, reuse it — ElevenLabs is only called again
  // when a genuinely different voice is requested.
  if (territory.vo_url && (!requestedVoiceId || cachedVoiceId === effectiveVoiceId)) {
    res.status(200).json({ vo_url: territory.vo_url, voice_id: cachedVoiceId });
    return;
  }

  const { data: beats, error: beatsError } = await supabase
    .from("beats")
    .select("*")
    .eq("territory_id", territoryId)
    .order("ord", { ascending: true });
  if (beatsError || !beats || beats.length === 0) {
    res.status(400).json({ error: "Generate a beat sheet before creating a voiceover." });
    return;
  }

  const script = (beats as DbBeat[])
    .map((b) => b.vo_text?.trim())
    .filter((text): text is string => !!text)
    .join(" ");
  if (!script) {
    res.status(400).json({ error: "This beat sheet has no VO text to read." });
    return;
  }

  const usage = await checkAndIncrementUsage(supabase, user.id, "tts_calls");
  if (!usage.allowed) {
    res.status(429).json({ error: usage.message });
    return;
  }

  try {
    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${effectiveVoiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: script,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!ttsRes.ok) {
      const errBody = await ttsRes.text();
      console.error("ElevenLabs TTS failed", ttsRes.status, errBody);
      res.status(502).json({ error: "Voiceover generation failed. Please retry." });
      return;
    }

    const buffer = Buffer.from(await ttsRes.arrayBuffer());
    // Path includes the voice id so switching voices always produces a
    // genuinely new URL. A fixed "vo.mp3" path with upsert overwrote the
    // same file on every regeneration — the audio bytes changed but the
    // public URL didn't, so the browser (and Supabase's CDN) kept serving
    // the previously-cached response for the old voice.
    const path = `${user.id}/${territoryId}/vo-${effectiveVoiceId}.mp3`;
    const { error: uploadError } = await supabase.storage.from("audio").upload(path, buffer, {
      contentType: "audio/mpeg",
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from("audio").getPublicUrl(path);

    const { error: updateError } = await supabase
      .from("territories")
      .update({ vo_url: publicUrlData.publicUrl, vo_voice_id: effectiveVoiceId })
      .eq("id", territoryId);
    if (updateError) throw updateError;

    res.status(200).json({ vo_url: publicUrlData.publicUrl, voice_id: effectiveVoiceId });
  } catch (err) {
    console.error("voiceover generation failed", err);
    res.status(502).json({ error: "Voiceover generation failed. Please retry." });
  }
}
