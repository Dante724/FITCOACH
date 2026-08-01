import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useToast } from "@/context/ToastContext";

const DAYS = [["Mon", 0], ["Tue", 1], ["Wed", 2], ["Thu", 3], ["Fri", 4], ["Sat", 5], ["Sun", 6]];
const ALL_TIMES = ["06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "16:00", "17:00", "18:00", "19:00", "20:00"];

export default function TrainerDashboard() {
  const { push } = useToast();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadSessions = useCallback(() => api.get("/trainer/sessions").then((r) => setSessions(r.data)).catch(() => {}), []);
  useEffect(() => {
    api.get("/trainer/me")
      .then((r) => setProfile(r.data))
      .catch(() => setProfile({ specialty: "", bio: "", available_days: [0, 1, 2, 3, 4], available_times: [] }));
    loadSessions();
  }, [loadSessions]);

  const toggleDay = (d) => setProfile((p) => ({ ...p, available_days: p.available_days.includes(d) ? p.available_days.filter((x) => x !== d) : [...p.available_days, d] }));
  const toggleTime = (t) => setProfile((p) => ({ ...p, available_times: p.available_times.includes(t) ? p.available_times.filter((x) => x !== t) : [...p.available_times, t] }));

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/trainer/me", profile);
      push("Availability updated.", "success");
    } catch { push("Could not save.", "error"); } finally { setSaving(false); }
  };

  const isUpcoming = (s) => new Date(`${s.date}T${s.time}`) >= new Date(Date.now() - 3600 * 1000);

  if (!profile) return <div className="spinner" style={{ margin: "80px auto" }} />;

  return (
    <div>
      <PageHeader eyebrow="Trainer" title="My Sessions" subtitle="Set your availability, view your booked clients and join video calls." />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div className="clay fade-up" style={{ padding: 26 }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>Availability</div>

          <label className="label">Specialty</label>
          <input className="field" data-testid="trainer-specialty" value={profile.specialty} onChange={(e) => setProfile({ ...profile, specialty: e.target.value })} placeholder="e.g. Strength & Conditioning" style={{ marginBottom: 16 }} />

          <label className="label">Available days</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
            {DAYS.map(([label, d]) => (
              <button key={d} data-testid={`day-${d}`} onClick={() => toggleDay(d)} className={profile.available_days.includes(d) ? "" : "clay-inset"}
                style={{ padding: "9px 14px", borderRadius: 10, border: profile.available_days.includes(d) ? "2px solid var(--accent)" : "none", background: profile.available_days.includes(d) ? "var(--accent-soft)" : undefined, color: profile.available_days.includes(d) ? "var(--accent)" : "var(--text-2)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                {label}
              </button>
            ))}
          </div>

          <label className="label">Available time slots</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {ALL_TIMES.map((t) => (
              <button key={t} data-testid={`time-${t}`} onClick={() => toggleTime(t)} className={profile.available_times.includes(t) ? "" : "clay-inset"}
                style={{ padding: "10px 0", borderRadius: 10, border: profile.available_times.includes(t) ? "2px solid var(--teal)" : "none", background: profile.available_times.includes(t) ? "var(--teal-soft)" : undefined, color: profile.available_times.includes(t) ? "var(--teal)" : "var(--text-2)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                {t}
              </button>
            ))}
          </div>

          <button className="btn btn-primary" data-testid="save-availability-btn" disabled={saving} onClick={save} style={{ width: "100%", marginTop: 20, padding: 13 }}>
            <Icons.Save size={17} /> {saving ? "Saving..." : "Save availability"}
          </button>
        </div>

        <div className="clay fade-up" style={{ padding: 26, animationDelay: "80ms" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div className="eyebrow">Booked sessions</div>
            <span className="chip chip-neutral">{sessions.length}</span>
          </div>
          {sessions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-3)" }}>
              <Icons.CalendarClock size={34} style={{ marginBottom: 10, opacity: 0.6 }} />
              <div style={{ fontSize: 14 }}>No sessions booked yet.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }} data-testid="trainer-sessions-list">
              {sessions.map((s) => (
                <div key={s.id} className="clay-inset" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--accent-soft)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--accent)" }}>
                    <span style={{ fontSize: 16, fontWeight: 800, lineHeight: 1 }}>{new Date(s.date + "T12:00").getDate()}</span>
                    <span style={{ fontSize: 10, fontWeight: 600 }}>{new Date(s.date + "T12:00").toLocaleDateString("en-US", { month: "short" })}</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{s.client_name || "Client"} · {s.time}</div>
                    <div style={{ fontSize: 12, color: "var(--text-3)" }}>{s.paid ? "Paid" : "Unpaid"}</div>
                  </div>
                  {isUpcoming(s) && (
                    <button className="btn btn-primary" data-testid={`trainer-join-${s.id}`} onClick={() => navigate(`/call/${s.id}`)} style={{ padding: "8px 14px", fontSize: 12.5 }}>
                      <Icons.Video size={15} /> Join
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
