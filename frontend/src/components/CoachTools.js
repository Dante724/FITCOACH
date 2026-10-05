import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import { PLAN_LABEL, timeAgo, localDate } from "@/lib/focus";
import { CHECKIN_SCALES } from "@/components/TodayCard";

// ── Weekly summary (AI when a key is set, otherwise built from the numbers) ──────────────────────────────────────────
export function WeeklySummary({ clientId, brief, canMessage, onUseMessage }) {
  const { push } = useToast();
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = (refresh = false) => {
    setLoading(true);
    api.get(`/coach/clients/${clientId}/summary`, { params: refresh ? { refresh: true } : {} })
      .then((r) => setS(r.data)).catch((e) => push(e?.response?.data?.detail || "Could not load the summary.", "error"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="clay fade-up min0" style={{ padding: 20 }} data-testid="weekly-summary">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <div className="eyebrow">This week</div>
          {s && <span className={`chip ${s.ai ? "chip-violet" : "chip-neutral"}`} style={{ fontSize: 11 }}>{s.ai ? <><Icons.Sparkles size={11} /> AI summary</> : "Auto summary"}</span>}
        </div>
        <button className="icon-btn" onClick={() => load(true)} disabled={loading} aria-label="Write a fresh summary" title="Write a fresh summary"><Icons.RefreshCw size={15} className={loading ? "spin" : ""} /></button>
      </div>
      <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 10 }}>{brief.headline}</div>
      <div className="row-wrap" style={{ marginBottom: 12 }}>
        {brief.flags.length === 0 && <span className="chip chip-teal"><Icons.Check size={13} /> On track</span>}
        {brief.flags.map((f) => <span key={f.kind} className="chip chip-accent">{f.text}</span>)}
      </div>
      {loading && !s ? (
        <div className="row" style={{ gap: 10, padding: "14px 0", color: "var(--text-3)", fontSize: 13.5 }}><div className="spinner" style={{ width: 18, height: 18 }} /> Reading their week…</div>
      ) : s && (
        <div className="stack" style={{ gap: 12, opacity: loading ? 0.5 : 1 }}>
          <p style={{ fontSize: 15, lineHeight: 1.6 }}>{s.summary}</p>
          {(s.wins.length > 0 || s.concerns.length > 0) && (
            <div className="grid-2" style={{ gap: 10 }}>
              {s.wins.length > 0 && (
                <div className="clay-inset" style={{ padding: "11px 14px" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--teal)", marginBottom: 6 }}>Wins</div>
                  {s.wins.map((w, i) => <div key={i} style={{ fontSize: 13, marginBottom: 3 }}><Icons.Check size={13} color="var(--teal)" style={{ verticalAlign: -2 }} /> {w}</div>)}
                </div>
              )}
              {s.concerns.length > 0 && (
                <div className="clay-inset" style={{ padding: "11px 14px" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", marginBottom: 6 }}>Watch</div>
                  {s.concerns.map((w, i) => <div key={i} style={{ fontSize: 13, marginBottom: 3 }}><Icons.TriangleAlert size={12} color="var(--accent)" style={{ verticalAlign: -2 }} /> {w}</div>)}
                </div>
              )}
            </div>
          )}
          <div className="clay-inset" style={{ padding: "11px 14px", fontSize: 13.5 }}>
            <Icons.Lightbulb size={14} color="var(--amber)" style={{ verticalAlign: -2 }} /> <strong>Next step:</strong> {s.next_step}
          </div>
          {s.message && (
            <div style={{ borderLeft: "3px solid var(--gold)", padding: "4px 0 4px 14px" }}>
              <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4 }}>Suggested message</div>
              <div style={{ fontSize: 14, fontStyle: "italic" }}>“{s.message}”</div>
              {canMessage && <button className="btn btn-ghost" onClick={() => onUseMessage(s.message)} style={{ marginTop: 10, padding: "7px 12px", fontSize: 12.5 }} data-testid="use-suggested-message"><Icons.MessageCircle size={14} /> Edit &amp; send in chat</button>}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>Written {timeAgo(s.generated_at)}{s.ai ? " · AI can be wrong — check before acting" : " · built from this week's numbers"}</div>
        </div>
      )}
    </div>
  );
}

// ── Check-in history ──────────────────────────────────────────
const tone = (v, reverse) => {
  if (!v) return "var(--surface-2)";
  const good = reverse ? 6 - v : v;
  return ["#c0532f", "#d98a5f", "#d9c27a", "#7fb28f", "#2f7a5c"][good - 1];
};

export function WellbeingCard({ daily, targets, today }) {
  // Days come from the server's "today" (India time) so the grid matches the dates check-ins were saved under.
  const end = new Date(`${today || localDate()}T12:00:00Z`);
  const days = Array.from({ length: 14 }, (_, i) => new Date(end.getTime() - (13 - i) * 86400000).toISOString().slice(0, 10));
  const byDate = Object.fromEntries((daily || []).map((d) => [d.date, d]));
  const notes = (daily || []).filter((d) => d.checkin?.note).slice(-3).reverse();
  const anyCheckin = (daily || []).some((d) => d.checkin);
  return (
    <div className="clay fade-up min0" style={{ padding: 20 }} data-testid="wellbeing-card">
      <div className="eyebrow" style={{ marginBottom: 12 }}>Check-ins · last 14 days</div>
      {!anyCheckin && !(targets || []).length ? <div className="empty" style={{ padding: "14px 0" }}>No check-ins yet. They show up here as soon as the client starts.</div> : (
        <div style={{ overflowX: "auto" }}>
          <div className="well-grid" style={{ minWidth: 340 }}>
            {CHECKIN_SCALES.map((s) => (
              <Row key={s.key} label={s.key[0].toUpperCase() + s.key.slice(1)}>
                {days.map((d) => { const v = byDate[d]?.checkin?.[s.key]; return <div key={d} className="well-cell" style={{ background: tone(v, s.key === "soreness") }} title={`${d}: ${v ? s.caps[v - 1] : "no check-in"}`} />; })}
              </Row>
            ))}
            {(targets || []).length > 0 && (
              <Row label="Targets">
                {days.map((d) => {
                  const n = targets.filter((t) => byDate[d]?.targets?.[t.id]).length;
                  return <div key={d} className="well-cell" style={{ background: n ? `rgba(15,74,58,${0.2 + 0.8 * (n / targets.length)})` : "var(--surface-2)" }} title={`${d}: ${n}/${targets.length} targets`} />;
                })}
              </Row>
            )}
            <div />
            {days.map((d, i) => <div key={d} style={{ textAlign: "center", color: "var(--text-3)", fontSize: 10 }}>{i % 2 === 1 ? new Date(`${d}T12:00`).getDate() : ""}</div>)}
          </div>
        </div>
      )}
      {notes.length > 0 && (
        <div className="stack" style={{ gap: 6, marginTop: 14 }}>
          {notes.map((d) => <div key={d.date} style={{ fontSize: 13, color: "var(--text-2)" }}><strong style={{ color: "var(--text)" }}>{new Date(`${d.date}T12:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}:</strong> “{d.checkin.note}”</div>)}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }) {
  return <><div style={{ color: "var(--text-2)", fontWeight: 500 }}>{label}</div>{children}</>;
}

// ── Daily targets editor ──────────────────────────────────────
const PRESETS = [
  { label: "Steps", goal: 8000, unit: "steps" }, { label: "Water", goal: 3, unit: "L" }, { label: "Protein", goal: 100, unit: "g" },
  { label: "Sleep", goal: 7, unit: "hours" }, { label: "Stretch", goal: 10, unit: "min" }, { label: "No sugar", goal: null, unit: "" },
];

export function TargetsEditor({ clientId, targets, onSaved }) {
  const { push } = useToast();
  const [rows, setRows] = useState(() => targets.map((t) => ({ ...t, goal: t.goal ?? "" })));
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(rows.map(({ id, label, goal, unit }) => [id, label, String(goal ?? ""), unit || ""])) !==
    JSON.stringify(targets.map(({ id, label, goal, unit }) => [id, label, String(goal ?? ""), unit || ""]));
  const set = (i, k, v) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const add = (p) => setRows((r) => (r.length >= 8 ? r : [...r, { label: p?.label || "", goal: p?.goal ?? "", unit: p?.unit || "" }]));
  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put(`/coach/clients/${clientId}/targets`, {
        targets: rows.filter((x) => x.label.trim()).map((x) => ({ id: x.id, label: x.label, unit: x.unit || null, goal: x.goal === "" ? null : Number(x.goal) })),
      });
      setRows(r.data.targets.map((t) => ({ ...t, goal: t.goal ?? "" })));
      onSaved(r.data.targets);
      push("Daily targets saved — your client has been notified.", "success");
    } catch (e) { push(e?.response?.data?.detail || "Could not save targets.", "error"); } finally { setSaving(false); }
  };
  const unused = PRESETS.filter((p) => !rows.some((r) => r.label.trim().toLowerCase() === p.label.toLowerCase()));
  return (
    <div className="clay fade-up min0" style={{ padding: 20 }} data-testid="targets-editor">
      <div className="eyebrow" style={{ marginBottom: 4 }}>Daily targets</div>
      <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 12 }}>Your client ticks these off every day.</div>
      <div className="stack" style={{ gap: 8 }}>
        {rows.map((r, i) => (
          <div key={r.id || `new-${i}`} className="row" style={{ gap: 6 }}>
            <input className="field" value={r.label} onChange={(e) => set(i, "label", e.target.value)} placeholder="Target" maxLength={40} style={{ flex: 2, minWidth: 0, padding: "9px 11px" }} aria-label="Target name" />
            <input className="field" value={r.goal} onChange={(e) => set(i, "goal", e.target.value.replace(/[^\d.]/g, ""))} placeholder="Goal" inputMode="decimal" style={{ flex: 1, minWidth: 0, padding: "9px 11px" }} aria-label="Goal amount" />
            <input className="field" value={r.unit || ""} onChange={(e) => set(i, "unit", e.target.value)} placeholder="Unit" maxLength={12} style={{ flex: 1, minWidth: 0, padding: "9px 11px" }} aria-label="Unit" />
            <button className="icon-btn" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label={`Remove ${r.label || "target"}`}><Icons.X size={15} /></button>
          </div>
        ))}
      </div>
      {rows.length < 8 && (
        <div className="row-wrap" style={{ gap: 6, marginTop: 10 }}>
          {unused.slice(0, 5).map((p) => (
            <button key={p.label} className="chip chip-neutral" onClick={() => add(p)} style={{ border: "none", cursor: "pointer" }}><Icons.Plus size={12} /> {p.label}</button>
          ))}
          <button className="chip chip-neutral" onClick={() => add()} style={{ border: "none", cursor: "pointer" }}><Icons.Plus size={12} /> Custom</button>
        </div>
      )}
      <button className="btn btn-primary" onClick={save} disabled={!dirty || saving} style={{ width: "100%", marginTop: 14 }} data-testid="targets-save">
        <Icons.Check size={16} /> {saving ? "Saving…" : "Save targets"}
      </button>
    </div>
  );
}

// ── Plan templates / copy from another client ──────────────────
export function PlanSourcePicker({ type, clientId, onClose, onDone }) {
  const { push } = useToast();
  const [src, setSrc] = useState(null);
  const [busy, setBusy] = useState("");
  const load = () => api.get("/coach/plan-sources", { params: { type } }).then((r) => setSrc(r.data)).catch(() => setSrc({ templates: [], client_plans: [] }));
  useEffect(() => { load(); }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async (body, key) => {
    setBusy(key);
    try {
      await api.post(`/coach/clients/${clientId}/plans/copy`, { type, ...body });
      push("Draft ready — personalise it, then approve.", "success");
      onDone();
    } catch (e) { push(e?.response?.data?.detail || "Could not copy the plan.", "error"); setBusy(""); }
  };
  const remove = async (t) => {
    try { await api.delete(`/coach/templates/${t.id}`); load(); } catch { push("Could not delete the template.", "error"); }
  };
  const others = (src?.client_plans || []).filter((p) => p.client_id !== clientId);

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="glass modal fade-up" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }} data-testid="plan-source-picker">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
          <h3 style={{ fontSize: 22 }}>Start from…</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icons.X size={18} /></button>
        </div>
        <p style={{ fontSize: 13.5, color: "var(--text-2)", marginBottom: 16 }}>Creates a {PLAN_LABEL[type].toLowerCase()} draft. Nothing reaches the client until you approve it.</p>
        {!src ? <div className="spinner" style={{ margin: "30px auto" }} /> : (
          <div className="stack" style={{ gap: 18, maxHeight: "60vh", overflowY: "auto" }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Your templates</div>
              {src.templates.length === 0 && <div style={{ fontSize: 13, color: "var(--text-3)" }}>No templates yet — use “Save as template” on any live plan.</div>}
              <div className="stack" style={{ gap: 6 }}>
                {src.templates.map((t) => (
                  <div key={t.id} className="clay-inset row" style={{ padding: "10px 12px", gap: 10 }}>
                    <Icons.LayoutTemplate size={16} color="var(--gold)" style={{ flexShrink: 0 }} />
                    <div className="min0" style={{ flex: 1 }}>
                      <div className="truncate" style={{ fontWeight: 600, fontSize: 14 }}>{t.name}</div>
                      <div className="truncate" style={{ fontSize: 12, color: "var(--text-3)" }}>{t.content.title} · saved {timeAgo(t.created_at)}</div>
                    </div>
                    <Icons.Trash2 size={15} style={{ cursor: "pointer", color: "var(--text-3)", flexShrink: 0 }} aria-label={`Delete template ${t.name}`} onClick={() => remove(t)} />
                    <button className="btn btn-primary" disabled={!!busy} onClick={() => copy({ template_id: t.id }, t.id)} style={{ padding: "7px 12px", fontSize: 12.5 }}>{busy === t.id ? "…" : "Use"}</button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Copy another client's live plan</div>
              {others.length === 0 && <div style={{ fontSize: 13, color: "var(--text-3)" }}>None of your other clients has a live {PLAN_LABEL[type].toLowerCase()} yet.</div>}
              <div className="stack" style={{ gap: 6 }}>
                {others.map((p) => (
                  <div key={p.plan_id} className="clay-inset row" style={{ padding: "10px 12px", gap: 10 }}>
                    <Icons.Copy size={16} color="var(--text-2)" style={{ flexShrink: 0 }} />
                    <div className="min0" style={{ flex: 1 }}>
                      <div className="truncate" style={{ fontWeight: 600, fontSize: 14 }}>{p.client_name}</div>
                      <div className="truncate" style={{ fontSize: 12, color: "var(--text-3)" }}>{p.title} · approved {timeAgo(p.approved_at)}</div>
                    </div>
                    <button className="btn btn-primary" disabled={!!busy} onClick={() => copy({ plan_id: p.plan_id }, p.plan_id)} style={{ padding: "7px 12px", fontSize: 12.5 }} data-testid={`copy-from-${p.client_id}`}>{busy === p.plan_id ? "…" : "Copy"}</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function SaveTemplateButton({ plan }) {
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(plan.content.title || "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.post("/coach/templates", { name, type: plan.type, plan_id: plan.id });
      push("Saved to your templates.", "success");
      setOpen(false);
    } catch (e) { push(e?.response?.data?.detail || "Could not save the template.", "error"); } finally { setSaving(false); }
  };
  if (!open) return <button className="btn btn-ghost" onClick={() => setOpen(true)} data-testid={`save-template-${plan.type}`}><Icons.BookmarkPlus size={16} /> Save as template</button>;
  return (
    <div className="row" style={{ gap: 6, width: "100%" }}>
      <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Template name" style={{ flex: 1, minWidth: 0 }} onKeyDown={(e) => e.key === "Enter" && name.trim() && save()} aria-label="Template name" />
      <button className="btn btn-primary" onClick={save} disabled={saving || !name.trim()}>{saving ? "…" : "Save"}</button>
      <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Cancel"><Icons.X size={16} /></button>
    </div>
  );
}
