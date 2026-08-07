-- The original guardrail language ("select/insert/update") never granted a
-- DELETE policy on projects, so deleting a project from the client was
-- silently blocked by RLS. Owner-only delete, matching the existing pattern.
create policy "projects_owner_delete" on projects
  for delete using (user_id = auth.uid());
