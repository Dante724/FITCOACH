import * as Icons from "lucide-react";

export function MealPlanView({ content }) {
  const totals = [
    ["Calories", content.total_calories, "", "var(--text)"],
    ["Protein", content.total_protein_g, "g", "var(--text)"],
    ["Carbs", content.total_carbs_g, "g", "var(--text)"],
    ["Fat", content.total_fat_g, "g", "var(--text)"],
  ];
  return (
    <div>
      <div className="grid-macros" style={{ marginBottom: 16 }}>
        {totals.map(([label, v, unit, color]) => (
          <div key={label} className="clay-inset" style={{ padding: "12px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>{label}</div>
            <div className="display" style={{ fontSize: 19, fontWeight: 600, color }}>{Math.round(v || 0)}<span style={{ fontSize: 11, fontWeight: 500 }}>{unit}</span></div>
          </div>
        ))}
      </div>
      <div className="stack">
        {(content.meals || []).map((m, i) => (
          <div key={i} className="clay-inset" style={{ padding: "14px 16px" }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap" }}>
              <div className="min0">
                <div className="eyebrow" style={{ fontSize: 10.5 }}>{m.meal}</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{m.name}</div>
              </div>
              <span className="chip chip-neutral">{Math.round(m.calories)} kcal</span>
            </div>
            <ul style={{ margin: "6px 0 8px 18px", fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.7 }}>
              {m.items.map((it, j) => <li key={j}>{it}</li>)}
            </ul>
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>P {Math.round(m.protein_g)}g · C {Math.round(m.carbs_g)}g · F {Math.round(m.fat_g)}g</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Days → exercises, used for both training plans and yoga practices.
export function DaysPlanView({ content, yoga, done, onToggle, day, onDay }) {
  const days = content.days || [];
  const current = days[day] || days[0];
  return (
    <div>
      {days.length > 1 && (
        <div className="tabs" role="tablist">
          {days.map((d, i) => (
            <button key={i} className={`tab${i === day ? " active" : ""}`} onClick={() => onDay(i)} role="tab" data-testid={`plan-day-${i}`}>
              {d.name}{d.focus ? ` · ${d.focus}` : ""}
            </button>
          ))}
        </div>
      )}
      {current && (
        <div className="stack">
          {current.exercises.map((ex, i) => {
            const checked = !!done?.[i];
            return (
              <button key={`${day}-${i}`} data-testid={`exercise-${i}`} onClick={() => onToggle?.(i)} disabled={!onToggle}
                className="clay-inset" style={{ border: "none", cursor: onToggle ? "pointer" : "default", padding: "13px 14px", display: "flex", gap: 12, textAlign: "left", alignItems: "flex-start", color: "var(--text)" }}>
                {onToggle && (
                  <div style={{ width: 24, height: 24, marginTop: 1, borderRadius: 8, background: checked ? "var(--ink)" : "transparent", border: checked ? "none" : "2px solid rgba(139,150,172,0.4)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {checked && <Icons.Check size={15} color="#fff" />}
                  </div>
                )}
                <div className="min0" style={{ flex: 1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, textDecoration: checked ? "line-through" : "none", color: checked ? "var(--text-3)" : "var(--text)" }}>{ex.name}</div>
                  {ex.notes && <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 3, lineHeight: 1.5 }}>{ex.notes}</div>}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <span className="chip chip-neutral">{yoga ? `${ex.sets}× ${ex.reps}` : `${ex.sets} × ${ex.reps}`}</span>
                  {ex.rest && ex.rest !== "—" && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>rest {ex.rest}</div>}
                </div>
              </button>
            );
          })}
          {current.exercises.length === 0 && <div className="empty">Rest day.</div>}
        </div>
      )}
    </div>
  );
}

export function ApprovedBy({ plan }) {
  if (!plan) return null;
  const when = plan.approved_at ? new Date(plan.approved_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";
  return (
    <div>
      <div className="row-wrap" style={{ gap: 8 }}>
        <span className="chip chip-teal"><Icons.BadgeCheck size={14} /> Approved by {plan.approved_by_name}{when ? ` · ${when}` : ""}</span>
      </div>
      {plan.reason && (
        <div className="clay-inset" style={{ padding: "10px 14px", marginTop: 10, fontSize: 13, color: "var(--text-2)" }}>
          <strong style={{ color: "var(--text)" }}>Why it changed:</strong> {plan.reason}
        </div>
      )}
      {plan.coach_note && (
        <div className="clay-inset" style={{ padding: "10px 14px", marginTop: 8, fontSize: 13, color: "var(--text-2)" }}>
          <strong style={{ color: "var(--text)" }}>Coach's note:</strong> {plan.coach_note}
        </div>
      )}
    </div>
  );
}
