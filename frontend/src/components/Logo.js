import { Zap } from "lucide-react";

// Wordmark: a small emerald (or gold, on dark surfaces) tile and the name in the display serif.
export default function Logo({ size = 28 }) {
  return (
    <div className="row" style={{ gap: 9 }}>
      <div style={{ width: size, height: size, borderRadius: 8, background: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)" }}>
        <Zap size={Math.round(size * 0.52)} color="var(--on-ink)" fill="var(--on-ink)" />
      </div>
      <span style={{ fontFamily: "var(--serif)", fontSize: 19, fontWeight: 500, letterSpacing: "-0.01em" }}>FitCoach</span>
    </div>
  );
}
