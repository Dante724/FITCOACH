import { useEffect, useState, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import * as Icons from "lucide-react";
import Avatar from "@/components/Avatar";
import Chat from "@/components/Chat";
import PlanEditor from "@/components/PlanEditor";
import { DaysPlanView, MealPlanView } from "@/components/PlanView";
import { Sparkline } from "@/pages/Progress";
import { ScoreRing, CheckList } from "@/components/PoseResult";
import { api, fileSrc } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { startCall } from "@/lib/calls";
import { GOAL_LABEL, PLAN_LABEL, timeAgo, localDate } from "@/lib/focus";
import { WeeklySummary, WellbeingCard, TargetsEditor, PlanSourcePicker, SaveTemplateButton } from "@/components/CoachTools";
import HealthFlags from "@/components/HealthFlags";
import { sessionStart, timeIn, tzCity } from "@/lib/locale";

const TRACK_TYPES = { fitness: ["workout", "meal"], yoga: ["yoga"] };
const INTAKE_LABELS = [["age", "Age"], ["sex", "Sex"], ["height_cm", "Height", "cm"], ["weight_kg", "Start weight", "kg"], ["target_weight_kg", "Target", "kg"],
  ["experience", "Experience"], ["days_per_week", "Days / week"], ["equipment", "Equipment"], ["diet", "Diet"], ["injuries", "Injuries"], ["allergies", "Allergies"], ["dislikes", "Dislikes"],
  ["waist_cm", "Waist", "cm"], ["conditions", "Conditions"], ["hba1c", "HbA1c", "%"], ["vitamin_d", "Vitamin D", "ng/mL"], ["b12", "Vitamin B12", "pg/mL"], ["labs_date", "Blood test date"]];

function Card({ title, children, action, style }) {
  return (
    <div className="clay fade-up min0" style={{ padding: 20, ...style }}>
      {(title || action) && <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}><div className="eyebrow">{title}</div>{action}</div>}
      {children}
    </div>
  );
}

function PlanSection({ type, plans, clientId, onChanged }) {
  const { push } = useToast();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState("");
  const [day, setDay] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [picking, setPicking] = useState(false);
  const draft = plans.find((p) => p.type === type && p.status === "draft");
  const active = plans.find((p) => p.type === type && p.status === "active");
  const archived = plans.filter((p) => p.type === type && p.status === "archived");

  const run = async (kind, fn) => {
    setBusy(kind);
    try { await fn(); onChanged(); } catch (e) { push(e?.response?.data?.detail || "Something went wrong.", "error"); } finally { setBusy(""); }
  };
  const draftAI = () => run("ai", async () => { await api.post(`/coach/clients/${clientId}/plans/draft`, { type, notes: notes || undefined }); setNotes(""); });
  const revise = () => run("revise", () => api.post(`/plans/${active.id}/revise`));

  return (
    <Card title={PLAN_LABEL[type]} style={{ marginBottom: 18 }}>
      {draft ? <PlanEditor plan={draft} onChanged={onChanged} /> : (
        <>
          {active ? (
            <div style={{ marginBottom: 16 }}>
              <div className="row-wrap" style={{ marginBottom: 10 }}>
                <span className="chip chip-teal"><Icons.BadgeCheck size={13} /> Live · approved {timeAgo(active.approved_at)}</span>
                {active.reason && <span className="chip chip-neutral">Why: {active.reason}</span>}
              </div>
              <h3 className="display" style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>{active.content.title}</h3>
              {type === "meal" ? <MealPlanView content={active.content} /> : <DaysPlanView content={active.content} yoga={type === "yoga"} day={day} onDay={setDay} />}
            </div>
          ) : (
            <div className="clay-inset" style={{ padding: 14, fontSize: 13.5, color: "var(--text-2)", marginBottom: 14 }}>
              No {PLAN_LABEL[type].toLowerCase()} yet. Auto-draft one from the client's intake, then review and approve it.
            </div>
          )}
          <label className="label">{active ? "What should change? (shown to the client as the reason)" : "Instructions for the draft (optional) — e.g. 4 days, home workouts, drop 150 kcal"}</label>
          <input className="field" data-testid={`draft-notes-${type}`} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder={active ? "e.g. Weight flat for 3 weeks — drop 150 kcal" : "e.g. Keep it knee-friendly"} />
          <div className="row-wrap" style={{ marginTop: 12, justifyContent: "flex-end" }}>
            {active && <SaveTemplateButton plan={active} />}
            <button className="btn btn-ghost" onClick={() => setPicking(true)} disabled={!!busy} data-testid={`from-template-${type}`}><Icons.Copy size={16} /> Template / copy</button>
            {active && <button className="btn btn-ghost" onClick={revise} disabled={!!busy}><Icons.PencilLine size={16} /> {busy === "revise" ? "Opening..." : "Edit by hand"}</button>}
            <button className="btn btn-primary" data-testid={`draft-ai-${type}`} onClick={draftAI} disabled={!!busy}>
              <Icons.Sparkles size={16} /> {busy === "ai" ? "Drafting..." : active ? "Auto-draft adjustment" : "Auto-draft"}
            </button>
          </div>
        </>
      )}
      {picking && <PlanSourcePicker type={type} clientId={clientId} onClose={() => setPicking(false)} onDone={() => { setPicking(false); onChanged(); }} />}
      {archived.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setShowHistory((v) => !v)} style={{ padding: "7px 12px", fontSize: 12.5 }}>
            <Icons.History size={14} /> {showHistory ? "Hide" : "Show"} history ({archived.length})
          </button>
          {showHistory && (
            <div className="stack" style={{ marginTop: 10 }}>
              {archived.map((p) => (
                <div key={p.id} className="clay-inset" style={{ padding: "10px 14px", fontSize: 13 }}>
                  <strong>{p.content.title}</strong> · approved {p.approved_at?.slice(0, 10)} by {p.approved_by_name}{p.reason ? ` · ${p.reason}` : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function PoseReviewCard({ check, canReview, onDone }) {
  const { push } = useToast();
  const [flags, setFlags] = useState(check.flags.map((f) => ({ text: f, on: true })));
  const [extra, setExtra] = useState("");
  const [score, setScore] = useState(check.score);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const reviewed = check.status === "reviewed";

  const send = async () => {
    const chosen = [...flags.filter((f) => f.on).map((f) => f.text), ...extra.split("\n").map((x) => x.trim()).filter(Boolean)];
    const changed = Number(score) !== check.score || chosen.length !== check.flags.length || chosen.some((f, i) => f !== check.flags[i]);
    setSaving(true);
    try {
      await api.post(`/pose-checks/${check.id}/review`, { verdict: changed ? "adjusted" : "confirmed", flags: chosen, score: Number(score), coach_note: note });
      push("Review sent to your client.", "success");
      onDone();
    } catch (e) { push(e?.response?.data?.detail || "Could not send review.", "error"); } finally { setSaving(false); }
  };

  return (
    <div className="clay fade-up" style={{ padding: 18 }} data-testid={`pose-review-${check.id}`}>
      <div className="grid-2" style={{ gap: 16 }}>
        {check.snapshot ? <img src={fileSrc(check.snapshot)} alt={`${check.pose_label} snapshot`} style={{ width: "100%", maxHeight: 420, objectFit: "contain", borderRadius: 14, background: "#11141b" }} />
          : <div className="clay-inset empty" style={{ minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Icons.ImageOff size={18} /> The client turned off photo storage</div>}
        <div className="min0">
          <div className="row" style={{ gap: 12, marginBottom: 12 }}>
            <ScoreRing score={reviewed ? check.coach_score : check.score} size={64} />
            <div className="min0">
              <div style={{ fontWeight: 600, fontSize: 16 }}>{check.pose_label}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>{timeAgo(check.created_at)} · auto score {check.score}{check.frames ? ` · ${check.frames} frames` : ""}</div>
            </div>
          </div>
          <CheckList checks={check.checks} />
          {reviewed ? (
            <div className="clay-inset" style={{ padding: 12, marginTop: 14, fontSize: 13.5 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}><Icons.BadgeCheck size={14} color="var(--teal)" /> {check.coach_verdict === "confirmed" ? "Confirmed" : "Adjusted"} by {check.reviewed_by_name}</div>
              {check.coach_flags.length ? <ul style={{ marginLeft: 18, lineHeight: 1.7 }}>{check.coach_flags.map((f, i) => <li key={i}>{f}</li>)}</ul> : <div>No corrections — good alignment.</div>}
              {check.coach_note && <div style={{ marginTop: 6 }}><strong>Note:</strong> {check.coach_note}</div>}
            </div>
          ) : canReview && (
            <div style={{ marginTop: 14 }}>
              <label className="label">Corrections the client will see</label>
              <div className="stack" style={{ gap: 6, marginBottom: 8 }}>
                {flags.map((f, i) => (
                  <label key={i} className="row" style={{ fontSize: 13.5, cursor: "pointer" }}>
                    <input type="checkbox" checked={f.on} onChange={() => setFlags(flags.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} /> {f.text}
                  </label>
                ))}
                {flags.length === 0 && <div style={{ fontSize: 13, color: "var(--text-3)" }}>The automatic check found nothing to fix.</div>}
              </div>
              <textarea className="field" rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Add your own corrections, one per line" style={{ resize: "vertical", fontSize: 13.5 }} />
              <div className="row" style={{ marginTop: 10 }}>
                <label className="label" style={{ margin: 0, flexShrink: 0 }}>Score</label>
                <input className="field" type="number" min="0" max="100" value={score} onChange={(e) => setScore(e.target.value)} style={{ width: 90 }} />
              </div>
              <textarea className="field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note to client (optional)" style={{ resize: "vertical", marginTop: 10, fontSize: 13.5 }} />
              <button className="btn btn-primary" data-testid="pose-review-send" onClick={send} disabled={saving} style={{ width: "100%", marginTop: 12 }}>
                <Icons.BadgeCheck size={16} /> {saving ? "Sending…" : "Send review"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScheduleModal({ clientId, clientName, onClose, onDone }) {
  const { push } = useToast();
  const tomorrow = localDate(new Date(Date.now() + 86400000));
  const [date, setDate] = useState(tomorrow);
  const [time, setTime] = useState("07:00");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.post(`/coach/clients/${clientId}/sessions`, { date, time });
      push(`Session scheduled. ${clientName.split(" ")[0]} has been notified.`, "success");
      onDone();
    } catch (e) { push(e?.response?.data?.detail || "Could not schedule.", "error"); } finally { setSaving(false); }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="glass modal fade-up" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }} data-testid="schedule-modal">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
          <h3 style={{ fontSize: 22 }}>Schedule a session</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icons.X size={18} /></button>
        </div>
        <p style={{ fontSize: 13.5, color: "var(--text-2)", marginBottom: 18 }}>In-app video call with {clientName}. You'll both get reminders an hour and 10 minutes before.</p>
        <div className="grid-2" style={{ gap: 12 }}>
          <div><label className="label">Date</label><input className="field" type="date" min={localDate()} value={date} onChange={(e) => setDate(e.target.value)} data-testid="schedule-date" /></div>
          <div><label className="label">Time</label><input className="field" type="time" value={time} onChange={(e) => setTime(e.target.value)} data-testid="schedule-time" /></div>
        </div>
        <button className="btn btn-primary" onClick={save} disabled={saving || !date || !time} style={{ width: "100%", marginTop: 18 }} data-testid="schedule-save">
          <Icons.CalendarPlus size={16} /> {saving ? "Scheduling…" : "Schedule"}
        </button>
      </div>
    </div>
  );
}

export default function ClientDetail() {
  const { clientId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [chatContext, setChatContext] = useState(null);
  const [scheduling, setScheduling] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const { push } = useToast();

  const load = useCallback(() => {
    api.get(`/coach/clients/${clientId}`).then((r) => setData(r.data)).catch((e) => setError(e?.response?.data?.detail || "Could not load client."));
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="clay empty" style={{ marginTop: 20 }}>{error}</div>;
  if (!data) return <div className="spinner" style={{ margin: "80px auto" }} />;

  const { client, brief, tracks } = data;
  const isCoach = user.role === "trainer";
  const fitness = tracks.includes("fitness");
  const tabs = [["overview", "Overview", "LayoutDashboard"], ["plans", "Plans", "ClipboardList"], ["progress", "Progress", "TrendingUp"],
    fitness && ["food", "Food", "Utensils"], tracks.includes("yoga") && ["pose", "Pose checks", "ScanEye"],
    ["workouts", "Sessions", "Dumbbell"], isCoach && ["chat", "Chat", "MessageCircle"]].filter(Boolean);
  const tab = tabs.some((t) => t[0] === params.get("tab")) ? params.get("tab") : "overview";
  const setTab = (t) => setParams({ tab: t }, { replace: true });
  const discuss = (ctx) => { setChatContext(ctx); setTab("chat"); };
  const intake = client.intake || {};
  const planTypes = tracks.flatMap((t) => TRACK_TYPES[t]);

  return (
    <div>
      <button className="btn btn-ghost" onClick={() => navigate(user.role === "admin" ? "/admin" : "/trainer")} style={{ padding: "8px 14px", fontSize: 13, marginBottom: 16 }}>
        <Icons.ArrowLeft size={15} /> Back
      </button>
      <div className="row fade-up" style={{ marginBottom: 18, gap: 14 }}>
        <Avatar name={client.name} picture={client.picture} size={56} />
        <div className="min0">
          <h1 className="truncate" style={{ fontSize: 28, fontWeight: 600 }}>{client.name}</h1>
          <div style={{ fontSize: 13.5, color: "var(--text-2)" }}>{GOAL_LABEL[client.focus] || "No goal yet"} · {client.email}</div>
          {data.locale?.abroad && (
            <div className="row" style={{ gap: 6, marginTop: 6 }} data-testid="client-abroad">
              <span className="chip chip-teal"><Icons.Globe size={12} /> Lives in {data.locale.country_name || data.locale.country}</span>
              <span className="chip chip-neutral"><Icons.Clock size={12} /> {timeIn(data.locale.timezone)} there now ({tzCity(data.locale.timezone)})</span>
            </div>
          )}
        </div>
      </div>
      {isCoach && (
        <div className="row-wrap" style={{ marginBottom: 18 }}>
          <button className="btn btn-primary" onClick={() => startCall(client.user_id, navigate, push)} data-testid="call-client"><Icons.Video size={16} /> Call now</button>
          <button className="btn btn-ghost" onClick={() => setScheduling(true)} data-testid="schedule-client"><Icons.CalendarPlus size={16} /> Schedule session</button>
          {data.upcoming_sessions?.map((b) => (
            <button key={b.id} className="chip chip-neutral" onClick={() => navigate(`/call/${b.id}`)} style={{ border: "none", cursor: "pointer", padding: "6px 11px" }} title="Join this session">
              <Icons.Video size={13} /> {b.date} · {b.time}{data.locale?.abroad ? ` (${timeIn(data.locale.timezone, sessionStart(b))} their time)` : ""}
            </button>
          ))}
        </div>
      )}
      {user.role === "admin" && (
        <div className="row-wrap" style={{ marginBottom: 18 }}>
          <button className="btn btn-ghost" style={{ color: "var(--accent)" }} data-testid="admin-delete-client" onClick={async () => {
            const typed = window.prompt(`Delete ${client.name}'s account and all their data? This can't be undone.\nType the client's name to confirm:`);
            if (typed == null) return;
            if (typed.trim().toLowerCase() !== (client.name || "").trim().toLowerCase()) { push("Name didn't match — nothing was deleted.", "error"); return; }
            try { await api.delete(`/admin/users/${client.user_id}`); push("Client account and data deleted.", "success"); navigate("/admin"); }
            catch (e) { push(e?.response?.data?.detail || "Could not delete.", "error"); }
          }}><Icons.UserX size={16} /> Delete account (on request)</button>
        </div>
      )}
      {scheduling && <ScheduleModal clientId={clientId} clientName={client.name} onClose={() => setScheduling(false)} onDone={() => { setScheduling(false); load(); }} />}

      <div className="tabs" role="tablist">
        {tabs.map(([id, label, icon]) => {
          const Icon = Icons[icon] || Icons.Circle;
          return <button key={id} role="tab" data-testid={`tab-${id}`} className={`tab${tab === id ? " active" : ""}`} onClick={() => setTab(id)}><Icon size={15} /> {label}</button>;
        })}
      </div>

      {tab === "overview" && (
        <div className="grid-main-side">
          <div className="stack" style={{ gap: 18 }}>
            <WeeklySummary clientId={clientId} brief={brief} canMessage={isCoach} onUseMessage={(text) => { setChatDraft(text); setChatContext(null); setTab("chat"); }} />
            <WellbeingCard daily={data.daily} targets={data.targets} today={data.today} />
            <Card title="Weight trend"><Sparkline data={data.progress} /></Card>
          </div>
          <div className="stack" style={{ gap: 18 }}>
          <TargetsEditor key={clientId} clientId={clientId} targets={data.targets} onSaved={(targets) => setData((d) => ({ ...d, targets }))} />
          <HealthFlags flags={data.health_flags} forCoach />
          <Card title="Intake">
            <div className="stack" style={{ gap: 0 }}>
              {INTAKE_LABELS.filter(([k]) => intake[k] !== undefined && intake[k] !== null && intake[k] !== "" && !(Array.isArray(intake[k]) && !intake[k].length)).map(([k, label, unit]) => (
                <div key={k} className="row" style={{ justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid rgba(139,150,172,0.16)", fontSize: 13.5 }}>
                  <span style={{ color: "var(--text-2)" }}>{label}</span>
                  <span style={{ fontWeight: 600, textAlign: "right" }}>{(Array.isArray(intake[k]) ? intake[k].join(", ") : String(intake[k])).replace("_", " ")}{unit ? ` ${unit}` : ""}</span>
                </div>
              ))}
              {Object.keys(intake).length === 0 && <div className="empty">The client hasn't filled in the questionnaire yet.</div>}
            </div>
            <div className="stack" style={{ gap: 6, marginTop: 14, fontSize: 12.5, color: "var(--text-3)" }}>
              {data.coaches.fitness && <div>Fitness coach: <strong style={{ color: "var(--text-2)" }}>{data.coaches.fitness.name}</strong></div>}
              {data.coaches.yoga && <div>Yoga coach: <strong style={{ color: "var(--text-2)" }}>{data.coaches.yoga.name}</strong></div>}
            </div>
          </Card>
          </div>
        </div>
      )}

      {tab === "plans" && planTypes.map((t) => <PlanSection key={t} type={t} plans={data.plans} clientId={clientId} onChanged={load} />)}

      {tab === "progress" && (
        <div className="stack" style={{ gap: 18 }}>
          <Card title={`Measurements (${data.progress.length})`}>
            {data.progress.length === 0 ? <div className="empty">No measurements logged yet.</div> : (
              <div className="stack" style={{ gap: 8 }}>
                {[...data.progress].reverse().map((e) => (
                  <div key={e.id} className="clay-inset row-wrap" style={{ padding: "11px 14px", fontSize: 13, justifyContent: "space-between" }}>
                    <strong>{e.date}</strong>
                    <span>{["weight:kg", "body_fat:%", "waist:cm", "chest:cm", "hips:cm", "arms:cm"].map((f) => { const [k, u] = f.split(":"); return e[k] != null ? `${k.replace("_", " ")} ${e[k]}${u}` : null; }).filter(Boolean).join(" · ")}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title={`Photos (${data.photos.length})`}>
            {data.photos.length === 0 ? <div className="empty">No progress photos yet.</div> : (
              <div className="grid-photos">
                {data.photos.map((p) => (
                  <div key={p.id} className="clay-inset" style={{ padding: 8 }}>
                    <img src={fileSrc(p.url)} alt={`Progress ${p.date}`} style={{ width: "100%", aspectRatio: "3 / 4", objectFit: "cover", borderRadius: 10 }} />
                    <div style={{ fontSize: 12, marginTop: 6 }}><strong>{p.date}</strong>{p.weight ? ` · ${p.weight} kg` : ""}</div>
                    {isCoach && <button className="btn btn-ghost" onClick={() => discuss({ type: "photo", id: p.id, label: `Progress photo ${p.date}` })} style={{ padding: "6px 10px", fontSize: 12, marginTop: 6, width: "100%" }}>Comment</button>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "food" && (
        <Card title={`Recent meals (${data.food.length})`}>
          {data.food.length === 0 ? <div className="empty">No meals logged yet.</div> : (
            <div className="stack">
              {data.food.map((f) => (
                <div key={f.id} className="clay-inset" style={{ padding: "12px 14px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div className="min0" style={{ flex: "1 1 200px" }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{f.result?.meal_name || "Meal"} <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 500 }}>· {timeAgo(f.created_at)}</span></div>
                    <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>{f.description}</div>
                  </div>
                  <span className="chip chip-neutral">{Math.round(f.result?.calories || 0)} kcal</span>
                  <span className="chip chip-neutral">P {Math.round(f.result?.protein_g || 0)}g</span>
                  {isCoach && <button className="btn btn-ghost" onClick={() => discuss({ type: "food", id: f.id, label: f.result?.meal_name || f.description })} style={{ padding: "7px 12px", fontSize: 12.5 }}><Icons.MessageCircle size={14} /> Comment</button>}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === "workouts" && (
        <Card title={`Logged sessions (${data.sessions.length})`}>
          {data.sessions.length === 0 ? <div className="empty">No sessions logged yet.</div> : (
            <div className="stack">
              {data.sessions.map((s) => (
                <div key={s.id} className="clay-inset" style={{ padding: "12px 14px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div className="min0" style={{ flex: "1 1 200px" }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</div>
                    <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>{timeAgo(s.created_at)} · {s.notes}</div>
                  </div>
                  {isCoach && <button className="btn btn-ghost" onClick={() => discuss({ type: "workout", id: s.id, label: s.name })} style={{ padding: "7px 12px", fontSize: 12.5 }}><Icons.MessageCircle size={14} /> Comment</button>}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === "pose" && (
        <div className="stack" style={{ gap: 16 }}>
          {data.pose_checks.length === 0 && <div className="clay empty">No pose checks yet. Clients send them from Pose Check in their app.</div>}
          {[...data.pose_checks].sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1)).map((c) => (
            <PoseReviewCard key={c.id} check={c} canReview={isCoach} onDone={load} />
          ))}
        </div>
      )}

      {tab === "chat" && isCoach && (
        <Card><Chat clientId={clientId} coachId={user.user_id} meId={user.user_id} otherName={client.name} initialContext={chatContext} initialText={chatDraft} isCoach /></Card>
      )}
    </div>
  );
}
