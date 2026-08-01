import { useEffect, useState, useCallback } from "react";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useToast } from "@/context/ToastContext";

const GOALS = [
  { id: "fat_loss", label: "Fat Loss", icon: "Flame" },
  { id: "maintenance", label: "Maintenance", icon: "Scale" },
  { id: "muscle_gain", label: "Muscle Gain", icon: "Dumbbell" },
];
const DIETS = [
  { id: "balanced", label: "Balanced" },
  { id: "vegetarian", label: "Vegetarian" },
  { id: "vegan", label: "Vegan" },
  { id: "high_protein", label: "High Protein" },
  { id: "keto", label: "Keto" },
];
const goalLabel = (id) => GOALS.find((g) => g.id === id)?.label || id;
const dietLabel = (id) => DIETS.find((d) => d.id === id)?.label || id;

function MealRow({ m }) {
  return (
    <div className="clay-inset" style={{ padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--teal)" }}>{m.meal}</div>
          <div style={{ fontSize: 14.5, fontWeight: 700, marginTop: 2 }}>{m.name}</div>
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--accent)", whiteSpace: "nowrap" }}>{Math.round(m.calories || 0)} kcal</div>
      </div>
      {Array.isArray(m.items) && m.items.length > 0 && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 16, fontSize: 12.8, color: "var(--text-2)", lineHeight: 1.7 }}>
          {m.items.map((it, i) => <li key={i}>{it}</li>)}
        </ul>
      )}
      <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11.5, color: "var(--text-3)" }}>
        <span>P {Math.round(m.protein_g || 0)}g</span>
        <span>C {Math.round(m.carbs_g || 0)}g</span>
        <span>F {Math.round(m.fat_g || 0)}g</span>
      </div>
    </div>
  );
}

function PlanCard({ plan, onSave, onDelete, saving }) {
  return (
    <div className="clay fade-up" style={{ padding: 24 }} data-testid="meal-plan-detail">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800 }}>{plan.title || "Meal plan"}</div>
          {plan.summary && <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, maxWidth: 520, lineHeight: 1.6 }}>{plan.summary}</div>}
        </div>
        {onSave && (
          <button data-testid="save-plan-btn" className="btn btn-primary" disabled={saving} onClick={onSave} style={{ padding: "11px 20px" }}>
            {saving ? <span className="spinner" style={{ width: 15, height: 15, borderWidth: 2 }} /> : <><Icons.BookmarkPlus size={16} /> Save plan</>}
          </button>
        )}
        {onDelete && (
          <Icons.Trash2 size={18} data-testid="delete-plan-btn" style={{ cursor: "pointer", color: "var(--text-3)" }} onClick={onDelete} />
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 16 }}>
        {[["Calories", plan.total_calories, "var(--accent)"], ["Protein", plan.total_protein_g, "var(--teal)"], ["Carbs", plan.total_carbs_g, "var(--amber)"], ["Fat", plan.total_fat_g, "#7c6bd6"]].map(([l, v, c]) => (
          <div key={l} className="clay-inset" style={{ padding: "10px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 10.5, color: "var(--text-3)", fontWeight: 600 }}>{l}</div>
            <div className="display" style={{ fontSize: 18, fontWeight: 800, color: c }}>{Math.round(v || 0)}{l === "Calories" ? "" : "g"}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
        {(plan.meals || []).map((m, i) => <MealRow key={i} m={m} />)}
      </div>
    </div>
  );
}

export default function MealPlans() {
  const { push } = useToast();
  const [goal, setGoal] = useState("fat_loss");
  const [diet, setDiet] = useState("balanced");
  const [calories, setCalories] = useState("");
  const [allergies, setAllergies] = useState("");
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState(null);
  const [planName, setPlanName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState([]);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(() => api.get("/meal-plans").then((r) => setSaved(r.data)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setGenerating(true);
    setPreview(null);
    try {
      const body = { goal, diet, allergies: allergies.trim() || null };
      const cal = parseInt(calories, 10);
      if (!isNaN(cal) && cal > 0) body.calories = cal;
      const res = await api.post("/meal-plans/generate", body);
      setPreview(res.data);
      setPlanName(res.data.title || `${dietLabel(diet)} · ${goalLabel(goal)}`);
      push("Meal plan generated.", "success");
    } catch (e) {
      push(e?.response?.data?.detail || "Generation failed. Try again.", "error");
    } finally { setGenerating(false); }
  };

  const savePlan = async () => {
    if (!planName.trim()) { push("Give your plan a name.", "error"); return; }
    setSaving(true);
    try {
      await api.post("/meal-plans", { name: planName.trim(), goal, diet, plan: preview });
      push("Plan saved to your library.", "success");
      setPreview(null); setPlanName("");
      load();
    } catch (e) {
      push(e?.response?.data?.detail || "Could not save plan.", "error");
    } finally { setSaving(false); }
  };

  const removePlan = async (id) => {
    try {
      await api.delete(`/meal-plans/${id}`);
      push("Plan removed.");
      if (openId === id) setOpenId(null);
      load();
    } catch { push("Could not remove plan.", "error"); }
  };

  return (
    <div data-testid="mealplans-page">
      <PageHeader eyebrow="Nutrition" title="Meal Plan Builder" subtitle="Generate a dietitian-style day of meals with AI, then save your favourites as reusable templates." />

      <div style={{ display: "grid", gridTemplateColumns: "340px minmax(0,1fr)", gap: 20 }} className="mealplan-grid">
        {/* Builder */}
        <div className="clay fade-up" style={{ padding: 24, alignSelf: "start" }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Your goal</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            {GOALS.map((g) => {
              const Icon = Icons[g.icon] || Icons.Circle;
              const active = goal === g.id;
              return (
                <button key={g.id} data-testid={`goal-${g.id}`} onClick={() => setGoal(g.id)}
                  style={{ flex: 1, padding: "12px 6px", borderRadius: 14, border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700,
                    color: active ? "#fff" : "var(--text-2)", background: active ? "linear-gradient(135deg, var(--accent), var(--accent-2))" : "var(--clay-inset, rgba(0,0,0,0.05))", transition: "all 0.18s ease" }}>
                  <Icon size={18} />{g.label}
                </button>
              );
            })}
          </div>

          <div className="eyebrow" style={{ marginBottom: 10 }}>Diet preference</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 18 }}>
            {DIETS.map((d) => {
              const active = diet === d.id;
              return (
                <button key={d.id} data-testid={`diet-${d.id}`} onClick={() => setDiet(d.id)}
                  style={{ padding: "8px 14px", borderRadius: 999, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 700,
                    color: active ? "#fff" : "var(--text-2)", background: active ? "var(--teal)" : "var(--clay-inset, rgba(0,0,0,0.05))", transition: "all 0.18s ease" }}>
                  {d.label}
                </button>
              );
            })}
          </div>

          <label className="label">Daily calories (optional)</label>
          <input data-testid="calories-input" className="field" type="number" min="800" value={calories} onChange={(e) => setCalories(e.target.value)} placeholder="e.g. 2000" style={{ marginBottom: 14 }} />

          <label className="label">Allergies / avoid (optional)</label>
          <input data-testid="allergies-input" className="field" value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="e.g. peanuts, shellfish" style={{ marginBottom: 18 }} />

          <button data-testid="generate-plan-btn" className="btn btn-primary" disabled={generating} onClick={generate} style={{ width: "100%", padding: "13px 20px", justifyContent: "center" }}>
            {generating ? <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Generating...</> : <><Icons.Sparkles size={18} /> Generate meal plan</>}
          </button>
        </div>

        {/* Preview + Library */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {generating && (
            <div className="clay" style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 14 }}>
              <span className="spinner" style={{ width: 22, height: 22, margin: "0 auto 12px" }} />
              <div>Crafting your {dietLabel(diet)} plan for {goalLabel(goal)}…</div>
            </div>
          )}

          {preview && !generating && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="glass" style={{ padding: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <Icons.Bookmark size={17} color="var(--teal)" />
                <input data-testid="plan-name-input" value={planName} onChange={(e) => setPlanName(e.target.value)} maxLength={80}
                  placeholder="Name this plan" className="clay-inset"
                  style={{ flex: 1, minWidth: 180, padding: "10px 13px", borderRadius: 12, border: "none", fontSize: 14, fontWeight: 600, background: "transparent", color: "var(--text)" }} />
              </div>
              <PlanCard plan={preview} onSave={savePlan} saving={saving} />
            </div>
          )}

          <div>
            <div className="eyebrow" style={{ marginBottom: 12 }}>Saved plans ({saved.length})</div>
            {saved.length === 0 ? (
              <div className="clay-inset" style={{ padding: "30px 20px", textAlign: "center", color: "var(--text-3)", fontSize: 13.5 }}>
                No saved plans yet. Generate one and hit “Save plan”.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="saved-plans">
                {saved.map((p) => (
                  <div key={p.id}>
                    <div className="clay-inset" data-testid={`saved-plan-${p.id}`} onClick={() => setOpenId(openId === p.id ? null : p.id)}
                      style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, cursor: "pointer" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                        <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                          {goalLabel(p.goal)} · {dietLabel(p.diet)} · {Math.round(p.plan?.total_calories || 0)} kcal
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                        <Icons.Trash2 size={16} data-testid={`delete-saved-${p.id}`} style={{ cursor: "pointer", color: "var(--text-3)" }} onClick={(e) => { e.stopPropagation(); removePlan(p.id); }} />
                        <Icons.ChevronDown size={18} style={{ color: "var(--text-3)", transform: openId === p.id ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                      </div>
                    </div>
                    {openId === p.id && <div style={{ marginTop: 10 }}><PlanCard plan={p.plan} onDelete={() => removePlan(p.id)} /></div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
