import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as Icons from "lucide-react";
import { api } from "@/lib/api";
import useCall from "@/lib/useCall";
import { initials } from "@/lib/focus";

function Video({ stream, muted, mirror, className, testid }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream || null; }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} data-testid={testid} style={mirror ? { transform: "scaleX(-1)" } : undefined} />;
}

function Timer({ since }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{String(Math.floor(s / 60)).padStart(2, "0")}:{String(s % 60).padStart(2, "0")}</span>;
}

function CtrlBtn({ on = true, danger, label, onClick, children, testid }) {
  return (
    <button className={`call-btn${on ? "" : " off"}${danger ? " danger" : ""}`} onClick={onClick} aria-label={label} title={label} data-testid={testid}>
      {children}
      <span className="call-btn-label">{label}</span>
    </button>
  );
}

const STATUS = {
  init: "Starting…", ringing: "Calling…", waiting: "Waiting to join", connecting: "Connecting…",
  reconnecting: "Reconnecting…", left: "Left the call", declined: "Call declined", noanswer: "No answer", ended: "Call ended", error: "Can't connect",
};

function CallRoom({ callId }) {
  const navigate = useNavigate();
  const c = useCall(callId);
  const peer = c.call?.peer_name || "";
  const done = ["declined", "noanswer", "ended", "error"].includes(c.phase);
  const remoteHasVideo = c.remoteStream?.getVideoTracks().some((t) => t.readyState === "live");
  const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  useEffect(() => { if (c.phase === "noanswer") c.hangUp(); }, [c.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const leave = async () => { if (!done) await c.hangUp(); navigate(-1); };

  return (
    <div className="call-room" data-testid="call-room">
      <div className="call-stage">
        {c.remoteStream && c.phase !== "waiting" ? (
          <Video stream={c.remoteStream} className="call-remote" testid="remote-video" />
        ) : null}
        {(!c.remoteStream || !remoteHasVideo || c.phase !== "connected") && (
          <div className="call-placeholder">
            <div className={`call-avatar${["ringing", "connecting", "waiting"].includes(c.phase) ? " pulse" : ""}`}>{initials(peer)}</div>
            <div className="call-peer">{peer || "…"}</div>
            <div className="call-status" data-testid="call-status">
              {c.phase === "left" ? `${peer.split(" ")[0]} left the call. You can wait here if they're coming back.` : STATUS[c.phase] || ""}
              {c.phase === "waiting" && peer ? ` — ${peer.split(" ")[0]} isn't here yet` : ""}
            </div>
            {c.error && <div className="call-status" style={{ color: "#f3b9a5" }}>{c.error}</div>}
            {(done || c.phase === "left") && <button className="btn btn-primary" onClick={leave} style={{ marginTop: 18 }} data-testid="call-back">Back to app</button>}
          </div>
        )}

        <div className="call-top">
          <div className="row" style={{ gap: 10 }}>
            <button className="call-icon" onClick={leave} aria-label="Leave"><Icons.ArrowLeft size={18} /></button>
            <div className="min0">
              <div className="truncate" style={{ fontFamily: "var(--serif)", fontSize: 18 }}>{peer}</div>
              <div style={{ fontSize: 12.5, opacity: 0.7 }}>
                {c.phase === "connected" && c.connectedAt ? <><span className="live-dot" /> Live · <Timer since={c.connectedAt} /></> : STATUS[c.phase]}
                {c.call?.kind === "scheduled" && c.call?.time ? ` · booked ${c.call.time}` : ""}
              </div>
            </div>
          </div>
          {c.noiseCancel && <span className="call-chip"><Icons.AudioLines size={13} /> Noise cancellation on</span>}
        </div>

        {c.localStream && !done && (
          <div className="call-self">
            <Video stream={c.localStream} muted mirror={c.facing === "user"} className="call-self-video" testid="local-video" />
            {!c.cam && <div className="call-self-off"><Icons.VideoOff size={18} /></div>}
            {!c.mic && <div className="call-self-mute"><Icons.MicOff size={12} /></div>}
          </div>
        )}

        {c.deviceNotes.length > 0 && !done && (
          <div className="call-note">
            <Icons.TriangleAlert size={14} /> We couldn't use your {c.deviceNotes.join(" or ")}. Check your browser's permissions — {c.deviceNotes.includes("microphone") ? "they won't hear you" : "you're on audio only"}.
          </div>
        )}
      </div>

      {!done && (
        <div className="call-bar">
          <CtrlBtn on={c.mic} label={c.mic ? "Mute" : "Unmute"} onClick={c.toggleMic} testid="call-mic">{c.mic ? <Icons.Mic size={20} /> : <Icons.MicOff size={20} />}</CtrlBtn>
          <CtrlBtn on={c.cam} label={c.cam ? "Camera off" : "Camera on"} onClick={c.toggleCam} testid="call-cam">{c.cam ? <Icons.Video size={20} /> : <Icons.VideoOff size={20} />}</CtrlBtn>
          <CtrlBtn on={c.noiseCancel} label={c.noiseCancel ? "Noise cancel on" : "Noise cancel off"} onClick={c.toggleNoiseCancel} testid="call-nc"><Icons.AudioLines size={20} /></CtrlBtn>
          {isMobile && <CtrlBtn label="Flip" onClick={c.flipCamera} testid="call-flip"><Icons.SwitchCamera size={20} /></CtrlBtn>}
          <CtrlBtn danger label="End" onClick={leave} testid="call-end"><Icons.PhoneOff size={20} /></CtrlBtn>
        </div>
      )}
    </div>
  );
}

// /call/:bookingId — join the room for a booked session.
export function BookedCall() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const [callId, setCallId] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.post(`/calls/booking/${bookingId}`).then((r) => setCallId(r.data.id)).catch((e) => setError(e?.response?.data?.detail || "Session not found."));
  }, [bookingId]);
  if (error) {
    return (
      <div className="call-room"><div className="call-placeholder">
        <Icons.VideoOff size={36} /><div className="call-status">{error}</div>
        <button className="btn btn-primary" onClick={() => navigate(-1)} style={{ marginTop: 16 }}>Go back</button>
      </div></div>
    );
  }
  return callId ? <CallRoom callId={callId} /> : <div className="call-room"><div className="call-placeholder"><div className="spinner" /></div></div>;
}

// /call/live/:callId — an instant call started with "Call now".
export default function LiveCall() {
  const { callId } = useParams();
  return <CallRoom callId={callId} />;
}
