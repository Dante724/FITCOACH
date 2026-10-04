import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as Icons from "lucide-react";
import { api } from "@/lib/api";

const GOALS = [["fat_loss", "Fat loss"], ["muscle_gain", "Muscle gain"], ["yoga", "Yoga"], ["hybrid", "Fitness + Yoga"]];
const SLOTS = [["morning", "Morning", "9–12"], ["afternoon", "Afternoon", "12–4"], ["evening", "Evening", "4–8"]];

function nextDays(n) {
  const out = [];
  const d = new Date();
  for (let i = 1; i <= n; i += 1) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    const iso = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    out.push({ iso, day: x.toLocaleDateString("en-IN", { weekday: "short" }), date: x.getDate() });
  }
  return out;
}

// Landing-page form: book a free consultation call. Shows up as a lead in the admin console.
export default function ConsultForm() {
  const days = useMemo(() => nextDays(7), []);
  const [f, setF] = useState({ name: "", phone: "", email: "", goal: "", preferred_date: "", preferred_slot: "", message: "", consent: false, website: "" });
  const [state, setState] = useState("idle"); // idle | sending | done
  const [error, setError] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const phoneOk = /^(\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}$/.test(f.phone.trim());
  const ready = f.name.trim() && phoneOk && f.consent;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setState("sending");
    setError("");
    try {
      await api.post("/leads", { ...f, email: f.email || null, goal: f.goal || null, preferred_date: f.preferred_date || null, preferred_slot: f.preferred_slot || null });
      setState("done");
    } catch (err) {
      setError(err?.response?.data?.detail || "Something went wrong — please try again.");
      setState("idle");
    }
  };

  if (state === "done") {
    const day = days.find((d) => d.iso === f.preferred_date);
    const slot = SLOTS.find((s) => s[0] === f.preferred_slot);
    return (
      <div className="clay consult-done fade-up" data-testid="consult-done">
        <div className="empty-medal" style={{ margin: "0 auto 14px" }}><Icons.PhoneCall size={24} strokeWidth={1.6} /></div>
        <h3 style={{ fontSize: 26 }}>Thanks, {f.name.trim().split(" ")[0]}!</h3>
        <p style={{ color: "var(--text-2)", marginTop: 8, lineHeight: 1.6 }}>
          A coach will call you on <strong>{f.phone}</strong>{day ? ` on ${day.day} ${day.date}` : " soon"}{slot ? `, ${slot[1].toLowerCase()} (${slot[2]})` : ""}.
          It's free and there's no obligation.
        </p>
      </div>
    );
  }

  return (
    <form className="clay consult-form" onSubmit={submit} data-testid="consult-form" noValidate>
      <div className="grid-pair">
        <div>
          <label className="label" htmlFor="c-name">Your name</label>
          <input id="c-name" className="field" value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={80} autoComplete="name" required />
        </div>
        <div>
          <label className="label" htmlFor="c-phone">Mobile number</label>
          <input id="c-phone" className="field" value={f.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" autoComplete="tel" placeholder="98765 43210" required
            aria-invalid={f.phone && !phoneOk ? "true" : undefined} />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="label" htmlFor="c-email">Email <span style={{ color: "var(--text-3)", fontWeight: 400 }}>(optional)</span></label>
        <input id="c-email" className="field" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" />
      </div>

      <div className="label" style={{ marginTop: 16 }}>What's your goal?</div>
      <div className="row-wrap" style={{ gap: 8 }}>
        {GOALS.map(([k, label]) => (
          <button type="button" key={k} className={`pill${f.goal === k ? " on" : ""}`} onClick={() => set("goal", f.goal === k ? "" : k)} aria-pressed={f.goal === k}>{label}</button>
        ))}
      </div>

      <div className="label" style={{ marginTop: 16 }}>When should we call?</div>
      <div className="day-strip">
        {days.map((d) => (
          <button type="button" key={d.iso} className={`day-chip${f.preferred_date === d.iso ? " on" : ""}`} onClick={() => set("preferred_date", f.preferred_date === d.iso ? "" : d.iso)} aria-pressed={f.preferred_date === d.iso}>
            <span style={{ fontSize: 11.5 }}>{d.day}</span><strong style={{ fontSize: 17, fontWeight: 600 }}>{d.date}</strong>
          </button>
        ))}
      </div>
      <div className="row-wrap" style={{ gap: 8, marginTop: 8 }}>
        {SLOTS.map(([k, label, hours]) => (
          <button type="button" key={k} className={`pill${f.preferred_slot === k ? " on" : ""}`} onClick={() => set("preferred_slot", f.preferred_slot === k ? "" : k)} aria-pressed={f.preferred_slot === k}>
            {label} <span style={{ opacity: 0.7 }}>{hours}</span>
          </button>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <label className="label" htmlFor="c-msg">Anything we should know? <span style={{ color: "var(--text-3)", fontWeight: 400 }}>(optional)</span></label>
        <textarea id="c-msg" className="field" rows={2} value={f.message} onChange={(e) => set("message", e.target.value)} maxLength={600} style={{ resize: "vertical" }}
          placeholder="e.g. Back pain, want to lose 8 kg before a wedding" />
      </div>
      <input type="text" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set("website", e.target.value)} className="hp" aria-hidden="true" name="website" />

      <label className="row consent-row" style={{ marginTop: 14 }}>
        <input type="checkbox" checked={f.consent} onChange={(e) => set("consent", e.target.checked)} data-testid="consult-consent" />
        <span>I agree to FitCoach calling me about this consultation and storing these details for up to 6 months. <Link to="/privacy">Privacy policy</Link></span>
      </label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button type="submit" className="btn btn-primary" disabled={!ready || state === "sending"} style={{ width: "100%", marginTop: 16, padding: 14 }} data-testid="consult-submit">
        <Icons.PhoneCall size={16} /> {state === "sending" ? "Booking…" : "Book my free call"}
      </button>
    </form>
  );
}
