import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { DaysPlanView, ApprovedBy } from "@/components/PlanView";
import { api } from "@/lib/api";
import { askCoachPath } from "@/lib/focus";
import { useToast } from "@/context/ToastContext";

// Client view of the coach-approved training plan (kind="workout") or yoga practice (kind="yoga").
export default function Workouts({ kind = "workout" }) {
  const { push } = useToast();
  const navigate = useNavigate();
  const yoga = kind === "yoga";
  const [plan, setPlan] = useState(undefined);
  const [day, setDay] = useState(0);
  const [done, setDone] = useState({});
  const [sessions, setSessions] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => api.get("/workouts/sessions").then((r) => setSessions(r.data.filter((s) => (s.kind || "workout") === kind))).catch(() => {}), [kind]);
  useEffect(() => {
    setPlan(undefined); setDay(0); setDone({});
    api.get("/workouts/plan", { params: { type: kind } }).then((r) => setPlan(r.data.plan)).catch(() => setPlan(null));
    load();
  }, [kind, load]);

  const current = plan?.content.days?.[day];
  const total = current?.exercises.length || 0;
  const completed = Object.values(done).filter(Boolean).length;
  const pct = total ? Math.round((completed / total) * 100) : 0;

  const logSession = async () => {
    if (!current || completed === 0) { push(`Tick off at least one ${yoga ? "pose" : "exercise"} first.`, "error"); return; }
    setSaving(true);
    try {
      const exercises = current.exercises.filter((_, i) => done[i]).map((e) => ({ name: e.name, meta: `${e.sets} × ${e.reps}` }));
      await api.post("/workouts/sessions", { name: `${plan.content.title} — ${current.name}`, exercises, notes: `${completed}/${total} completed`, plan_id: plan.id, kind });
      push(yoga ? "Practice logged." : "Session logged.", "success");
      setDone({});
      load();
    } catch { push("Could not log session.", "error"); } finally { setSaving(false); }
  };

  const ask = () => navigate(askCoachPath(plan.approved_by, { type: "plan", id: plan.id, label: `${plan.content.title}${current ? ` — ${current.name}` : ""}` }));

  return (
    <div>
      <PageHeader eyebrow={yoga ? "Practice" : "Training"} title={yoga ? "My Yoga" : "My Training"}
        subtitle={yoga ? "Your coach-approved practice. Tick off poses as you go and log the session." : "Your coach-approved programme. Tick off exercises as you go and log the session."}
        action={plan ? <button className="btn btn-ghost" onClick={ask} data-testid="ask-coach-plan"><Icons.MessageCircle size={17} /> Ask coach</button> : null} />

      {plan === undefined && <div className="spinner" style={{ margin: "60px auto" }} />}
      {plan === null && (
        <div className="clay fade-up empty" data-testid="plan-pending" style={{ padding: "56px 20px" }}>
          <Icons.ClipboardList size={38} style={{ opacity: 0.55, marginBottom: 12 }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Your coach is preparing your {yoga ? "practice" : "plan"}</div>
          <div style={{ maxWidth: 420, margin: "0 auto", lineHeight: 1.6 }}>Plans are drafted from your goals and checked by your coach before they reach you. You'll get a notification when it's ready.</div>
        </div>
      )}

      {plan && (
        <div className="grid-main-side">
          <div className="clay fade-up min0" style={{ padding: 22 }}>
            <h3 className="display" style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{plan.content.title}</h3>
            {plan.content.summary && <p style={{ fontSize: 13.5, color: "var(--text-2)", marginBottom: 12, lineHeight: 1.6 }}>{plan.content.summary}</p>}
            <div style={{ marginBottom: 16 }}><ApprovedBy plan={plan} /></div>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <div className="eyebrow">Today's session</div>
              <span className="chip chip-accent">{completed}/{total} done</span>
            </div>
            <div className="progress-track" style={{ marginBottom: 14 }}><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
            <DaysPlanView content={plan.content} yoga={yoga} day={day} onDay={(i) => { setDay(i); setDone({}); }}
              done={done} onToggle={(i) => setDone((d) => ({ ...d, [i]: !d[i] }))} />
            <button data-testid="log-session-btn" className="btn btn-primary" disabled={saving} onClick={logSession} style={{ width: "100%", marginTop: 18, padding: 14 }}>
              <Icons.Save size={18} /> {saving ? "Saving..." : yoga ? "Log this practice" : "Log this session"}
            </button>
          </div>

          <div className="clay fade-up min0" style={{ padding: 22, animationDelay: "80ms" }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
              <div className="eyebrow">History</div>
              <span className="chip chip-neutral">{sessions.length}</span>
            </div>
            {sessions.length === 0 ? (
              <div className="empty"><Icons.History size={30} style={{ opacity: 0.6, marginBottom: 8 }} /><div>Nothing logged yet.</div></div>
            ) : (
              <div className="stack" data-testid="sessions-list">
                {sessions.map((s) => (
                  <div key={s.id} className="clay-inset" style={{ padding: "13px 14px" }}>
                    <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
                      <span className="truncate" style={{ fontSize: 13.5, fontWeight: 700 }}>{s.name}</span>
                      <span style={{ fontSize: 11.5, color: "var(--text-3)", flexShrink: 0 }}>{(s.created_at || "").slice(0, 10)}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>{s.exercises?.length || 0} {yoga ? "poses" : "exercises"} · {s.notes}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
