import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

interface UpgradeModalProps {
  feature?: string;
  onClose: () => void;
}

const STUDIO_FEATURES = [
  "Unlimited territories per project",
  "MP4 and Pitch PDF downloads",
  "Higher-quality image rendering",
  "Higher daily limits — 200 LLM · 100 image · 20 TTS calls/day (vs. 30 · 40 · 5 on free)",
  "Priority email support",
];

export function UpgradeModal({ feature, onClose }: UpgradeModalProps) {
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpgrade() {
    setRedirecting(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session expired. Please sign in again.");

      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Could not start checkout.");

      // Full navigation, not a client-side route change — Checkout is a
      // Stripe-hosted page outside this app.
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout.");
      setRedirecting(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Upgrade to Territory Studio</h2>
        {feature && <p>{feature} is part of Territory Studio ($29/mo).</p>}
        <p className="modal-subhead">{feature ? "Studio also unlocks:" : "Territory Studio ($29/mo) unlocks:"}</p>
        <ul className="modal-feature-list">
          {STUDIO_FEATURES.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div className="modal-actions">
          <button type="button" className="primary-btn" onClick={handleUpgrade} disabled={redirecting}>
            {redirecting ? "Redirecting…" : "Upgrade — $29/mo"}
          </button>
          <button type="button" className="expand-btn" onClick={onClose}>
            Maybe later
          </button>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
