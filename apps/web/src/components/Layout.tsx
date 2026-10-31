import {
  Atom, BookOpen, ChevronRight, FolderKanban, LayoutDashboard, LogOut, Menu, ShieldCheck, Activity,
} from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { GLOBAL_ROLE } from "../lib/format";

export type Crumb = { label: string; to?: string };
const CrumbCtx = createContext<(c: Crumb[]) => void>(() => {});

export function useCrumbs(crumbs: Crumb[]) {
  const set = useContext(CrumbCtx);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    set(crumbs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, set]);
}

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0f1a2e" stroke="#1f2f4d" />
      <g stroke="#4fd1e8" strokeWidth="1.3" opacity=".7">
        <path d="M8 10 16 16 8 22M16 16 24 11M16 16 24 21M8 10 24 11M8 22 24 21" />
      </g>
      <circle cx="8" cy="10" r="2.5" fill="#4fd1e8" />
      <circle cx="8" cy="22" r="2.5" fill="#4fd1e8" />
      <circle cx="16" cy="16" r="3.2" fill="#f5b84a" />
      <circle cx="24" cy="11" r="2.5" fill="#4fd1e8" />
      <circle cx="24" cy="21" r="2.5" fill="#4fd1e8" />
    </svg>
  );
}

export default function Layout() {
  const { me, signOut } = useAuth();
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const initials = (me?.display_name || me?.email || "?").slice(0, 2).toUpperCase();

  const nav: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
    { to: "/", label: "Inicio", icon: <LayoutDashboard />, end: true },
    { to: "/projects", label: "Proyectos", icon: <FolderKanban /> },
    { to: "/jobs", label: "Entrenamientos", icon: <Activity /> },
    { to: "/fundamentals", label: "Fundamentos", icon: <BookOpen /> },
    { to: "/families", label: "Familias de redes", icon: <Atom /> },
  ];

  return (
    <CrumbCtx.Provider value={setCrumbs}>
      <div className="shell">
        <aside className={`sidebar ${open ? "open" : ""}`} aria-label="Navegación principal">
          <Link to="/" className="brand" style={{ color: "inherit" }}>
            <BrandMark />
            <div>
              <div className="brand-name">NeuroLab</div>
              <div className="brand-sub">Observatorio de redes neuronales</div>
            </div>
          </Link>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              {n.icon}
              {n.label}
            </NavLink>
          ))}
          {me?.role === "admin" && (
            <>
              <div className="nav-group">Administración</div>
              <NavLink to="/admin" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                <ShieldCheck />
                Seguridad y sistema
              </NavLink>
            </>
          )}
          <div className="sidebar-foot">
            <div className="user-chip">
              <div className="avatar">{initials}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {me?.display_name}
                </div>
                <div className="xs muted">{me ? GLOBAL_ROLE[me.role] : ""}</div>
              </div>
              <button className="btn ghost icon" onClick={signOut} aria-label="Cerrar sesión" title="Cerrar sesión">
                <LogOut />
              </button>
            </div>
          </div>
        </aside>
        <div className="main">
          <header className="topbar">
            <button className="btn ghost icon menu-btn" onClick={() => setOpen(!open)} aria-label="Abrir menú">
              <Menu />
            </button>
            <nav className="crumbs" aria-label="Ruta">
              {crumbs.map((c, i) => (
                <span key={i} className="row" style={{ gap: 8 }}>
                  {i > 0 && <ChevronRight />}
                  {c.to && i < crumbs.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span className="here">{c.label}</span>}
                </span>
              ))}
            </nav>
          </header>
          <main className="page">
            <Outlet />
          </main>
        </div>
      </div>
    </CrumbCtx.Provider>
  );
}
