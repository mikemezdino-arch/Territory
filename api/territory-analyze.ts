import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { stripCodeFences } from "./_lib/parsing";
import { checkAndIncrementUsage } from "./_lib/creditCap";
import { isTerritoryShape } from "./_lib/territoryShape";
import { captureError } from "./_lib/sentry";

const SYSTEM_PROMPT = `You are a senior creative director running a pitch war-room. A team member
has proposed their OWN campaign territory idea, separate from the ones you
generated. Analyze it against the brief and produce a structured breakdown —
you are formalizing and assessing their idea, not inventing a new one.

Rules:
1. Preserve the core idea as given. You may tighten the wording of the
   concept statement for clarity, but do not change its substance, add plot
   points it doesn't contain, or soften it into something safer.
2. Extract exactly 3 tonal words that describe this territory's emotional
   register.
3. Describe its narrative structure in one clear phrase or sentence.
4. Assess riskiness honestly on a 1-5 scale (1 = very safe/client-friendly,
   5 = a genuine big swing) — how far this idea pushes past expected,
   category-conventional advertising.
5. Write why_this_answers_the_brief: an honest analytical assessment of how
   well this territory serves the brief's objective, audience, and key
   message. If it conflicts with a mandatory or resembles a past rejection,
   say so plainly rather than glossing over it — the point is useful
   analysis, not cheerleading.
6. Respond with ONLY a JSON object, no markdown fences, schema:
   { "name": str, "concept_statement": str, "tonal_words": [str,str,str],
     "narrative_structure": str, "why_this_answers_the_brief": str,
     "riskiness": int }`;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";
const MAX_CUSTOM_TERRITORY_CHARS = 1500;

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

  const { project_id: projectId, custom_territory_text: customTerritoryText } = (req.body ?? {}) as {
    project_id?: unknown;
    custom_territory_text?: unknown;
  };
  if (typeof projectId !== "string" || !projectId) {
    res.status(400).json({ error: "Missing project_id." });
    return;
  }
  if (
    typeof customTerritoryText !== "string" ||
    customTerritoryText.trim().length === 0 ||
    customTerritoryText.length > MAX_CUSTOM_TERRITORY_CHARS
  ) {
    res.status(400).json({ error: `Territory description must be 1-${MAX_CUSTOM_TERRITORY_CHARS} characters.` });
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
    .select("id, user_id, brief")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError || !project || project.user_id !== user.id) {
    res.status(403).json({ error: "You do not have access to this project." });
    return;
  }

  const usage = await checkAndIncrementUsage(supabase, user.id, "llm_calls");
  if (!usage.allowed) {
    res.status(429).json({ error: usage.message });
    return;
  }

  const userMessage = JSON.stringify(
    { brief: project.brief, custom_territory: customTerritoryText },
    null,
    2,
  );

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
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

    if (!isTerritoryShape(parsed)) {
      res.status(502).json({ error: "Model output did not match the expected territory schema. Please retry." });
      return;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("territories")
      .insert({
        project_id: projectId,
        name: parsed.name,
        concept_statement: parsed.concept_statement,
        tonal_words: parsed.tonal_words,
        narrative_structure: parsed.narrative_structure,
        rationale: parsed.why_this_answers_the_brief,
        riskiness: parsed.riskiness,
      })
      .select()
      .single();
    if (insertError) {
      console.error("custom territory insert failed", insertError);
      captureError(insertError, { route: "territory-analyze", stage: "insert" });
      res.status(502).json({ error: "Territory was analyzed but failed to save. Please retry." });
      return;
    }

    res.status(200).json({ territory: inserted });
  } catch (err) {
    console.error("custom territory analysis failed", err);
    captureError(err, { route: "territory-analyze" });
    res.status(502).json({ error: "Territory analysis failed. Please retry." });
  }
}
