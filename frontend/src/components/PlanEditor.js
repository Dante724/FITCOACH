import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import { api } from "@/lib/api";
import { PLAN_LABEL } from "@/lib/focus";
import { useToast } from "@/context/ToastContext";

const blankExercise = () => ({ name: "", sets: 3, reps: "10", rest: "60s", notes: "" });
const blankMeal = () => ({ meal: "Snack", name: "", items: [], calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

function DaysEditor({ content, setContent, yoga }) {
  const days = content.days || [];
  const setDays = (next) => setContent({ ...content, days: next });
  const patchDay = (i, patch) => setDays(days.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const patchEx = (i, k, patch) => patchDay(i, { exercises: days[i].exercises.map((e, j) => (j === k ? { ...e, ...patch } : e)) });

  return (
    <div className="stack" style={{ gap: 14 }}>
      {days.map((d, i) => (
        <div key={i} className="clay-inset" style={{ padding: 14 }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <input className="field" value={d.name} onChange={(e) => patchDay(i, { name: e.target.value })} placeholder="Day name" style={{ flex: 1, fontWeight: 600 }} aria-label="Day name" />
            <input className="field" value={d.focus} onChange={(e) => patchDay(i, { focus: e.target.value })} placeholder="Focus" style={{ flex: 1 }} aria-label="Day focus" />
            <button className="icon-btn" title="Remove day" onClick={() => setDays(days.filter((_, j) => j !== i))}><Icons.Trash2 size={16} /></button>
          </div>
          <div className="ex-row" style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", padding: "0 2px 4px" }}>
            <span>{yoga ? "Pose" : "Exercise"}</span><span>{yoga ? "Rounds" : "Sets"}</span><span>{yoga ? "Hold" : "Reps"}</span><span className="ex-rest">Rest</span><span />
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {d.exercises.map((ex, k) => (
              <div key={k}>
                <div className="ex-row">
                  <input className="field" value={ex.name} onChange={(e) => patchEx(i, k, { name: e.target.value })} placeholder="Name" aria-label="Exercise name" />
                  <input className="field" type="number" min="0" value={ex.sets} onChange={(e) => patchEx(i, k, { sets: e.target.value })} aria-label="Sets" />
                  <input className="field ex-reps" value={ex.reps} onChange={(e) => patchEx(i, k, { reps: e.target.value })} aria-label="Reps" />
                  <input className="field ex-rest" value={ex.rest} onChange={(e) => patchEx(i, k, { rest: e.target.value })} aria-label="Rest" />
                  <button className="icon-btn" title="Remove" onClick={() => patchDay(i, { exercises: d.exercises.filter((_, j) => j !== k) })}><Icons.X size={16} /></button>
                </div>
                <input className="field" value={ex.notes} onChange={(e) => patchEx(i, k, { notes: e.target.value })} placeholder="Cue / note (optional)"
                  style={{ marginTop: 6, padding: "8px 11px", fontSize: 12.5 }} aria-label="Note" />
              </div>
            ))}
          </div>
          <button className="btn btn-ghost" onClick={() => patchDay(i, { exercises: [...d.exercises, blankExercise()] })} style={{ marginTop: 10, padding: "8px 14px", fontSize: 13 }}>
            <Icons.Plus size={15} /> Add {yoga ? "pose" : "exercise"}
          </button>
        </div>
      ))}
      <button className="btn btn-ghost" onClick={() => setDays([...days, { name: `Day ${days.length + 1}`, focus: "", exercises: [blankExercise()] }])} style={{ alignSelf: "flex-start" }}>
        <Icons.CalendarPlus size={16} /> Add day
      </button>
    </div>
  );
}

function MealsEditor({ content, setContent }) {
  const meals = content.meals || [];
  const setMeals = (next) => setContent({ ...content, meals: next });
  const patch = (i, p) => setMeals(meals.map((m, j) => (j === i ? { ...m, ...p } : m)));
  const total = (k) => Math.round(meals.reduce((s, m) => s + (Number(m[k]) || 0), 0));

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row-wrap" style={{ fontSize: 13, color: "var(--text-2)" }}>
        <span className="chip chip-neutral">{total("calories")} kcal</span>
        <span className="chip chip-neutral">P {total("protein_g")}g</span>
        <span className="chip chip-neutral">C {total("carbs_g")}g</span>
        <span className="chip chip-neutral">F {total("fat_g")}g</span>
      </div>
      {meals.map((m, i) => (
        <div key={i} className="clay-inset" style={{ padding: 14 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <select className="field" value={m.meal} onChange={(e) => patch(i, { meal: e.target.value })} style={{ width: 130, flexShrink: 0 }} aria-label="Meal">
              {["Breakfast", "Lunch", "Dinner", "Snack"].map((x) => <option key={x}>{x}</option>)}
            </select>
            <input className="field" value={m.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="Meal name" style={{ flex: 1 }} aria-label="Meal name" />
            <button className="icon-btn" title="Remove meal" onClick={() => setMeals(meals.filter((_, j) => j !== i))}><Icons.Trash2 size={16} /></button>
          </div>
          <textarea className="field" rows={3} value={m.items.join("\n")} onChange={(e) => patch(i, { items: e.target.value.split("\n") })}
            placeholder="One item per line, with portions" style={{ resize: "vertical", fontSize: 13.5, lineHeight: 1.6 }} aria-label="Items" />
          <div className="grid-macros" style={{ marginTop: 8 }}>
            {[["calories", "kcal"], ["protein_g", "Protein g"], ["carbs_g", "Carbs g"], ["fat_g", "Fat g"]].map(([k, label]) => (
              <label key={k} style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)" }}>{label}
                <input className="field" type="number" min="0" value={m[k]} onChange={(e) => patch(i, { [k]: e.target.value })} style={{ padding: "9px 10px", marginTop: 4 }} />
              </label>
            ))}
          </div>
        </div>
      ))}
      <button className="btn btn-ghost" onClick={() => setMeals([...meals, blankMeal()])} style={{ alignSelf: "flex-start" }}><Icons.Plus size={16} /> Add meal</button>
    </div>
  );
}

// Coach-side editor for a draft plan: edit inline, then approve to publish it to the client.
export default function PlanEditor({ plan, onChanged }) {
  const { push } = useToast();
  const [content, setContent] = useState(plan.content);
  const [note, setNote] = useState(plan.coach_note || "");
  const [busy, setBusy] = useState("");

  useEffect(() => { setContent(plan.content); setNote(plan.coach_note || ""); }, [plan]);

  const cleaned = () => {
    if (plan.type === "meal") return { ...content, meals: content.meals.map((m) => ({ ...m, items: m.items.map((x) => x.trim()).filter(Boolean) })) };
    return content;
  };

  const save = async (quiet) => {
    const r = await api.put(`/plans/${plan.id}`, { content: cleaned(), coach_note: note });
    if (!quiet) push("Draft saved.", "success");
    return r.data;
  };

  const run = async (kind, fn) => {
    setBusy(kind);
    try { await fn(); } catch (e) { push(e?.response?.data?.detail || "Something went wrong.", "error"); } finally { setBusy(""); }
  };

  const approve = () => run("approve", async () => {
    await save(true);
    await api.post(`/plans/${plan.id}/approve`);
    push("Approved — your client can see it now.", "success");
    onChanged?.();
  });
  const discard = () => run("discard", async () => {
    if (!window.confirm("Discard this draft?")) return;
    await api.delete(`/plans/${plan.id}`);
    push("Draft discarded.");
    onChanged?.();
  });

  return (
    <div data-testid={`plan-editor-${plan.type}`}>
      <div className="row-wrap" style={{ marginBottom: 12 }}>
        <span className="chip chip-amber"><Icons.PencilLine size={13} /> Draft</span>
        {plan.ai_generated ? <span className="chip chip-violet"><Icons.Sparkles size={13} /> AI draft</span>
          : plan.source === "engine" ? <span className="chip chip-violet"><Icons.Sparkles size={13} /> Auto draft</span>
          : <span className="chip chip-neutral">Manual</span>}
        {plan.revises && <span className="chip chip-neutral">Replaces current plan</span>}
      </div>
      {plan.ai_note && <div className="clay-inset" style={{ padding: "10px 14px", fontSize: 12.5, color: "var(--text-2)", marginBottom: 12 }}><Icons.Info size={13} /> {plan.ai_note}</div>}
      {plan.reason && <div className="clay-inset" style={{ padding: "10px 14px", fontSize: 13, color: "var(--text-2)", marginBottom: 12 }}><strong>Reason shown to client:</strong> {plan.reason}</div>}

      <label className="label">Title</label>
      <input className="field" data-testid="plan-title" value={content.title || ""} onChange={(e) => setContent({ ...content, title: e.target.value })} style={{ marginBottom: 12 }} />
      <label className="label">Summary</label>
      <textarea className="field" rows={2} value={content.summary || ""} onChange={(e) => setContent({ ...content, summary: e.target.value })} style={{ marginBottom: 16, resize: "vertical" }} />

      {plan.type === "meal"
        ? <MealsEditor content={content} setContent={setContent} />
        : <DaysEditor content={content} setContent={setContent} yoga={plan.type === "yoga"} />}

      <label className="label" style={{ marginTop: 18 }}>Note to client (optional)</label>
      <textarea className="field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Keep week 1 light and focus on form." style={{ resize: "vertical" }} />

      <div className="row-wrap" style={{ marginTop: 18, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={discard} disabled={!!busy} style={{ color: "var(--accent)" }}>Discard</button>
        <button className="btn btn-ghost" data-testid="plan-save" onClick={() => run("save", () => save(false).then(() => onChanged?.()))} disabled={!!busy}>
          <Icons.Save size={16} /> {busy === "save" ? "Saving..." : "Save draft"}
        </button>
        <button className="btn btn-primary" data-testid="plan-approve" onClick={approve} disabled={!!busy}>
          <Icons.BadgeCheck size={17} /> {busy === "approve" ? "Approving..." : `Approve ${PLAN_LABEL[plan.type].toLowerCase()}`}
        </button>
      </div>
    </div>
  );
}
