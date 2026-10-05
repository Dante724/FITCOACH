import { useCallback, useEffect, useRef, useState } from "react";
import { api, API, authHeaders } from "@/lib/api";
import { aiNoiseSupported, getMic, NOISE_MODES } from "@/lib/noise";
import { rateQuality } from "@/lib/callQuality";

// In-app 1:1 video calls over WebRTC. Media goes browser-to-browser (or through a TURN relay on networks that
// block direct connections); our API only relays offer/answer/ICE messages and presence. The coach always makes
// the offer, so the two sides never race; every offer carries an `attempt` id so late messages from an old
// attempt are ignored. Dropped connections are repaired with an ICE restart, and the microphone is cleaned by
// on-device AI noise removal (see lib/noise.js).

const POLL_MS = 1000;
// Leaving is deferred briefly so a quick remount of the same call (React dev mode, route refresh) doesn't end it.
const pendingLeave = {};
const RING_TIMEOUT_MS = 45000;
const RESTART_AFTER_MS = 4000; // a "disconnected" link that doesn't recover by itself gets an ICE restart

const videoConstraints = (facingMode) => ({ facingMode, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } });

// A "camera unavailable" card so the other side still sees who they're talking to.
function placeholderTrack(name) {
  const c = Object.assign(document.createElement("canvas"), { width: 640, height: 360 });
  const ctx = c.getContext("2d");
  const draw = () => {
    ctx.fillStyle = "#0c3328"; ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = "#c9a45c"; ctx.font = "500 64px Georgia, serif"; ctx.textAlign = "center";
    ctx.fillText((name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase(), 320, 190);
    ctx.fillStyle = "rgba(245,239,226,0.6)"; ctx.font = "18px sans-serif"; ctx.fillText("Camera unavailable", 320, 240);
  };
  draw();
  const track = c.captureStream(2).getVideoTracks()[0];
  const t = setInterval(draw, 1000);
  track.addEventListener("ended", () => clearInterval(t));
  track.isPlaceholder = true;
  return track;
}

async function getMedia(noiseMode, facingMode, name) {
  const notes = [];
  const stream = new MediaStream();
  let mic = null;
  try {
    mic = await getMic(noiseMode);
    stream.addTrack(mic.track);
  } catch {
    notes.push("microphone");
  }
  try {
    const v = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(facingMode) });
    stream.addTrack(v.getVideoTracks()[0]);
  } catch {
    notes.push("camera");
    stream.addTrack(placeholderTrack(name));
  }
  return { stream, notes, mic };
}

export default function useCall(callId) {
  const [call, setCall] = useState(null);
  const [phase, setPhase] = useState("init"); // init | ringing | waiting | connecting | connected | reconnecting | left | declined | noanswer | ended | error
  const [error, setError] = useState("");
  const [deviceNotes, setDeviceNotes] = useState([]);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [noiseMode, setNoiseModeState] = useState(aiNoiseSupported() ? "ai" : "standard");
  const [facing, setFacing] = useState("user");
  const [connectedAt, setConnectedAt] = useState(null);
  const [relay, setRelay] = useState(false);
  const [quality, setQuality] = useState(null); // good | fair | poor
  const [viaRelay, setViaRelay] = useState(false);

  const r = useRef({ pc: null, attempt: null, queued: {}, ice: [], local: null, remote: null, role: null, polling: false, run: null,
    peerPresent: false, lastOfferAt: 0, startedAt: Date.now(), mic: null, restartTimer: null, lastLoss: null });

  const offerRef = useRef(null);
  const signal = useCallback((type, payload) => api.post(`/calls/${callId}/signal`, { type, payload }).catch(() => {}), [callId]);

  const closePc = useCallback(() => {
    const st = r.current;
    clearTimeout(st.restartTimer);
    if (st.pc) { st.pc.ontrack = st.pc.onicecandidate = st.pc.onconnectionstatechange = null; st.pc.close(); }
    st.pc = null;
    st.remote = null;
    setRemoteStream(null);
  }, []);

  // Ask for a fresh connection: the coach restarts ICE; the client asks the coach to.
  const repair = useCallback(() => {
    const st = r.current;
    if (!st.run) return;
    if (st.role === "offerer") offerRef.current?.(true);
    else signal("ready", { repair: true });
  }, [signal]);

  const createPc = useCallback((attempt) => {
    const st = r.current;
    closePc();
    const pc = new RTCPeerConnection({ iceServers: st.ice });
    pc.attempt = attempt;
    st.pc = pc;
    st.local.getTracks().forEach((t) => pc.addTrack(t, st.local));
    if (!st.local.getAudioTracks().length) pc.addTransceiver("audio", { direction: "recvonly" });
    // Voice matters more than picture: ask the network to prioritise audio packets.
    pc.getSenders().forEach((s) => {
      if (s.track?.kind !== "audio" || !s.getParameters) return;
      try {
        const p = s.getParameters();
        if (p.encodings?.length) { p.encodings.forEach((e) => { e.priority = "high"; e.networkPriority = "high"; }); s.setParameters(p).catch(() => {}); }
      } catch { /* not supported */ }
    });
    pc.ontrack = (e) => {
      if (!st.remote) st.remote = new MediaStream();
      if (!st.remote.getTracks().includes(e.track)) st.remote.addTrack(e.track);
      setRemoteStream(new MediaStream(st.remote.getTracks()));
    };
    pc.onicecandidate = (e) => { if (e.candidate) signal("ice", { attempt, candidate: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (st.pc !== pc) return;
      const s = pc.connectionState;
      clearTimeout(st.restartTimer);
      if (s === "connected") { setPhase("connected"); setConnectedAt((t) => t || Date.now()); }
      else if (s === "disconnected") {
        setPhase("reconnecting");
        st.restartTimer = setTimeout(() => { if (st.pc === pc && pc.connectionState !== "connected") repair(); }, RESTART_AFTER_MS);
      } else if (s === "failed") {
        setPhase("reconnecting");
        repair();
      }
    };
    return pc;
  }, [closePc, signal, repair]);

  const drainIce = useCallback(async (pc) => {
    const list = r.current.queued[pc.attempt] || [];
    delete r.current.queued[pc.attempt];
    for (const c of list) { try { await pc.addIceCandidate(c); } catch { /* stale */ } }
  }, []);

  const makeOffer = useCallback(async (restart = false) => {
    const st = r.current;
    st.lastOfferAt = Date.now();
    const attempt = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const pc = createPc(attempt);
    setPhase((p) => (p === "connected" || restart ? "reconnecting" : "connecting"));
    const offer = await pc.createOffer({ iceRestart: restart });
    await pc.setLocalDescription(offer);
    signal("offer", { attempt, type: offer.type, sdp: offer.sdp });
  }, [createPc, signal]);
  offerRef.current = makeOffer;

  const handle = useCallback(async (msg) => {
    const st = r.current;
    const p = msg.payload || {};
    if (msg.type === "offer" && st.role === "answerer") {
      const pc = createPc(p.attempt);
      setPhase((ph) => (ph === "connected" ? "reconnecting" : "connecting"));
      await pc.setRemoteDescription({ type: "offer", sdp: p.sdp });
      await drainIce(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      signal("answer", { attempt: p.attempt, type: answer.type, sdp: answer.sdp });
    } else if (msg.type === "answer" && st.role === "offerer") {
      const pc = st.pc;
      if (pc && pc.attempt === p.attempt && pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription({ type: "answer", sdp: p.sdp });
        await drainIce(pc);
      }
    } else if (msg.type === "ice") {
      const pc = st.pc;
      if (pc && pc.attempt === p.attempt && pc.remoteDescription) {
        try { await pc.addIceCandidate(p.candidate); } catch { /* ignore */ }
      } else {
        (st.queued[p.attempt] = st.queued[p.attempt] || []).push(p.candidate);
      }
    } else if (msg.type === "ready" && st.role === "offerer") {
      await makeOffer(Boolean(p.repair));
    } else if (msg.type === "bye") {
      closePc();
      setConnectedAt(null);
      setQuality(null);
      setPhase(p.reason === "declined" ? "declined" : "left");
    }
  }, [createPc, drainIce, makeOffer, signal, closePc]);

  // Boot: load call, get media, join, then poll.
  useEffect(() => {
    if (!callId) return undefined;
    const st = r.current;
    const run = {};
    st.run = run; // a fresh token per mount; async work from an older mount checks it and bails out
    const alive = () => st.run === run;
    clearTimeout(pendingLeave[callId]);
    let timer;
    let statsTimer;
    (async () => {
      try {
        const [{ data: info }, { data: ice }] = await Promise.all([api.get(`/calls/${callId}`), api.get("/calls/ice")]);
        st.ice = ice.iceServers;
        st.role = info.role;
        setRelay(ice.relay);
        setCall(info);
        const { stream, notes, mic: micInfo } = await getMedia(aiNoiseSupported() ? "ai" : "standard", "user", info.me === info.coach_id ? info.coach_name : info.client_name);
        if (!alive()) { stream.getTracks().forEach((t) => t.stop()); micInfo?.raw?.stop(); micInfo?.suppressor?.stop(); return; }
        st.local = stream;
        st.mic = micInfo;
        if (micInfo) setNoiseModeState(micInfo.mode);
        setLocalStream(stream);
        setDeviceNotes(notes);
        if (notes.includes("camera")) setCam(false);
        if (notes.includes("microphone")) setMic(false);
        const { data: joined } = await api.post(`/calls/${callId}/join`);
        if (!alive()) return;
        setCall(joined);
        const ringing = joined.kind === "instant" && joined.status === "ringing" && !joined.peer_present;
        setPhase(ringing ? "ringing" : joined.peer_present ? "connecting" : "waiting");
        if (st.role === "answerer") signal("ready", {});

        const poll = async () => {
          if (!alive() || st.polling) return;
          st.polling = true;
          try {
            const { data } = await api.get(`/calls/${callId}/signals`);
            st.peerPresent = data.peer_present;
            for (const m of data.signals) await handle(m);
            setPhase((ph) => {
              if (["declined", "ended", "noanswer", "error"].includes(ph)) return ph;
              if (ph === "ringing" && Date.now() - st.startedAt > RING_TIMEOUT_MS && !data.peer_present) return "noanswer";
              if (!data.peer_present && !st.pc && !["ringing", "left"].includes(ph)) return "waiting";
              return ph;
            });
            // Coach starts the connection as soon as the client is in the room.
            if (st.role === "offerer" && data.peer_present && !st.pc && Date.now() - st.lastOfferAt > 3000) await makeOffer();
          } catch (e) {
            if (e?.response?.status === 404) { setError("This call is no longer available."); setPhase("error"); }
          } finally { st.polling = false; }
        };
        timer = setInterval(poll, POLL_MS);
        poll();

        // Connection quality, every 2 s.
        statsTimer = setInterval(async () => {
          const pc = st.pc;
          if (!pc || pc.connectionState !== "connected") return;
          try {
            const stats = await pc.getStats();
            let rtt = null; let localId = null; let lost = 0; let received = 0;
            stats.forEach((s) => {
              if (s.type === "candidate-pair" && s.state === "succeeded" && (s.nominated || s.selected)) {
                if (s.currentRoundTripTime != null) rtt = s.currentRoundTripTime;
                localId = s.localCandidateId;
              }
              if (s.type === "inbound-rtp" && !s.isRemote) { lost += s.packetsLost || 0; received += s.packetsReceived || 0; }
            });
            const prev = st.lastLoss;
            st.lastLoss = { lost, received };
            const dl = prev ? lost - prev.lost : 0;
            const dr = prev ? received - prev.received : 0;
            const lossRate = prev && dl + dr > 0 ? Math.max(0, dl) / (dl + dr) : null;
            setQuality(rateQuality(rtt, lossRate));
            setViaRelay(localId ? stats.get(localId)?.candidateType === "relay" : false);
          } catch { /* stats unavailable */ }
        }, 2000);
      } catch (e) {
        setError(e?.response?.data?.detail || "Couldn't start the call.");
        setPhase("error");
      }
    })();

    // Phone switched from Wi-Fi to mobile data (or back): repair the connection straight away.
    const onOnline = () => { if (st.pc) repair(); };
    window.addEventListener("online", onOnline);
    const leaveBeacon = () => {
      fetch(`${API}/calls/${callId}/leave`, { method: "POST", keepalive: true, headers: authHeaders() }).catch(() => {});
    };
    window.addEventListener("pagehide", leaveBeacon);
    return () => {
      if (st.run === run) st.run = null;
      clearInterval(timer);
      clearInterval(statsTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pagehide", leaveBeacon);
      closePc();
      st.local?.getTracks().forEach((t) => t.stop());
      st.mic?.raw?.stop();
      st.mic?.suppressor?.stop();
      pendingLeave[callId] = setTimeout(leaveBeacon, 600);
    };
  }, [callId]); // eslint-disable-line react-hooks/exhaustive-deps

  const replaceTrack = async (kind, track) => {
    const st = r.current;
    const old = st.local.getTracks().find((t) => t.kind === kind);
    const sender = st.pc?.getSenders().find((s) => s.track?.kind === kind) || st.pc?.getSenders().find((s) => !s.track);
    if (sender) await sender.replaceTrack(track);
    if (old) { st.local.removeTrack(old); old.stop(); }
    st.local.addTrack(track);
    setLocalStream(new MediaStream(st.local.getTracks()));
  };

  const toggleMic = () => {
    const st = r.current;
    const t = st.local?.getAudioTracks()[0];
    if (!t) return;
    t.enabled = !t.enabled;
    if (st.mic?.raw && st.mic.raw !== t) st.mic.raw.enabled = t.enabled;
    setMic(t.enabled);
  };

  const toggleCam = () => {
    const t = r.current.local?.getVideoTracks()[0];
    if (!t || t.isPlaceholder) return;
    t.enabled = !t.enabled;
    setCam(t.enabled);
  };

  // Switch noise handling (AI → basic → off) and hot-swap the microphone into the call without reconnecting.
  const setNoiseMode = async (mode) => {
    const st = r.current;
    if (!st.local) return;
    try {
      const next = await getMic(mode);
      next.track.enabled = mic;
      if (next.raw !== next.track) next.raw.enabled = mic;
      const prev = st.mic;
      await replaceTrack("audio", next.track);
      prev?.raw?.stop();
      prev?.suppressor?.stop();
      st.mic = next;
      setNoiseModeState(next.mode);
    } catch { /* keep the current microphone */ }
  };
  const cycleNoise = () => {
    const modes = aiNoiseSupported() ? NOISE_MODES : NOISE_MODES.filter((m) => m !== "ai");
    setNoiseMode(modes[(modes.indexOf(noiseMode) + 1) % modes.length]);
  };

  const flipCamera = async () => {
    const next = facing === "user" ? "environment" : "user";
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(next) });
      const track = s.getVideoTracks()[0];
      track.enabled = cam;
      await replaceTrack("video", track);
      setFacing(next);
    } catch { /* single camera */ }
  };

  const hangUp = async () => {
    const st = r.current;
    st.run = null;
    closePc();
    st.local?.getTracks().forEach((t) => t.stop());
    st.mic?.raw?.stop();
    st.mic?.suppressor?.stop();
    await api.post(`/calls/${callId}/leave`).catch(() => {});
    setPhase("ended");
  };

  return { call, phase, error, deviceNotes, localStream, remoteStream, mic, cam, noiseMode, noiseCancel: noiseMode !== "off", facing,
    connectedAt, relay, quality, viaRelay, toggleMic, toggleCam, setNoiseMode, cycleNoise, flipCamera, hangUp };
}
