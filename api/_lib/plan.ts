import type { SupabaseClient } from "@supabase/supabase-js";

// Stripe is the source of truth; subscriptions is a local mirror kept in
// sync by the webhook. A missing row, a non-"studio" plan, or a lapsed
// current_period_end are all treated as free — the date check matters
// because it's what protects a user's access through the period they
// already paid for if a cancellation webhook fires mid-cycle, and it's
// what stops a stale "studio" row from granting access forever if a
// renewal webhook is ever delayed or dropped.
export async function isUserOnFreePlan(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("subscriptions")
    .select("plan, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data || data.plan !== "studio") return true;
  if (data.current_period_end && new Date(data.current_period_end).getTime() < Date.now()) return true;
  return false;
}
