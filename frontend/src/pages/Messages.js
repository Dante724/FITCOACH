import { useEffect, useMemo, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import Chat from "@/components/Chat";
import Avatar from "@/components/Avatar";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import useCoaches from "@/lib/useCoaches";

// Client ↔ coach chat. Everything stays in the app — no WhatsApp needed.
export default function Messages() {
  const { user } = useAuth();
  const coaches = useCoaches();
  const [params, setParams] = useSearchParams();
  const [unread, setUnread] = useState({});

  const list = useMemo(() => ["fitness", "yoga"].map((t) => coaches?.[t] && { ...coaches[t], type: t }).filter(Boolean), [coaches]);
  const activeId = params.get("coach") && list.some((c) => c.user_id === params.get("coach")) ? params.get("coach") : list[0]?.user_id;
  const active = list.find((c) => c.user_id === activeId);
  const ctxType = params.get("ctype"), ctxId = params.get("cid"), ctxLabel = params.get("clabel");
  const initialContext = useMemo(() => (ctxType && ctxId ? { type: ctxType, id: ctxId, label: ctxLabel || "" } : null), [ctxType, ctxId, ctxLabel]);

  const loadUnread = useCallback(() => api.get("/messages/unread").then((r) => setUnread(r.data.threads || {})).catch(() => {}), []);
  useEffect(() => { loadUnread(); }, [loadUnread]);

  return (
    <div>
      <PageHeader eyebrow="Coaching" title="Messages" subtitle="Ask about a meal, a workout or your plan. Your coach replies right here." />
      {coaches === null && <div className="spinner" style={{ margin: "60px auto" }} />}
      {coaches && list.length === 0 && (
        <div className="clay empty" style={{ padding: "56px 20px" }}>
          <Icons.UserRoundSearch size={36} style={{ opacity: 0.55, marginBottom: 10 }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>Your coach hasn't been assigned yet</div>
          <div>You'll be able to message them here as soon as they are.</div>
        </div>
      )}
      {active && (
        <div className="clay fade-up" style={{ padding: 16 }}>
          {list.length > 1 && (
            <div className="tabs">
              {list.map((c) => (
                <button key={c.user_id} className={`tab${c.user_id === activeId ? " active" : ""}`} onClick={() => setParams({ coach: c.user_id })} data-testid={`thread-${c.type}`}>
                  {c.name} · {c.type === "yoga" ? "Yoga" : "Fitness"}
                  {unread[c.user_id] > 0 && c.user_id !== activeId && <span className="badge">{unread[c.user_id]}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="row" style={{ padding: "4px 6px 12px" }}>
            <Avatar name={active.name} picture={active.picture} size={38} />
            <div className="min0">
              <div style={{ fontWeight: 600, fontSize: 14.5 }}>{active.name}</div>
              <div style={{ fontSize: 12, color: "var(--text-3)" }}>{active.type === "yoga" ? "Yoga coach" : "Fitness & nutrition coach"}</div>
            </div>
          </div>
          <Chat clientId={user.user_id} coachId={active.user_id} meId={user.user_id} otherName={active.name}
            initialContext={params.get("coach") === active.user_id ? initialContext : null} onRead={loadUnread} />
        </div>
      )}
    </div>
  );
}
