import type { SupabaseClient } from "@supabase/supabase-js";
import { isUserOnFreePlan } from "./plan";

export type UsageColumn = "llm_calls" | "image_calls" | "tts_calls";

const FREE_TIER_LIMITS: Record<UsageColumn, number> = {
  llm_calls: 30,
  image_calls: 40,
  tts_calls: 5,
};

const STUDIO_TIER_LIMITS: Record<UsageColumn, number> = {
  llm_calls: 200,
  image_calls: 100,
  tts_calls: 20,
};

const FRIENDLY_NAMES: Record<UsageColumn, string> = {
  llm_calls: "generation",
  image_calls: "image generation",
  tts_calls: "voiceover generation",
};

// Atomically increments today's usage counter and reports whether the call
// is allowed. Backed by a Postgres function so concurrent requests can't
// race past the daily cap. Plan-aware: looks up the caller's real
// subscription status before picking a limit table, so every existing
// call site (vo.ts, panel.ts, beats.ts, territory.ts, territory-analyze.ts)
// gets studio limits automatically once Phase 6 billing is live, with no
// changes needed at the call sites themselves.
export async function checkAndIncrementUsage(
  supabase: SupabaseClient,
  userId: string,
  column: UsageColumn,
): Promise<{ allowed: boolean; message: string }> {
  const isFree = await isUserOnFreePlan(supabase, userId);
  const limits = isFree ? FREE_TIER_LIMITS : STUDIO_TIER_LIMITS;
  const limit = limits[column];
  const { data, error } = await supabase.rpc("increment_usage_counter", {
    p_user_id: userId,
    p_column: column,
    p_limit: limit,
  });
  if (error) throw error;

  return {
    allowed: data !== null,
    message: isFree
      ? `Daily ${FRIENDLY_NAMES[column]} limit reached (${limit}/day on the free plan). Upgrade to Territory Studio for a higher limit, or try again tomorrow.`
      : `Daily ${FRIENDLY_NAMES[column]} limit reached (${limit}/day on the Studio plan). Try again tomorrow.`,
  };
}
