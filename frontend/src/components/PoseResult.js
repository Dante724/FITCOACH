import * as Icons from "lucide-react";

const ringColor = (s) => (s >= 80 ? "var(--teal)" : s >= 55 ? "var(--amber)" : "var(--accent)");

export function ScoreRing({ score, size = 84 }) {
  return (
    <div className="score-ring" style={{ width: size, height: size, fontSize: size / 3, color: ringColor(score),
      background: `conic-gradient(${ringColor(score)} ${score * 3.6}deg, rgba(139,150,172,0.18) 0deg)` }}>
      <div style={{ width: size - 14, height: size - 14, borderRadius: "50%", background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center" }}>{score}</div>
    </div>
  );
}

// Per-check breakdown from the automatic analysis.
export function CheckList({ checks }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      {checks.map((c) => (
        <div key={c.id} className="row" style={{ fontSize: 13.5, alignItems: "flex-start" }}>
          {c.ok ? <Icons.CircleCheck size={17} color="var(--teal)" style={{ flexShrink: 0, marginTop: 1 }} /> : <Icons.CircleX size={17} color="var(--accent)" style={{ flexShrink: 0, marginTop: 1 }} />}
          <div className="min0">
            <span style={{ fontWeight: 600 }}>{c.label}</span>
            {c.unit === "°" && <span style={{ color: "var(--text-3)" }}> · {Math.round(c.value)}°</span>}
            {!c.ok && c.cue && <div style={{ color: "var(--text-2)", fontSize: 12.5 }}>{c.cue}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
