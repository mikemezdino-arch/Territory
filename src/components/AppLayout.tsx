import { useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { UpgradeModal } from "./UpgradeModal";
import { PlanProvider } from "../context/PlanProvider";
import { usePlan } from "../hooks/usePlan";
import { supabase } from "../lib/supabaseClient";

function TopBar() {
  const { isFreePlan, loading } = usePlan();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const navigate = useNavigate();

  async function signOut() {
    await supabase.auth.signOut();
    navigate("/login");
  }

  return (
    <>
      <div className="top-bar">
        {isFreePlan && !loading && (
          <button type="button" className="subscribe-link" onClick={() => setShowUpgradeModal(true)}>
            Subscribe
          </button>
        )}
        <button type="button" className="expand-btn" onClick={signOut}>
          Sign out
        </button>
      </div>
      {showUpgradeModal && <UpgradeModal onClose={() => setShowUpgradeModal(false)} />}
    </>
  );
}

export function AppLayout() {
  return (
    <PlanProvider>
      <div className="app-layout">
        <Sidebar />
        <div className="app-main-content">
          <TopBar />
          <Outlet />
        </div>
      </div>
    </PlanProvider>
  );
}
