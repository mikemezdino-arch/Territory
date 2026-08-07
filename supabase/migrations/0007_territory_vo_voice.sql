-- Phase 5 follow-up: track which voice was used for the cached VO so
-- /api/vo can tell "same voice, return cache" apart from "different voice,
-- regenerate" without re-spending a tts_calls credit on every playback.
alter table territories add column vo_voice_id text;
