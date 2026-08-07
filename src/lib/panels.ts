import type { DbPanel } from "../types";

export function latestPanelsByBeat(panels: DbPanel[]): Record<string, DbPanel> {
  const result: Record<string, DbPanel> = {};
  for (const panel of panels) {
    const existing = result[panel.beat_id];
    if (!existing || new Date(panel.created_at) > new Date(existing.created_at)) {
      result[panel.beat_id] = panel;
    }
  }
  return result;
}
