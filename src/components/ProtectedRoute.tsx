import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "../hooks/useSession";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();

  if (loading) {
    return <p className="loading-msg">Loading…</p>;
  }
  if (!session) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
