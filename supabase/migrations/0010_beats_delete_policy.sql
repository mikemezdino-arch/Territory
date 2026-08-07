-- Beats table was missing a DELETE policy, same gap 0008 fixed for
-- projects — the original guardrail wording only ever said
-- "select/insert/update". Needed now that beats can be added/removed
-- directly from the Beat sheet and Animatic pages. Panels cascade-delete
-- automatically via their existing FK, no separate policy needed there.
create policy "beats_owner_delete" on beats
  for delete using (
    exists (
      select 1 from territories
      join projects on projects.id = territories.project_id
      where territories.id = beats.territory_id
      and projects.user_id = auth.uid()
    )
  );
