import type { TerritoryLLMResponse } from "../../src/types";

export function isTerritoryShape(t: unknown): t is TerritoryLLMResponse {
  if (!t || typeof t !== "object") return false;
  const territory = t as Record<string, unknown>;
  return (
    typeof territory.name === "string" &&
    typeof territory.concept_statement === "string" &&
    Array.isArray(territory.tonal_words) &&
    territory.tonal_words.length === 3 &&
    typeof territory.narrative_structure === "string" &&
    typeof territory.why_this_answers_the_brief === "string" &&
    typeof territory.riskiness === "number"
  );
}
