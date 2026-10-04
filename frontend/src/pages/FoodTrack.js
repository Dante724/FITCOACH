import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import { askCoachPath, localDate } from "@/lib/focus";
import useCoaches from "@/lib/useCoaches";

function Macro({ label, value, unit, color }) {
  return (
    <div className="clay-inset" style={{ padding: "12px 14px", textAlign: "center" }}>
      <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>{label}</div>
      <div className="display" style={{ fontSize: 19, fontWeight: 600, color }}>{value}<span style={{ fontSize: 11, fontWeight: 500 }}>{unit}</span></div>
    </div>
  );
}

export default function FoodTrack() {
  const { push } = useToast();
  const navigate = useNavigate();
  const coach = useCoaches()?.fitness;
  const [desc, setDesc] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [logs, setLogs] = useState([]);

  const load = useCallback(() => api.get("/food/logs").then((r) => setLogs(r.data)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const analyze = async () => {
    if (!desc.trim()) { push("Describe what you ate first.", "error"); return; }
    setAnalyzing(true);
    try {
      await api.post("/food/analyze", { description: desc });
      push("Meal analyzed and logged.", "success");
      setDesc("");
      load();
    } catch (e) {
      push(e?.response?.data?.detail || "AI analysis failed.", "error");
    } finally { setAnalyzing(false); }
  };

  const remove = async (id) => { await api.delete(`/food/logs/${id}`).catch(() => {}); load(); };

  const today = localDate();
  const todayLogs = logs.filter((l) => l.created_at && localDate(l.created_at) === today);
  const totalCal = todayLogs.reduce((s, l) => s + (Number(l.result?.calories) || 0), 0);
  const totalProt = todayLogs.reduce((s, l) => s + (Number(l.result?.protein_g) || 0), 0);

  return (
    <div>
      <PageHeader eyebrow="Nutrition" title="Food Log" subtitle="Describe your meal in plain language. AI estimates the calories and macros, and your coach can see your log." />

      <div className="grid-main-side">
        <div className="clay fade-up min0" style={{ padding: 22 }}>
          <label className="label">What did you eat?</label>
          <textarea data-testid="food-input" className="field" rows={4} value={desc} onChange={(e) => setDesc(e.target.value)}
            placeholder="e.g. Grilled chicken breast with a cup of brown rice, steamed broccoli and a tablespoon of olive oil"
            style={{ resize: "vertical", marginBottom: 16, lineHeight: 1.6 }} />
          <button data-testid="analyze-food-btn" className="btn btn-primary" disabled={analyzing} onClick={analyze} style={{ padding: "13px 26px" }}>
            {analyzing ? <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Analyzing...</> : <><Icons.Sparkles size={18} /> Analyze & log meal</>}
          </button>

          <div style={{ marginTop: 26 }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Today's log</div>
            {todayLogs.length === 0 ? (
              <div style={{ textAlign: "center", padding: "36px 0", color: "var(--text-3)", fontSize: 14 }}>No meals logged today.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="food-logs">
                {todayLogs.map((l) => (
                  <div key={l.id} className="clay-inset" style={{ padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>{l.result?.meal_name || "Meal"}</div>
                        <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 2 }}>{l.description}</div>
                      </div>
                      <div className="row" style={{ gap: 2, flexShrink: 0 }}>
                        {coach && (
                          <button className="icon-btn" title="Ask your coach about this meal" data-testid={`ask-food-${l.id}`}
                            onClick={() => navigate(askCoachPath(coach.user_id, { type: "food", id: l.id, label: l.result?.meal_name || l.description }))}>
                            <Icons.MessageCircle size={16} />
                          </button>
                        )}
                        <button className="icon-btn" title="Delete" data-testid={`delete-food-${l.id}`} onClick={() => remove(l.id)}><Icons.Trash2 size={16} /></button>
                      </div>
                    </div>
                    <div className="grid-macros">
                      <Macro label="Calories" value={Math.round(l.result?.calories || 0)} unit="" color="var(--text)" />
                      <Macro label="Protein" value={Math.round(l.result?.protein_g || 0)} unit="g" color="var(--text)" />
                      <Macro label="Carbs" value={Math.round(l.result?.carbs_g || 0)} unit="g" color="var(--text)" />
                      <Macro label="Fat" value={Math.round(l.result?.fat_g || 0)} unit="g" color="var(--text)" />
                    </div>
                    {l.result?.notes && <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 12, lineHeight: 1.6 }}>{l.result.notes}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="clay fade-up" style={{ padding: 24, animationDelay: "80ms" }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Today's totals</div>
            <div style={{ textAlign: "center", marginBottom: 8 }}>
              <div className="display" style={{ fontSize: 40, fontWeight: 600, color: "var(--text)" }}>{Math.round(totalCal)}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>calories</div>
            </div>
            <div className="clay-inset" style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
              <span style={{ fontSize: 13, color: "var(--text-2)" }}>Protein</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: "var(--teal)" }}>{Math.round(totalProt)} g</span>
            </div>
            <div className="clay-inset" style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <span style={{ fontSize: 13, color: "var(--text-2)" }}>Meals logged</span>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{todayLogs.length}</span>
            </div>
          </div>
          <div className="glass fade-up" style={{ padding: 20, animationDelay: "140ms" }}>
            <Icons.Info size={18} color="var(--text)" style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.7 }}>Estimates are AI-generated for guidance. Be specific with portions for more accurate results.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
