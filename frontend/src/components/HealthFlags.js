import * as Icons from "lucide-react";

const STYLE = {
  high: { icon: "AlertTriangle", color: "var(--accent)" },
  watch: { icon: "Eye", color: "var(--amber)" },
  tip: { icon: "Lightbulb", color: "var(--teal)" },
};

// Health screening tuned for South Asians (Indian BMI and waist limits, HbA1c, vitamin D, B12). Not a diagnosis.
export default function HealthFlags({ flags, forCoach = false }) {
  if (!flags?.length) return null;
  return (
    <div className="clay fade-up min0" style={{ padding: 20 }} data-testid="health-flags">
      <div className="eyebrow" style={{ marginBottom: 4 }}>Health check</div>
      <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 12 }}>
        {forCoach ? "Based on Indian/Asian health limits. Plan around these and keep their doctor in the loop."
          : "Based on Indian/Asian health limits, which are stricter than Western ones. Not a diagnosis — share with your doctor."}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {flags.map((f) => {
          const st = STYLE[f.level] || STYLE.tip;
          const Icon = Icons[st.icon] || Icons.Info;
          return (
            <div key={f.text} className="clay-inset row" style={{ padding: "10px 12px", gap: 10, alignItems: "flex-start", fontSize: 13.5, lineHeight: 1.5 }}>
              <Icon size={16} color={st.color} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{f.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
