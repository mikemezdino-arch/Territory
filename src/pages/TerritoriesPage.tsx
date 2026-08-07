import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { TerritoryCard } from "../components/TerritoryCard";
import { UpgradeModal } from "../components/UpgradeModal";
import { FREE_TIER_MAX_TERRITORIES } from "../lib/plan";
import { usePlan } from "../hooks/usePlan";
import type { DbProject, DbTerritory } from "../types";

export function TerritoriesPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isFreePlan } = usePlan();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<DbProject | null>(null);
  const [territories, setTerritories] = useState<DbTerritory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [choosingId, setChoosingId] = useState<string | null>(null);
  const [customTerritoryText, setCustomTerritoryText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      const [{ data: projectData, error: projectError }, { data: territoryData, error: territoryError }] =
        await Promise.all([
          supabase.from("projects").select("*").eq("id", id).maybeSingle(),
          supabase.from("territories").select("*").eq("project_id", id).order("riskiness", { ascending: true }),
        ]);

      if (cancelled) return;

      if (projectError || territoryError) {
        setError(projectError?.message || territoryError?.message || "Failed to load project.");
        setLoading(false);
        return;
      }
      setProject(projectData as DbProject | null);
      setTerritories((territoryData as DbTerritory[]) ?? []);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function chooseTerritory(territory: DbTerritory) {
    if (!id) return;
    const selectedCount = territories.filter((t) => t.selected).length;
    if (isFreePlan && !territory.selected && selectedCount >= FREE_TIER_MAX_TERRITORIES) {
      setShowUpgradeModal(true);
      return;
    }
    setChoosingId(territory.id);
    setError(null);
    try {
      // Non-exclusive: choosing one territory doesn't deselect others, so
      // multiple directions can be developed in parallel on the same project.
      const { error: setSelectedError } = await supabase
        .from("territories")
        .update({ selected: true })
        .eq("id", territory.id);
      if (setSelectedError) throw setSelectedError;

      setTerritories((prev) => prev.map((t) => (t.id === territory.id ? { ...t, selected: true } : t)));
      navigate(`/app/p/${id}/t/${territory.id}/look`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to choose territory.");
    } finally {
      setChoosingId(null);
    }
  }

  async function analyzeCustomTerritory() {
    if (!id || !customTerritoryText.trim()) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session expired. Please sign in again.");

      const res = await fetch("/api/territory-analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ project_id: id, custom_territory_text: customTerritoryText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Territory analysis failed.");

      setTerritories((prev) => [...prev, data.territory as DbTerritory]);
      setCustomTerritoryText("");
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "Territory analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  }

  if (loading) {
    return (
      <div className="app-shell">
        <p className="loading-msg">Loading…</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="app-shell">
        <div className="error-banner" role="alert">
          {error || "Project not found."}
        </div>
        <Link to="/app" className="back-link">
          Back to projects
        </Link>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/app" className="back-link">
          ← Projects
        </Link>
        <h1>{project.title}</h1>
        <p>Pick one or more directions to develop — each keeps its own look profile, beat sheet, and animatic.</p>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {territories.length > 0 && (
        <div className="territory-grid">
          {territories.map((territory) => (
            <TerritoryCard
              key={territory.id}
              territory={territory}
              onChoose={chooseTerritory}
              choosing={choosingId === territory.id}
            />
          ))}
        </div>
      )}

      <section className="custom-territory-section">
        <h2>Have your own direction?</h2>
        <p className="custom-territory-hint">
          Treat the territories above as starting points, not the only options. Paste your own idea and we'll
          analyze it against the brief — tonal words, narrative structure, riskiness, and an honest read on how well
          it answers the brief.
        </p>
        <textarea
          className="custom-territory-input"
          value={customTerritoryText}
          maxLength={1500}
          placeholder="Describe your own campaign territory…"
          onChange={(e) => setCustomTerritoryText(e.target.value)}
        />
        <button
          type="button"
          className="primary-btn"
          disabled={analyzing || !customTerritoryText.trim()}
          onClick={analyzeCustomTerritory}
        >
          {analyzing ? "Analyzing…" : "Analyze"}
        </button>
        {analyzeError && (
          <div className="error-banner" role="alert">
            {analyzeError}
            <button type="button" onClick={analyzeCustomTerritory} className="retry-btn">
              Retry
            </button>
          </div>
        )}
      </section>

      {showUpgradeModal && (
        <UpgradeModal feature="Developing more than one territory per project" onClose={() => setShowUpgradeModal(false)} />
      )}
    </div>
  );
}
