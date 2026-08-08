import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { captureError } from "./_lib/sentry";

// Storage objects aren't covered by Postgres' `on delete cascade` — only DB
// rows are. Every generation endpoint writes to one of these three buckets
// under a `${user_id}/${territory_id}/...` prefix, so cleanup has to walk
// that same shape before the project row (and its cascaded DB rows) go away.
const BUCKETS = ["panels", "audio", "references"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "Server is missing Supabase configuration." });
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!token) {
    res.status(401).json({ error: "Missing Authorization header." });
    return;
  }

  const { project_id: projectId } = (req.body ?? {}) as { project_id?: unknown };
  if (typeof projectId !== "string" || !projectId) {
    res.status(400).json({ error: "Missing project_id." });
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    res.status(401).json({ error: "Invalid or expired session. Please sign in again." });
    return;
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, user_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError || !project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  if (project.user_id !== user.id) {
    res.status(403).json({ error: "You do not have access to this project." });
    return;
  }

  const { data: territories, error: territoriesError } = await supabase
    .from("territories")
    .select("id")
    .eq("project_id", projectId);
  if (territoriesError) {
    console.error("failed to list territories for storage cleanup", territoriesError);
    captureError(territoriesError, { route: "delete-project", stage: "list-territories" });
    res.status(502).json({ error: "Failed to delete project. Please retry." });
    return;
  }

  for (const territory of territories ?? []) {
    const prefix = `${user.id}/${territory.id}`;
    for (const bucket of BUCKETS) {
      const { data: files, error: listError } = await supabase.storage.from(bucket).list(prefix);
      if (listError || !files || files.length === 0) continue;
      const paths = files.map((f) => `${prefix}/${f.name}`);
      const { error: removeError } = await supabase.storage.from(bucket).remove(paths);
      if (removeError) {
        // Don't let one bucket's cleanup failure block the rest — an orphaned
        // blob is a Storage-quota nuisance, not a correctness problem, and
        // the alternative (aborting) leaves the project undeletable.
        console.error(`failed to remove ${bucket} objects for territory ${territory.id}`, removeError);
        captureError(removeError, { route: "delete-project", stage: "storage-remove", bucket, territoryId: territory.id });
      }
    }
  }

  const { data: deleted, error: deleteError } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId)
    .select();
  if (deleteError || !deleted || deleted.length === 0) {
    console.error("project delete failed", deleteError);
    captureError(deleteError ?? new Error("project delete matched zero rows"), { route: "delete-project", stage: "delete" });
    res.status(502).json({ error: "Failed to delete project. Please retry." });
    return;
  }

  res.status(200).json({ success: true });
}
