import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useToast } from "@/context/ToastContext";

const DAYS = [["Mon", 0], ["Tue", 1], ["Wed", 2], ["Thu", 3], ["Fri", 4], ["Sat", 5], ["Sun", 6]];
const ALL_TIMES = ["06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "16:00", "17:00", "18:00", "19:00", "20:00"];

export default function TrainerAvailability() {
  const { push } = useToast();
  const [profile, setProfile] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/trainer/me")
      .then((r) => setProfile(r.data))
      .catch(() => setProfile({ specialty: "", bio: "", available_days: [0, 1, 2, 3, 4], available_times: [] }));
  }, []);

  const toggleDay = (d) => setProfile((p) => ({ ...p, available_days: p.available_days.includes(d) ? p.available_days.filter((x) => x !== d) : [...p.available_days, d] }));
  const toggleTime = (t) => setProfile((p) => ({ ...p, available_times: p.available_times.includes(t) ? p.available_times.filter((x) => x !== t) : [...p.available_times, t] }));

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/trainer/me", profile);
      push("Availability updated.", "success");
    } catch { push("Could not save.", "error"); } finally { setSaving(false); }
  };

  if (!profile) return <div className="spinner" style={{ margin: "80px auto" }} />;

  return (
    <div>
      <PageHeader eyebrow="Coach" title="Availability" subtitle="Set when your clients can book live video sessions with you." />

      <div style={{ maxWidth: 620 }}>
        <div className="clay fade-up" style={{ padding: 22 }}>
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
          <div className="grid-slots">
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

      </div>
    </div>
  );
}
