import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import type { Brief, TerritoryLLMResponse } from "../src/types";
import { stripCodeFences } from "./_lib/parsing";
import { checkAndIncrementUsage } from "./_lib/creditCap";
import { isTerritoryShape } from "./_lib/territoryShape";
import { captureError } from "./_lib/sentry";

const SYSTEM_PROMPT = `You are a senior creative director running a pitch war-room. Given a brief,
produce 3 deliberately DIFFERENT campaign territories for a client pitch.

Rules:
1. Each territory must answer the brief differently — different emotional
   register, different narrative structure, different visual world. If two
   territories could share a director's reel, you failed. Discard and rethink.
2. No slogans as concepts. A concept is a WORLD and a POV, stated in 2-3
   sentences that a director could shoot from.
3. Kill any territory that reads as generic AI output — mood-boardy language,
   no specific human observation. Every concept must contain at least one
   concrete, filmable human moment.
4. Respect mandatories absolutely. Respect past_rejections: do not resubmit a
   killed direction in disguise, but you may learn from WHY it was killed.
5. Exactly one territory must be "safe" client-friendly (riskiness <= 2).
   Exactly one must be a "big swing" (riskiness >= 4).
6. Respond with ONLY a JSON array of 3 objects, no markdown fences, schema:
   { "name": str, "concept_statement": str, "tonal_words": [str,str,str],
     "narrative_structure": str, "why_this_answers_the_brief": str,
     "riskiness": int }`;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";
const MAX_BRIEF_JSON_CHARS = 4000 * 4; // brief text fields are capped at 4000 chars each; this bounds the whole payload

function validateBrief(body: unknown): body is Brief {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  const requiredStrings = ["client", "product", "objective", "audience", "key_message"];
  for (const key of requiredStrings) {
    if (typeof b[key] !== "string" || (b[key] as string).length === 0) return false;
    if ((b[key] as string).length > 4000) return false;
  }
  if (!Array.isArray(b.reasons_to_believe) || !Array.isArray(b.mandatories) || !Array.isArray(b.past_rejections)) {
    return false;
  }
  if (!b.tone_sliders || typeof b.tone_sliders !== "object") return false;
  return true;
}

function validateTerritories(parsed: unknown): parsed is TerritoryLLMResponse[] {
  return Array.isArray(parsed) && parsed.length === 3 && parsed.every(isTerritoryShape);
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

  const { brief, project_id: projectId } = (req.body ?? {}) as { brief?: unknown; project_id?: unknown };
  if (typeof projectId !== "string" || projectId.length === 0) {
    res.status(400).json({ error: "Missing project_id." });
    return;
  }
  if (!validateBrief(brief)) {
    res.status(400).json({ error: "Brief is missing required fields or exceeds length limits." });
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

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, user_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError || !project || project.user_id !== user.id) {
    res.status(403).json({ error: "You do not have access to this project." });
    return;
  }

  const briefJson = JSON.stringify(brief, null, 2);
  if (briefJson.length > MAX_BRIEF_JSON_CHARS) {
    res.status(400).json({ error: "Brief payload is too large." });
    return;
  }

  const usage = await checkAndIncrementUsage(supabase, user.id, "llm_calls");
  if (!usage.allowed) {
    res.status(429).json({ error: usage.message });
    return;
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: briefJson }],
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

    if (!validateTerritories(parsed)) {
      res.status(502).json({ error: "Model output did not match the expected territory schema. Please retry." });
      return;
    }

    const rows = parsed.map((t) => ({
      project_id: projectId,
      name: t.name,
      concept_statement: t.concept_statement,
      tonal_words: t.tonal_words,
      narrative_structure: t.narrative_structure,
      rationale: t.why_this_answers_the_brief,
      riskiness: t.riskiness,
    }));

    const { data: inserted, error: insertError } = await supabase.from("territories").insert(rows).select();
    if (insertError) {
      console.error("territory insert failed", insertError);
      captureError(insertError, { route: "territory", stage: "insert" });
      res.status(502).json({ error: "Territories were generated but failed to save. Please retry." });
      return;
    }

    res.status(200).json({ territories: inserted });
  } catch (err) {
    console.error("territory generation failed", err);
    captureError(err, { route: "territory" });
    res.status(502).json({ error: "Territory generation failed. Please retry." });
  }
}
