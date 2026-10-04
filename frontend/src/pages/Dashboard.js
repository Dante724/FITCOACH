import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { getFocus, hasFeature, askCoachPath, PLAN_LABEL, localDate } from "@/lib/focus";
import Avatar from "@/components/Avatar";
import { startCall } from "@/lib/calls";
import { useMembership, membershipNotice } from "@/lib/membership";
import { useToast } from "@/context/ToastContext";
import TodayCard from "@/components/TodayCard";

function StatCard({ icon: Icon, label, value, unit, accent, delay }) {
  return (
    <div className="clay fade-up stat-card" style={{ padding: 20, animationDelay: `${delay}ms` }}>
      <div className="stat-icon" style={{ width: 40, height: 40, borderRadius: 12, background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
        <Icon size={20} color={accent} />
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-3)", fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div className="display" style={{ fontSize: 26, fontWeight: 600 }}>
        {value}{unit && <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-2)" }}> {unit}</span>}
      </div>
    </div>
  );
}

function CoachCard({ type, coach, unread, navigate }) {
  const { push } = useToast();
  const label = type === "yoga" ? "Yoga coach" : "Fitness & nutrition coach";
  if (!coach) {
    return (
      <div className="clay-inset row" style={{ padding: 14 }} data-testid={`coach-pending-${type}`}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icons.Hourglass size={18} strokeWidth={1.75} color="var(--text-2)" />
        </div>
        <div className="min0">
          <div style={{ fontSize: 14, fontWeight: 600 }}>Matching your {label.toLowerCase()}</div>
          <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>We'll notify you as soon as they're assigned.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="clay-inset row" style={{ padding: 14 }} data-testid={`coach-${type}`}>
      <span className="avatar-ring"><Avatar name={coach.name} picture={coach.picture} size={44} /></span>
      <div className="min0" style={{ flex: 1 }}>
        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 600 }}>{coach.name}</div>
        <div className="truncate" style={{ fontSize: 12.5, color: "var(--text-3)" }}>{label}</div>
      </div>
      <button className="btn btn-ghost" onClick={() => startCall(coach.user_id, navigate, push)} aria-label={`Video call ${coach.name}`} title="Video call" data-testid={`call-coach-${type}`} style={{ padding: "9px 11px" }}>
        <Icons.Video size={16} />
      </button>
      <button className="btn btn-ghost" onClick={() => navigate(askCoachPath(coach.user_id))} style={{ padding: "9px 14px", fontSize: 13, position: "relative" }}>
        <Icons.MessageCircle size={16} /> <span>Message</span>
        {unread > 0 && <span className="badge" style={{ position: "absolute", top: -6, right: -6 }}>{unread}</span>}
      </button>
    </div>
  );
}

function PlanPreview({ plan, type, navigate }) {
  const path = { workout: "/workouts", yoga: "/yoga", meal: "/meal-plans" }[type];
  return (
    <div className="clay fade-up" style={{ padding: 22 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div className="min0">
          <div className="eyebrow">{PLAN_LABEL[type]}</div>
          <h3 className="display truncate" style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{plan ? plan.content.title : "Being prepared"}</h3>
        </div>
        {plan && <button className="btn btn-ghost" onClick={() => navigate(path)} style={{ padding: "9px 16px", fontSize: 13 }}>Open</button>}
      </div>
      {!plan && <div style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.6 }}>Your coach is reviewing your details and will approve your {PLAN_LABEL[type].toLowerCase()} soon.</div>}
      {plan && type !== "meal" && (
        <div className="stack" style={{ gap: 8 }}>
          {(plan.content.days?.[0]?.exercises || []).slice(0, 4).map((ex, i) => (
            <div key={i} className="clay-inset row" style={{ padding: "11px 14px", justifyContent: "space-between" }}>
              <span className="truncate" style={{ fontSize: 13.5, fontWeight: 600 }}>{ex.name}</span>
              <span className="chip chip-neutral" style={{ flexShrink: 0 }}>{ex.sets} × {ex.reps}</span>
            </div>
          ))}
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>{plan.content.days?.length} days · approved by {plan.approved_by_name}</div>
        </div>
      )}
      {plan && type === "meal" && (
        <div className="row-wrap">
          <span className="chip chip-neutral">{Math.round(plan.content.total_calories)} kcal / day</span>
          <span className="chip chip-neutral">{Math.round(plan.content.total_protein_g)} g protein</span>
          <span className="chip chip-neutral">{plan.content.meals?.length} meals</span>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const focus = getFocus(user?.focus);
  const [progress, setProgress] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [foods, setFoods] = useState([]);
  const [plans, setPlans] = useState(null);
  const [coaches, setCoaches] = useState(null);
  const [unread, setUnread] = useState({});
  const [membership] = useMembership();

  useEffect(() => {
    api.get("/progress").then((r) => setProgress(r.data)).catch(() => {});
    api.get("/bookings").then((r) => setBookings(r.data)).catch(() => {});
    api.get("/workouts/sessions").then((r) => setSessions(r.data)).catch(() => {});
    api.get("/my/plans").then((r) => setPlans(r.data)).catch(() => setPlans({}));
    api.get("/my/coaches").then((r) => setCoaches(r.data)).catch(() => {});
    api.get("/messages/unread").then((r) => setUnread(r.data.threads || {})).catch(() => {});
    if (hasFeature(user?.focus, "food")) api.get("/food/logs").then((r) => setFoods(r.data)).catch(() => {});
  }, [user?.focus]);

  const latest = [...progress].reverse().find((p) => p.weight != null) || {};
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const weekAgo = Date.now() - 7 * 86400000;
  const today = localDate();
  const startOf = (b) => (b.starts_at ? new Date(b.starts_at) : new Date(`${b.date}T${b.time}`));
  const upcoming = bookings.filter((b) => startOf(b) >= new Date(Date.now() - 60 * 60000)).sort((a, b) => startOf(a) - startOf(b));
  const next = upcoming[0];
  const hasCoach = !!(coaches?.fitness || coaches?.yoga);
  const notice = membershipNotice(membership);
  const nextLabel = next && (() => {
    const d = startOf(next);
    const mins = Math.round((d - Date.now()) / 60000);
    if (mins <= 0) return "Happening now";
    if (mins < 60) return `In ${mins} min`;
    return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) + " · " + next.time;
  })();
  const planTypes = [hasFeature(user?.focus, "workouts") && "workout", hasFeature(user?.focus, "yoga") && "yoga", hasFeature(user?.focus, "mealplan") && "meal"].filter(Boolean);

  return (
    <div>
      <div className="hero-band fade-up" data-testid="client-hero">
        <div className="min0">
          <div className="eyebrow">{new Date().toLocaleDateString("en-IN", { weekday: "long", month: "long", day: "numeric" })}</div>
          <h1>{greet}, {user?.name?.split(" ")[0]}</h1>
          {focus && <p style={{ fontSize: 14.5, color: "var(--text-2)" }}>Working towards <span className="serif-italic" style={{ fontSize: 17 }}>{focus.label.toLowerCase()}</span></p>}
          {notice && (
            <button className="chip" onClick={() => navigate("/membership")} data-testid="membership-notice"
              style={{ marginTop: 12, border: "none", cursor: "pointer", background: notice.tone === "gold" ? "rgba(201,164,92,0.2)" : "rgba(192,83,47,0.25)", color: notice.tone === "gold" ? "#e3c88f" : "#f3b9a5" }}>
              <Icons.Crown size={13} /> {notice.text} · {notice.tone === "gold" ? "See plans" : "Renew"}
            </button>
          )}
        </div>
        <div className="hero-next">
          <div className="eyebrow" style={{ marginBottom: 6 }}>{next ? "Next session" : hasCoach ? "No session booked" : "Coach coming soon"}</div>
          {next ? (
            <>
              <div style={{ fontFamily: "var(--serif)", fontSize: 21 }}>{nextLabel}</div>
              <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 12 }}>Video call with {next.trainer_name}</div>
              <button className="btn btn-primary" onClick={() => navigate(`/call/${next.id}`)} style={{ width: "100%" }} data-testid="hero-join"><Icons.Video size={16} /> Join</button>
            </>
          ) : hasCoach ? (
            <>
              <div style={{ fontSize: 13, color: "var(--text-2)", margin: "2px 0 12px" }}>Book a video session with your coach.</div>
              <button className="btn btn-primary" onClick={() => navigate("/booking")} style={{ width: "100%" }}><Icons.CalendarPlus size={16} /> Book a session</button>
            </>
          ) : (
            <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2, maxWidth: 260 }}>We're matching you with your coach. You can book sessions as soon as they're assigned.</div>
          )}
        </div>
      </div>

      <div className="clay fade-up" style={{ padding: 20, marginBottom: 18 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Your coach{focus?.coaches.length > 1 ? "es" : ""}</div>
        <div className="grid-2" style={{ gap: 12 }}>
          {(focus?.coaches || []).map((t) => (
            <CoachCard key={t} type={t} coach={coaches?.[t]} unread={coaches?.[t] ? unread[coaches[t].user_id] : 0} navigate={navigate} />
          ))}
        </div>
      </div>

      <TodayCard />

      <div className="grid-stats" style={{ marginBottom: 18 }}>
        <StatCard icon={Icons.Weight} label="Latest weight" value={latest.weight ?? "—"} unit={latest.weight ? "kg" : ""} accent="var(--accent)" delay={0} />
        <StatCard icon={Icons.Dumbbell} label="Sessions this week" value={sessions.filter((s) => new Date(s.created_at).getTime() >= weekAgo).length} accent="var(--violet)" delay={60} />
        <StatCard icon={Icons.CalendarDays} label="Upcoming calls" value={upcoming.length} accent="var(--teal)" delay={120} />
        {hasFeature(user?.focus, "food")
          ? <StatCard icon={Icons.Utensils} label="Meals logged today" value={foods.filter((f) => f.created_at && localDate(f.created_at) === today).length} accent="var(--amber)" delay={180} />
          : <StatCard icon={Icons.LineChart} label="Progress entries" value={progress.length} accent="var(--amber)" delay={180} />}
      </div>

      {plans && (
        <div className="grid-cards">
          {planTypes.map((t) => <PlanPreview key={t} type={t} plan={plans[t]} navigate={navigate} />)}
        </div>
      )}
    </div>
  );
}
