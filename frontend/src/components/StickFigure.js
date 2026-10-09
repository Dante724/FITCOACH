import { useEffect, useRef, useState } from "react";

// Joints: 0 head, 1 L shoulder, 2 R shoulder, 3 L elbow, 4 R elbow, 5 L wrist, 6 R wrist, 7 L hip, 8 R hip, 9 L knee,
// 10 R knee, 11 L ankle, 12 R ankle — in a 0–100 box, y down, floor at 92.
const LIMBS = [[1, 3], [3, 5], [2, 4], [4, 6], [7, 9], [9, 11], [8, 10], [10, 12]];
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const lerp = (a, b, t) => a.map((p, i) => [p[0] + (b[i][0] - p[0]) * t, p[1] + (b[i][1] - p[1]) * t]);

function reducedMotion() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

// The movement pattern as a stick figure. `animate` loops start → end → start (about 2.4 s per rep).
export default function StickFigure({ figure, size = 120, animate = false, color = "var(--ink)", title }) {
  const [t, setT] = useState(animate && !reducedMotion() ? 0 : 1);
  const raf = useRef(0);
  useEffect(() => {
    if (!animate || !figure || reducedMotion()) { setT(1); return undefined; }
    const t0 = performance.now();
    const tick = (now) => {
      const phase = ((now - t0) / 2400) % 1;
      setT((1 - Math.cos(phase * 2 * Math.PI)) / 2); // ease in/out, there and back
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [animate, figure]);
  if (!figure?.start || !figure?.end) return null;
  const p = lerp(figure.start, figure.end, t);
  const neck = mid(p[1], p[2]);
  const pelvis = mid(p[7], p[8]);
  // near side (L) drawn solid, far side (R) lighter in side view so crossing limbs stay readable
  const far = figure.view === "side";
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={title || "Movement pattern"} style={{ display: "block" }}>
      <line x1="4" y1="93.5" x2="96" y2="93.5" stroke="var(--border-strong, #ccc)" strokeWidth="1" strokeLinecap="round" />
      <g stroke={color} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {LIMBS.map(([a, b]) => (
          <line key={`${a}-${b}`} x1={p[a][0]} y1={p[a][1]} x2={p[b][0]} y2={p[b][1]} opacity={far && [2, 4, 6, 8, 10, 12].includes(a) ? 0.45 : 1} />
        ))}
        <line x1={p[1][0]} y1={p[1][1]} x2={p[2][0]} y2={p[2][1]} />
        <line x1={p[7][0]} y1={p[7][1]} x2={p[8][0]} y2={p[8][1]} />
        <line x1={neck[0]} y1={neck[1]} x2={pelvis[0]} y2={pelvis[1]} />
        <line x1={neck[0]} y1={neck[1]} x2={p[0][0] + (neck[0] - p[0][0]) * 0.45} y2={p[0][1] + (neck[1] - p[0][1]) * 0.45} />
      </g>
      <circle cx={p[0][0]} cy={p[0][1]} r="5" fill={color} />
    </svg>
  );
}
