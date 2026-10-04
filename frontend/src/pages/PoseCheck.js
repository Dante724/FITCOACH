import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PoseCamera from "@/components/PoseCamera";
import { ScoreRing, CheckList } from "@/components/PoseResult";
import { api } from "@/lib/api";
import { POSES, POSE_KEYS, matchPose } from "@/lib/poses";
import { timeAgo } from "@/lib/focus";
import { useToast } from "@/context/ToastContext";
import useCoaches from "@/lib/useCoaches";

function HistoryItem({ c }) {
  const reviewed = c.status === "reviewed";
  const flags = reviewed ? c.coach_flags : c.flags;
  return (
    <div className="clay-inset" style={{ padding: 14, display: "flex", gap: 14, flexWrap: "wrap" }} data-testid="pose-history-item">
      <img src={c.snapshot} alt={`${c.pose_label} snapshot`} style={{ width: 96, height: 128, objectFit: "cover", borderRadius: 12, flexShrink: 0, background: "#11141b" }} />
      <div className="min0" style={{ flex: "1 1 200px" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ fontWeight: 700 }}>{c.pose_label} <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 500 }}>· {timeAgo(c.created_at)}</span></div>
          <ScoreRing score={reviewed ? c.coach_score : c.score} size={46} />
        </div>
        {reviewed
          ? <span className="chip chip-teal"><Icons.BadgeCheck size={13} /> Reviewed by {c.reviewed_by_name}</span>
          : <span className="chip chip-amber"><Icons.Hourglass size={13} /> Automatic result · waiting for your coach</span>}
        {flags?.length > 0 ? (
          <ul style={{ margin: "10px 0 0 18px", fontSize: 13.5, lineHeight: 1.7, color: "var(--text-2)" }}>{flags.map((f, i) => <li key={i}>{f}</li>)}</ul>
        ) : <div style={{ fontSize: 13.5, color: "var(--teal)", marginTop: 10, fontWeight: 600 }}>Great alignment — nothing to fix.</div>}
        {c.coach_note && <div style={{ fontSize: 13, marginTop: 8 }}><strong>Coach:</strong> {c.coach_note}</div>}
      </div>
    </div>
  );
}

// Yoga pose check: live on-device tracking, then a 10s hold that's sent to the yoga coach for review.
export default function PoseCheck() {
  const { push } = useToast();
  const coaches = useCoaches();
  const [params, setParams] = useSearchParams();
  const [planPoses, setPlanPoses] = useState([]);
  const [planId, setPlanId] = useState(null);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState(null);
  const [sending, setSending] = useState(false);
  const pose = POSES[params.get("pose")] ? params.get("pose") : planPoses[0] || "warrior2";

  const loadHistory = useCallback(() => api.get("/pose-checks").then((r) => setHistory(r.data)).catch(() => setHistory([])), []);
  useEffect(() => {
    loadHistory();
    api.get("/workouts/plan", { params: { type: "yoga" } }).then((r) => {
      const plan = r.data.plan;
      if (!plan) return;
      setPlanId(plan.id);
      const keys = plan.content.days.flatMap((d) => d.exercises.map((e) => matchPose(e.name))).filter(Boolean);
      setPlanPoses([...new Set(keys)]);
    }).catch(() => {});
  }, [loadHistory]);

  const order = useMemo(() => [...planPoses, ...POSE_KEYS.filter((k) => !planPoses.includes(k))], [planPoses]);
  const onResult = useCallback((summary, snapshot) => setResult({ ...summary, snapshot }), []);
  const pick = (k) => { setResult(null); setParams({ pose: k }, { replace: true }); };

  const send = async () => {
    setSending(true);
    try {
      await api.post("/pose-checks", { pose, pose_label: POSES[pose].label, score: result.score, checks: result.checks, flags: result.flags,
        snapshot: result.snapshot, frames: result.frames, plan_id: planId });
      push("Sent to your coach for review.", "success");
      setResult(null);
      loadHistory();
    } catch (e) { push(e?.response?.data?.detail || "Could not send.", "error"); } finally { setSending(false); }
  };

  return (
    <div>
      <PageHeader eyebrow="Yoga" title="Pose Check" subtitle="See your alignment live, then record a 10-second hold. Your yoga coach reviews it and confirms what to fix." />

      <div className="tabs" role="tablist">
        {order.map((k) => (
          <button key={k} role="tab" className={`tab${k === pose ? " active" : ""}`} onClick={() => pick(k)} data-testid={`pose-${k}`}>
            {POSES[k].label}{planPoses.includes(k) && <Icons.Star size={13} fill="currentColor" />}
          </button>
        ))}
      </div>
      {planPoses.length > 0 && <div style={{ fontSize: 12, color: "var(--text-3)", margin: "-6px 0 14px" }}><Icons.Star size={11} fill="currentColor" /> In your practice</div>}

      <div className="grid-main-side">
        <div className="clay fade-up min0" style={{ padding: 16 }}>
          <PoseCamera poseKey={pose} onResult={onResult} />
        </div>

        <div className="clay fade-up min0" style={{ padding: 20 }}>
          {!result ? (
            <>
              <div className="eyebrow" style={{ marginBottom: 12 }}>What we check</div>
              <div className="stack" style={{ gap: 8 }}>
                {POSES[pose].checks.map((c) => (
                  <div key={c.id} className="row" style={{ fontSize: 13.5 }}><Icons.Check size={15} color="var(--teal)" /> {c.label}</div>
                ))}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 14, lineHeight: 1.6 }}>
                Automatic scoring is a guide, not a diagnosis. Your coach has the final say, and stop if anything hurts.
              </div>
            </>
          ) : (
            <div data-testid="pose-result">
              <div className="row" style={{ gap: 14, marginBottom: 14 }}>
                <ScoreRing score={result.score} />
                <div className="min0">
                  <div style={{ fontWeight: 800, fontSize: 17 }}>{POSES[pose].label}</div>
                  <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>Automatic result · {result.flags.length ? `${result.flags.length} thing${result.flags.length > 1 ? "s" : ""} to work on` : "looking good"}</div>
                </div>
              </div>
              <CheckList checks={result.checks} />
              {result.snapshot && <img src={result.snapshot} alt="Snapshot of your hold" style={{ width: "100%", borderRadius: 12, marginTop: 14 }} />}
              <div className="row-wrap" style={{ marginTop: 14 }}>
                {coaches?.yoga
                  ? <button className="btn btn-primary" data-testid="pose-send" onClick={send} disabled={sending || !result.snapshot} style={{ flex: 1 }}><Icons.Send size={16} /> {sending ? "Sending…" : `Send to ${coaches.yoga.name.split(" ")[0]}`}</button>
                  : <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>You can send checks once your yoga coach is assigned.</div>}
                <button className="btn btn-ghost" onClick={() => setResult(null)}><Icons.RotateCcw size={16} /> Try again</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="clay fade-up" style={{ padding: 20, marginTop: 18 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Your checks</div>
        {history === null && <div className="spinner" style={{ margin: "20px auto" }} />}
        {history?.length === 0 && <div className="empty">No checks yet. Pick a pose, start the camera and hold it for 10 seconds.</div>}
        <div className="stack">{history?.map((c) => <HistoryItem key={c.id} c={c} />)}</div>
      </div>
    </div>
  );
}
