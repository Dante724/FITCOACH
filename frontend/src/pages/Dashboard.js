import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { getFocus, hasFeature, askCoachPath, PLAN_LABEL } from "@/lib/focus";
import Avatar from "@/components/Avatar";

function StatCard({ icon: Icon, label, value, unit, accent, delay }) {
  return (
    <div className="clay fade-up stat-card" style={{ padding: 20, animationDelay: `${delay}ms` }}>
      <div className="stat-icon" style={{ width: 40, height: 40, borderRadius: 12, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
        <Icon size={20} color={accent} />
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-3)", fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div className="display" style={{ fontSize: 26, fontWeight: 800 }}>
        {value}{unit && <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-2)" }}> {unit}</span>}
      </div>
    </div>
  );
}

function CoachCard({ type, coach, unread, navigate }) {
  const label = type === "yoga" ? "Yoga coach" : "Fitness & nutrition coach";
  if (!coach) {
    return (
      <div className="clay-inset row" style={{ padding: 14 }} data-testid={`coach-pending-${type}`}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icons.Hourglass size={20} color="var(--accent)" />
        </div>
        <div className="min0">
          <div style={{ fontSize: 14, fontWeight: 700 }}>Matching your {label.toLowerCase()}</div>
          <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>We'll notify you as soon as they're assigned.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="clay-inset row" style={{ padding: 14 }} data-testid={`coach-${type}`}>
      <Avatar name={coach.name} picture={coach.picture} size={44} />
      <div className="min0" style={{ flex: 1 }}>
        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{coach.name}</div>
        <div className="truncate" style={{ fontSize: 12.5, color: "var(--text-3)" }}>{label}</div>
      </div>
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
          <h3 className="display truncate" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{plan ? plan.content.title : "Being prepared"}</h3>
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
          <span className="chip chip-accent">{Math.round(plan.content.total_calories)} kcal / day</span>
          <span className="chip chip-teal">{Math.round(plan.content.total_protein_g)} g protein</span>
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
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = bookings.filter((b) => new Date(`${b.date}T${b.time}`) >= new Date());
  const planTypes = [hasFeature(user?.focus, "workouts") && "workout", hasFeature(user?.focus, "yoga") && "yoga", hasFeature(user?.focus, "mealplan") && "meal"].filter(Boolean);

  return (
    <div>
      <div className="fade-up" style={{ marginBottom: 24 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>{new Date().toLocaleDateString("en-IN", { weekday: "long", month: "long", day: "numeric" })}</div>
        <h1 style={{ fontSize: 32, fontWeight: 800 }}>{greet}, {user?.name?.split(" ")[0]}</h1>
        {focus && <p style={{ fontSize: 14.5, color: "var(--text-2)", marginTop: 8 }}>Goal: <strong style={{ color: focus.accent }}>{focus.label}</strong></p>}
      </div>

      <div className="clay fade-up" style={{ padding: 20, marginBottom: 18 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Your coach{focus?.coaches.length > 1 ? "es" : ""}</div>
        <div className="grid-2" style={{ gap: 12 }}>
          {(focus?.coaches || []).map((t) => (
            <CoachCard key={t} type={t} coach={coaches?.[t]} unread={coaches?.[t] ? unread[coaches[t].user_id] : 0} navigate={navigate} />
          ))}
        </div>
      </div>

      <div className="grid-stats" style={{ marginBottom: 18 }}>
        <StatCard icon={Icons.Weight} label="Latest weight" value={latest.weight ?? "—"} unit={latest.weight ? "kg" : ""} accent="var(--accent)" delay={0} />
        <StatCard icon={Icons.Dumbbell} label="Sessions this week" value={sessions.filter((s) => new Date(s.created_at).getTime() >= weekAgo).length} accent="#7c6bd6" delay={60} />
        <StatCard icon={Icons.CalendarDays} label="Upcoming calls" value={upcoming.length} accent="var(--teal)" delay={120} />
        {hasFeature(user?.focus, "food")
          ? <StatCard icon={Icons.Utensils} label="Meals logged today" value={foods.filter((f) => (f.created_at || "").slice(0, 10) === today).length} accent="var(--amber)" delay={180} />
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
