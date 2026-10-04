import { useCallback, useEffect, useRef, useState } from "react";
import * as Icons from "lucide-react";
import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { POSES, SKELETON, scoreFrame, summarize } from "@/lib/poses";

const TASKS_VERSION = "1.0.1"; // keep in sync with @mediapipe/tasks-vision in package.json
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const CAPTURE_SECONDS = 10;
const MAX_UPLOAD_SECONDS = 30;
const FRAME_MS = 66; // ~15 detections per second

let landmarkerPromise = null;
function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      const make = (delegate) => PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: "VIDEO", numPoses: 1,
      });
      try { return await make("GPU"); } catch { return make("CPU"); }
    })().catch((e) => { landmarkerPromise = null; throw e; });
  }
  return landmarkerPromise;
}

const scoreColor = (s) => (s >= 80 ? "#0f8a7e" : s >= 55 ? "#d8981f" : "#e05c37");

function drawSkeleton(ctx, lm, w, h, color) {
  ctx.lineWidth = Math.max(3, w / 160);
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  SKELETON.forEach(([a, b]) => {
    if ((lm[a].visibility ?? 1) < 0.4 || (lm[b].visibility ?? 1) < 0.4) return;
    ctx.beginPath();
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
    ctx.stroke();
  });
  ctx.fillStyle = "#fff";
  new Set(SKELETON.flat()).forEach((i) => {
    if ((lm[i].visibility ?? 1) < 0.4) return;
    ctx.beginPath();
    ctx.arc(lm[i].x * w, lm[i].y * h, Math.max(4, w / 110), 0, Math.PI * 2);
    ctx.fill();
  });
}

// Small annotated still of the current frame for the coach (the video itself never leaves the device).
function snapshot(video, lm, color, mirror) {
  const scale = Math.min(1, 480 / video.videoWidth);
  const c = document.createElement("canvas");
  c.width = Math.round(video.videoWidth * scale);
  c.height = Math.round(video.videoHeight * scale);
  const ctx = c.getContext("2d");
  if (mirror) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, c.width, c.height);
  if (lm) drawSkeleton(ctx, lm, c.width, c.height, color);
  return c;
}

/**
 * Live camera (or an uploaded clip) with on-device pose tracking.
 * Shows a skeleton and live cues; "Check my pose" records a hold and calls onResult(summary, snapshotDataUrl).
 */
export default function PoseCamera({ poseKey, onResult }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  const captureRef = useRef(null); // { frames, shots, until?, source }
  const poseRef = useRef(poseKey);
  const [status, setStatus] = useState("idle"); // idle | loading | live | countdown | recording | analysing | error
  const [source, setSource] = useState(null);   // camera | file
  const [error, setError] = useState("");
  const [live, setLive] = useState(null);
  const [count, setCount] = useState(0);

  poseRef.current = poseKey;

  const stopAll = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) { v.pause(); if (v.src) { URL.revokeObjectURL(v.src); v.removeAttribute("src"); } v.srcObject = null; }
  }, []);

  useEffect(() => stopAll, [stopAll]);

  const finish = useCallback(() => {
    const cap = captureRef.current;
    captureRef.current = null;
    if (!cap) return;
    setStatus("analysing");
    const summary = summarize(poseRef.current, cap.frames);
    if (!summary) {
      setError("We couldn't see your whole body for long enough. Step back so your head to feet are in the frame, then try again.");
      setStatus(cap.source === "camera" ? "live" : "error");
      return;
    }
    // pick the still closest to the overall score so the coach sees a typical moment, not the best one
    const shot = cap.shots.sort((a, b) => Math.abs(a.score - summary.score) - Math.abs(b.score - summary.score))[0];
    const url = shot ? shot.canvas.toDataURL("image/jpeg", 0.72) : null;
    if (cap.source === "file") stopAll();
    setStatus(cap.source === "camera" ? "live" : "idle");
    onResult(summary, url);
  }, [onResult, stopAll]);

  const loop = useCallback((landmarker, mirror) => {
    const tick = (now) => {
      rafRef.current = requestAnimationFrame(tick);
      const video = videoRef.current, canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2 || now - lastRef.current < FRAME_MS) return;
      lastRef.current = now;
      const w = video.videoWidth, h = video.videoHeight;
      if (canvas.width !== w) { canvas.width = w; canvas.height = h; }
      const res = landmarker.detectForVideo(video, now);
      const lm = res.landmarks?.[0];
      const frame = lm ? scoreFrame(poseRef.current, lm, w, h) : { visible: false, score: 0, checks: [] };
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, w, h);
      if (lm) drawSkeleton(ctx, lm, w, h, frame.visible ? scoreColor(frame.score) : "rgba(255,255,255,0.7)");
      setLive(frame);

      const cap = captureRef.current;
      if (cap) {
        cap.frames.push(frame);
        if (frame.visible && now - (cap.lastShot || 0) > 900) {
          cap.lastShot = now;
          cap.shots.push({ score: frame.score, canvas: snapshot(video, lm, scoreColor(frame.score), mirror) });
        }
        if (cap.until && now >= cap.until) finish();
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [finish]);

  const startCamera = async () => {
    setError(""); setStatus("loading"); setSource("camera");
    try {
      const [landmarker, stream] = await Promise.all([
        getLandmarker(),
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } }, audio: false }),
      ]);
      streamRef.current = stream;
      const v = videoRef.current;
      v.srcObject = stream;
      await v.play();
      setStatus("live");
      loop(landmarker, true);
    } catch (e) {
      stopAll();
      setStatus("error");
      setError(e?.name === "NotAllowedError" ? "Camera access was blocked. Allow the camera in your browser settings, or upload a short video instead."
        : e?.name === "NotFoundError" ? "No camera found on this device. Upload a short video instead."
        : "Couldn't start pose tracking. Check your connection and try again.");
    }
  };

  const startFile = async (file) => {
    if (!file) return;
    stopAll(); setError(""); setStatus("loading"); setSource("file");
    try {
      const landmarker = await getLandmarker();
      const v = videoRef.current;
      v.src = URL.createObjectURL(file);
      v.muted = true;
      await new Promise((ok, fail) => { v.onloadeddata = ok; v.onerror = () => fail(new Error("bad video")); });
      if (v.duration > MAX_UPLOAD_SECONDS) {
        stopAll(); setStatus("error");
        setError(`Please upload a clip shorter than ${MAX_UPLOAD_SECONDS} seconds — just the hold.`);
        return;
      }
      captureRef.current = { frames: [], shots: [], source: "file" };
      v.onended = () => finish();
      setStatus("recording");
      loop(landmarker, false);
      await v.play();
    } catch {
      stopAll(); setStatus("error");
      setError("We couldn't read that video. Try an MP4 or MOV recorded on your phone.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const startCapture = () => {
    setError("");
    setStatus("countdown");
    let n = 3;
    setCount(n);
    const t = setInterval(() => {
      n -= 1;
      if (n > 0) { setCount(n); return; }
      clearInterval(t);
      captureRef.current = { frames: [], shots: [], source: "camera", until: performance.now() + CAPTURE_SECONDS * 1000 };
      setStatus("recording");
      setCount(CAPTURE_SECONDS);
      const left = setInterval(() => {
        if (!captureRef.current) { clearInterval(left); return; }
        setCount((c) => (c > 1 ? c - 1 : 1));
      }, 1000);
    }, 1000);
  };

  const stopCamera = () => { stopAll(); setStatus("idle"); setSource(null); setLive(null); };

  const def = POSES[poseKey];
  const cue = live?.visible ? live.checks.find((c) => !c.ok)?.cue : null;
  const showVideo = ["live", "countdown", "recording", "analysing"].includes(status) || (status === "loading" && source);

  return (
    <div data-testid="pose-camera">
      <div className="pose-stage" style={{ display: showVideo ? "block" : "none" }}>
        <video ref={videoRef} playsInline muted className={source === "camera" ? "mirror" : ""} />
        <canvas ref={canvasRef} className={source === "camera" ? "mirror" : ""} />
        {status === "loading" && <div className="pose-overlay center"><div className="spinner" /><div>Loading pose tracking…</div></div>}
        {status === "countdown" && <div className="pose-overlay center"><div className="pose-count">{count}</div><div>Get into {def?.label}</div></div>}
        {(status === "live" || status === "recording") && (
          <div className="pose-overlay top">
            {status === "recording" && <span className="chip" style={{ background: "#e05c37", color: "#fff" }}><span className="rec-dot" /> Hold · {count}s</span>}
            {live && !live.visible && <span className="chip chip-neutral" style={{ background: "rgba(255,255,255,0.85)" }}>Step back — head to feet in frame</span>}
            {live?.visible && (
              <span className="chip" style={{ background: scoreColor(live.score), color: "#fff" }}>{live.score}</span>
            )}
          </div>
        )}
        {(status === "live" || status === "recording") && cue && <div className="pose-overlay bottom"><div className="pose-cue">{cue}</div></div>}
        {status === "analysing" && <div className="pose-overlay center"><div className="spinner" /><div>Analysing your hold…</div></div>}
      </div>

      {!showVideo && (
        <div className="clay-inset" style={{ padding: "34px 18px", textAlign: "center" }}>
          <Icons.PersonStanding size={40} color="var(--accent)" style={{ marginBottom: 10 }} />
          <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 4 }}>{def?.label} <span style={{ color: "var(--text-3)", fontWeight: 500 }}>· {def?.sanskrit}</span></div>
          <div style={{ fontSize: 13.5, color: "var(--text-2)", marginBottom: 6 }}>{def?.tip} Prop your phone up about 2–3 metres away.</div>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}><Icons.ShieldCheck size={13} /> Tracking runs on your device. Only one still photo is shared with your coach.</div>
        </div>
      )}

      {error && <div className="clay-inset" style={{ padding: "11px 14px", marginTop: 12, fontSize: 13.5, color: "var(--accent)" }}><Icons.CircleAlert size={15} /> {error}</div>}

      <div className="row-wrap" style={{ marginTop: 14, justifyContent: "center" }}>
        {(status === "idle" || status === "error") && (<>
          <button className="btn btn-primary" data-testid="pose-start-camera" onClick={startCamera}><Icons.Camera size={17} /> Start camera</button>
          <button className="btn btn-ghost" data-testid="pose-upload" onClick={() => fileRef.current?.click()}><Icons.Upload size={17} /> Upload a video</button>
        </>)}
        {status === "live" && (<>
          <button className="btn btn-primary" data-testid="pose-capture" onClick={startCapture}><Icons.Timer size={17} /> Check my pose ({CAPTURE_SECONDS}s)</button>
          <button className="btn btn-ghost" onClick={stopCamera}><Icons.CameraOff size={17} /> Stop</button>
        </>)}
        <input ref={fileRef} type="file" accept="video/*" hidden data-testid="pose-file" onChange={(e) => startFile(e.target.files?.[0])} />
      </div>
    </div>
  );
}
