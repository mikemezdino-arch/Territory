import { Link, NavLink, useMatch } from "react-router-dom";
import logo from "../assets/territory-logo.png";

export function Sidebar() {
  // Derived strictly from the current URL, not persisted anywhere — the
  // sidebar should lock the moment you're not actually inside a specific
  // territory's pages (e.g. back on the Projects list), not stay unlocked
  // just because you visited one earlier in the session.
  const match = useMatch("/app/p/:id/t/:territoryId/*");
  const base = match ? `/app/p/${match.params.id}/t/${match.params.territoryId}` : null;

  return (
    <nav className="app-sidebar">
      <Link to="/app" className="sidebar-logo-link">
        <img src={logo} alt="Territory" className="sidebar-logo" />
      </Link>
      <NavLink to="/app" end className={({ isActive }) => `sidebar-link${isActive ? " sidebar-link-active" : ""}`}>
        Projects
      </NavLink>
      <NavLink to="/app/account" className={({ isActive }) => `sidebar-link${isActive ? " sidebar-link-active" : ""}`}>
        Account
      </NavLink>
      {base ? (
        <>
          <NavLink to={`${base}/beats`} className={({ isActive }) => `sidebar-link${isActive ? " sidebar-link-active" : ""}`}>
            Beat sheets
          </NavLink>
          <NavLink to={`${base}/board`} className={({ isActive }) => `sidebar-link${isActive ? " sidebar-link-active" : ""}`}>
            Animatics
          </NavLink>
          <NavLink to={`${base}/export`} className={({ isActive }) => `sidebar-link${isActive ? " sidebar-link-active" : ""}`}>
            Pitches
          </NavLink>
        </>
      ) : (
        <>
          <span className="sidebar-link sidebar-link-disabled" title="Open a project and territory first">
            Beat sheets
          </span>
          <span className="sidebar-link sidebar-link-disabled" title="Open a project and territory first">
            Animatics
          </span>
          <span className="sidebar-link sidebar-link-disabled" title="Open a project and territory first">
            Pitches
          </span>
        </>
      )}
    </nav>
  );
}
