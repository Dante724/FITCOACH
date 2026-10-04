import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import Avatar from "@/components/Avatar";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { GOAL_LABEL, PLAN_LABEL } from "@/lib/focus";

const KIND = {
  session: { icon: "Video", color: "var(--teal)" },
  approve: { icon: "BadgeCheck", color: "var(--accent)" },
  message: { icon: "MessageCircle", color: "#7c6bd6" },
  pose_review: { icon: "ScanEye", color: "#7c6bd6" },
  needs_plan: { icon: "ClipboardPlus", color: "var(--amber)" },
  plateau: { icon: "TrendingDown", color: "var(--accent)" },
  off_track: { icon: "TriangleAlert", color: "var(--accent)" },
  inactive: { icon: "Moon", color: "var(--text-3)" },
  no_food: { icon: "Utensils", color: "var(--text-3)" },
};

function AttentionItem({ item, onAction, busy }) {
  const meta = KIND[item.kind] || { icon: "Circle", color: "var(--text-3)" };
  const Icon = Icons[meta.icon] || Icons.Circle;
  let action;
  if (item.kind === "session") action = ["Join", "Video", () => onAction("join", item)];
  else if (item.kind === "approve") action = ["Review", "ArrowRight", () => onAction("plans", item)];
  else if (item.kind === "message") action = ["Reply", "Reply", () => onAction("chat", item)];
  else if (item.kind === "pose_review") action = ["Review", "ScanEye", () => onAction("pose", item)];
  else if (item.kind === "needs_plan") action = ["Draft with AI", "Sparkles", () => onAction("draft", item)];
  else if (item.plan_type) action = ["Draft adjustment", "Sparkles", () => onAction("adjust", item)];
  else action = ["Message", "MessageCircle", () => onAction("chat", item)];
  const ActionIcon = Icons[action[1]] || Icons.ArrowRight;

  return (
    <div className="clay-inset" style={{ padding: "12px 14px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }} data-testid={`attention-${item.kind}`}>
      <div style={{ width: 38, height: 38, borderRadius: 11, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={18} color={meta.color} />
      </div>
      <div className="min0" style={{ flex: "1 1 180px", cursor: "pointer" }} onClick={() => onAction("open", item)}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{item.client_name}</div>
        <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>{item.text}</div>
      </div>
      <button className={item.kind === "approve" || item.kind === "session" ? "btn btn-primary" : "btn btn-ghost"} disabled={busy === item.id}
        onClick={action[2]} style={{ padding: "8px 14px", fontSize: 12.5, marginLeft: "auto" }}>
        <ActionIcon size={15} /> {busy === item.id ? "Working..." : action[0]}
      </button>
    </div>
  );
}

function ClientCard({ c, onOpen }) {
  const { brief } = c;
  return (
    <button className="clay fade-up" onClick={onOpen} data-testid={`client-card-${c.user_id}`}
      style={{ padding: 18, border: "none", cursor: "pointer", textAlign: "left", color: "var(--text)", display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="row">
        <Avatar name={c.name} picture={c.picture} size={42} />
        <div className="min0" style={{ flex: 1 }}>
          <div className="truncate" style={{ fontSize: 15, fontWeight: 700 }}>{c.name}</div>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>{GOAL_LABEL[c.focus] || "No goal yet"}</div>
        </div>
        {c.pending_pose > 0 && <span className="chip chip-violet" title="Pose checks to review"><Icons.ScanEye size={12} /> {c.pending_pose}</span>}
        {c.unread > 0 && <span className="badge">{c.unread}</span>}
      </div>
      <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>{brief.headline}</div>
      <div className="row-wrap" style={{ gap: 6 }}>
        {c.active_plans.map((t) => <span key={t} className="chip chip-teal">{PLAN_LABEL[t]}</span>)}
        {c.draft_plans.map((t) => <span key={t} className="chip chip-amber">{PLAN_LABEL[t]} draft</span>)}
        {brief.flags.map((f) => <span key={f.kind} className="chip chip-accent">{f.text}</span>)}
      </div>
    </button>
  );
}

export default function TrainerDashboard() {
  const { user } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const [clients, setClients] = useState(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    api.get("/coach/attention").then((r) => setItems(r.data)).catch(() => setItems([]));
    api.get("/coach/clients").then((r) => setClients(r.data)).catch(() => setClients([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const onAction = async (kind, item) => {
    const base = `/trainer/clients/${item.client_id}`;
    if (kind === "join") return navigate(`/call/${item.booking_id}`);
    if (kind === "open") return navigate(base);
    if (kind === "plans") return navigate(`${base}?tab=plans`);
    if (kind === "chat") return navigate(`${base}?tab=chat`);
    if (kind === "pose") return navigate(`${base}?tab=pose`);
    setBusy(item.id);
    try {
      await api.post(`/coach/clients/${item.client_id}/plans/draft`, { type: item.plan_type, notes: kind === "adjust" ? item.adjust_reason : undefined });
      push("Draft ready — review and approve it.", "success");
      navigate(`${base}?tab=plans`);
    } catch (e) {
      push(e?.response?.data?.detail || "Could not draft plan.", "error");
    } finally { setBusy(""); }
  };

  const filtered = (clients || []).filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(query.toLowerCase()));
  const approvals = (items || []).filter((i) => i.kind === "approve").length;

  return (
    <div>
      <PageHeader eyebrow={new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
        title={`Hi ${user?.name?.split(" ")[0] || "Coach"}`}
        subtitle={items ? `${items.length} thing${items.length === 1 ? "" : "s"} need you today${approvals ? ` · ${approvals} plan${approvals > 1 ? "s" : ""} to approve` : ""}.` : "Loading your day..."} />

      <div className="clay fade-up" style={{ padding: 20, marginBottom: 20 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
          <div className="eyebrow">Needs attention</div>
          <button className="icon-btn" onClick={load} title="Refresh"><Icons.RefreshCw size={16} /></button>
        </div>
        {items === null && <div className="spinner" style={{ margin: "30px auto" }} />}
        {items?.length === 0 && (
          <div className="empty"><Icons.PartyPopper size={30} style={{ opacity: 0.6, marginBottom: 8 }} /><div>All caught up. Nice work.</div></div>
        )}
        <div className="stack" data-testid="attention-list">
          {items?.map((i) => <AttentionItem key={i.id} item={i} onAction={onAction} busy={busy} />)}
        </div>
      </div>

      <div className="row-wrap" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div className="eyebrow">My clients ({clients?.length ?? 0})</div>
        <div style={{ position: "relative", flex: "0 1 280px", minWidth: 200 }}>
          <Icons.Search size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }} />
          <input className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search clients..." style={{ paddingLeft: 38 }} />
        </div>
      </div>
      {clients?.length === 0 && <div className="clay empty">No clients assigned to you yet. Your admin assigns clients from the Admin Console.</div>}
      <div className="grid-cards" data-testid="client-list">
        {filtered.map((c) => <ClientCard key={c.user_id} c={c} onOpen={() => navigate(`/trainer/clients/${c.user_id}`)} />)}
      </div>
    </div>
  );
}
