import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import * as Icons from "lucide-react";
import { api } from "@/lib/api";
import { GOAL_LABEL } from "@/lib/focus";
import { weekTiles } from "@/lib/week";
import { useToast } from "@/context/ToastContext";
import { useAuth } from "@/context/AuthContext";
import { weightUnit } from "@/lib/locale";

const W = 1080, H = 1350;
const SERIF = "Fraunces, Georgia, serif";
const SANS = "Inter, system-ui, sans-serif";

function shortDate(iso) {
  return new Date(`${iso}T12:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}


function headline(w) {
  if (w.workouts >= 4 || w.streak >= 7) return "Unstoppable.";
  if (w.workouts >= 2 || w.streak >= 3) return "Showing up.";
  return "Every step counts.";
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draws the shareable card. Kept free of React so it can be reused and tested.
export function drawWeekCard(ctx, w) {
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0f4a3a");
  bg.addColorStop(1, "#0a2a21");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, 120, 0, W * 0.85, 120, 620);
  glow.addColorStop(0, "rgba(201,164,92,0.28)");
  glow.addColorStop(1, "rgba(201,164,92,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(201,164,92,0.45)";
  ctx.lineWidth = 2;
  roundRect(ctx, 40, 40, W - 80, H - 80, 36);
  ctx.stroke();

  ctx.fillStyle = "#c9a45c";
  ctx.font = `600 30px ${SANS}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("F I T C O A C H", 100, 140);
  ctx.textAlign = "right";
  ctx.font = `500 28px ${SANS}`;
  ctx.fillStyle = "rgba(251,247,238,0.7)";
  ctx.fillText(`${shortDate(w.from)} – ${shortDate(w.to)}`, W - 100, 140);
  ctx.textAlign = "left";

  const first = (w.name || "My").split(" ")[0];
  ctx.fillStyle = "#fbf7ee";
  ctx.font = `500 92px ${SERIF}`;
  ctx.fillText(`${first}'s week`, 100, 300);
  ctx.font = `italic 400 60px ${SERIF}`;
  ctx.fillStyle = "#e3c88f";
  ctx.fillText(headline(w), 100, 385);
  if (GOAL_LABEL[w.focus]) {
    ctx.font = `500 30px ${SANS}`;
    ctx.fillStyle = "rgba(251,247,238,0.65)";
    ctx.fillText(`Working towards ${GOAL_LABEL[w.focus].toLowerCase()}`, 100, 445);
  }

  const tiles = weekTiles(w, w.unit);
  const tw = (W - 200 - 30) / 2, th = tiles.length <= 2 ? 330 : 270;
  tiles.forEach((t, i) => {
    const x = 100 + (i % 2) * (tw + 30), y = 520 + Math.floor(i / 2) * (th + 30);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    roundRect(ctx, x, y, tw, th, 28);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#fbf7ee";
    ctx.font = `500 ${t.value.length > 6 ? 92 : 112}px ${SERIF}`;
    ctx.fillText(t.value, x + 40, y + 160);
    ctx.fillStyle = "rgba(251,247,238,0.7)";
    ctx.font = `500 32px ${SANS}`;
    ctx.fillText(t.label, x + 40, y + 220);
  });

  ctx.fillStyle = "rgba(201,164,92,0.5)";
  ctx.fillRect(100, 1150, 80, 3);
  ctx.fillStyle = "rgba(251,247,238,0.85)";
  ctx.font = `500 32px ${SANS}`;
  ctx.fillText(w.coach ? `Coached by ${w.coach}` : "Coached on FitCoach", 100, 1210);
}

export default function WeekCard({ onClose }) {
  const { push } = useToast();
  const { user } = useAuth();
  const unit = weightUnit(user);
  const canvasRef = useRef(null);
  const [week, setWeek] = useState(null);
  const [blob, setBlob] = useState(null);
  const [url, setUrl] = useState("");

  useEffect(() => { api.get("/me/week").then((r) => setWeek(r.data)).catch(() => push("Could not load your week.", "error")); }, [push]);

  useEffect(() => {
    if (!week || !canvasRef.current) return undefined;
    let cancelled = false;
    let made = "";
    (document.fonts?.ready || Promise.resolve()).then(() => {
      if (cancelled) return;
      const c = canvasRef.current;
      drawWeekCard(c.getContext("2d"), { ...week, unit });
      c.toBlob((b) => {
        if (cancelled || !b) return;
        made = URL.createObjectURL(b);
        setBlob(b);
        setUrl(made);
      }, "image/png");
    });
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [week, unit]);

  const file = blob && new File([blob], "my-fitcoach-week.png", { type: "image/png" });
  const canShare = !!(file && navigator.canShare?.({ files: [file] }));

  const share = async () => {
    try {
      await navigator.share({ files: [file], title: "My week on FitCoach", text: "My week with my coach 💪" });
    } catch (e) {
      if (e?.name !== "AbortError") push("Sharing didn't work — try Download instead.", "error");
    }
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="glass modal fade-up" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }} data-testid="week-card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ fontSize: 22 }}>Your week</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icons.X size={18} /></button>
        </div>
        <canvas ref={canvasRef} width={W} height={H} style={{ display: "none" }} />
        {url ? <img src={url} alt="Your weekly progress card" style={{ width: "100%", borderRadius: 16, display: "block" }} data-testid="week-card-img" />
          : <div style={{ aspectRatio: "4 / 5", display: "flex", alignItems: "center", justifyContent: "center" }}><div className="spinner" /></div>}
        <div className="row" style={{ gap: 10, marginTop: 14 }}>
          {canShare && <button className="btn btn-primary" onClick={share} style={{ flex: 1 }}><Icons.Share2 size={16} /> Share</button>}
          <a className={`btn ${canShare ? "btn-ghost" : "btn-primary"}`} href={url || undefined} download="my-fitcoach-week.png" style={{ flex: 1, pointerEvents: url ? "auto" : "none" }}>
            <Icons.Download size={16} /> Download
          </a>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 10, textAlign: "center" }}>Only what you see on the card is shared.</p>
      </div>
    </div>,
    document.body,
  );
}
