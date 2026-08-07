import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { insertBeat, deleteBeatAndRenumber } from "../lib/beats";
import { buildLookProfileBlock, FORMAT_SECONDS, type DbBeat, type DbProject, type DbTerritory } from "../types";

export function BeatsPage() {
  const { id, territoryId } = useParams<{ id: string; territoryId: string }>();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<DbProject | null>(null);
  const [territory, setTerritory] = useState<DbTerritory | null>(null);
  const [beats, setBeats] = useState<DbBeat[]>([]);
  const [lookProfileBlock, setLookProfileBlock] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [exportingScript, setExportingScript] = useState(false);
  const [scriptExportError, setScriptExportError] = useState<string | null>(null);
  const [addingBeat, setAddingBeat] = useState(false);
  const [beatEditError, setBeatEditError] = useState<string | null>(null);
  const [deletingBeatId, setDeletingBeatId] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !territoryId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);

      const { data: projectData, error: projectError } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      if (projectError || !projectData) {
        setLoadError(projectError?.message || "Project not found.");
        setLoading(false);
        return;
      }
      setProject(projectData as DbProject);

      const { data: territoryData, error: territoryError } = await supabase
        .from("territories")
        .select("*")
        .eq("id", territoryId)
        .eq("project_id", id)
        .maybeSingle();
      if (cancelled) return;
      if (territoryError || !territoryData) {
        setLoadError("Territory not found.");
        setLoading(false);
        return;
      }
      setTerritory(territoryData as DbTerritory);

      const [{ data: beatsData, error: beatsError }, { data: lookProfileData }] = await Promise.all([
        supabase.from("beats").select("*").eq("territory_id", territoryData.id).order("ord", { ascending: true }),
        supabase.from("look_profiles").select("*").eq("territory_id", territoryData.id).maybeSingle(),
      ]);
      if (cancelled) return;
      if (beatsError) {
        setLoadError(beatsError.message);
        setLoading(false);
        return;
      }
      setBeats((beatsData as DbBeat[]) ?? []);
      if (lookProfileData) setLookProfileBlock(buildLookProfileBlock(lookProfileData));
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [id, territoryId]);

  function updateBeat(index: number, field: "duration_seconds" | "action" | "vo_text", value: string | number) {
    setSaved(false);
    setBeats((prev) => prev.map((b, i) => (i === index ? { ...b, [field]: value } : b)));
  }

  async function addBeat() {
    if (!territoryId) return;
    setAddingBeat(true);
    setBeatEditError(null);
    try {
      const newBeat = await insertBeat(territoryId, beats, lookProfileBlock ?? "");
      setBeats((prev) => [...prev, newBeat]);
      setSaved(false);
    } catch (err) {
      setBeatEditError(err instanceof Error ? err.message : "Failed to add beat.");
    } finally {
      setAddingBeat(false);
    }
  }

  async function removeBeat(beatId: string) {
    if (beats.length <= 1) {
      setBeatEditError("A beat sheet needs at least one beat.");
      return;
    }
    const confirmed = window.confirm("Delete this beat? Any generated panel for it goes with it.");
    if (!confirmed) return;
    setDeletingBeatId(beatId);
    setBeatEditError(null);
    try {
      const remaining = beats.filter((b) => b.id !== beatId);
      const renumbered = await deleteBeatAndRenumber(beatId, remaining);
      setBeats(renumbered);
      setSaved(false);
    } catch (err) {
      setBeatEditError(err instanceof Error ? err.message : "Failed to delete beat.");
    } finally {
      setDeletingBeatId(null);
    }
  }

  async function saveChanges() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await Promise.all(
        beats.map((beat) =>
          supabase
            .from("beats")
            .update({ duration_seconds: beat.duration_seconds, action: beat.action, vo_text: beat.vo_text })
            .eq("id", beat.id)
            .then(({ error }) => {
              if (error) throw error;
            }),
        ),
      );
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function exportScript() {
    if (!territory || !project) return;
    setExportingScript(true);
    setScriptExportError(null);
    try {
      // Dynamically imported so jsPDF doesn't bloat this page's bundle for
      // the common case where the user never clicks export.
      const [{ renderScriptPdf }, { downloadBlob }] = await Promise.all([
        import("../lib/scriptPdf"),
        import("../lib/download"),
      ]);
      const blob = renderScriptPdf(territory.name, project.format, beats);
      downloadBlob(blob, `${territory.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-script.pdf`);
    } catch (err) {
      setScriptExportError(err instanceof Error ? err.message : "Script export failed.");
    } finally {
      setExportingScript(false);
    }
  }

  if (loading) {
    return (
      <div className="app-shell">
        <p className="loading-msg">Loading…</p>
      </div>
    );
  }

  if (!project || !territory) {
    return (
      <div className="app-shell">
        <div className="error-banner" role="alert">
          {loadError}
        </div>
        <Link to={`/app/p/${id}/territories`} className="back-link">
          Back to territories
        </Link>
      </div>
    );
  }

  const targetSeconds = FORMAT_SECONDS[project.format] ?? 0;
  const totalSeconds = beats.reduce((sum, b) => sum + Number(b.duration_seconds || 0), 0);
  const durationsMatch = Math.abs(totalSeconds - targetSeconds) < 0.01;

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to={`/app/p/${id}/t/${territoryId}/look`} className="back-link">
          ← Look profile
        </Link>
        <h1>Beat sheet</h1>
        <p>
          <strong>{territory.name}</strong> · {project.format} spot
        </p>
      </header>

      <main>
        <p className={`duration-total ${durationsMatch ? "duration-ok" : "duration-mismatch"}`}>
          Total: {totalSeconds.toFixed(1)}s / {targetSeconds}s{" "}
          {durationsMatch ? "✓ matches format length" : "— must sum to format length"}
        </p>

        <div className="beats-table-wrapper">
          <table className="beats-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Duration (s)</th>
                <th>Action</th>
                <th>VO</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {beats.map((beat, i) => (
                <tr key={beat.id}>
                  <td>{beat.ord}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={beat.duration_seconds}
                      onChange={(e) => updateBeat(i, "duration_seconds", Number(e.target.value))}
                    />
                  </td>
                  <td>
                    <textarea value={beat.action} onChange={(e) => updateBeat(i, "action", e.target.value)} />
                  </td>
                  <td>
                    <textarea
                      value={beat.vo_text ?? ""}
                      onChange={(e) => updateBeat(i, "vo_text", e.target.value)}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="remove-btn"
                      disabled={deletingBeatId === beat.id}
                      onClick={() => removeBeat(beat.id)}
                    >
                      {deletingBeatId === beat.id ? "Deleting…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button type="button" className="add-btn" onClick={addBeat} disabled={addingBeat}>
          {addingBeat ? "Adding…" : "+ Add beat"}
        </button>
        {beatEditError && (
          <div className="error-banner" role="alert">
            {beatEditError}
          </div>
        )}

        <div className="button-row">
          <button type="button" className="primary-btn" onClick={saveChanges} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button type="button" className="primary-btn" onClick={exportScript} disabled={exportingScript}>
            {exportingScript ? "Exporting…" : "Export script"}
          </button>
          <Link to={`/app/p/${id}/t/${territoryId}/board`} className="primary-btn">
            Go to animatic →
          </Link>
        </div>
        {saved && <span className="upload-status">Saved.</span>}
        {saveError && (
          <div className="error-banner" role="alert">
            {saveError}
          </div>
        )}
        {scriptExportError && (
          <div className="error-banner" role="alert">
            {scriptExportError}
          </div>
        )}
      </main>
    </div>
  );
}
