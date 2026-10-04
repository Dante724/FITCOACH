import { Zap } from "lucide-react";

// Minimal wordmark: a small ink tile and the name.
export default function Logo({ size = 28 }) {
  return (
    <div className="row" style={{ gap: 9 }}>
      <div style={{ width: size, height: size, borderRadius: 8, background: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Zap size={Math.round(size * 0.52)} color="#fff" fill="#fff" />
      </div>
      <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.02em" }}>FitCoach</span>
    </div>
  );
}
