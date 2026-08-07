import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { latestPanelsByBeat } from "../lib/panels";
import { downloadBlob, renderMp4, renderPitchPdf, type ExportBeat } from "../lib/exportUtils";
import { getMusicBedUrl } from "../lib/musicBeds";
import { UpgradeModal } from "../components/UpgradeModal";
import { usePlan } from "../hooks/usePlan";
import type { DbBeat, DbPanel, DbProject, DbTerritory } from "../types";

export function ExportPage() {
  const { id, territoryId } = useParams<{ id: string; territoryId: string }>();
  const { isFreePlan } = usePlan();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<DbProject | null>(null);
  const [territory, setTerritory] = useState<DbTerritory | null>(null);
  const [beats, setBeats] = useState<DbBeat[]>([]);
  const [panels, setPanels] = useState<Record<string, DbPanel>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const [renderingMp4, setRenderingMp4] = useState(false);
  const [renderingPdf, setRenderingPdf] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [upgradeFeature, setUpgradeFeature] = useState<string | null>(null);

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

      const { data: beatsData, error: beatsError } = await supabase
        .from("beats")
        .select("*")
        .eq("territory_id", territoryData.id)
        .order("ord", { ascending: true });
      if (cancelled) return;
      if (beatsError || !beatsData || beatsData.length === 0) {
        setLoadError("Generate a beat sheet before exporting.");
        setLoading(false);
        return;
      }
      setBeats(beatsData as DbBeat[]);

      const { data: panelsData } = await supabase
        .from("panels")
        .select("*")
        .in(
          "beat_id",
          beatsData.map((b) => b.id),
        )
        .order("created_at", { ascending: true });
      if (cancelled) return;
      setPanels(latestPanelsByBeat((panelsData as DbPanel[]) ?? []));
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [id, territoryId]);

  const missingPanelBeats = beats.filter((b) => !panels[b.id]?.image_url);
  const exportBeats: ExportBeat[] = beats
    .filter((b) => panels[b.id]?.image_url)
    .map((b) => ({
      ord: b.ord,
      duration_seconds: b.duration_seconds,
      action: b.action,
      vo_text: b.vo_text,
      image_url: panels[b.id].image_url!,
    }));

  async function ensureVoUrl(): Promise<string | null> {
    if (territory?.vo_url) return territory.vo_url;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session || !territory) return null;

    const res = await fetch("/api/vo", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ territory_id: territory.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Voiceover generation failed.");
    setTerritory((prev) => (prev ? { ...prev, vo_url: data.vo_url } : prev));
    return data.vo_url as string;
  }

  async function handleRenderMp4() {
    if (!territory) return;
    if (isFreePlan) {
      setUpgradeFeature("MP4 exports");
      return;
    }
    setRenderingMp4(true);
    setExportError(null);
    try {
      const voUrl = await ensureVoUrl();
      const musicUrl = territory.music_bed_path ? getMusicBedUrl(territory.music_bed_path) : null;
      const blob = await renderMp4(exportBeats, voUrl, musicUrl, isFreePlan, setProgressMessage);
      downloadBlob(blob, `${territory.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.mp4`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "MP4 render failed.");
    } finally {
      setRenderingMp4(false);
      setProgressMessage(null);
    }
  }

  async function handleRenderPdf() {
    if (!territory) return;
    if (isFreePlan) {
      setUpgradeFeature("Pitch PDF exports");
      return;
    }
    setRenderingPdf(true);
    setExportError(null);
    try {
      const blob = await renderPitchPdf(territory.name, territory.concept_statement, exportBeats, setProgressMessage);
      downloadBlob(blob, `${territory.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-pitch.pdf`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "PDF render failed.");
    } finally {
      setRenderingPdf(false);
      setProgressMessage(null);
    }
  }

  if (loading) {
    return (
      <div className="app-shell">
        <p className="loading-msg">Loading…</p>
      </div>
    );
  }

  if (!project || !territory || beats.length === 0) {
    return (
      <div className="app-shell">
        <div className="error-banner" role="alert">
          {loadError}
        </div>
        <Link to={`/app/p/${id}/t/${territoryId}/board`} className="back-link">
          Back to animatic
        </Link>
      </div>
    );
  }

  const canExport = missingPanelBeats.length === 0;

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to={`/app/p/${id}/t/${territoryId}/board`} className="back-link">
          ← Animatic
        </Link>
        <h1>Export</h1>
        <p>
          <strong>{territory.name}</strong> · {project.format} spot
        </p>
      </header>

      {!canExport && (
        <div className="error-banner" role="alert">
          {missingPanelBeats.length} of {beats.length} beats don't have a generated panel yet — go back to the
          animatic and generate them before exporting.
        </div>
      )}

      {isFreePlan && <p className="phase-note">Free plan: downloads are part of Territory Studio.</p>}

      <div className="export-actions">
        <button type="button" className="primary-btn" disabled={!canExport || renderingMp4} onClick={handleRenderMp4}>
          {renderingMp4 ? "Rendering…" : isFreePlan ? "Render MP4 🔒" : "Render MP4"}
        </button>
        <button type="button" className="primary-btn" disabled={!canExport || renderingPdf} onClick={handleRenderPdf}>
          {renderingPdf ? "Rendering…" : isFreePlan ? "Pitch PDF 🔒" : "Pitch PDF"}
        </button>
      </div>

      {progressMessage && <p className="loading-msg">{progressMessage}</p>}

      {exportError && (
        <div className="error-banner" role="alert">
          {exportError}
        </div>
      )}

      {upgradeFeature && <UpgradeModal feature={upgradeFeature} onClose={() => setUpgradeFeature(null)} />}
    </div>
  );
}
