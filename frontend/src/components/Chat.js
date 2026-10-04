import { useCallback, useEffect, useRef, useState } from "react";
import * as Icons from "lucide-react";
import { api, fileSrc } from "@/lib/api";
import { timeAgo } from "@/lib/focus";
import { useToast } from "@/context/ToastContext";

const CONTEXT_ICON = { food: "Utensils", workout: "Dumbbell", plan: "ClipboardList", photo: "Image", progress: "TrendingUp" };
const MAX_VOICE_SECONDS = 180;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function ContextChip({ context, onClear, light }) {
  const Icon = Icons[CONTEXT_ICON[context.type]] || Icons.Paperclip;
  return (
    <div className="row" style={{ gap: 6, fontSize: 12, fontWeight: 600, padding: "5px 10px", borderRadius: 10, marginBottom: 6,
      background: light ? "rgba(255,255,255,0.22)" : "var(--teal-soft)", color: light ? "#fff" : "var(--teal)", width: "fit-content", maxWidth: "100%" }}>
      <Icon size={13} style={{ flexShrink: 0 }} />
      <span className="truncate">{context.label || context.type}</span>
      {onClear && <Icons.X size={13} style={{ cursor: "pointer", flexShrink: 0 }} onClick={onClear} />}
    </div>
  );
}

function VoiceNote({ audio, mine }) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const total = audio.duration || ref.current?.duration || 0;
  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {}); else el.pause();
  };
  return (
    <div className="voice-note" data-testid="voice-note">
      <audio ref={ref} src={fileSrc(audio.url)} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setPos(0); }} onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)} />
      <button className={`voice-play${mine ? " mine" : ""}`} onClick={toggle} aria-label={playing ? "Pause voice note" : "Play voice note"}>
        {playing ? <Icons.Pause size={16} /> : <Icons.Play size={16} style={{ marginLeft: 2 }} />}
      </button>
      <div className="voice-track"><div className="voice-fill" style={{ width: `${total ? Math.min(100, (pos / total) * 100) : 0}%` }} /></div>
      <span style={{ fontSize: 11.5, opacity: 0.8, fontVariantNumeric: "tabular-nums" }}>{fmt(playing || pos ? pos : total)}</span>
    </div>
  );
}

function pickMime() {
  if (typeof MediaRecorder === "undefined") return null;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported?.(m)) || "";
}

// Hold-free recorder: tap the mic to start, then send or discard.
function useRecorder({ onDone, push }) {
  const [state, setState] = useState("idle"); // idle | recording
  const [secs, setSecs] = useState(0);
  const rec = useRef(null);
  const chunks = useRef([]);
  const started = useRef(0);
  const timer = useRef(null);
  const cancelled = useRef(false);

  const cleanup = () => {
    clearInterval(timer.current);
    rec.current?.stream?.getTracks().forEach((t) => t.stop());
    rec.current = null;
    setState("idle");
    setSecs(0);
  };

  const stop = (cancel = false) => {
    cancelled.current = cancel;
    if (rec.current && rec.current.state !== "inactive") rec.current.stop(); else cleanup();
  };

  const start = async () => {
    const mime = pickMime();
    if (mime === null || !navigator.mediaDevices?.getUserMedia) { push("Voice notes aren't supported in this browser.", "error"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      cancelled.current = false;
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => {
        const duration = (Date.now() - started.current) / 1000;
        const blob = new Blob(chunks.current, { type: r.mimeType || mime || "audio/webm" });
        cleanup();
        if (!cancelled.current && duration >= 1 && blob.size) onDone(blob, Math.min(duration, MAX_VOICE_SECONDS));
        else if (!cancelled.current) push("Hold on a little longer — that was too short.", "error");
      };
      rec.current = r;
      started.current = Date.now();
      r.start(250);
      setState("recording");
      timer.current = setInterval(() => {
        const s = (Date.now() - started.current) / 1000;
        setSecs(s);
        if (s >= MAX_VOICE_SECONDS) stop();
      }, 250);
    } catch {
      push("Allow microphone access to record a voice note.", "error");
    }
  };

  useEffect(() => () => { cancelled.current = true; if (rec.current && rec.current.state !== "inactive") rec.current.stop(); clearInterval(timer.current); }, []);
  return { state, secs, start, stop };
}

function QuickReplies({ draft, firstName, onPick, onClose }) {
  const { push } = useToast();
  const [replies, setReplies] = useState(null);
  useEffect(() => { api.get("/coach/quick-replies").then((r) => setReplies(r.data.replies)).catch(() => setReplies([])); }, []);
  const save = async (next) => {
    try { const r = await api.put("/coach/quick-replies", { replies: next }); setReplies(r.data.replies); }
    catch (e) { push(e?.response?.data?.detail || "Could not save.", "error"); }
  };
  const fill = (t) => t.replaceAll("{name}", firstName || "");
  return (
    <div className="quick-replies fade-up" data-testid="quick-replies">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <div className="eyebrow">Quick replies</div>
        <button className="icon-btn" onClick={onClose} aria-label="Close quick replies" style={{ width: 30, height: 30 }}><Icons.X size={15} /></button>
      </div>
      {replies === null && <div className="spinner" style={{ margin: "14px auto" }} />}
      <div className="stack" style={{ gap: 6, maxHeight: 240, overflowY: "auto" }}>
        {replies?.map((r, i) => (
          <div key={i} className="quick-reply row">
            <button onClick={() => onPick(fill(r))} className="min0" style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", font: "inherit", color: "inherit", padding: 0 }}>
              <span className="truncate" style={{ display: "block" }}>{fill(r)}</span>
            </button>
            <Icons.Trash2 size={14} style={{ cursor: "pointer", color: "var(--text-3)", flexShrink: 0 }} aria-label="Delete quick reply" onClick={() => save(replies.filter((_, j) => j !== i))} />
          </div>
        ))}
        {replies?.length === 0 && <div style={{ fontSize: 13, color: "var(--text-3)" }}>No saved replies yet.</div>}
      </div>
      <button className="btn btn-ghost" disabled={!draft.trim() || !replies} onClick={() => save([...(replies || []), draft.trim()])}
        style={{ width: "100%", marginTop: 10, padding: "8px 12px", fontSize: 12.5 }} data-testid="save-quick-reply">
        <Icons.Plus size={14} /> Save current message as a quick reply
      </button>
      <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 6 }}>Tip: write {"{name}"} to insert the client's first name.</div>
    </div>
  );
}

// One coach ↔ client conversation. Polls for new messages while open.
export default function Chat({ clientId, coachId, meId, otherName, initialContext, initialText, onRead, isCoach }) {
  const { push } = useToast();
  const [messages, setMessages] = useState(null);
  const [body, setBody] = useState(initialText || "");
  const [context, setContext] = useState(initialContext || null);
  const [sending, setSending] = useState(false);
  const [showQuick, setShowQuick] = useState(false);
  const scrollRef = useRef(null);
  const countRef = useRef(0);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  const load = useCallback(() => {
    if (!clientId || !coachId) return;
    api.get(`/messages/${clientId}/${coachId}`).then((r) => {
      setMessages(r.data);
      onReadRef.current?.();
    }).catch(() => setMessages([]));
  }, [clientId, coachId]);

  useEffect(() => { setMessages(null); load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);
  useEffect(() => { setContext(initialContext || null); }, [initialContext]);
  useEffect(() => { if (initialText) setBody(initialText); }, [initialText]);
  useEffect(() => {
    if (messages && messages.length !== countRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      countRef.current = messages.length;
    }
  }, [messages]);

  const sendVoice = async (blob, duration) => {
    setSending(true);
    try {
      const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
      const fd = new FormData();
      fd.append("file", blob, `voice.${ext}`);
      fd.append("duration", String(Math.round(duration * 10) / 10));
      const r = await api.post(`/messages/${clientId}/${coachId}/voice`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setMessages((m) => [...(m || []), r.data]);
    } catch (e) {
      push(e?.response?.data?.detail || "Could not send voice note.", "error");
    } finally { setSending(false); }
  };
  const recorder = useRecorder({ onDone: sendVoice, push });
  const recording = recorder.state === "recording";

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setSending(true);
    try {
      const payload = { body: text };
      if (context) Object.assign(payload, { context_type: context.type, context_id: context.id, context_label: context.label });
      const r = await api.post(`/messages/${clientId}/${coachId}`, payload);
      setMessages((m) => [...(m || []), r.data]);
      setBody("");
      setContext(null);
    } catch (e) {
      push(e?.response?.data?.detail || "Could not send message.", "error");
    } finally { setSending(false); }
  };

  const onKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
  const firstName = (otherName || "").split(" ")[0];

  return (
    <div className="chat" data-testid="chat">
      <div className="chat-scroll" ref={scrollRef}>
        {messages === null && <div className="spinner" style={{ margin: "40px auto" }} />}
        {messages?.length === 0 && (
          <div className="empty">
            <Icons.MessageCircle size={32} style={{ opacity: 0.5, marginBottom: 8 }} />
            <div>No messages yet. Say hello to {otherName || "your coach"}.</div>
          </div>
        )}
        {messages?.map((m) => {
          const mine = m.sender_id === meId;
          return (
            <div key={m.id} className={`bubble ${mine ? "me" : "them"}`} data-testid="chat-message">
              {m.context && <ContextChip context={m.context} light={mine} />}
              {m.audio ? <VoiceNote audio={m.audio} mine={mine} /> : <div>{m.body}</div>}
              <div style={{ fontSize: 10.5, marginTop: 4, opacity: 0.7, textAlign: mine ? "right" : "left" }}>
                {!mine && `${m.sender_name} · `}{timeAgo(m.created_at)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="clay-inset" style={{ padding: 10, position: "relative" }}>
        {showQuick && isCoach && <QuickReplies draft={body} firstName={firstName} onClose={() => setShowQuick(false)} onPick={(t) => { setBody(t); setShowQuick(false); }} />}
        {context && !recording && <ContextChip context={context} onClear={() => setContext(null)} />}
        {recording ? (
          <div className="row" style={{ minHeight: 44, gap: 10 }} data-testid="recording-bar">
            <button className="icon-btn" onClick={() => recorder.stop(true)} aria-label="Discard recording" title="Discard"><Icons.Trash2 size={17} /></button>
            <span className="rec-dot" />
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt(recorder.secs)}</span>
            <span style={{ flex: 1, fontSize: 12.5, color: "var(--text-3)" }} className="truncate">Recording… max 3 min</span>
            <button className="btn btn-primary" onClick={() => recorder.stop(false)} style={{ padding: "11px 16px" }} aria-label="Send voice note" data-testid="voice-send">
              <Icons.Send size={17} />
            </button>
          </div>
        ) : (
          <div className="row" style={{ alignItems: "flex-end", gap: 8 }}>
            {isCoach && (
              <button className="icon-btn" onClick={() => setShowQuick((v) => !v)} aria-label="Quick replies" title="Quick replies" data-testid="quick-replies-btn" style={{ flexShrink: 0, marginBottom: 2 }}>
                <Icons.Zap size={17} />
              </button>
            )}
            <textarea className="field" data-testid="chat-input" rows={1} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={onKey}
              placeholder={`Message ${otherName || ""}`.trim()} style={{ resize: "none", boxShadow: "none", background: "transparent", minHeight: 44, maxHeight: 140 }} />
            {body.trim() ? (
              <button className="btn btn-primary" data-testid="chat-send" disabled={sending} onClick={send} style={{ padding: "11px 16px", flexShrink: 0 }} aria-label="Send">
                <Icons.Send size={17} />
              </button>
            ) : (
              <button className="btn btn-primary" data-testid="voice-record" disabled={sending} onClick={recorder.start} style={{ padding: "11px 16px", flexShrink: 0 }} aria-label="Record a voice note" title="Record a voice note">
                {sending ? <div className="spinner" style={{ width: 17, height: 17 }} /> : <Icons.Mic size={17} />}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
