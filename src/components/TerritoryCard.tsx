import { useState } from "react";
import { Link } from "react-router-dom";
import type { DbTerritory } from "../types";

function riskinessLabel(riskiness: number): string {
  if (riskiness <= 2) return "Safe";
  if (riskiness === 3) return "Balanced";
  return "Big swing";
}

interface TerritoryCardProps {
  territory: DbTerritory;
  onChoose?: (territory: DbTerritory) => void;
  choosing?: boolean;
}

export function TerritoryCard({ territory, onChoose, choosing }: TerritoryCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article className={`territory-card${territory.selected ? " territory-card-selected" : ""}`}>
      <header>
        <h3>{territory.name}</h3>
        <span className={`riskiness-badge riskiness-${territory.riskiness}`}>
          {riskinessLabel(territory.riskiness)} · {territory.riskiness}/5
        </span>
      </header>

      <p className="concept-statement">{territory.concept_statement}</p>

      <ul className="tonal-words">
        {territory.tonal_words.map((word) => (
          <li key={word}>{word}</li>
        ))}
      </ul>

      <p className="narrative-structure">
        <strong>Structure:</strong> {territory.narrative_structure}
      </p>

      <button type="button" className="expand-btn" onClick={() => setExpanded((v) => !v)}>
        {expanded ? "Hide rationale" : "Why this answers the brief"}
      </button>
      {expanded && <p className="rationale">{territory.rationale}</p>}

      {onChoose && territory.selected && (
        <Link to={`/app/p/${territory.project_id}/t/${territory.id}/look`} className="primary-btn choose-btn">
          Continue to look profile →
        </Link>
      )}
      {onChoose && !territory.selected && (
        <button type="button" className="primary-btn choose-btn" disabled={choosing} onClick={() => onChoose(territory)}>
          {choosing ? "Choosing…" : "Choose this direction"}
        </button>
      )}
    </article>
  );
}
