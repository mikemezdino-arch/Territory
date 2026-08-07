import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabaseClient";
import { PlanContext } from "./planContext";

// One real subscription lookup per app session (not per page) — every
// /app/* page renders under AppLayout, which mounts this once, so
// navigating between pages doesn't re-fire the query. Stripe is the
// source of truth; this reads the subscriptions row the webhook keeps in
// sync, scoped to the caller by RLS (owner-only select).
export function PlanProvider({ children }: { children: ReactNode }) {
  const [isFreePlan, setIsFreePlan] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          setIsFreePlan(true);
          setLoading(false);
        }
        return;
      }

      const { data } = await supabase
        .from("subscriptions")
        .select("plan, current_period_end")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;

      const isPaid =
        !!data &&
        data.plan === "studio" &&
        (!data.current_period_end || new Date(data.current_period_end).getTime() > Date.now());
      setIsFreePlan(!isPaid);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <PlanContext.Provider value={{ isFreePlan, loading, refreshPlan: () => setRefreshKey((k) => k + 1) }}>
      {children}
    </PlanContext.Provider>
  );
}
