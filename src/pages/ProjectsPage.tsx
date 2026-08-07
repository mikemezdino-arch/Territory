import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { DEMO_BRIEF, DEMO_PROJECT_TITLE, DEMO_TERRITORIES, type DbProject } from "../types";

const POSTGRES_UNIQUE_VIOLATION = "23505";

async function ensureDemoProject(userId: string) {
  // A partial unique index (one row per user with this title) is the real
  // guard against duplicates — insert directly and treat a conflict as
  // "someone else already created it" rather than pre-checking, since a
  // check-then-insert race (two tabs, React StrictMode's double effect
  // invocation) can otherwise create two demo projects.
  const { data: project, error: insertProjectError } = await supabase
    .from("projects")
    .insert({ user_id: userId, title: DEMO_PROJECT_TITLE, brief: DEMO_BRIEF, format: ":30" })
    .select()
    .single();

  if (insertProjectError) {
    if (insertProjectError.code === POSTGRES_UNIQUE_VIOLATION) return;
    throw insertProjectError;
  }

  const { error: insertTerritoriesError } = await supabase
    .from("territories")
    .insert(DEMO_TERRITORIES.map((t) => ({ ...t, project_id: project.id })));

  if (insertTerritoriesError) throw insertTerritoriesError;
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<DbProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const seeded = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError(null);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        if (!seeded.current) {
          seeded.current = true;
          await ensureDemoProject(user.id);
        }

        const { data, error: listError } = await supabase
          .from("projects")
          .select("*")
          .order("created_at", { ascending: false });
        if (listError) throw listError;
        if (!cancelled) setProjects(data as DbProject[]);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load projects.");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function deleteProject(project: DbProject) {
    const confirmed = window.confirm(
      `Delete "${project.title}"? This permanently removes the project and everything built from it — territories, look profiles, beat sheets, and panels. This can't be undone.`,
    );
    if (!confirmed) return;

    setDeletingId(project.id);
    setError(null);
    try {
      const { error: deleteError } = await supabase.from("projects").delete().eq("id", project.id);
      if (deleteError) throw deleteError;
      setProjects((prev) => prev?.filter((p) => p.id !== project.id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header projects-header">
        <div>
          <h1>Projects</h1>
          <p>Pick a project or start a new brief.</p>
        </div>
        <div className="header-actions">
          <Link to="/app/new" className="primary-btn">
            New project
          </Link>
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {!projects && !error && <p className="loading-msg">Loading projects…</p>}

      {projects && projects.length === 0 && <p>No projects yet.</p>}

      {projects && projects.length > 0 && (
        <div className="project-grid">
          {projects.map((project) => (
            <div key={project.id} className="project-card">
              <Link to={`/app/p/${project.id}/territories`} className="project-card-link">
                <h3>{project.title}</h3>
                <p className="project-meta">
                  {project.format} · {project.status}
                </p>
                <p className="project-brief-line">{project.brief.key_message}</p>
              </Link>
              <button
                type="button"
                className="remove-btn project-delete-btn"
                disabled={deletingId === project.id}
                onClick={() => deleteProject(project)}
              >
                {deletingId === project.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
