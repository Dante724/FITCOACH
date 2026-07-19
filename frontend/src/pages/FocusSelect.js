import { useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import { FOCUS_OPTIONS } from "@/lib/focus";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";

const ICONS = { strength: "Dumbbell", nutrition: "Salad", yoga: "Flower2", muscle_fat: "Flame" };
const FEATURE_LABEL = { workouts: "Workouts", progress: "Progress", bodyscan: "AI Body Scan", booking: "Booking", food: "AI Food Track" };

export default function FocusSelect() {
  const { user, setUser } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(user?.focus || null);
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await api.put("/profile/focus", { focus: selected });
      setUser(res.data);
      navigate("/dashboard", { replace: true });
    } catch {
      push("Could not save your choice. Try again.", "error");
      setSaving(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", padding: "56px 24px", maxWidth: 1060, margin: "0 auto" }}>
      <div className="fade-up" style={{ textAlign: "center", marginBottom: 44 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Step 1 of 1</div>
        <h1 className="display" style={{ fontSize: 40, fontWeight: 800, marginBottom: 12 }}>
          What are you here to achieve{user?.name ? `, ${user.name.split(" ")[0]}` : ""}?
        </h1>
        <p style={{ fontSize: 15.5, color: "var(--text-2)", maxWidth: 520, margin: "0 auto" }}>
          Choose your focus. Each programme unlocks the tools that matter most for your goal.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 34 }}>
        {FOCUS_OPTIONS.map((f, idx) => {
          const Icon = Icons[ICONS[f.key]] || Icons.Circle;
          const active = selected === f.key;
          return (
            <button key={f.key} data-testid={`focus-${f.key}`} onClick={() => setSelected(f.key)}
              className={active ? "glass fade-up" : "clay fade-up"}
              style={{
                textAlign: "left", padding: "26px 26px", border: active ? `2px solid ${f.accent}` : "2px solid transparent",
                cursor: "pointer", animationDelay: `${idx * 60}ms`, transition: "border-color 0.2s ease, transform 0.2s ease",
                transform: active ? "translateY(-3px)" : "none",
              }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                <div style={{ width: 52, height: 52, borderRadius: 16, background: `${f.accent}1f`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon size={26} color={f.accent} />
                </div>
                {active && <Icons.CheckCircle2 size={24} color={f.accent} />}
              </div>
              <h3 className="display" style={{ fontSize: 21, fontWeight: 700, marginBottom: 6 }}>{f.label}</h3>
              <p style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.6, marginBottom: 16 }}>{f.tagline}</p>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {f.features.map((feat) => (
                  <span key={feat} className="chip chip-neutral">{FEATURE_LABEL[feat]}</span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <button data-testid="focus-confirm-btn" className="btn btn-primary" disabled={!selected || saving} onClick={confirm} style={{ padding: "15px 44px", fontSize: 15.5 }}>
          {saving ? "Setting up..." : "Continue to my workspace"}
          {!saving && <Icons.ArrowRight size={18} />}
        </button>
      </div>
    </div>
  );
}
