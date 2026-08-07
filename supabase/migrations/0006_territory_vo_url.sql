-- Phase 5: cache the concatenated scratch-VO mp3 URL per territory so
-- /api/vo only ever calls ElevenLabs once per territory rather than
-- re-spending a tts_calls credit on every export.
alter table territories add column vo_url text;
