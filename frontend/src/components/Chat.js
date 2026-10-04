import { useCallback, useEffect, useRef, useState } from "react";
import * as Icons from "lucide-react";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/focus";
import { useToast } from "@/context/ToastContext";

const CONTEXT_ICON = { food: "Utensils", workout: "Dumbbell", plan: "ClipboardList", photo: "Image", progress: "TrendingUp" };

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

// One coach ↔ client conversation. Polls for new messages while open.
export default function Chat({ clientId, coachId, meId, otherName, initialContext, onRead }) {
  const { push } = useToast();
  const [messages, setMessages] = useState(null);
  const [body, setBody] = useState("");
  const [context, setContext] = useState(initialContext || null);
  const [sending, setSending] = useState(false);
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
  useEffect(() => {
    if (messages && messages.length !== countRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      countRef.current = messages.length;
    }
  }, [messages]);

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
              <div>{m.body}</div>
              <div style={{ fontSize: 10.5, marginTop: 4, opacity: 0.7, textAlign: mine ? "right" : "left" }}>
                {!mine && `${m.sender_name} · `}{timeAgo(m.created_at)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="clay-inset" style={{ padding: 10 }}>
        {context && <ContextChip context={context} onClear={() => setContext(null)} />}
        <div className="row" style={{ alignItems: "flex-end" }}>
          <textarea className="field" data-testid="chat-input" rows={1} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={onKey}
            placeholder={`Message ${otherName || ""}`.trim()} style={{ resize: "none", boxShadow: "none", background: "transparent", minHeight: 44, maxHeight: 140 }} />
          <button className="btn btn-primary" data-testid="chat-send" disabled={sending || !body.trim()} onClick={send} style={{ padding: "11px 16px", flexShrink: 0 }} aria-label="Send">
            <Icons.Send size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
