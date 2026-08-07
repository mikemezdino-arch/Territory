-- Music bed feature: persist which royalty-free background track (if any) a
-- territory has selected for its animatic, mirroring the vo_voice_id
-- pattern. The track files themselves live in the existing "audio" Storage
-- bucket (root level, alongside per-user VO subfolders) — see
-- src/lib/musicBeds.ts for the curated list.
alter table territories add column music_bed_path text;
