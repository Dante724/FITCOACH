import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import AbroadSwaps from "@/components/AbroadSwaps";
import { api, isOfflineError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { askCoachPath, localDate } from "@/lib/focus";
import useCoaches from "@/lib/useCoaches";
import { analyzeMeal, dailyTargets, FOOD_COUNT } from "@/lib/nutrition";
import { enqueue, dequeue, newId, useQueue, useOnline } from "@/lib/offline";

function Macro({ label, value, unit }) {
  return (
    <div className="clay-inset" style={{ padding: "12px 14px", textAlign: "center" }}>
      <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>{label}</div>
      <div className="display" style={{ fontSize: 19, fontWeight: 600 }}>{value}<span style={{ fontSize: 11, fontWeight: 500 }}>{unit}</span></div>
    </div>
  );
}

function Meter({ label, value, target, unit }) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}>
        <span style={{ color: "var(--text-2)" }}>{label}</span>
        <span><strong>{Math.round(value)}</strong><span style={{ color: "var(--text-3)" }}> / {target}{unit}</span></span>
      </div>
      <div className={`meter${target && value > target * 1.05 ? " over" : ""}`}><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

const EMPTY_FOOD = { name: "", aliases: "", unit: "1 serving", grams: "", kcal: "", protein_g: "", carbs_g: "", fat_g: "" };

function MyFoods({ foods, onSaved, prefill, onClose }) {
  const { push } = useToast();
  const [f, setF] = useState(() => ({ ...EMPTY_FOOD, ...(prefill || {}) }));
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (prefill) setF({ ...EMPTY_FOOD, ...prefill }); }, [prefill]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const ready = f.name.trim().length >= 2 && f.kcal !== "" && Number(f.kcal) >= 0;

  const save = async () => {
    const payload = {
      id: newId(), name: f.name.trim(), aliases: f.aliases.split(",").map((a) => a.trim()).filter(Boolean), unit: f.unit.trim() || "1 serving",
      grams: f.grams ? Number(f.grams) : null, kcal: Number(f.kcal), protein_g: Number(f.protein_g || 0), carbs_g: Number(f.carbs_g || 0), fat_g: Number(f.fat_g || 0),
    };
    setSaving(true);
    try {
      await api.post("/me/foods", payload, { timeout: 12000 });
      push(`“${payload.name}” saved — FitCoach will recognise it from now on.`, "success");
    } catch (e) {
      if (!isOfflineError(e)) { push(e?.response?.data?.detail || "Couldn't save the food.", "error"); setSaving(false); return; }
      enqueue({ id: payload.id, type: "my_food", payload, label: payload.name });
      push(`“${payload.name}” saved on this phone — it works now and syncs when you're back online.`, "success");
    }
    setSaving(false);
    setF(EMPTY_FOOD);
    onSaved();
  };

  return (
    <div className="clay fade-up" style={{ padding: 20 }} data-testid="my-foods">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <div className="eyebrow">My foods</div>
        {onClose && <button className="icon-btn" onClick={onClose} aria-label="Close"><Icons.X size={16} /></button>}
      </div>
      <p style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 12 }}>Teach FitCoach dishes it doesn't know — family recipes, local snacks. Check the pack label or ask your coach for the numbers.</p>
      {foods.length > 0 && (
        <div className="stack" style={{ gap: 6, marginBottom: 14 }}>
          {foods.map((x) => (
            <div key={x.id} className="clay-inset row" style={{ padding: "8px 12px", gap: 8, fontSize: 13 }}>
              <span className="min0 truncate" style={{ flex: 1 }}><strong>{x.name}</strong> · {x.unit}</span>
              <span style={{ color: "var(--text-2)", flexShrink: 0 }}>{Math.round(x.kcal)} kcal · P {x.protein_g}g</span>
              {x.pending && <Icons.CloudOff size={14} color="var(--text-3)" aria-label="Waiting to sync" />}
            </div>
          ))}
        </div>
      )}
      <div className="grid-pair">
        <div><label className="label" htmlFor="mf-name">Food</label><input id="mf-name" className="field" value={f.name} onChange={set("name")} placeholder="e.g. Methi thepla" maxLength={60} data-testid="my-food-name" /></div>
        <div><label className="label" htmlFor="mf-unit">One serving is</label><input id="mf-unit" className="field" value={f.unit} onChange={set("unit")} placeholder="1 piece" maxLength={30} /></div>
      </div>
      <div style={{ marginTop: 10 }}><label className="label" htmlFor="mf-alias">Also called <span style={{ color: "var(--text-3)", fontWeight: 400 }}>(optional, comma separated)</span></label>
        <input id="mf-alias" className="field" value={f.aliases} onChange={set("aliases")} placeholder="thepla, theplu" /></div>
      <div className="grid-stats" style={{ gap: 8, marginTop: 10 }}>
        {[["kcal", "Calories"], ["protein_g", "Protein g"], ["carbs_g", "Carbs g"], ["fat_g", "Fat g"]].map(([k, label]) => (
          <div key={k}><label className="label" htmlFor={`mf-${k}`}>{label}</label>
            <input id={`mf-${k}`} className="field" inputMode="decimal" value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value.replace(/[^\d.]/g, "") }))} data-testid={`my-food-${k}`} /></div>
        ))}
      </div>
      <button className="btn btn-primary" onClick={save} disabled={!ready || saving} style={{ width: "100%", marginTop: 12 }} data-testid="my-food-save">
        <Icons.Plus size={16} /> {saving ? "Saving…" : "Save food"}
      </button>
    </div>
  );
}

export default function FoodTrack() {
  const { push } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const coach = useCoaches()?.fitness;
  const online = useOnline();
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState([]);
  const [serverFoods, setServerFoods] = useState([]);
  const [plans, setPlans] = useState({});
  const [weight, setWeight] = useState(null);
  const [teach, setTeach] = useState(null);
  const queuedLogs = useQueue("food_log");
  const queuedFoods = useQueue("my_food");

  const load = useCallback(() => {
    api.get("/food/logs").then((r) => setLogs(r.data)).catch(() => {});
    api.get("/me/foods").then((r) => setServerFoods(r.data)).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    api.get("/my/plans").then((r) => setPlans(r.data || {})).catch(() => {});
    api.get("/progress").then((r) => setWeight([...r.data].reverse().find((p) => p.weight != null)?.weight ?? null)).catch(() => {});
  }, [load]);
  useEffect(() => { // refresh once queued items reach the server
    const onSynced = () => load();
    window.addEventListener("fc:synced", onSynced);
    return () => window.removeEventListener("fc:synced", onSynced);
  }, [load]);

  const myFoods = useMemo(() => {
    const ids = new Set(serverFoods.map((f) => f.id));
    return [...serverFoods, ...queuedFoods.filter((q) => !ids.has(q.payload.id)).map((q) => ({ ...q.payload, pending: true }))];
  }, [serverFoods, queuedFoods]);

  // Instant estimate on the device as you type — no server, no AI.
  const typed = useDeferredValue(desc);
  const estimate = useMemo(() => (typed.trim().length >= 2 ? analyzeMeal(typed, myFoods) : null), [typed, myFoods]);

  const logMeal = async () => {
    const text = desc.trim();
    if (!text) { push("Describe what you ate first.", "error"); return; }
    const local = analyzeMeal(text, myFoods);
    if (!local.calories && local.calories !== 0) { push("We couldn't recognise those foods — try simpler names, or teach FitCoach the dish below.", "error"); return; }
    const payload = { description: text, client_ref: newId(), logged_at: new Date().toISOString() };
    setSaving(true);
    try {
      await api.post("/food/analyze", payload, { timeout: 12000 });
      push("Meal logged.", "success");
      load();
    } catch (e) {
      if (!isOfflineError(e)) { push(e?.response?.data?.detail || "Couldn't log that meal.", "error"); setSaving(false); return; }
      enqueue({ id: payload.client_ref, type: "food_log", payload, local, label: local.meal_name });
      push("Logged on this phone — it syncs with your coach when you're back online.", "success");
    }
    setDesc("");
    setSaving(false);
  };

  const remove = async (l) => {
    if (l.pending) { dequeue(l.id); return; }
    try { await api.delete(`/food/logs/${l.id}`); load(); } catch (e) {
      push(isOfflineError(e) ? "You're offline — delete it once you're connected." : "Couldn't delete.", "error");
    }
  };

  const today = localDate();
  const syncedRefs = new Set(logs.map((l) => l.client_ref).filter(Boolean));
  const pendingLogs = queuedLogs.filter((q) => !syncedRefs.has(q.id))
    .map((q) => ({ id: q.id, description: q.payload.description, result: q.local, created_at: q.payload.logged_at, pending: true }));
  const todayLogs = [...pendingLogs, ...logs].filter((l) => l.created_at && localDate(l.created_at) === today)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const sum = (k) => todayLogs.reduce((s, l) => s + (Number(l.result?.[k]) || 0), 0);

  const meal = plans.meal?.content;
  const target = meal?.total_calories
    ? { calories: Math.round(meal.total_calories), protein_g: Math.round(meal.total_protein_g), carbs_g: Math.round(meal.total_carbs_g), fat_g: Math.round(meal.total_fat_g), from: "plan" }
    : { ...dailyTargets(user?.intake || {}, weight, user?.focus), from: "estimate" };

  return (
    <div>
      <PageHeader eyebrow="Nutrition" title="Food Log" subtitle="Type what you ate — like “2 roti, 1 katori dal, paneer sabzi”. Calories and macros are worked out instantly on your phone, even offline." />

      <div className="grid-main-side">
        <div className="stack min0" style={{ gap: 18 }}>
          <div className="clay fade-up min0" style={{ padding: 22 }}>
            <label className="label" htmlFor="food-input">What did you eat?</label>
            <textarea id="food-input" data-testid="food-input" className="field" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)}
              placeholder="e.g. 2 roti, 1 katori dal, paneer sabzi and a glass of chaas" style={{ resize: "vertical", lineHeight: 1.6 }} />
            {estimate && (
              <div className="estimate" data-testid="food-estimate" aria-live="polite">
                {estimate.calories !== undefined ? (
                  <>
                    <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                      <strong style={{ fontSize: 15 }}>≈ {estimate.calories} kcal</strong>
                      <span style={{ color: "var(--text-2)" }}>P {estimate.protein_g} g · C {estimate.carbs_g} g · F {estimate.fat_g} g</span>
                    </div>
                    <div className="chips">
                      {estimate.items.map((i) => <span key={i} className="chip chip-neutral" style={{ fontSize: 11.5 }}>{i.split(" — ")[0]}</span>)}
                      {estimate.unrecognised.map((u) => (
                        <button key={u} className="chip chip-accent" onClick={() => setTeach({ name: u.replace(/^\s*[\d½¼¾.]+\s*/, "").replace(/\b\w/g, (c) => c.toUpperCase()) })}
                          style={{ border: "none", cursor: "pointer", fontSize: 11.5 }} title="Teach FitCoach this food"><Icons.CircleHelp size={12} /> {u} · teach it</button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="row" style={{ gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
                    <span style={{ color: "var(--text-2)" }}>Don't know that one yet.</span>
                    <button className="btn btn-ghost" onClick={() => setTeach({ name: typed.trim().replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60) })} style={{ padding: "6px 12px", fontSize: 12.5 }}>
                      <Icons.Plus size={14} /> Teach FitCoach
                    </button>
                  </div>
                )}
              </div>
            )}
            <button data-testid="analyze-food-btn" className="btn btn-primary" disabled={saving || !estimate?.items?.length} onClick={logMeal} style={{ padding: "13px 26px", marginTop: 14 }}>
              {saving ? <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Saving…</> : <><Icons.Plus size={18} /> Log meal</>}
            </button>
            {!online && <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 10 }}><Icons.WifiOff size={13} style={{ verticalAlign: -2 }} /> Offline — meals are saved on this phone and sync later.</div>}
          </div>

          {teach && <MyFoods foods={myFoods} prefill={teach} onClose={() => setTeach(null)} onSaved={() => { setTeach(null); load(); }} />}

          <div className="clay fade-up min0" style={{ padding: 22 }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Today's log</div>
            {todayLogs.length === 0 ? (
              <div style={{ textAlign: "center", padding: "30px 0", color: "var(--text-3)", fontSize: 14 }}>No meals logged today.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="food-logs">
                {todayLogs.map((l) => (
                  <div key={l.id} className="clay-inset" style={{ padding: 16 }} data-testid={l.pending ? "food-log-pending" : "food-log"}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 8 }}>
                      <div className="min0">
                        <div style={{ fontSize: 15, fontWeight: 600 }}>{l.result?.meal_name || "Meal"}</div>
                        <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 2 }}>{l.description}</div>
                        {l.pending && <span className="chip chip-neutral" style={{ marginTop: 6, fontSize: 11 }}><Icons.CloudOff size={12} /> On this phone · syncs when online</span>}
                      </div>
                      <div className="row" style={{ gap: 2, flexShrink: 0 }}>
                        {coach && !l.pending && (
                          <button className="icon-btn" title="Ask your coach about this meal" data-testid={`ask-food-${l.id}`}
                            onClick={() => navigate(askCoachPath(coach.user_id, { type: "food", id: l.id, label: l.result?.meal_name || l.description }))}>
                            <Icons.MessageCircle size={16} />
                          </button>
                        )}
                        <button className="icon-btn" title="Delete" data-testid={`delete-food-${l.id}`} onClick={() => remove(l)}><Icons.Trash2 size={16} /></button>
                      </div>
                    </div>
                    <div className="grid-macros">
                      <Macro label="Calories" value={Math.round(l.result?.calories || 0)} unit="" />
                      <Macro label="Protein" value={Math.round(l.result?.protein_g || 0)} unit="g" />
                      <Macro label="Carbs" value={Math.round(l.result?.carbs_g || 0)} unit="g" />
                      <Macro label="Fat" value={Math.round(l.result?.fat_g || 0)} unit="g" />
                    </div>
                    {l.result?.notes && <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 12, lineHeight: 1.6 }}>{l.result.notes}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <div className="clay fade-up" style={{ padding: 22, animationDelay: "80ms" }} data-testid="food-targets">
            <div className="eyebrow" style={{ marginBottom: 6 }}>Today vs target</div>
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>{target.from === "plan" ? "From your coach-approved nutrition plan" : "Estimated from your profile — your coach may set exact numbers"}</div>
            <div style={{ textAlign: "center", margin: "14px 0 4px" }}>
              <div className="display" style={{ fontSize: 40, fontWeight: 600 }}>{Math.round(sum("calories"))}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>of {target.calories} kcal · {Math.max(0, target.calories - Math.round(sum("calories")))} left</div>
            </div>
            <Meter label="Protein" value={sum("protein_g")} target={target.protein_g} unit=" g" />
            <Meter label="Carbs" value={sum("carbs_g")} target={target.carbs_g} unit=" g" />
            <Meter label="Fat" value={sum("fat_g")} target={target.fat_g} unit=" g" />
          </div>
          {!teach && <MyFoods foods={myFoods} onSaved={load} />}
          <div className="glass fade-up" style={{ padding: 18 }}>
            <Icons.ShieldCheck size={18} color="var(--teal)" style={{ marginBottom: 6 }} />
            <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.7 }}>
              Works offline: {FOOD_COUNT} everyday foods are built into the app, plus any you add. Estimates use typical home-style portions — add amounts (2 roti, 1 bowl, 150 g) for better accuracy; your coach can correct anything.
            </div>
          </div>
          <AbroadSwaps title="Cooking Indian food abroad" collapsed />
        </div>
      </div>
    </div>
  );
}
