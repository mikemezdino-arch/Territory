import { supabase } from "./supabaseClient";
import type { DbBeat } from "../types";

const DEFAULT_NEW_BEAT_ACTION = "New beat — describe the shot";
const DEFAULT_NEW_BEAT_DURATION = 2;

// Manually-added beats have no LLM-authored shot_prompt, but the column is
// not-null and api/panel.ts sends it straight to fal.ai — so it needs a
// real value from the moment the row exists, not just a placeholder that
// breaks generation until the user notices. Built from the same look
// profile block every LLM-generated beat's prompt already starts with.
export async function insertBeat(territoryId: string, existingBeats: DbBeat[], lookProfileBlock: string): Promise<DbBeat> {
  const nextOrd = existingBeats.length > 0 ? Math.max(...existingBeats.map((b) => b.ord)) + 1 : 1;
  const { data, error } = await supabase
    .from("beats")
    .insert({
      territory_id: territoryId,
      ord: nextOrd,
      duration_seconds: DEFAULT_NEW_BEAT_DURATION,
      action: DEFAULT_NEW_BEAT_ACTION,
      vo_text: "",
      shot_prompt: `${lookProfileBlock} ${DEFAULT_NEW_BEAT_ACTION}`,
    })
    .select()
    .single();
  if (error) throw error;
  return data as DbBeat;
}

// Deletes the beat (panels cascade automatically via their FK) and
// renumbers whatever's left so `ord` stays contiguous from 1 — the concat
// export order and the "#N" labels throughout the UI both depend on that.
export async function deleteBeatAndRenumber(beatId: string, beatsAfterRemoval: DbBeat[]): Promise<DbBeat[]> {
  // RLS blocks an unauthorized delete by matching zero rows, not by
  // erroring — .select() after .delete() is what surfaces that as data
  // instead of a silent no-op the caller would otherwise treat as success.
  const { data: deleted, error: deleteError } = await supabase.from("beats").delete().eq("id", beatId).select();
  if (deleteError) throw deleteError;
  if (!deleted || deleted.length === 0) {
    throw new Error("Delete didn't go through — the beats table may be missing its delete policy (migration 0010).");
  }

  const renumbered = beatsAfterRemoval.map((beat, i) => ({ ...beat, ord: i + 1 }));
  await Promise.all(
    renumbered
      .filter((beat, i) => beat.ord !== beatsAfterRemoval[i].ord)
      .map((beat) =>
        supabase
          .from("beats")
          .update({ ord: beat.ord })
          .eq("id", beat.id)
          .then(({ error }) => {
            if (error) throw error;
          }),
      ),
  );
  return renumbered;
}
