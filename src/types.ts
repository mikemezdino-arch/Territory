export interface Brief {
  client: string;
  product: string;
  objective: string;
  audience: string;
  key_message: string;
  reasons_to_believe: string[];
  tone_sliders: {
    calm_vs_loud: number;
    wry_vs_earnest: number;
    premium_vs_mass: number;
  };
  mandatories: string[];
  past_rejections: string[];
}

// Raw shape returned by the LLM per the /api/territory system prompt.
export interface TerritoryLLMResponse {
  name: string;
  concept_statement: string;
  tonal_words: [string, string, string];
  narrative_structure: string;
  why_this_answers_the_brief: string;
  riskiness: number;
}

// Persisted shape (territories table). `rationale` stores
// why_this_answers_the_brief from the LLM response.
export interface DbTerritory {
  id: string;
  project_id: string;
  name: string;
  concept_statement: string;
  tonal_words: string[];
  narrative_structure: string;
  rationale: string;
  riskiness: number;
  selected: boolean;
  vo_url: string | null;
  vo_voice_id: string | null;
  music_bed_path: string | null;
  created_at: string;
}

export interface DbProject {
  id: string;
  user_id: string;
  title: string;
  brief: Brief;
  format: string;
  status: string;
  created_at: string;
}

export interface CastMember {
  name: string;
  description: string;
  ref_image_url: string;
}

export interface DbLookProfile {
  id: string;
  territory_id: string;
  style_description: string;
  palette: string;
  palette_colors: string[];
  lighting_rules: string | null;
  camera_grammar: string | null;
  cast_json: CastMember[];
  product_ref_url: string | null;
  locked_seed: number | null;
  created_at: string;
}

// Raw shape returned by the LLM per the /api/beats system prompt.
export interface BeatLLMResponse {
  ord: number;
  duration_seconds: number;
  action: string;
  vo_text: string;
  shot_prompt: string;
}

// Persisted shape (beats table).
export interface DbBeat {
  id: string;
  territory_id: string;
  ord: number;
  duration_seconds: number;
  action: string;
  vo_text: string | null;
  shot_prompt: string;
}

// Persisted shape (panels table). Multiple rows can exist per beat_id
// (one per generation attempt); the UI shows the most recent.
export interface DbPanel {
  id: string;
  beat_id: string;
  image_url: string | null;
  seed: number | null;
  model: string | null;
  status: "pending" | "done" | "failed";
  created_at: string;
}

export const FORMAT_SECONDS: Record<string, number> = {
  ":15": 15,
  ":30": 30,
  ":60": 60,
};

export const FORMAT_BEAT_COUNT: Record<string, number> = {
  ":15": 8,
  ":30": 14,
  ":60": 20,
};

// Look profile block template from spec 5b, injected verbatim at the start
// of every beat's shot_prompt.
export function buildLookProfileBlock(profile: {
  style_description: string;
  palette: string;
  palette_colors?: string[] | null;
  lighting_rules?: string | null;
  camera_grammar?: string | null;
}): string {
  // `palette` (free text) predates the color-swatch picker and is kept only
  // for older look profiles saved before palette_colors existed; new saves
  // send an empty string here since the swatches are now the single source
  // of truth. Join whichever pieces are actually present so an empty
  // palette never produces a dangling "PALETTE: ." in the prompt.
  const hexList = profile.palette_colors && profile.palette_colors.length > 0 ? profile.palette_colors.join(", ") : null;
  const paletteSegment = [profile.palette.trim() || null, hexList].filter(Boolean).join(", ") || "unspecified";
  return `STYLE: ${profile.style_description}. PALETTE: ${paletteSegment}. LIGHTING: ${profile.lighting_rules || "none specified"}. CAMERA: ${profile.camera_grammar || "none specified"}. Storyboard panel, 16:9, cinematic composition, no text or captions in image. ---`;
}

export const DEMO_PROJECT_TITLE = "Embr (Demo)";

export const DEMO_TERRITORIES: Omit<
  DbTerritory,
  "id" | "project_id" | "selected" | "vo_url" | "vo_voice_id" | "music_bed_path" | "created_at"
>[] = [
  {
    name: "The 11pm test",
    concept_statement:
      "We open on someone lying in bed at 11pm, wide awake and furious about it — then rewind through the day in reverse, showing every decision that led here, ending on the 3pm energy drink that seemed harmless at the time. The film ends on Embr instead: same moment, same person, but asleep by 11.",
    tonal_words: ["wry", "observational", "reassuring"],
    narrative_structure: "reverse chronology, two parallel versions of the same evening",
    rationale:
      "It dramatizes the actual cost of typical energy drinks (a wrecked night) without preaching, using a structural device — rewind — that makes the RTB (no crash) legible without a single line of copy. Riskiness is low because the format is familiar and client-safe, but the specificity of '11pm, furious, wide awake' keeps it from reading as generic.",
    riskiness: 2,
  },
  {
    name: "Adrenaline retires",
    concept_statement:
      "A tongue-in-cheek retirement party for 'the old idea of energy' — jittery hands, gym-bro energy, sugar crashes — personified as an exhausted mascot getting a gold watch and a cardboard cake. The next generation, embodied by our audience mid-3pm-slump, quietly clocks out of the party early to go be functional instead.",
    tonal_words: ["affectionate", "sly", "self-aware"],
    narrative_structure: "mockumentary retirement-party framing, one continuous scene",
    rationale:
      "It lets us be funny about the category without insulting the audience — the joke is on old energy-drink culture, not on the viewer, which matters for an audience explicitly skeptical of 'energy-drink bro culture.' It's a mid-risk swing because the mascot device is unconventional but still clearly on-brief and easy to storyboard.",
    riskiness: 3,
  },
  {
    name: "Circadian",
    concept_statement:
      "A single unbroken take follows one person through an entire day compressed into 60 seconds, shot so the practical lighting itself shifts continuously from harsh 3pm office fluorescents through a warm, dimming gradient to soft lamplight at bedtime — no cuts, no dialogue, the light doing all the emotional work. Embr appears once, at the exact moment the gradient shift begins.",
    tonal_words: ["cinematic", "meditative", "premium"],
    narrative_structure:
      "single continuous take, one-day compression, tied to a lighting gradient rather than plot beats",
    rationale:
      "It makes 'energy that doesn't wreck you' a formal property of the film itself instead of a claim — you feel the gentle decline instead of being told about it. It's the highest-risk territory because it requires real technical execution (a true one-take lighting rig) and has no jokes or safety net if the craft doesn't land.",
    riskiness: 4,
  },
];

export const DEMO_BRIEF: Brief = {
  client: "Embr",
  product: "sleep-friendly calm energy drink, L-theanine + 40mg caffeine",
  objective: "establish 'energy that doesn't wreck you'; drive trial",
  audience:
    "24-34, urban hybrid workers, 3pm-coffee regretters, skeptical of energy-drink bro culture",
  key_message: "Energy shouldn't cost you tonight.",
  reasons_to_believe: [
    "L-theanine smooths the caffeine curve",
    "40mg caffeine vs 160+",
    "no sugar crash",
  ],
  tone_sliders: { calm_vs_loud: 0.8, wry_vs_earnest: 0.65, premium_vs_mass: 0.75 },
  mandatories: [
    "can appears in final 5s",
    "tagline: Burn steady",
    "no gym or extreme-sports imagery",
  ],
  past_rejections: ["meditation-parody route killed as too jokey"],
};
