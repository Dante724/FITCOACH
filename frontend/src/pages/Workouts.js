import { useEffect, useState, useCallback } from "react";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";

export default function Workouts() {
  const { user } = useAuth();
  const { push } = useToast();
  const isYoga = user?.focus === "yoga";
  const [plan, setPlan] = useState(null);
  const [done, setDone] = useState({});
  const [sessions, setSessions] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => api.get("/workouts/sessions").then((r) => setSessions(r.data)).catch(() => {}), []);
  useEffect(() => {
    api.get("/workouts/plan").then((r) => setPlan(r.data)).catch(() => {});
    load();
  }, [load]);

  const toggle = (i) => setDone((d) => ({ ...d, [i]: !d[i] }));
  const total = plan?.exercises.length || 0;
  const completed = Object.values(done).filter(Boolean).length;
  const pct = total ? Math.round((completed / total) * 100) : 0;

  const logSession = async () => {
    if (!plan || completed === 0) { push("Complete at least one exercise first.", "error"); return; }
    setSaving(true);
    try {
      const exercises = plan.exercises.filter((_, i) => done[i]).map((e) => ({ name: e.name, meta: e.meta }));
      await api.post("/workouts/sessions", { name: plan.name, exercises, duration_min: null, notes: `${completed}/${total} completed` });
      push("Session logged.", "success");
      setDone({});
      load();
    } catch { push("Could not log session.", "error"); } finally { setSaving(false); }
  };

  return (
    <div>
      <PageHeader eyebrow={isYoga ? "Practice" : "Training"} title={isYoga ? "Yoga Sessions" : "Workouts"}
        subtitle={isYoga ? "Follow today's flow and log your practice. Review your session history below." : "Work through today's programme, tick off exercises and save the session to your history."} />

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 18 }}>
        <div className="clay fade-up" style={{ padding: 26 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div className="eyebrow">Current session</div>
            <span className="chip chip-accent">{completed}/{total} done</span>
          </div>
          <h3 className="display" style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>{plan?.name || "Loading..."}</h3>

          <div className="progress-track" style={{ marginBottom: 20 }}><div className="progress-fill" style={{ width: `${pct}%` }} /></div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="exercise-list">
            {plan?.exercises.map((ex, i) => (
              <button key={`${ex.name}-${i}`} data-testid={`exercise-${i}`} onClick={() => toggle(i)}
                className="clay-inset" style={{ border: "none", cursor: "pointer", padding: "14px 16px", display: "flex", alignItems: "center", gap: 13, textAlign: "left" }}>
                <div style={{ width: 24, height: 24, borderRadius: 8, background: done[i] ? "var(--teal)" : "transparent", border: done[i] ? "none" : "2px solid rgba(139,150,172,0.4)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {done[i] && <Icons.Check size={15} color="#fff" />}
                </div>
                <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600, textDecoration: done[i] ? "line-through" : "none", color: done[i] ? "var(--text-3)" : "var(--text)" }}>{ex.name}</span>
                <span className="chip chip-neutral">{ex.meta}</span>
              </button>
            ))}
          </div>

          <button data-testid="log-session-btn" className="btn btn-primary" disabled={saving} onClick={logSession} style={{ width: "100%", marginTop: 20, padding: 14 }}>
            <Icons.Save size={18} /> {saving ? "Saving..." : "Log this session"}
          </button>
        </div>

        <div className="clay fade-up" style={{ padding: 26, animationDelay: "80ms" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div className="eyebrow">Previous sessions</div>
            <span className="chip chip-neutral">{sessions.length}</span>
          </div>
          {sessions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "44px 0", color: "var(--text-3)" }}>
              <Icons.History size={34} style={{ marginBottom: 10, opacity: 0.6 }} />
              <div style={{ fontSize: 14 }}>No sessions logged yet.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }} data-testid="sessions-list">
              {sessions.map((s) => (
                <div key={s.id} className="clay-inset" style={{ padding: "15px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{s.name}</span>
                    <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{(s.created_at || "").slice(0, 10)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>{s.exercises?.length || 0} exercises · {s.notes}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
