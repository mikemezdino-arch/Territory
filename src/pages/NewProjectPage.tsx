import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BriefForm } from "../components/BriefForm";
import { supabase } from "../lib/supabaseClient";
import { DEMO_BRIEF, type Brief, type DbProject } from "../types";

export function NewProjectPage() {
  const [title, setTitle] = useState(`${DEMO_BRIEF.client} campaign`);
  const [brief, setBrief] = useState<Brief>(DEMO_BRIEF);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  // Retrying after a failed /api/territory call must reuse the already-created
  // project row instead of inserting a duplicate.
  const createdProject = useRef<DbProject | null>(null);

  async function createProject() {
    setSubmitting(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session expired. Please sign in again.");

      let project = createdProject.current;
      if (!project) {
        const { data, error: insertError } = await supabase
          .from("projects")
          .insert({ user_id: session.user.id, title, brief, format: ":30" })
          .select()
          .single();
        if (insertError) throw insertError;
        project = data as DbProject;
        createdProject.current = project;
      }

      const res = await fetch("/api/territory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ brief, project_id: project.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Something went wrong generating territories.");
      }

      navigate(`/app/p/${project.id}/territories`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>New project</h1>
        <p>Paste a brief. Get three genuinely distinct campaign directions.</p>
      </header>

      <main className="app-main app-main-single">
        <BriefForm
          brief={brief}
          onChange={setBrief}
          onSubmit={createProject}
          submitting={submitting}
          title={title}
          onTitleChange={setTitle}
          submitLabel="Create project"
        />

        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button type="button" onClick={createProject} className="retry-btn">
              Retry
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
