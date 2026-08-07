-- Phase 7 (marketing-driven): structured color swatches alongside the
-- existing free-text `palette` description. Additive only — `palette`
-- stays required and still carries the descriptive prompt text;
-- palette_colors is optional hex anchors on top of it.

alter table look_profiles
  add column palette_colors text[] not null default '{}';
