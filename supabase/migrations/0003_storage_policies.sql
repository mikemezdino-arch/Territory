-- Phase 3: allow authenticated users to upload look-profile reference images
-- into their own folder (path prefix = their user id) in the "references"
-- bucket. The bucket is public for reads, so no SELECT policy is needed —
-- Supabase serves public-bucket objects directly without going through RLS.

create policy "references_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'references'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
