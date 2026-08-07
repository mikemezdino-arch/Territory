import { useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useSession } from "../hooks/useSession";
import logo from "../assets/territory-logo.png";

export function LoginPage() {
  const { session, loading } = useSession();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  if (!loading && session) {
    return <Navigate to="/app" replace />;
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + "/app" },
    });
    if (signInError) {
      setStatus("error");
      setError(signInError.message);
      return;
    }
    setStatus("sent");
  }

  return (
    <div className="auth-shell">
      <img src={logo} alt="Territory" className="auth-logo" />
      <p>Sign in with a magic link — no password needed.</p>

      {status === "sent" ? (
        <p className="auth-sent">Check {email} for a sign-in link.</p>
      ) : (
        <form className="auth-form" onSubmit={sendMagicLink}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@studio.com"
          />
          <button type="submit" className="primary-btn" disabled={status === "sending"}>
            {status === "sending" ? "Sending…" : "Send magic link"}
          </button>
          {status === "error" && error && <p className="auth-error">{error}</p>}
        </form>
      )}
    </div>
  );
}
