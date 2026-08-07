import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { validateImageFile } from "../lib/validateImageFile";
import { ImageUploadField } from "../components/ImageUploadField";
import type { CastMember, DbProject, DbTerritory } from "../types";

const MAX_CAST_MEMBERS = 4;
const MAX_PALETTE_COLORS = 6;
const DEFAULT_PALETTE_COLOR = "#e7eaf1";

interface CastMemberState extends CastMember {
  uploading: boolean;
  error: string | null;
}

function emptyCastMember(): CastMemberState {
  return { name: "", description: "", ref_image_url: "", uploading: false, error: null };
}

export function LookProfilePage() {
  const { id, territoryId } = useParams<{ id: string; territoryId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<DbProject | null>(null);
  const [territory, setTerritory] = useState<DbTerritory | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [styleDescription, setStyleDescription] = useState("");
  const [palette, setPalette] = useState("");
  const [paletteColors, setPaletteColors] = useState<string[]>([]);
  const [lightingRules, setLightingRules] = useState("");
  const [cameraGrammar, setCameraGrammar] = useState("");
  const [castMembers, setCastMembers] = useState<CastMemberState[]>([emptyCastMember()]);
  const [productRefUrl, setProductRefUrl] = useState("");
  const [productUploading, setProductUploading] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [hasExistingBeats, setHasExistingBeats] = useState(false);

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

      const { data: profileData } = await supabase
        .from("look_profiles")
        .select("*")
        .eq("territory_id", territoryData.id)
        .maybeSingle();
      if (cancelled) return;
      if (profileData) {
        setStyleDescription(profileData.style_description ?? "");
        setPalette(profileData.palette ?? "");
        setPaletteColors((profileData.palette_colors as string[] | null) ?? []);
        setLightingRules(profileData.lighting_rules ?? "");
        setCameraGrammar(profileData.camera_grammar ?? "");
        setProductRefUrl(profileData.product_ref_url ?? "");
        const cast = (profileData.cast_json as CastMember[]) ?? [];
        setCastMembers(
          cast.length > 0
            ? cast.map((c) => ({ ...c, uploading: false, error: null }))
            : [emptyCastMember()],
        );
      }

      const { count } = await supabase
        .from("beats")
        .select("id", { count: "exact", head: true })
        .eq("territory_id", territoryData.id);
      if (cancelled) return;
      setHasExistingBeats(!!count && count > 0);

      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [id, territoryId]);

  async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function uploadImage(file: File): Promise<string> {
    if (!territory) throw new Error("Session expired. Please sign in again.");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Session expired. Please sign in again.");

    const dataBase64 = await fileToBase64(file);
    const res = await fetch("/api/upload-reference", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        territory_id: territory.id,
        filename: file.name,
        content_type: file.type,
        data_base64: dataBase64,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed.");
    return data.url;
  }

  async function handleCastFileSelected(index: number, file: File) {
    const validationError = validateImageFile(file);
    if (validationError) {
      setCastMembers((prev) => prev.map((c, i) => (i === index ? { ...c, error: validationError } : c)));
      return;
    }
    setCastMembers((prev) => prev.map((c, i) => (i === index ? { ...c, uploading: true, error: null } : c)));
    try {
      const url = await uploadImage(file);
      setCastMembers((prev) => prev.map((c, i) => (i === index ? { ...c, ref_image_url: url, uploading: false } : c)));
    } catch (err) {
      setCastMembers((prev) =>
        prev.map((c, i) =>
          i === index ? { ...c, uploading: false, error: err instanceof Error ? err.message : "Upload failed." } : c,
        ),
      );
    }
  }

  async function handleProductFileSelected(file: File) {
    const validationError = validateImageFile(file);
    if (validationError) {
      setProductError(validationError);
      return;
    }
    setProductUploading(true);
    setProductError(null);
    try {
      const url = await uploadImage(file);
      setProductRefUrl(url);
    } catch (err) {
      setProductError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setProductUploading(false);
    }
  }

  function addPaletteColor() {
    setPaletteColors((prev) => (prev.length < MAX_PALETTE_COLORS ? [...prev, DEFAULT_PALETTE_COLOR] : prev));
  }

  function removePaletteColor(index: number) {
    setPaletteColors((prev) => prev.filter((_, i) => i !== index));
  }

  function updatePaletteColor(index: number, value: string) {
    setPaletteColors((prev) => prev.map((c, i) => (i === index ? value : c)));
  }

  function addCastMember() {
    setCastMembers((prev) => (prev.length < MAX_CAST_MEMBERS ? [...prev, emptyCastMember()] : prev));
  }

  function removeCastMember(index: number) {
    setCastMembers((prev) => prev.filter((_, i) => i !== index));
  }

  function updateCastField(index: number, field: "name" | "description", value: string) {
    setCastMembers((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }

  async function generateBeatSheet() {
    if (!territory || !id) return;
    if (hasExistingBeats) {
      const confirmed = window.confirm(
        "This will replace your existing beat sheet, including any edits you've made on the Beats page. Continue?",
      );
      if (!confirmed) return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session expired. Please sign in again.");

      const cast = castMembers.filter((c) => c.name.trim() || c.description.trim() || c.ref_image_url).map((c) => ({
        name: c.name,
        description: c.description,
        ref_image_url: c.ref_image_url,
      }));

      const { data: lookProfile, error: upsertError } = await supabase
        .from("look_profiles")
        .upsert(
          {
            territory_id: territory.id,
            style_description: styleDescription,
            palette,
            palette_colors: paletteColors,
            lighting_rules: lightingRules || null,
            camera_grammar: cameraGrammar || null,
            cast_json: cast,
            product_ref_url: productRefUrl || null,
          },
          { onConflict: "territory_id" },
        )
        .select()
        .single();
      if (upsertError) throw upsertError;

      const res = await fetch("/api/beats", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ territory_id: territory.id, look_profile_id: lookProfile.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Something went wrong generating the beat sheet.");
      }

      navigate(`/app/p/${id}/t/${territoryId}/beats`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to={`/app/p/${id}/territories`} className="back-link">
          ← Territories
        </Link>
        <h1>Look profile</h1>
        <p>
          For <strong>{territory.name}</strong>. Locked once panels start generating.
        </p>
        {hasExistingBeats && (
          <Link to={`/app/p/${id}/t/${territoryId}/beats`} className="primary-btn view-beats-link">
            View existing beat sheet →
          </Link>
        )}
      </header>

      <main className="app-main-single">
        <form
          className="brief-form"
          onSubmit={(e) => {
            e.preventDefault();
            generateBeatSheet();
          }}
        >
          <div className="field">
            <label htmlFor="style_description">Style Description</label>
            <textarea
              id="style_description"
              value={styleDescription}
              maxLength={1500}
              required
              onChange={(e) => setStyleDescription(e.target.value)}
              placeholder="e.g. night-neon graphic novel, heavy ink shadows"
            />
          </div>

          <div className="field">
            <label htmlFor="palette">Palette</label>
            <input
              id="palette"
              type="text"
              value={palette}
              maxLength={1500}
              required
              onChange={(e) => setPalette(e.target.value)}
              placeholder="e.g. amber and teal, no pure white"
            />
          </div>

          <div className="field">
            <label>Palette Colors ({paletteColors.length}/{MAX_PALETTE_COLORS})</label>
            <div className="palette-color-row">
              {paletteColors.map((color, i) => (
                <div className="palette-color-item" key={i}>
                  <input
                    type="color"
                    className="palette-color-swatch"
                    aria-label={`Palette color ${i + 1}`}
                    value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#000000"}
                    onChange={(e) => updatePaletteColor(i, e.target.value)}
                  />
                  <input
                    type="text"
                    className="palette-color-hex"
                    aria-label={`Palette color ${i + 1} hex code`}
                    value={color}
                    maxLength={7}
                    placeholder="#rrggbb"
                    onChange={(e) => updatePaletteColor(i, e.target.value)}
                  />
                  <button
                    type="button"
                    className="palette-color-remove"
                    aria-label={`Remove palette color ${i + 1}`}
                    onClick={() => removePaletteColor(i)}
                  >
                    ×
                  </button>
                </div>
              ))}
              {paletteColors.length < MAX_PALETTE_COLORS && (
                <button type="button" className="palette-color-add" onClick={addPaletteColor}>
                  + Add color
                </button>
              )}
            </div>
          </div>

          <div className="field">
            <label htmlFor="lighting_rules">Lighting Rules</label>
            <input
              id="lighting_rules"
              type="text"
              value={lightingRules}
              maxLength={1500}
              onChange={(e) => setLightingRules(e.target.value)}
              placeholder="e.g. continuous warm-to-dusk gradient, no spikes"
            />
          </div>

          <div className="field">
            <label htmlFor="camera_grammar">Camera Grammar</label>
            <input
              id="camera_grammar"
              type="text"
              value={cameraGrammar}
              maxLength={1500}
              onChange={(e) => setCameraGrammar(e.target.value)}
              placeholder="e.g. single tracking camera, eye level"
            />
          </div>

          <div className="field">
            <label>Cast ({castMembers.length}/{MAX_CAST_MEMBERS})</label>
            {castMembers.map((cast, i) => (
              <div className="cast-row" key={i}>
                <input
                  type="text"
                  placeholder="Name"
                  value={cast.name}
                  maxLength={200}
                  onChange={(e) => updateCastField(i, "name", e.target.value)}
                />
                <textarea
                  placeholder="Description"
                  value={cast.description}
                  maxLength={1500}
                  onChange={(e) => updateCastField(i, "description", e.target.value)}
                />
                <ImageUploadField
                  label="Reference image"
                  imageUrl={cast.ref_image_url || null}
                  uploading={cast.uploading}
                  error={cast.error}
                  onFileSelected={(file) => handleCastFileSelected(i, file)}
                  circular
                />
                <button type="button" className="remove-btn" onClick={() => removeCastMember(i)}>
                  Remove cast member
                </button>
              </div>
            ))}
            {castMembers.length < MAX_CAST_MEMBERS && (
              <button type="button" className="add-btn" onClick={addCastMember}>
                + Add cast member
              </button>
            )}
          </div>

          <ImageUploadField
            label="Product reference image"
            imageUrl={productRefUrl || null}
            uploading={productUploading}
            error={productError}
            onFileSelected={handleProductFileSelected}
          />

          <button type="submit" className="primary-btn" disabled={submitting}>
            {submitting ? "Generating beat sheet…" : hasExistingBeats ? "Regenerate beat sheet" : "Generate beat sheet"}
          </button>

          {submitError && (
            <div className="error-banner" role="alert">
              {submitError}
              <button type="button" onClick={generateBeatSheet} className="retry-btn">
                Retry
              </button>
            </div>
          )}
        </form>
      </main>
    </div>
  );
}
