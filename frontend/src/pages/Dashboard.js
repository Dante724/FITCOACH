import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { getFocus, navForFocus } from "@/lib/focus";

function StatCard({ icon: Icon, label, value, unit, accent, delay }) {
  return (
    <div className="clay fade-up" style={{ padding: 22, animationDelay: `${delay}ms` }}>
      <div style={{ width: 42, height: 42, borderRadius: 13, background: `${accent}1f`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
        <Icon size={21} color={accent} />
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-3)", fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div className="display" style={{ fontSize: 28, fontWeight: 800 }}>
        {value}{unit && <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-2)" }}> {unit}</span>}
      </div>
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
  const [plan, setPlan] = useState(null);

  useEffect(() => {
    api.get("/progress").then((r) => setProgress(r.data)).catch(() => {});
    api.get("/bookings").then((r) => setBookings(r.data)).catch(() => {});
    api.get("/workouts/sessions").then((r) => setSessions(r.data)).catch(() => {});
    api.get("/workouts/plan").then((r) => setPlan(r.data)).catch(() => {});
  }, []);

  const latest = progress[progress.length - 1] || {};
  const hour = new Date().getHours();
  const getGreeting = () => {
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  };
  const greet = getGreeting();
  const nav = navForFocus(user?.focus).filter((n) => n.feature !== "dashboard");
  const showWorkouts = focus?.features.includes("workouts");

  return (
    <div>
      <div className="fade-up" style={{ marginBottom: 28 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
        <h1 style={{ fontSize: 32, fontWeight: 800 }}>{greet}, {user?.name?.split(" ")[0]}</h1>
        {focus && <p style={{ fontSize: 14.5, color: "var(--text-2)", marginTop: 8 }}>Your <strong style={{ color: focus.accent }}>{focus.label}</strong> workspace is ready.</p>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
        <StatCard icon={Icons.Weight} label="Latest weight" value={latest.weight ?? "—"} unit={latest.weight ? "kg" : ""} accent="var(--accent)" delay={0} />
        <StatCard icon={Icons.CalendarDays} label="Upcoming sessions" value={bookings.length} accent="var(--teal)" delay={60} />
        <StatCard icon={Icons.Dumbbell} label="Logged workouts" value={sessions.length} accent="#7c6bd6" delay={120} />
        <StatCard icon={Icons.LineChart} label="Progress entries" value={progress.length} accent="var(--amber)" delay={180} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 18 }}>
        {showWorkouts && plan ? (
          <div className="clay fade-up" style={{ padding: 26 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <div className="eyebrow">Today's session</div>
                <h3 className="display" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{plan.name}</h3>
              </div>
              <button className="btn btn-ghost" onClick={() => navigate("/workouts")} style={{ padding: "9px 16px", fontSize: 13 }}>Open</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {plan.exercises.map((ex, i) => (
                <div key={`${ex.name}-${i}`} className="clay-inset" style={{ padding: "13px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{ex.name}</span>
                  <span className="chip chip-accent">{ex.meta}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="clay fade-up" style={{ padding: 26 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Your programme</div>
            <h3 className="display" style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{focus?.label}</h3>
            <p style={{ fontSize: 14.5, color: "var(--text-2)", lineHeight: 1.7 }}>{focus?.tagline} Use the tools below to stay on track and hit your goals consistently.</p>
          </div>
        )}

        <div className="clay fade-up" style={{ padding: 26 }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>Quick access</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {nav.map((item) => {
              const Icon = Icons[item.icon] || Icons.Circle;
              return (
                <button key={item.path} data-testid={`quick-${item.feature}`} onClick={() => navigate(item.path)}
                  className="clay-inset" style={{ border: "none", cursor: "pointer", padding: "14px 16px", display: "flex", alignItems: "center", gap: 13, textAlign: "left" }}>
                  <div style={{ width: 38, height: 38, borderRadius: 11, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon size={18} color="var(--accent)" />
                  </div>
                  <span style={{ fontSize: 14.5, fontWeight: 600, flex: 1 }}>{item.label}</span>
                  <Icons.ChevronRight size={18} color="var(--text-3)" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
