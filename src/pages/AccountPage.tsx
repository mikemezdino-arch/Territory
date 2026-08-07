import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { usePlan } from "../hooks/usePlan";

// Display-only — mirrors the enforcement limits in api/_lib/creditCap.ts.
// Keep these two in sync by hand; there's no shared source since one runs
// server-side against the service-role client and this runs client-side.
const LIMITS = {
  free: { llm_calls: 30, image_calls: 40, tts_calls: 5 },
  studio: { llm_calls: 200, image_calls: 100, tts_calls: 20 },
};

interface UsageRow {
  llm_calls: number;
  image_calls: number;
  tts_calls: number;
}

export function AccountPage() {
  const { isFreePlan, loading: planLoading, refreshPlan } = usePlan();
  const [searchParams] = useSearchParams();
  const [usage, setUsage] = useState<UsageRow | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(true);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  useEffect(() => {
    if (!searchParams.get("upgraded")) return;
    // Stripe fires the webhook asynchronously right after the Checkout
    // redirect lands here — it may not have landed the instant this page
    // mounts, so give it a moment before re-checking rather than trusting
    // whatever usePlan() already had cached from before the upgrade.
    const timeout = setTimeout(refreshPlan, 2000);
    return () => clearTimeout(timeout);
  }, [searchParams, refreshPlan]);

  useEffect(() => {
    let cancelled = false;

    async function loadUsage() {
      setLoadingUsage(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("usage_counters")
        .select("llm_calls, image_calls, tts_calls")
        .eq("user_id", user.id)
        .eq("date", today)
        .maybeSingle();
      if (cancelled) return;
      setUsage((data as UsageRow) ?? { llm_calls: 0, image_calls: 0, tts_calls: 0 });
      setLoadingUsage(false);
    }

    loadUsage();
    return () => {
      cancelled = true;
    };
  }, []);

  async function openBillingPortal() {
    setOpeningPortal(true);
    setPortalError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session expired. Please sign in again.");

      const res = await fetch("/api/billing-portal", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Could not open billing portal.");
      window.location.href = data.url;
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : "Could not open billing portal.");
      setOpeningPortal(false);
    }
  }

  const limits = isFreePlan ? LIMITS.free : LIMITS.studio;

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/app" className="back-link">
          Back to projects
        </Link>
        <h1>Account</h1>
      </header>

      <main>
        {planLoading ? (
          <p className="loading-msg">Loading…</p>
        ) : (
          <>
            <p>
              <strong>Plan:</strong> {isFreePlan ? "Free" : "Territory Studio — $29/mo"}
            </p>

            {searchParams.get("upgraded") && isFreePlan && (
              <p className="phase-note">
                Upgrade received — confirming with Stripe can take a few seconds. Refresh if this still shows Free
                after a moment.
              </p>
            )}

            <h2>Today's usage</h2>
            {loadingUsage || !usage ? (
              <p className="loading-msg">Loading…</p>
            ) : (
              <ul>
                <li>
                  Generation: {usage.llm_calls} / {limits.llm_calls}
                </li>
                <li>
                  Image generation: {usage.image_calls} / {limits.image_calls}
                </li>
                <li>
                  Voiceover generation: {usage.tts_calls} / {limits.tts_calls}
                </li>
              </ul>
            )}

            {!isFreePlan && (
              <button type="button" className="primary-btn" onClick={openBillingPortal} disabled={openingPortal}>
                {openingPortal ? "Opening…" : "Manage billing"}
              </button>
            )}
            {portalError && (
              <div className="error-banner" role="alert">
                {portalError}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
