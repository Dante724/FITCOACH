import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { navForFocus, getFocus, focusAllowsPath } from "@/lib/focus";
import NotificationBell from "@/components/NotificationBell";
import Logo from "@/components/Logo";
import Avatar from "@/components/Avatar";

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const role = user?.role || "client";
  const focus = getFocus(user?.focus);

  let nav;
  if (role === "admin") {
    nav = [{ feature: "admin", path: "/admin", label: "Admin Console", icon: "ShieldCheck" }];
  } else if (role === "trainer") {
    nav = [
      { feature: "trainer", path: "/trainer", label: "Clients & Today", icon: "LayoutDashboard", end: true },
      { feature: "availability", path: "/trainer/availability", label: "Availability", icon: "CalendarClock" },
    ];
  } else {
    nav = navForFocus(user?.focus);
  }

  useEffect(() => {
    if (user && role === "client" && !focusAllowsPath(user.focus, location.pathname)) {
      navigate("/dashboard", { replace: true });
    }
  }, [location.pathname, user, role, navigate]);

  const roleLabel = role === "trainer" ? `${user?.coach_type === "yoga" ? "Yoga" : "Fitness"} coach` : role.charAt(0).toUpperCase() + role.slice(1);
  const [drawer, setDrawer] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => { setDrawer(false); }, [location.pathname]);
  useEffect(() => {
    if (role !== "client") return;
    api.get("/messages/unread").then((r) => setUnread(r.data.total || 0)).catch(() => {});
  }, [role, location.pathname]);

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <div className="mobile-topbar">
        <button data-testid="menu-btn" className="icon-btn" onClick={() => setDrawer(true)} aria-label="Open menu">
          <Icons.Menu size={22} color="var(--text)" />
        </button>
        <Logo />
        <NotificationBell />
      </div>
      <div className={`sidebar-overlay${drawer ? " open" : ""}`} onClick={() => setDrawer(false)} />

      <aside className={`app-sidebar${drawer ? " open" : ""}`} data-testid="sidebar">
        <div style={{ padding: "2px 10px 22px" }}><Logo /></div>
        <div style={{ padding: "0 10px 14px", fontSize: 12, color: "var(--text-3)" }}>
          {role === "client" ? (focus ? focus.label : "Client") : roleLabel}
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, overflowY: "auto", minHeight: 0 }}>
          {nav.map((item) => {
            const Icon = Icons[item.icon] || Icons.Circle;
            return (
              <NavLink key={item.path} to={item.path} end={item.end} data-testid={`nav-${item.feature}`} className="nav-link">
                <Icon size={17} strokeWidth={1.75} />
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.feature === "messages" && unread > 0 && <span className="badge">{unread}</span>}
              </NavLink>
            );
          })}
        </nav>
        <div className="row" style={{ borderTop: "1px solid var(--border)", padding: "14px 6px 0", marginTop: 12 }}>
          <div data-testid="profile-link" onClick={() => navigate("/profile")} className="row min0" style={{ flex: 1, cursor: "pointer", gap: 10 }}>
            <Avatar name={user?.name} picture={user?.picture} size={30} />
            <div className="min0">
              <div className="truncate" style={{ fontSize: 13.5, fontWeight: 500 }}>{user?.name}</div>
              <div style={{ fontSize: 12, color: "var(--text-3)" }}>{roleLabel}</div>
            </div>
          </div>
          <button className="icon-btn" data-testid="logout-btn" onClick={logout} title="Log out" aria-label="Log out"><Icons.LogOut size={16} /></button>
        </div>
      </aside>

      <main className="app-main">
        <div className="desktop-bell" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <NotificationBell />
        </div>
        <Outlet />
      </main>
    </div>
  );
}
