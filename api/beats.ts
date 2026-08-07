import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { buildLookProfileBlock, FORMAT_BEAT_COUNT, FORMAT_SECONDS, type BeatLLMResponse } from "../src/types";
import { stripCodeFences } from "./_lib/parsing";
import { checkAndIncrementUsage } from "./_lib/creditCap";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";
const DURATION_TOLERANCE_SECONDS = 0.5;

function systemPrompt(format: string, n: number): string {
  return `You are a director's assistant breaking a chosen campaign territory into a
timed storyboard for a ${format} spot.

Input: the brief, the chosen territory, and the look profile.

Rules:
1. Produce ${n} beats where ${n} = 8 for :15, 14 for :30, 20 for :60.
   Durations must sum to the spot length. Vary beat length for rhythm.
2. Honor mandatories (e.g. product in final 5s) with explicit beats.
3. vo_text across all beats must read as one continuous scratch VO script in
   the territory's tone. Some beats may have empty vo_text.
4. For each beat, write shot_prompt: a single image-generation prompt that
   BEGINS with the look profile block verbatim, then describes this beat's
   framing, subject, and action in concrete visual language. Never contradict
   the look profile. Reference cast members by their profile descriptions,
   not names.
5. Respond with ONLY a JSON array, schema:
   { "ord": int, "duration_seconds": number, "action": str,
     "vo_text": str, "shot_prompt": str }`;
}

function validateBeats(parsed: unknown, expectedCount: number): parsed is BeatLLMResponse[] {
  if (!Array.isArray(parsed) || parsed.length !== expectedCount) return false;
  return parsed.every((b) => {
    if (!b || typeof b !== "object") return false;
    const beat = b as Record<string, unknown>;
    return (
      typeof beat.ord === "number" &&
      typeof beat.duration_seconds === "number" &&
      typeof beat.action === "string" &&
      typeof beat.vo_text === "string" &&
      typeof beat.shot_prompt === "string"
    );
  });
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
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY." });
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

  const { territory_id: territoryId, look_profile_id: lookProfileId } = (req.body ?? {}) as {
    territory_id?: unknown;
    look_profile_id?: unknown;
  };
  if (typeof territoryId !== "string" || !territoryId) {
    res.status(400).json({ error: "Missing territory_id." });
    return;
  }
  if (typeof lookProfileId !== "string" || !lookProfileId) {
    res.status(400).json({ error: "Missing look_profile_id." });
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

  const { data: territory, error: territoryError } = await supabase
    .from("territories")
    .select("id, name, concept_statement, tonal_words, narrative_structure, rationale, riskiness, project_id, projects!inner(user_id, brief, format)")
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

  const { data: lookProfile, error: lookProfileError } = await supabase
    .from("look_profiles")
    .select("*")
    .eq("id", lookProfileId)
    .maybeSingle();
  if (lookProfileError || !lookProfile || lookProfile.territory_id !== territoryId) {
    res.status(404).json({ error: "Look profile not found." });
    return;
  }

  const format = project.format as string;
  const n = FORMAT_BEAT_COUNT[format];
  const totalSeconds = FORMAT_SECONDS[format];
  if (!n || !totalSeconds) {
    res.status(400).json({ error: `Unsupported format "${format}".` });
    return;
  }

  const lookProfileBlock = buildLookProfileBlock(lookProfile);

  const userMessage = JSON.stringify(
    {
      instructions: `Every shot_prompt must begin with this exact block, verbatim, then a space, then the beat's own description:\n${lookProfileBlock}`,
      brief: project.brief,
      territory: {
        name: territory.name,
        concept_statement: territory.concept_statement,
        tonal_words: territory.tonal_words,
        narrative_structure: territory.narrative_structure,
        rationale: territory.rationale,
        riskiness: territory.riskiness,
      },
      look_profile: {
        style_description: lookProfile.style_description,
        palette: lookProfile.palette,
        palette_colors: lookProfile.palette_colors,
        lighting_rules: lookProfile.lighting_rules,
        camera_grammar: lookProfile.camera_grammar,
        cast_json: lookProfile.cast_json,
        product_ref_url: lookProfile.product_ref_url,
      },
    },
    null,
    2,
  );

  const usage = await checkAndIncrementUsage(supabase, user.id, "llm_calls");
  if (!usage.allowed) {
    res.status(429).json({ error: usage.message });
    return;
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: systemPrompt(format, n),
      messages: [{ role: "user", content: userMessage }],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      res.status(502).json({ error: "Model returned no text output. Please retry." });
      return;
    }

    const cleaned = stripCodeFences(textBlock.text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      res.status(502).json({ error: "Model output was not valid JSON. Please retry." });
      return;
    }

    if (!validateBeats(parsed, n)) {
      res.status(502).json({ error: "Model output did not match the expected beat schema. Please retry." });
      return;
    }

    const durationSum = parsed.reduce((sum, b) => sum + b.duration_seconds, 0);
    if (Math.abs(durationSum - totalSeconds) > DURATION_TOLERANCE_SECONDS) {
      res.status(502).json({ error: "Beat durations did not sum to the spot length. Please retry." });
      return;
    }

    const rows = parsed.map((b) => ({
      territory_id: territoryId,
      ord: b.ord,
      duration_seconds: b.duration_seconds,
      action: b.action,
      vo_text: b.vo_text,
      shot_prompt: b.shot_prompt.startsWith(lookProfileBlock) ? b.shot_prompt : `${lookProfileBlock} ${b.shot_prompt}`,
    }));

    const { error: deleteError } = await supabase.from("beats").delete().eq("territory_id", territoryId);
    if (deleteError) {
      console.error("beat delete failed", deleteError);
      res.status(502).json({ error: "Failed to clear the previous beat sheet. Please retry." });
      return;
    }

    const { data: inserted, error: insertError } = await supabase.from("beats").insert(rows).select();
    if (insertError) {
      console.error("beat insert failed", insertError);
      res.status(502).json({ error: "Beats were generated but failed to save. Please retry." });
      return;
    }

    res.status(200).json({ beats: inserted });
  } catch (err) {
    console.error("beat generation failed", err);
    res.status(502).json({ error: "Beat sheet generation failed. Please retry." });
  }
}
