import { useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import { FOCUS_OPTIONS, getFocus } from "@/lib/focus";
import Logo from "@/components/Logo";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";

const DIETS = [["veg", "Vegetarian"], ["eggetarian", "Veg + eggs"], ["non_veg", "Non-veg"], ["vegan", "Vegan"], ["jain", "Jain"]];
const EXPERIENCE = [["beginner", "Beginner"], ["intermediate", "Intermediate"], ["advanced", "Advanced"]];
const EQUIPMENT = [["gym", "Full gym"], ["home", "Home dumbbells"], ["bodyweight", "No equipment"]];

function Choice({ options, value, onChange, testid }) {
  return (
    <div className="row-wrap" style={{ gap: 8 }}>
      {options.map(([v, label]) => (
        <button key={v} type="button" data-testid={`${testid}-${v}`} onClick={() => onChange(v)} className={value === v ? "tab active" : "tab"}>{label}</button>
      ))}
    </div>
  );
}

// Client onboarding: goal, then the details the coach (and the AI draft) need.
export default function FocusSelect() {
  const { user, setUser } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const prev = user?.intake || {};
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState(getFocus(user?.focus)?.key || null);
  const [form, setForm] = useState({
    age: prev.age || "", sex: prev.sex || "", height_cm: prev.height_cm || "", weight_kg: prev.weight_kg || "",
    target_weight_kg: prev.target_weight_kg || "", experience: prev.experience || "beginner", days_per_week: prev.days_per_week || 3,
    equipment: prev.equipment || "gym", injuries: prev.injuries || "", diet: prev.diet || "veg", allergies: prev.allergies || "", dislikes: prev.dislikes || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));
  const fitness = getFocus(selected)?.coaches.includes("fitness");

  const submit = async () => {
    const num = (v) => (v === "" || v === null ? null : Number(v));
    setSaving(true);
    try {
      const res = await api.put("/profile/intake", {
        focus: selected, ...form, age: num(form.age), height_cm: num(form.height_cm), weight_kg: num(form.weight_kg),
        target_weight_kg: num(form.target_weight_kg), days_per_week: num(form.days_per_week), sex: form.sex || null,
      });
      setUser(res.data);
      navigate("/dashboard", { replace: true });
    } catch (e) {
      push(e?.response?.data?.detail || "Could not save. Try again.", "error");
      setSaving(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", padding: "48px 16px", maxWidth: 1000, margin: "0 auto" }}>
      <div className="fade-up" style={{ textAlign: "center", marginBottom: 34 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}><Logo /></div>
        <div className="row" style={{ justifyContent: "center", gap: 6, marginBottom: 14 }}>
          {[1, 2].map((n) => <span key={n} style={{ width: 34, height: 3, borderRadius: 3, background: n <= step ? "var(--gold)" : "var(--border-strong)" }} />)}
        </div>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Step {step} of 2</div>
        <h1 style={{ fontSize: 40, fontWeight: 400, marginBottom: 10 }}>
          {step === 1 ? `What's your goal${user?.name ? `, ${user.name.split(" ")[0]}` : ""}?` : "Tell your coach about you"}
        </h1>
        <p style={{ fontSize: 15, color: "var(--text-2)", maxWidth: 540, margin: "0 auto" }}>
          {step === 1 ? "We'll match you with a coach for this goal. Every plan you get is checked and approved by them."
            : "Your coach uses this to build your first plan. You can change it later."}
        </p>
      </div>

      {step === 1 && (
        <>
          <div className="grid-2" style={{ marginBottom: 30 }}>
            {FOCUS_OPTIONS.map((f, idx) => {
              const Icon = Icons[f.icon] || Icons.Circle;
              const active = selected === f.key;
              return (
                <button key={f.key} data-testid={`focus-${f.key}`} onClick={() => setSelected(f.key)}
                  className="clay fade-up goal-card"
                  style={{ textAlign: "left", borderColor: active ? "var(--gold)" : undefined, boxShadow: active ? "0 0 0 2px var(--gold), var(--shadow-pop)" : undefined, cursor: "pointer",
                    animationDelay: `${idx * 60}ms`, color: "var(--text)", position: "relative" }}>
                  <img src={f.img} alt="" loading="lazy" />
                  {active && <span style={{ position: "absolute", top: 12, right: 12, width: 30, height: 30, borderRadius: "50%", background: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icons.Check size={17} color="var(--on-ink)" /></span>}
                  <div className="goal-body">
                  <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                    <Icon size={18} strokeWidth={1.75} color="var(--gold)" />
                    <h3 className="display" style={{ fontSize: 23 }}>{f.label}</h3>
                  </div>
                  <p style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.6, marginBottom: 14 }}>{f.tagline}</p>
                  <div className="row-wrap" style={{ gap: 7 }}>
                    {f.coaches.map((c) => <span key={c} className="chip chip-neutral">{c === "yoga" ? "Yoga coach" : "Fitness & nutrition coach"}</span>)}
                  </div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="sticky-cta">
            <button data-testid="focus-next-btn" className="btn btn-primary" disabled={!selected} onClick={() => setStep(2)} style={{ padding: "15px 44px", fontSize: 15.5 }}>
              Continue <Icons.ArrowRight size={18} />
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <div className="clay fade-up" style={{ padding: 24, maxWidth: 760, margin: "0 auto" }}>
          <div className="grid-pair" style={{ gap: 14 }}>
            <div><label className="label">Age</label><input aria-label="Age" className="field" type="number" data-testid="intake-age" value={form.age} onChange={set("age")} /></div>
            <div><label className="label">Sex</label>
              <select className="field" value={form.sex} onChange={set("sex")}><option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option></select></div>
            <div><label className="label">Height (cm)</label><input aria-label="Height (cm)" className="field" type="number" value={form.height_cm} onChange={set("height_cm")} /></div>
            <div><label className="label">Current weight (kg)</label><input aria-label="Current weight (kg)" className="field" type="number" step="0.1" data-testid="intake-weight" value={form.weight_kg} onChange={set("weight_kg")} /></div>
            {fitness && <div><label className="label">Target weight (kg)</label><input aria-label="Target weight (kg)" className="field" type="number" step="0.1" value={form.target_weight_kg} onChange={set("target_weight_kg")} /></div>}
            <div><label className="label">Days you can train each week</label>
              <select className="field" value={form.days_per_week} onChange={set("days_per_week")}>{[2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d} days</option>)}</select></div>
          </div>

          <label className="label" style={{ marginTop: 18 }}>Experience</label>
          <Choice options={EXPERIENCE} value={form.experience} onChange={set("experience")} testid="exp" />
          {fitness && (<>
            <label className="label" style={{ marginTop: 16 }}>Equipment</label>
            <Choice options={EQUIPMENT} value={form.equipment} onChange={set("equipment")} testid="equip" />
            <label className="label" style={{ marginTop: 16 }}>Diet</label>
            <Choice options={DIETS} value={form.diet} onChange={set("diet")} testid="diet" />
          </>)}

          <label className="label" style={{ marginTop: 18 }}>Injuries or pain we should know about</label>
          <input className="field" value={form.injuries} onChange={set("injuries")} placeholder="e.g. lower back pain, left knee" />
          {fitness && (
            <div className="grid-2" style={{ gap: 14, marginTop: 14 }}>
              <div><label className="label">Allergies</label><input aria-label="Allergies" className="field" value={form.allergies} onChange={set("allergies")} placeholder="e.g. peanuts" /></div>
              <div><label className="label">Foods you dislike</label><input aria-label="Foods you dislike" className="field" value={form.dislikes} onChange={set("dislikes")} placeholder="e.g. mushrooms" /></div>
            </div>
          )}

          <div className="row" style={{ justifyContent: "space-between", marginTop: 24 }}>
            <button className="btn btn-ghost" onClick={() => setStep(1)}><Icons.ArrowLeft size={17} /> Back</button>
            <button data-testid="focus-confirm-btn" className="btn btn-primary" disabled={saving} onClick={submit} style={{ padding: "14px 30px" }}>
              {saving ? "Saving..." : "Finish"} {!saving && <Icons.Check size={18} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
