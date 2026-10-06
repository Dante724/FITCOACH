import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { getMic, MODEL_LABEL } from "@/lib/noise";
import { networkVerdict } from "@/lib/callQuality";

function useLevel(track) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!track) return undefined;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    let raf;
    const tick = () => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
      setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
      raf = requestAnimationFrame(tick);
    };
    tick();
    const resume = () => ctx.resume().catch(() => {});
    document.addEventListener("pointerdown", resume, { once: true });
    return () => { cancelAnimationFrame(raf); document.removeEventListener("pointerdown", resume); ctx.close().catch(() => {}); };
  }, [track]);
  return level;
}

const TONE = { good: "var(--teal)", fair: "var(--amber)", poor: "var(--accent)" };

export default function CallCheck() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const [camErr, setCamErr] = useState("");
  const [micErr, setMicErr] = useState("");
  const [micInfo, setMicInfo] = useState(null);
  const [net, setNet] = useState(null); // null = testing
  const level = useLevel(micInfo?.track);

  useEffect(() => {
    let stream;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "user" } })
      .then((s) => { stream = s; if (videoRef.current) videoRef.current.srcObject = s; })
      .catch(() => setCamErr("We couldn't open your camera. Allow camera access in your browser settings, or close other apps using it."));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  useEffect(() => {
    let cur = null;
    let cancelled = false;
    getMic({ onModel: (model) => !cancelled && setMicInfo((cur) => (cur ? { ...cur, model } : cur)) }).then((m) => {
      if (cancelled) { m.raw.stop(); m.suppressor?.stop(); return; }
      cur = m; setMicInfo(m); setMicErr("");
    }).catch(() => setMicErr("We couldn't open your microphone. Allow microphone access in your browser settings."));
    return () => { cancelled = true; cur?.raw.stop(); cur?.suppressor?.stop(); };
  }, []);

  const testNetwork = useCallback(async () => {
    setNet(null);
    let iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
    let relayConfigured = false;
    try { const { data } = await api.get("/calls/ice"); iceServers = data.iceServers; relayConfigured = data.relay; } catch { /* use public STUN */ }
    const pc = new RTCPeerConnection({ iceServers });
    const types = new Set();
    pc.createDataChannel("check");
    pc.onicecandidate = (e) => { if (e.candidate?.type) types.add(e.candidate.type); };
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((res) => {
      const done = setTimeout(res, 8000);
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === "complete") { clearTimeout(done); res(); } };
    });
    pc.close();
    setNet({ ...networkVerdict([...types], relayConfigured), types: [...types] });
  }, []);
  useEffect(() => { testNetwork(); }, [testNetwork]);

  const Row = ({ ok, warn, icon, title, children }) => {
    const Icon = Icons[icon];
    const color = ok ? TONE.good : warn ? TONE.fair : TONE.poor;
    return (
      <div className="clay-inset" style={{ padding: 14, display: "flex", gap: 12, alignItems: "flex-start" }}>
        <Icon size={20} color={color} style={{ flexShrink: 0, marginTop: 2 }} />
        <div className="min0" style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14.5 }}>{title}</div>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2, lineHeight: 1.55 }}>{children}</div>
        </div>
      </div>
    );
  };

  return (
    <div data-testid="call-check">
      <PageHeader eyebrow="Video sessions" title="Test your call setup" subtitle="Check your camera, microphone and connection before a session — takes 20 seconds." />
      <div className="grid-2">
        <div className="clay fade-up min0" style={{ padding: 18 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Camera</div>
          {camErr ? <Row icon="VideoOff" title="Camera not available">{camErr}</Row>
            : <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", borderRadius: 14, background: "#0c3328", aspectRatio: "4 / 3", objectFit: "cover", transform: "scaleX(-1)" }} />}
        </div>
        <div className="stack min0" style={{ gap: 14 }}>
          <div className="clay fade-up" style={{ padding: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Microphone</div>
            {micErr ? <Row icon="MicOff" title="Microphone not available">{micErr}</Row> : (
              <>
                <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 8 }}>Say something — the bar should jump when you speak and stay low when you're quiet, even with a fan or traffic nearby.</div>
                <div className="meter" style={{ height: 10 }} aria-label="Microphone level"><span style={{ width: `${Math.round(level * 100)}%`, transition: "width .08s linear", background: level > 0.05 ? "var(--teal)" : "var(--ink)" }} /></div>
                {micInfo && (
                  <div className="row" style={{ gap: 8, marginTop: 12, fontSize: 13 }} data-testid="check-noise">
                    <Icons.AudioLines size={16} color={micInfo.model === "basic" ? "var(--amber)" : "var(--teal)"} />
                    <span><strong>{MODEL_LABEL[micInfo.model]}</strong> — always on. {micInfo.model === "basic"
                      ? "This browser can't run the AI filter; try Chrome for the best sound."
                      : "Traffic, horns and voices further away are removed on this device."}</span>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="clay fade-up" style={{ padding: 18 }} data-testid="network-check">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
              <div className="eyebrow">Connection</div>
              <button className="icon-btn" onClick={testNetwork} aria-label="Test again" title="Test again" disabled={!net}><Icons.RefreshCw size={15} className={net ? "" : "spin"} /></button>
            </div>
            {!net ? <div className="row" style={{ gap: 10, color: "var(--text-3)", fontSize: 13.5 }}><div className="spinner" style={{ width: 16, height: 16 }} /> Testing your network…</div>
              : <Row ok={net.level === "good"} warn={net.level === "fair"} icon={net.level === "poor" ? "WifiOff" : "Wifi"} title={net.title}>{net.text}</Row>}
          </div>
        </div>
      </div>
      <button className="btn btn-primary" onClick={() => navigate(-1)} style={{ marginTop: 18 }}><Icons.Check size={16} /> Done</button>
    </div>
  );
}
