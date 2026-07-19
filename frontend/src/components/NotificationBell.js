import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

export default function NotificationBell() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState({ notifications: [], reminders: [], unread: 0, badge: 0 });
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const load = useCallback(() => api.get("/notifications").then((r) => setData(r.data)).catch(() => {}), []);

  useEffect(() => {
    if (!user) return;
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load, user]);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && data.unread > 0) {
      await api.post("/notifications/read").catch(() => {});
      load();
    }
  };

  const goto = (link) => { setOpen(false); if (link) navigate(link); };
  const items = [...data.reminders, ...data.notifications];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button data-testid="notif-bell" onClick={toggle} className="clay-sm"
        style={{ width: 44, height: 44, borderRadius: 13, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", background: "var(--surface)" }}>
        <Icons.Bell size={20} color="var(--text-2)" />
        {data.badge > 0 && (
          <span data-testid="notif-badge" style={{ position: "absolute", top: 6, right: 6, minWidth: 18, height: 18, padding: "0 4px", borderRadius: 9, background: "var(--accent)", color: "#fff", fontSize: 10.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {data.badge > 9 ? "9+" : data.badge}
          </span>
        )}
      </button>

      {open && (
        <div className="glass fade-up" data-testid="notif-panel"
          style={{ position: "absolute", top: 54, right: 0, width: 340, maxHeight: 440, overflowY: "auto", borderRadius: 18, padding: 14, zIndex: 60 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 6px 12px" }}>
            <span className="display" style={{ fontSize: 16, fontWeight: 700 }}>Notifications</span>
            <Icons.Bell size={16} color="var(--text-3)" />
          </div>
          {items.length === 0 ? (
            <div style={{ textAlign: "center", padding: "34px 0", color: "var(--text-3)", fontSize: 13.5 }}>You're all caught up.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((n) => {
                const isReminder = n.kind === "reminder";
                return (
                  <button key={n.id} data-testid="notif-item" onClick={() => goto(n.link)}
                    className="clay-inset" style={{ border: "none", cursor: "pointer", textAlign: "left", padding: "12px 13px", display: "flex", gap: 11, alignItems: "flex-start" }}>
                    <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, background: isReminder ? "var(--teal-soft)" : "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {isReminder ? <Icons.CalendarClock size={16} color="var(--teal)" /> : <Icons.Info size={16} color="var(--accent)" />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>{n.title}</div>
                      <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>{n.body}</div>
                    </div>
                    {isReminder && <Icons.Video size={15} color="var(--teal)" style={{ flexShrink: 0, marginTop: 2 }} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
