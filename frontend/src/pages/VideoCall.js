import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as Icons from "lucide-react";
import { api, fileSrc } from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import useCall from "@/lib/useCall";
import { initials } from "@/lib/focus";
import { MODEL_LABEL, resumeAllAudio } from "@/lib/noise";
import { fmtSessionTime } from "@/lib/locale";
import { cornerPos, nearestCorner, savedCorner, saveCorner, TAP_SLOP } from "@/lib/pip";

// onBlocked: the browser refused to start sound (it wants a tap first) — we show a "tap to turn on sound" button.
function Video({ stream, muted, mirror, className, testid, onBlocked }) {
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream || null;
    if (stream && !muted) v.play?.()?.catch?.(() => onBlocked?.());
  }, [stream]); // eslint-disable-line react-hooks/exhaustive-deps
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} data-testid={testid} style={mirror ? { transform: "scaleX(-1)" } : undefined} />;
}

// The small floating tile (like WhatsApp): drag it anywhere and it snaps to the nearest corner, which is remembered.
// A tap swaps it with the big view.
function FloatingTile({ stageRef, onTap, children, testid }) {
  const ref = useRef(null);
  const [corner, setCorner] = useState(savedCorner);
  const [pos, setPos] = useState(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  const margins = () => (window.innerWidth <= 620 ? { top: 76, side: 12, bottom: 12 } : undefined);
  const place = (c) => {
    const st = stageRef.current, el = ref.current;
    if (!st || !el) return;
    setPos(cornerPos(c, st.clientWidth, st.clientHeight, el.offsetWidth, el.offsetHeight, margins()));
  };
  useEffect(() => {
    place(corner);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => place(corner)) : null;
    if (ro && stageRef.current) ro.observe(stageRef.current);
    const onResize = () => place(corner);
    window.addEventListener("resize", onResize);
    return () => { ro?.disconnect(); window.removeEventListener("resize", onResize); };
  }, [corner]); // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e) => {
    if (!pos) return;
    ref.current.setPointerCapture?.(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, x: pos.x, y: pos.y, moved: false };
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
    d.moved = true;
    setDragging(true);
    const st = stageRef.current, el = ref.current;
    setPos({ x: Math.min(Math.max(0, d.x + dx), st.clientWidth - el.offsetWidth), y: Math.min(Math.max(0, d.y + dy), st.clientHeight - el.offsetHeight) });
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) { onTap?.(); return; }
    setDragging(false);
    const st = stageRef.current, el = ref.current;
    const c = nearestCorner(pos.x, pos.y, st.clientWidth, st.clientHeight, el.offsetWidth, el.offsetHeight);
    saveCorner(c);
    if (c === corner) place(c); else setCorner(c);
  };
  return (
    <div ref={ref} className={`call-self${dragging ? " dragging" : ""}`} data-testid={testid} data-corner={corner}
      style={pos ? { transform: `translate(${pos.x}px, ${pos.y}px)` } : { visibility: "hidden" }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      title="Drag to move · tap to swap">
      {children}
    </div>
  );
}

function Timer({ since }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{String(Math.floor(s / 60)).padStart(2, "0")}:{String(s % 60).padStart(2, "0")}</span>;
}

function QualityBars({ level }) {
  const n = { good: 3, fair: 2, poor: 1 }[level] || 0;
  return (
    <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "flex-end", gap: 2, height: 12 }}>
      {[5, 8, 12].map((h, i) => <span key={h} style={{ width: 3, height: h, borderRadius: 1, background: "currentColor", opacity: i < n ? 1 : 0.3 }} />)}
    </span>
  );
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
  const stageRef = useRef(null);
  const [swapped, setSwapped] = useState(false); // true: me big, them small
  const [soundBlocked, setSoundBlocked] = useState(false);
  const photoRef = useRef(null);
  const { push } = useToast();
  const [hiddenShow, setHiddenShow] = useState(null); // a shown photo I've closed on my side
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const peerPhoto = c.peerShow && c.peerShow !== hiddenShow ? c.peerShow : null;
  const pickPhoto = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setSendingPhoto(true);
    try { await c.showPhoto(f); } catch (err) { push(err?.response?.data?.detail || "Couldn't send the photo. Try again.", "error"); }
    setSendingPhoto(false);
  };
  const needsTap = soundBlocked || c.audioBlocked;
  const turnOnSound = () => {
    resumeAllAudio();
    document.querySelectorAll(".call-room video").forEach((v) => { if (!v.muted) v.play().catch(() => {}); });
    setSoundBlocked(false);
  };
  const firstName = (peer || "").split(" ")[0] || "They";
  const showRemote = Boolean(c.remoteStream && c.phase !== "waiting");
  const remoteView = (cls) => (
    <Video stream={c.remoteStream} className={`${cls}${c.peerSharing ? " sharing" : ""}`} testid="remote-video" onBlocked={() => setSoundBlocked(true)} />
  );
  const localView = (cls) => (
    <>
      <Video stream={c.localStream} muted mirror={c.facing === "user" && !c.sharing} className={`${cls}${c.sharing ? " sharing" : ""}`} testid="local-video" />
      {!c.cam && !c.sharing && <div className="call-self-off"><Icons.VideoOff size={18} /></div>}
      {!c.mic && <div className="call-self-mute"><Icons.MicOff size={12} /></div>}
    </>
  );
  const bigIsLocal = swapped && showRemote && c.localStream;

  useEffect(() => { if (c.phase === "noanswer") c.hangUp(); }, [c.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const leave = async () => { if (!done) await c.hangUp(); navigate(-1); };

  return (
    <div className="call-room" data-testid="call-room">
      <div className="call-stage" ref={stageRef}>
        {bigIsLocal ? <div className="call-remote-wrap">{localView("call-remote")}</div> : showRemote ? remoteView("call-remote") : null}
        {!bigIsLocal && (!c.remoteStream || !remoteHasVideo || c.phase !== "connected") && (
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
                {c.call?.kind === "scheduled" && c.call?.time ? ` · booked ${fmtSessionTime(c.call)}` : ""}
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {c.phase === "connected" && c.quality && (
              <span className={`call-chip q-${c.quality}`} data-testid="call-quality" title={c.viaRelay ? "Connected through a relay server" : "Direct connection"}>
                <QualityBars level={c.quality} /> {{ good: "Good connection", fair: "Fair connection", poor: "Weak connection" }[c.quality]}
              </span>
            )}
            {c.noiseModel && <span className="call-chip" data-testid="noise-chip" title="Always on — cleaned on this device"><Icons.AudioLines size={13} /> {MODEL_LABEL[c.noiseModel]}</span>}
          </div>
        </div>

        {c.localStream && !done && (
          <FloatingTile stageRef={stageRef} onTap={() => showRemote && setSwapped((v) => !v)} testid="call-pip">
            {bigIsLocal ? (
              <>
                {remoteView("call-self-video")}
                {!remoteHasVideo && <div className="call-self-off" style={{ fontFamily: "var(--serif)", fontSize: 22 }}>{initials(peer)}</div>}
              </>
            ) : localView("call-self-video")}
          </FloatingTile>
        )}

        {peerPhoto && !done && (
          <div className="call-shown" data-testid="peer-photo">
            <img src={fileSrc(peerPhoto)} alt={`Shown by ${firstName}`} />
          </div>
        )}

        {(c.myShow || peerPhoto) && !done && (
          <div className="call-share-banner" data-testid="photo-banner" style={c.sharing || c.peerSharing ? { top: 120 } : undefined}>
            <Icons.Image size={14} />
            {c.myShow ? <>You're showing a photo</> : <>{firstName} is showing a photo</>}
            {c.myShow ? <button className="btn btn-ghost" onClick={c.stopShow} data-testid="photo-stop">Stop</button>
              : <button className="btn btn-ghost" onClick={() => setHiddenShow(c.peerShow)} data-testid="photo-hide">Close</button>}
          </div>
        )}

        {(c.sharing || c.peerSharing) && !done && (
          <div className="call-share-banner" data-testid="share-banner">
            <Icons.ScreenShare size={14} />
            {c.sharing ? <>You're sharing your screen{c.shareAudio ? " and its sound" : ""}</> : <>{firstName} is sharing their screen</>}
            {c.sharing && <button className="btn btn-ghost" onClick={c.stopShare} data-testid="share-stop">Stop</button>}
          </div>
        )}

        {needsTap && !done && (
          <button className="call-sound" onClick={turnOnSound} data-testid="call-sound"><Icons.Volume2 size={18} /> Tap to turn on sound</button>
        )}

        {c.phase === "connected" && c.quality === "poor" && c.cam && !done && (
          <div className="call-note" data-testid="weak-hint">
            <Icons.WifiOff size={14} /> Weak connection. Turning your camera off keeps the voice clear.
            <button className="btn btn-ghost" onClick={c.toggleCam} style={{ padding: "4px 10px", fontSize: 12, marginLeft: 8, color: "inherit", borderColor: "currentColor" }}>Camera off</button>
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
          <input ref={photoRef} type="file" accept="image/*" hidden onChange={pickPhoto} data-testid="photo-input" />
          <CtrlBtn on={!c.myShow} label={sendingPhoto ? "Sending…" : c.myShow ? "Stop photo" : "Photo"}
            onClick={c.myShow ? c.stopShow : () => photoRef.current?.click()} testid="call-photo">
            {c.myShow ? <Icons.ImageOff size={20} /> : <Icons.ImageUp size={20} />}
          </CtrlBtn>
          {c.shareSupported && (
            <CtrlBtn on={!c.sharing} label={c.sharing ? "Stop sharing" : "Screen"} onClick={c.sharing ? c.stopShare : c.startShare} testid="call-share">
              {c.sharing ? <Icons.ScreenShareOff size={20} /> : <Icons.ScreenShare size={20} />}
            </CtrlBtn>
          )}
          {isMobile && !c.sharing && <CtrlBtn label="Flip" onClick={c.flipCamera} testid="call-flip"><Icons.SwitchCamera size={20} /></CtrlBtn>}
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
