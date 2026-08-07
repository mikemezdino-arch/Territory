import { lazy, Suspense } from "react";
import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { AccountPage } from "./pages/AccountPage";
import { NewProjectPage } from "./pages/NewProjectPage";
import { TerritoriesPage } from "./pages/TerritoriesPage";
import { LookProfilePage } from "./pages/LookProfilePage";
import { BeatsPage } from "./pages/BeatsPage";
import { AnimaticPage } from "./pages/AnimaticPage";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AppLayout } from "./components/AppLayout";
import "./App.css";

// jsPDF + ffmpeg.wasm are heavy (large gzipped payload); code-split so they
// only load when a user actually visits /export, keeping the animatic
// page's bundle lean for its Lighthouse performance target.
const ExportPage = lazy(() => import("./pages/ExportPage").then((m) => ({ default: m.ExportPage })));

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/app" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<ProjectsPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="new" element={<NewProjectPage />} />
          <Route path="p/:id/territories" element={<TerritoriesPage />} />
          <Route path="p/:id/t/:territoryId/look" element={<LookProfilePage />} />
          <Route path="p/:id/t/:territoryId/beats" element={<BeatsPage />} />
          <Route path="p/:id/t/:territoryId/board" element={<AnimaticPage />} />
          <Route
            path="p/:id/t/:territoryId/export"
            element={
              <Suspense fallback={<p className="loading-msg">Loading…</p>}>
                <ExportPage />
              </Suspense>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
