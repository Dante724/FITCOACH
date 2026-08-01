import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { navForFocus, getFocus, focusAllowsPath } from "@/lib/focus";
import NotificationBell from "@/components/NotificationBell";

function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
      <div style={{ width: 38, height: 38, borderRadius: 12, background: "linear-gradient(135deg, var(--accent), var(--accent-2))", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 14px rgba(224,92,55,0.4)" }}>
        <Icons.Zap size={20} color="#fff" fill="#fff" />
      </div>
      <span className="display" style={{ fontSize: 20, fontWeight: 800 }}>FitCoach</span>
    </div>
  );
}

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
    nav = [{ feature: "trainer", path: "/trainer", label: "My Sessions", icon: "CalendarClock" }];
  } else {
    nav = navForFocus(user?.focus);
  }

  useEffect(() => {
    if (user && role === "client" && !focusAllowsPath(user.focus, location.pathname)) {
      navigate("/dashboard", { replace: true });
    }
  }, [location.pathname, user, role, navigate]);

  const initials = (user?.name || "U").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => { setDrawer(false); }, [location.pathname]);

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <div className={`mobile-topbar glass${drawer ? " " : ""}`}>
        <button data-testid="menu-btn" onClick={() => setDrawer(true)} style={{ border: "none", background: "transparent", cursor: "pointer", padding: 6, display: "flex" }}>
          <Icons.Menu size={24} color="var(--text)" />
        </button>
        <Logo />
        <NotificationBell />
      </div>
      <div className={`sidebar-overlay${drawer ? " open" : ""}`} onClick={() => setDrawer(false)} />

      <aside className={`glass app-sidebar${drawer ? " open" : ""}`} data-testid="sidebar"
        style={{ width: 250, position: "fixed", top: 16, left: 16, bottom: 16, borderRadius: 26, display: "flex", flexDirection: "column", padding: "24px 18px", zIndex: 42 }}>
        <div style={{ padding: "0 6px 22px" }}><Logo /></div>
        {role === "client" && focus && (
          <div className="clay-inset" style={{ padding: "10px 14px", marginBottom: 18 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-3)" }}>Programme</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3, color: focus.accent }}>{focus.label}</div>
          </div>
        )}
        {role !== "client" && (
          <div className="clay-inset" style={{ padding: "10px 14px", marginBottom: 18 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-3)" }}>Role</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3, color: role === "admin" ? "var(--accent)" : "var(--teal)" }}>{roleLabel}</div>
          </div>
        )}
        <nav style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1 }}>
          {nav.map((item) => {
            const Icon = Icons[item.icon] || Icons.Circle;
            return (
              <NavLink key={item.path} to={item.path} data-testid={`nav-${item.feature}`}
                style={({ isActive }) => ({
                  display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 14,
                  fontSize: 14, fontWeight: 600, textDecoration: "none",
                  color: isActive ? "#fff" : "var(--text-2)",
                  background: isActive ? "linear-gradient(135deg, var(--accent), var(--accent-2))" : "transparent",
                  boxShadow: isActive ? "0 6px 16px rgba(224,92,55,0.35)" : "none",
                  transition: "all 0.18s ease",
                })}>
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="clay-inset" style={{ padding: "12px", display: "flex", alignItems: "center", gap: 11, marginTop: 12 }}>
          <div data-testid="profile-link" onClick={() => navigate("/profile")} style={{ display: "flex", alignItems: "center", gap: 11, flex: 1, minWidth: 0, cursor: "pointer" }}>
            {user?.picture ? (
              <img src={user.picture} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />
            ) : (
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, var(--accent), #7c6bd6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff" }}>{initials}</div>
            )}
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user?.name}</div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>{roleLabel}</div>
            </div>
          </div>
          <Icons.LogOut size={17} data-testid="logout-btn" style={{ cursor: "pointer", color: "var(--text-3)" }} onClick={logout} />
        </div>
      </aside>

      <main className="app-main" style={{ marginLeft: 282, flex: 1, padding: "24px 42px 40px", maxWidth: 1180 }}>
        <div className="desktop-bell" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <NotificationBell />
        </div>
        <Outlet />
      </main>
    </div>
  );
}
