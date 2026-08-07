import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { latestPanelsByBeat } from "../lib/panels";
import { DEFAULT_VOICE_ID, VOICE_OPTIONS } from "../lib/voices";
import { MUSIC_BED_OPTIONS, getMusicBedUrl } from "../lib/musicBeds";
import { insertBeat, deleteBeatAndRenumber } from "../lib/beats";
import { usePlan } from "../hooks/usePlan";
import { UpgradeModal } from "../components/UpgradeModal";
import {
  buildLookProfileBlock,
  FORMAT_SECONDS,
  type DbBeat,
  type DbPanel,
  type DbProject,
  type DbTerritory,
} from "../types";

const MUSIC_PREVIEW_VOLUME = 0.8;
const MUSIC_MIX_VOLUME = 0.35;

export function AnimaticPage() {
  const { id, territoryId } = useParams<{ id: string; territoryId: string }>();
  const { isFreePlan } = usePlan();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<DbProject | null>(null);
  const [territory, setTerritory] = useState<DbTerritory | null>(null);
  const [beats, setBeats] = useState<DbBeat[]>([]);
  const [panels, setPanels] = useState<Record<string, DbPanel>>({});
  const [lookProfileBlock, setLookProfileBlock] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generatingBeatId, setGeneratingBeatId] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [addingBeat, setAddingBeat] = useState(false);
  const [deletingBeatId, setDeletingBeatId] = useState<string | null>(null);
  const [beatEditError, setBeatEditError] = useState<string | null>(null);
  const [modifiers, setModifiers] = useState<Record<string, string>>({});
  const [qualityByBeat, setQualityByBeat] = useState<Record<string, boolean>>({});
  const [savingBeats, setSavingBeats] = useState(false);
  const [beatsSaveError, setBeatsSaveError] = useState<string | null>(null);
  const [beatsSaved, setBeatsSaved] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentBeatIndex, setCurrentBeatIndex] = useState<number | null>(null);
  const [voLoading, setVoLoading] = useState(false);
  const [voError, setVoError] = useState<string | null>(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState(DEFAULT_VOICE_ID);
  const [generatingVoice, setGeneratingVoice] = useState(false);
  const [selectedMusicPath, setSelectedMusicPath] = useState("");
  const [savingMusic, setSavingMusic] = useState(false);
  const [musicError, setMusicError] = useState<string | null>(null);
  const [previewingMusic, setPreviewingMusic] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const musicAudioRef = useRef<HTMLAudioElement>(null);
  const advanceTimeoutRef = useRef<number | null>(null);

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
      // A cached vo_voice_id can point at a voice that's since been dropped
      // from the curated list (as just happened swapping in American-accent
      // voices) — the <select> would visually fall back to its first option
      // while this state stayed on the stale id, so "Generate" would send
      // an id the server no longer recognizes. Only adopt the cached id if
      // it's still a real option.
      if (territoryData.vo_voice_id && VOICE_OPTIONS.some((v) => v.id === territoryData.vo_voice_id)) {
        setSelectedVoiceId(territoryData.vo_voice_id);
      }
      if (territoryData.music_bed_path) setSelectedMusicPath(territoryData.music_bed_path);

      const { data: beatsData, error: beatsError } = await supabase
        .from("beats")
        .select("*")
        .eq("territory_id", territoryData.id)
        .order("ord", { ascending: true });
      if (cancelled) return;
      if (beatsError || !beatsData || beatsData.length === 0) {
        setLoadError("Generate a beat sheet before viewing the animatic.");
        setLoading(false);
        return;
      }
      setBeats(beatsData as DbBeat[]);

      const { data: lookProfileData } = await supabase
        .from("look_profiles")
        .select("*")
        .eq("territory_id", territoryData.id)
        .maybeSingle();
      if (cancelled) return;
      if (lookProfileData) setLookProfileBlock(buildLookProfileBlock(lookProfileData));

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

  function updateBeatField(beatId: string, field: "action" | "vo_text" | "duration_seconds", value: string | number) {
    setBeatsSaved(false);
    setBeats((prev) => prev.map((b) => (b.id === beatId ? { ...b, [field]: value } : b)));
  }

  async function addBeat() {
    if (!territoryId) return;
    setAddingBeat(true);
    setBeatEditError(null);
    try {
      const newBeat = await insertBeat(territoryId, beats, lookProfileBlock ?? "");
      setBeats((prev) => [...prev, newBeat]);
      setBeatsSaved(false);
    } catch (err) {
      setBeatEditError(err instanceof Error ? err.message : "Failed to add beat.");
    } finally {
      setAddingBeat(false);
    }
  }

  async function removeBeat(beatId: string) {
    if (beats.length <= 1) {
      setBeatEditError("An animatic needs at least one beat.");
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
      setPanels((prev) => {
        const next = { ...prev };
        delete next[beatId];
        return next;
      });
      setBeatsSaved(false);
    } catch (err) {
      setBeatEditError(err instanceof Error ? err.message : "Failed to delete beat.");
    } finally {
      setDeletingBeatId(null);
    }
  }

  async function saveBeatChanges() {
    setSavingBeats(true);
    setBeatsSaveError(null);
    setBeatsSaved(false);
    try {
      await Promise.all(
        beats.map((beat) =>
          supabase
            .from("beats")
            .update({ action: beat.action, vo_text: beat.vo_text, duration_seconds: beat.duration_seconds })
            .eq("id", beat.id)
            .then(({ error }) => {
              if (error) throw error;
            }),
        ),
      );
      setBeatsSaved(true);
    } catch (err) {
      setBeatsSaveError(err instanceof Error ? err.message : "Failed to save changes.");
    } finally {
      setSavingBeats(false);
    }
  }

  async function generatePanel(beatId: string) {
    setGeneratingBeatId(beatId);
    setGenError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session expired. Please sign in again.");

      const res = await fetch("/api/panel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          beat_id: beatId,
          modifier: modifiers[beatId] || undefined,
          quality: qualityByBeat[beatId] ? "high" : "standard",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Panel generation failed.");

      setPanels((prev) => ({ ...prev, [beatId]: data.panel as DbPanel }));
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Panel generation failed.");
    } finally {
      setGeneratingBeatId(null);
    }
  }

  useEffect(() => {
    return () => {
      if (advanceTimeoutRef.current) window.clearTimeout(advanceTimeoutRef.current);
    };
  }, []);

  function stopPlayback() {
    if (advanceTimeoutRef.current) window.clearTimeout(advanceTimeoutRef.current);
    audioRef.current?.pause();
    musicAudioRef.current?.pause();
    setPlaying(false);
    setCurrentBeatIndex(null);
  }

  function scheduleAdvance(index: number) {
    const durationMs = beats[index].duration_seconds * 1000;
    advanceTimeoutRef.current = window.setTimeout(() => {
      const next = index + 1;
      if (next >= beats.length) {
        stopPlayback();
        return;
      }
      setCurrentBeatIndex(next);
      scheduleAdvance(next);
    }, durationMs);
  }

  async function fetchVo(voiceId?: string): Promise<string | null> {
    if (!voiceId && territory?.vo_url) return territory.vo_url;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session || !territory) return null;

    const res = await fetch("/api/vo", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ territory_id: territory.id, ...(voiceId ? { voice_id: voiceId } : {}) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Voiceover generation failed.");

    setTerritory((prev) => (prev ? { ...prev, vo_url: data.vo_url, vo_voice_id: data.voice_id } : prev));
    return data.vo_url as string;
  }

  async function startPlayback() {
    if (beats.length === 0) return;
    setVoError(null);
    setVoLoading(true);
    try {
      const voUrl = await fetchVo();
      if (audioRef.current && voUrl) {
        audioRef.current.src = voUrl;
        await audioRef.current.play().catch(() => {});
      }
    } catch (err) {
      setVoError(err instanceof Error ? err.message : "Voiceover generation failed. Playing without audio.");
    } finally {
      setVoLoading(false);
    }

    if (musicAudioRef.current && selectedMusicPath) {
      musicAudioRef.current.src = getMusicBedUrl(selectedMusicPath);
      musicAudioRef.current.volume = MUSIC_MIX_VOLUME;
      musicAudioRef.current.loop = true;
      musicAudioRef.current.play().catch(() => {});
    }

    setPlaying(true);
    setCurrentBeatIndex(0);
    scheduleAdvance(0);
  }

  async function handleGenerateVoice() {
    setVoError(null);
    setGeneratingVoice(true);
    try {
      await fetchVo(selectedVoiceId);
    } catch (err) {
      setVoError(err instanceof Error ? err.message : "Voiceover generation failed.");
    } finally {
      setGeneratingVoice(false);
    }
  }

  async function handleMusicChange(path: string) {
    setSelectedMusicPath(path);
    setPreviewingMusic(false);
    musicAudioRef.current?.pause();
    if (!territory) return;
    setSavingMusic(true);
    setMusicError(null);
    try {
      const { error } = await supabase
        .from("territories")
        .update({ music_bed_path: path || null })
        .eq("id", territory.id);
      if (error) throw error;
      setTerritory((prev) => (prev ? { ...prev, music_bed_path: path || null } : prev));
    } catch (err) {
      setMusicError(err instanceof Error ? err.message : "Failed to save music bed.");
    } finally {
      setSavingMusic(false);
    }
  }

  function togglePreviewMusic() {
    if (!musicAudioRef.current || !selectedMusicPath) return;
    if (previewingMusic) {
      musicAudioRef.current.pause();
      setPreviewingMusic(false);
      return;
    }
    musicAudioRef.current.src = getMusicBedUrl(selectedMusicPath);
    musicAudioRef.current.volume = MUSIC_PREVIEW_VOLUME;
    musicAudioRef.current.loop = false;
    musicAudioRef.current.play().catch(() => {});
    setPreviewingMusic(true);
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
        <Link to={`/app/p/${id}/t/${territoryId}/beats`} className="back-link">
          Back to beat sheet
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
        <Link to={`/app/p/${id}/t/${territoryId}/beats`} className="back-link">
          ← Beat sheet
        </Link>
        <h1>Animatic</h1>
        <p>
          <strong>{territory.name}</strong> · {project.format} spot
        </p>
      </header>

      {genError && (
        <div className="error-banner" role="alert">
          {genError}
        </div>
      )}

      <div className="playback-strip">
        <p className={`duration-total ${durationsMatch ? "duration-ok" : "duration-mismatch"}`}>
          Total: {totalSeconds.toFixed(1)}s / {targetSeconds}s{" "}
          {durationsMatch ? "✓ matches format length" : "— must sum to format length"}
        </p>
        <div className="playback-stage">
          {currentBeatIndex !== null && panels[beats[currentBeatIndex].id]?.image_url ? (
            <img
              src={panels[beats[currentBeatIndex].id].image_url!}
              alt={`Beat ${beats[currentBeatIndex].ord}`}
              className="playback-image"
            />
          ) : (
            <div className="panel-placeholder">
              {playing ? "No panel for this beat" : "Press Play to preview the animatic"}
            </div>
          )}
        </div>
        <div className="button-row">
          <button type="button" className="primary-btn" onClick={saveBeatChanges} disabled={savingBeats}>
            {savingBeats ? "Saving…" : "Save changes"}
          </button>
          <button type="button" className="primary-btn" onClick={playing ? stopPlayback : startPlayback} disabled={voLoading}>
            {voLoading ? "Loading VO…" : playing ? "Stop" : "Play"}
          </button>
          <Link
            to={`/app/p/${id}/t/${territoryId}/export`}
            className="primary-btn"
            onClick={(e) => {
              if (isFreePlan) {
                e.preventDefault();
                setUpgradeFeature("Exporting your animatic");
              }
            }}
          >
            Export →
          </Link>
        </div>
        <div className="playback-controls">
          {currentBeatIndex !== null && (
            <span className="playback-position">
              Beat {beats[currentBeatIndex].ord} / {beats.length}
            </span>
          )}
          {beatsSaved && <span className="upload-status">Saved.</span>}
          {beatsSaveError && (
            <div className="error-banner" role="alert">
              {beatsSaveError}
            </div>
          )}
        </div>

        <div className="media-picker-grid">
          <div className="media-picker-row">
            <label htmlFor="voice_select">Voice</label>
            <div className="media-picker-controls">
              <select id="voice_select" value={selectedVoiceId} onChange={(e) => setSelectedVoiceId(e.target.value)}>
                {VOICE_OPTIONS.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} — {v.description}
                  </option>
                ))}
              </select>
              <button type="button" className="expand-btn" onClick={handleGenerateVoice} disabled={generatingVoice}>
                {generatingVoice ? "Generating…" : "Generate voiceover"}
              </button>
              {territory.vo_voice_id && (
                <span className="playback-position">
                  Current: {VOICE_OPTIONS.find((v) => v.id === territory.vo_voice_id)?.name ?? territory.vo_voice_id}
                </span>
              )}
            </div>
          </div>

          <div className="media-picker-row">
            <label htmlFor="music_select">Music</label>
            <div className="media-picker-controls">
              <select
                id="music_select"
                value={selectedMusicPath}
                onChange={(e) => handleMusicChange(e.target.value)}
                disabled={savingMusic}
              >
                <option value="">None</option>
                {MUSIC_BED_OPTIONS.map((m) => (
                  <option key={m.path} value={m.path}>
                    {m.name} — {m.mood}
                  </option>
                ))}
              </select>
              <button type="button" className="expand-btn" onClick={togglePreviewMusic} disabled={!selectedMusicPath}>
                {previewingMusic ? "Stop preview" : "Preview"}
              </button>
              {savingMusic && <span className="playback-position">Saving…</span>}
            </div>
          </div>
        </div>

        {voError && <p className="auth-error">{voError}</p>}
        {musicError && <p className="auth-error">{musicError}</p>}
        <audio ref={audioRef} />
        <audio ref={musicAudioRef} onEnded={() => setPreviewingMusic(false)} />
      </div>

      <div className="board-grid">
        {beats.map((beat) => {
          const panel = panels[beat.id];
          const generating = generatingBeatId === beat.id;
          return (
            <div className="panel-card" key={beat.id}>
              <div className="panel-image-wrapper">
                {panel?.image_url ? (
                  <img src={panel.image_url} alt={`Panel for beat ${beat.ord}`} className="panel-image" />
                ) : (
                  <div className="panel-placeholder">
                    {panel?.status === "pending" || generating
                      ? "Generating…"
                      : panel?.status === "failed"
                        ? "Failed"
                        : "No panel yet"}
                  </div>
                )}
              </div>
              <div className="panel-beat-label-row">
                <p className="panel-beat-label">
                  #{beat.ord} ·{" "}
                  <input
                    type="number"
                    className="panel-duration-input"
                    min={0}
                    step={0.5}
                    value={beat.duration_seconds}
                    onChange={(e) => updateBeatField(beat.id, "duration_seconds", Number(e.target.value))}
                  />
                  s
                </p>
                <button
                  type="button"
                  className="remove-btn"
                  disabled={deletingBeatId === beat.id}
                  onClick={() => removeBeat(beat.id)}
                >
                  {deletingBeatId === beat.id ? "Deleting…" : "Delete"}
                </button>
              </div>

              <label className="modifier-label">
                Shot description
                <textarea
                  className="panel-text-input"
                  value={beat.action}
                  onChange={(e) => updateBeatField(beat.id, "action", e.target.value)}
                />
              </label>

              <label className="modifier-label">
                VO
                <textarea
                  className="panel-text-input"
                  value={beat.vo_text ?? ""}
                  onChange={(e) => updateBeatField(beat.id, "vo_text", e.target.value)}
                  placeholder="No VO for this beat"
                />
              </label>

              <label className="modifier-label">
                Modifier (optional)
                <input
                  type="text"
                  maxLength={200}
                  value={modifiers[beat.id] || ""}
                  onChange={(e) => setModifiers((prev) => ({ ...prev, [beat.id]: e.target.value }))}
                  placeholder="e.g. wider shot, more contrast"
                />
              </label>

              <label className="quality-toggle">
                <input
                  type="checkbox"
                  checked={!!qualityByBeat[beat.id]}
                  onChange={(e) => {
                    if (isFreePlan && e.target.checked) {
                      setUpgradeFeature("Higher-quality image rendering");
                      return;
                    }
                    setQualityByBeat((prev) => ({ ...prev, [beat.id]: e.target.checked }));
                  }}
                />
                Higher quality{isFreePlan ? " 🔒" : ""}
              </label>

              <button
                type="button"
                className="primary-btn"
                disabled={generating}
                onClick={() => generatePanel(beat.id)}
              >
                {generating ? "Generating…" : panel ? "Regenerate" : "Generate"}
              </button>
            </div>
          );
        })}
      </div>

      <button type="button" className="add-btn" onClick={addBeat} disabled={addingBeat}>
        {addingBeat ? "Adding…" : "+ Add beat"}
      </button>
      {beatEditError && (
        <div className="error-banner" role="alert">
          {beatEditError}
        </div>
      )}

      {upgradeFeature && <UpgradeModal feature={upgradeFeature} onClose={() => setUpgradeFeature(null)} />}
    </div>
  );
}
