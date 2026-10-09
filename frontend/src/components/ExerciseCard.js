import { createPortal } from "react-dom";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import * as Icons from "lucide-react";
import StickFigure from "@/components/StickFigure";
import { LEVEL_LABEL } from "@/lib/library";

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function List({ icon, title, items, tone }) {
  if (!items?.length) return null;
  const Icon = Icons[icon] || Icons.Dot;
  return (
    <div style={{ marginTop: 16 }}>
      <div className="row" style={{ gap: 6, fontWeight: 600, fontSize: 13.5, marginBottom: 6, color: tone }}><Icon size={15} /> {title}</div>
      <ul style={{ margin: "0 0 0 18px", padding: 0, fontSize: 14, lineHeight: 1.65, color: "var(--text-2)" }}>
        {items.map((x) => <li key={x}>{x}</li>)}
      </ul>
    </div>
  );
}

// Everything about one exercise or pose: names in English/Hindi/Sanskrit, the movement pattern, how to do it, safety.
export function ExerciseCard({ e, big = false, showPoseCheck = true }) {
  if (!e) return null;
  return (
    <div data-testid="exercise-card">
      <div className="row" style={{ gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div className="clay-inset" style={{ padding: 8, borderRadius: 16, flexShrink: 0 }}>
          <StickFigure figure={e.figure} size={big ? 220 : 150} animate title={`${e.name} movement`} />
        </div>
        <div className="min0" style={{ flex: "1 1 200px" }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>{e.group}</div>
          <h3 style={{ fontSize: big ? 26 : 22, lineHeight: 1.2 }}>{e.name}</h3>
          <div style={{ fontSize: 17, marginTop: 4 }} lang="hi">{e.hindi}</div>
          {(e.sanskrit || e.hinglish) && (
            <div style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2 }}>{e.sanskrit ? `${e.sanskrit} · ` : ""}{e.hinglish}</div>
          )}
          <div className="row-wrap" style={{ gap: 6, marginTop: 10 }}>
            <span className="chip chip-neutral">{LEVEL_LABEL[e.level] || e.level}</span>
            {e.dose && <span className="chip chip-teal"><Icons.Repeat size={12} /> {e.dose}</span>}
            {(e.equipment || []).filter((q) => q !== "none").map((q) => <span key={q} className="chip chip-neutral">{cap(q)}</span>)}
            {(e.equipment || []).includes("none") && <span className="chip chip-neutral">No equipment</span>}
          </div>
          {e.muscles?.length > 0 && <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 8 }}>Works: {e.muscles.join(", ")}</div>}
        </div>
      </div>
      <List icon="ListOrdered" title="How to do it" items={e.steps} />
      <List icon="Sparkles" title="Benefits" items={e.benefits} />
      <List icon="CircleAlert" title="Common mistakes" items={e.mistakes} />
      <List icon="ShieldAlert" title="Skip or ask your coach if you have" items={e.avoid_if} tone="var(--amber)" />
      {showPoseCheck && e.pose_check && (
        <Link to={`/pose-check?pose=${e.pose_check}`} className="btn btn-ghost" style={{ marginTop: 16 }} data-testid="pose-check-link">
          <Icons.ScanLine size={16} /> Check my pose with the camera
        </Link>
      )}
    </div>
  );
}

// Pop-up version used by the library, plans and calls.
export default function ExerciseModal({ e, onClose, footer }) {
  useEffect(() => {
    const onKey = (ev) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!e) return null;
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="glass modal fade-up" onClick={(ev) => ev.stopPropagation()} style={{ maxWidth: 620, maxHeight: "90vh", overflowY: "auto" }} role="dialog" aria-label={e.name}>
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: -8 }}>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icons.X size={18} /></button>
        </div>
        <ExerciseCard e={e} />
        {footer}
      </div>
    </div>,
    document.body,
  );
}
