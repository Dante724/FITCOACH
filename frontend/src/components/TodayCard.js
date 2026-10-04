import { useEffect, useState, lazy, Suspense } from "react";
import * as Icons from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/context/ToastContext";

const WeekCard = lazy(() => import("@/components/WeekCard"));

export const CHECKIN_SCALES = [
  { key: "sleep", q: "How did you sleep?", faces: ["😫", "😕", "😐", "🙂", "😴"], caps: ["Awful", "Poor", "OK", "Good", "Great"] },
  { key: "energy", q: "Energy today?", faces: ["🪫", "😮‍💨", "😐", "⚡", "🚀"], caps: ["Drained", "Low", "OK", "Good", "High"] },
  { key: "soreness", q: "How sore are you?", faces: ["✨", "🙂", "😐", "😣", "🥵"], caps: ["None", "Light", "Some", "Sore", "Very"] },
  { key: "mood", q: "Mood?", faces: ["😞", "😕", "😐", "🙂", "😄"], caps: ["Low", "Meh", "OK", "Good", "Great"] },
];

function CheckinForm({ initial, onSaved, onCancel }) {
  const { push } = useToast();
  const [vals, setVals] = useState(() => (initial ? { sleep: initial.sleep, energy: initial.energy, soreness: initial.soreness, mood: initial.mood } : {}));
  const [note, setNote] = useState(initial?.note || "");
  const [saving, setSaving] = useState(false);
  const ready = CHECKIN_SCALES.every((s) => vals[s.key]);
  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put("/today/checkin", { ...vals, note: note.trim() || null });
      onSaved(r.data);
      push("Checked in — your coach can see it.", "success");
    } catch (e) { push(e?.response?.data?.detail || "Could not save your check-in.", "error"); } finally { setSaving(false); }
  };
  return (
    <div className="stack" style={{ gap: 14 }} data-testid="checkin-form">
      {CHECKIN_SCALES.map((s) => (
        <div key={s.key}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 7 }}>{s.q}</div>
          <div className="scale" role="radiogroup" aria-label={s.q}>
            {s.faces.map((f, i) => (
              <button key={i} type="button" role="radio" aria-checked={vals[s.key] === i + 1} className={vals[s.key] === i + 1 ? "on" : ""}
                onClick={() => setVals((v) => ({ ...v, [s.key]: i + 1 }))} data-testid={`checkin-${s.key}-${i + 1}`}>
                <span className="face" aria-hidden="true">{f}</span><span className="cap">{s.caps[i]}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <input className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} placeholder="Anything your coach should know? (optional)" data-testid="checkin-note" />
      <div className="row" style={{ gap: 10 }}>
        {onCancel && <button className="btn btn-ghost" onClick={onCancel} style={{ flex: 1 }}>Cancel</button>}
        <button className="btn btn-primary" disabled={!ready || saving} onClick={save} style={{ flex: 2 }} data-testid="checkin-save">
          <Icons.Check size={16} /> {saving ? "Saving…" : "Save check-in"}
        </button>
      </div>
    </div>
  );
}

export default function TodayCard() {
  const { push } = useToast();
  const [today, setToday] = useState(null);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState("");

  useEffect(() => { api.get("/today").then((r) => setToday(r.data)).catch(() => {}); }, []);
  if (!today) return null;

  const toggle = async (t) => {
    const done = !today.done[t.id];
    setBusy(t.id);
    setToday((d) => ({ ...d, done: done ? { ...d.done, [t.id]: true } : Object.fromEntries(Object.entries(d.done).filter(([k]) => k !== t.id)) }));
    try { setToday((await api.put(`/today/targets/${t.id}`, { done })).data); }
    catch { push("Could not update — try again.", "error"); api.get("/today").then((r) => setToday(r.data)).catch(() => {}); }
    finally { setBusy(""); }
  };

  const doneCount = today.targets.filter((t) => today.done[t.id]).length;
  const c = today.checkin;
  const showForm = !c || editing;

  return (
    <div className="grid-2 fade-up" style={{ marginBottom: 18 }} data-testid="today-card">
      <div className="clay min0" style={{ padding: 20 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 14, gap: 8 }}>
          <div className="min0">
            <div className="eyebrow">Daily check-in</div>
            <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 2 }}>30 seconds · helps your coach adjust your plan</div>
          </div>
          {today.streak > 0 && <span className="chip chip-amber" data-testid="streak" style={{ flexShrink: 0 }}><Icons.Flame size={13} /> {today.streak}-day streak</span>}
        </div>
        {showForm ? (
          <CheckinForm initial={c} onCancel={c ? () => setEditing(false) : null} onSaved={(d) => { setToday(d); setEditing(false); }} />
        ) : (
          <div data-testid="checkin-done">
            <div className="row-wrap" style={{ gap: 8, marginBottom: 12 }}>
              {CHECKIN_SCALES.map((s) => (
                <span key={s.key} className="chip chip-neutral" title={s.q}><span aria-hidden="true">{s.faces[c[s.key] - 1]}</span> {s.key[0].toUpperCase() + s.key.slice(1)} · {s.caps[c[s.key] - 1]}</span>
              ))}
            </div>
            {c.note && <div className="clay-inset" style={{ padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>“{c.note}”</div>}
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: "var(--teal)", fontWeight: 600 }}><Icons.CircleCheck size={15} style={{ verticalAlign: -3 }} /> Done for today</span>
              <button className="btn btn-ghost" onClick={() => setEditing(true)} style={{ padding: "7px 12px", fontSize: 12.5 }}><Icons.PencilLine size={14} /> Edit</button>
            </div>
          </div>
        )}
      </div>

      <div className="clay min0" style={{ padding: 20, display: "flex", flexDirection: "column" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div className="eyebrow">Today's targets</div>
            <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 2 }}>
              {today.targets.length ? `${doneCount} of ${today.targets.length} done · set by your coach` : "Set by your coach"}
            </div>
          </div>
          {today.targets.length > 0 && doneCount === today.targets.length && <span className="chip chip-teal"><Icons.PartyPopper size={13} /> All done</span>}
        </div>
        <div className="stack" style={{ gap: 8, flex: 1 }}>
          {today.targets.map((t) => {
            const done = !!today.done[t.id];
            return (
              <button key={t.id} className={`target-row${done ? " done" : ""}`} onClick={() => toggle(t)} disabled={busy === t.id} aria-pressed={done} data-testid={`target-${t.id}`}>
                <span className="tick">{done && <Icons.Check size={14} />}</span>
                <span className="target-label min0 truncate" style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{t.label}</span>
                {t.goal != null && <span style={{ fontSize: 12.5, color: "var(--text-2)", flexShrink: 0 }}>{Number(t.goal).toLocaleString("en-IN")}{t.unit ? ` ${t.unit}` : ""}</span>}
              </button>
            );
          })}
          {today.targets.length === 0 && (
            <div className="clay-inset" style={{ padding: 14, fontSize: 13.5, color: "var(--text-2)" }}>
              Your coach hasn't set daily targets yet — things like steps, water or protein will show up here to tick off.
            </div>
          )}
        </div>
        <button className="btn btn-ghost" onClick={() => setSharing(true)} style={{ marginTop: 14 }} data-testid="share-week">
          <Icons.Share2 size={16} /> Share my week
        </button>
      </div>
      {sharing && <Suspense fallback={null}><WeekCard onClose={() => setSharing(false)} /></Suspense>}
    </div>
  );
}
