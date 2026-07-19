import { useEffect, useState, useCallback } from "react";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useToast } from "@/context/ToastContext";

function todayISO() { return new Date().toISOString().slice(0, 10); }

export default function Booking() {
  const { push } = useToast();
  const [trainers, setTrainers] = useState([]);
  const [slots, setSlots] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [trainerId, setTrainerId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => api.get("/bookings").then((r) => setBookings(r.data)).catch(() => {}), []);

  useEffect(() => {
    api.get("/trainers").then((r) => {
      setTrainers(r.data.trainers);
      setSlots(r.data.slots);
      setTrainerId(r.data.trainers[0]?.trainer_id || "");
    }).catch(() => {});
    load();
  }, [load]);

  const book = async () => {
    if (!trainerId || !date || !time) { push("Pick a trainer, date and time.", "error"); return; }
    setSaving(true);
    try {
      await api.post("/bookings", { trainer_id: trainerId, date, time });
      push("Session booked.", "success");
      setTime("");
      load();
    } catch (e) {
      push(e?.response?.data?.detail || "Could not book session.", "error");
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (id) => {
    await api.delete(`/bookings/${id}`).catch(() => {});
    push("Booking cancelled.");
    load();
  };

  const takenTimes = bookings.filter((b) => b.date === date).map((b) => b.time);

  return (
    <div>
      <PageHeader eyebrow="Schedule" title="Book a Session" subtitle="Reserve time with a certified trainer. Pick a coach, date and slot that works for you." />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div className="clay fade-up" style={{ padding: 26 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Choose your trainer</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
            {trainers.map((t) => (
              <button key={t.trainer_id} data-testid={`trainer-${t.trainer_id}`} onClick={() => setTrainerId(t.trainer_id)}
                className="clay-inset" style={{ border: trainerId === t.trainer_id ? "2px solid var(--accent)" : "2px solid transparent", cursor: "pointer", padding: "12px 14px", display: "flex", alignItems: "center", gap: 13, textAlign: "left" }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg, var(--accent), #7c6bd6)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>{t.initials}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>{t.specialty}</div>
                </div>
                {trainerId === t.trainer_id && <Icons.Check size={18} color="var(--accent)" />}
              </button>
            ))}
          </div>

          <label className="label">Date</label>
          <input type="date" className="field" data-testid="booking-date" value={date} min={todayISO()} onChange={(e) => setDate(e.target.value)} style={{ marginBottom: 18 }} />

          <label className="label">Available slots</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 9 }}>
            {slots.map((s) => {
              const taken = takenTimes.includes(s);
              return (
                <button key={s} data-testid={`slot-${s}`} disabled={taken} onClick={() => setTime(s)}
                  className={time === s ? "" : "clay-inset"}
                  style={{ padding: "11px 0", borderRadius: 12, border: time === s ? "2px solid var(--accent)" : "none", cursor: taken ? "not-allowed" : "pointer",
                    background: time === s ? "var(--accent-soft)" : undefined, color: taken ? "var(--text-3)" : "var(--text)", opacity: taken ? 0.5 : 1,
                    fontWeight: 600, fontSize: 13.5, textDecoration: taken ? "line-through" : "none" }}>
                  {s}
                </button>
              );
            })}
          </div>

          <button data-testid="confirm-booking-btn" className="btn btn-primary" disabled={saving} onClick={book} style={{ width: "100%", marginTop: 22, padding: 14 }}>
            <Icons.CalendarCheck size={18} /> {saving ? "Booking..." : "Confirm booking"}
          </button>
        </div>

        <div className="clay fade-up" style={{ padding: 26, animationDelay: "80ms" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <div className="eyebrow">Upcoming sessions</div>
            <span className="chip chip-neutral">{bookings.length} booked</span>
          </div>
          {bookings.length === 0 ? (
            <div style={{ textAlign: "center", padding: "50px 0", color: "var(--text-3)" }}>
              <Icons.CalendarX size={34} style={{ marginBottom: 10, opacity: 0.6 }} />
              <div style={{ fontSize: 14 }}>No sessions booked yet.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }} data-testid="bookings-list">
              {bookings.map((b) => (
                <div key={b.id} className="clay-inset" style={{ padding: "15px 16px", display: "flex", alignItems: "center", gap: 13 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--teal-soft)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--teal)" }}>
                    <span style={{ fontSize: 16, fontWeight: 800, lineHeight: 1 }}>{new Date(b.date + "T12:00").getDate()}</span>
                    <span style={{ fontSize: 10, fontWeight: 600 }}>{new Date(b.date + "T12:00").toLocaleDateString("en-US", { month: "short" })}</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{b.trainer_name} · {b.time}</div>
                    <div style={{ fontSize: 12, color: "var(--text-3)" }}>{b.specialty}</div>
                  </div>
                  <Icons.Trash2 size={17} data-testid={`cancel-${b.id}`} style={{ cursor: "pointer", color: "var(--text-3)" }} onClick={() => cancel(b.id)} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
