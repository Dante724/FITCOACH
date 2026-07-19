import { useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { navForFocus, getFocus, focusAllowsPath } from "@/lib/focus";

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
  const focus = getFocus(user?.focus);
  const nav = navForFocus(user?.focus);

  useEffect(() => {
    if (user && !focusAllowsPath(user.focus, location.pathname)) {
      navigate("/dashboard", { replace: true });
    }
  }, [location.pathname, user, navigate]);

  const initials = (user?.name || "U").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside className="glass" data-testid="sidebar"
        style={{ width: 250, position: "fixed", top: 16, left: 16, bottom: 16, borderRadius: 26, display: "flex", flexDirection: "column", padding: "24px 18px", zIndex: 40 }}>
        <div style={{ padding: "0 6px 22px" }}><Logo /></div>
        {focus && (
          <div className="clay-inset" style={{ padding: "10px 14px", marginBottom: 18 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-3)" }}>Programme</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3, color: focus.accent }}>{focus.label}</div>
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
          {user?.picture ? (
            <img src={user.picture} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />
          ) : (
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, var(--accent), #7c6bd6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff" }}>{initials}</div>
          )}
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user?.name}</div>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>Member</div>
          </div>
          <Icons.LogOut size={17} data-testid="logout-btn" style={{ cursor: "pointer", color: "var(--text-3)" }} onClick={logout} />
        </div>
      </aside>

      <main style={{ marginLeft: 282, flex: 1, padding: "34px 42px", maxWidth: 1180 }}>
        <Outlet />
      </main>
    </div>
  );
}
