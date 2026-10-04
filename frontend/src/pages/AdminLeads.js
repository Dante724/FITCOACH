import { useCallback, useEffect, useState } from "react";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import { GOAL_LABEL, timeAgo } from "@/lib/focus";

const STATUSES = [
  ["new", "New", "chip-accent"], ["contacted", "Contacted", "chip-amber"], ["scheduled", "Call booked", "chip-violet"],
  ["converted", "Signed up", "chip-teal"], ["lost", "Not now", "chip-neutral"],
];
const STATUS = Object.fromEntries(STATUSES.map(([k, label, cls]) => [k, { label, cls }]));

function LeadCard({ lead, slots, onChange, onDelete }) {
  const { push } = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (body) => {
    setBusy(true);
    try { onChange((await api.put(`/admin/leads/${lead.id}`, body)).data); if (body.note) setNote(""); }
    catch (e) { push(e?.response?.data?.detail || "Could not update the lead.", "error"); } finally { setBusy(false); }
  };
  const when = [lead.preferred_date && new Date(`${lead.preferred_date}T12:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }),
    lead.preferred_slot && slots[lead.preferred_slot]].filter(Boolean).join(" · ");
  return (
    <div className="clay fade-up" style={{ padding: 18 }} data-testid={`lead-${lead.id}`}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div className="min0" style={{ flex: "1 1 220px" }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 16 }}>{lead.name}</span>
            <span className={`chip ${STATUS[lead.status]?.cls}`}>{STATUS[lead.status]?.label}</span>
            {lead.goal && <span className="chip chip-neutral">{GOAL_LABEL[lead.goal]}</span>}
          </div>
          <div className="row-wrap" style={{ gap: 14, marginTop: 8, fontSize: 13.5 }}>
            <a href={`tel:${lead.phone}`} className="row" style={{ gap: 6, color: "var(--ink)", fontWeight: 600, textDecoration: "none" }}><Icons.Phone size={14} /> {lead.phone}</a>
            {lead.email && <a href={`mailto:${lead.email}`} className="row" style={{ gap: 6, color: "var(--text-2)", textDecoration: "none" }}><Icons.Mail size={14} /> {lead.email}</a>}
          </div>
          <div className="row-wrap" style={{ gap: 14, marginTop: 6, fontSize: 12.5, color: "var(--text-3)" }}>
            <span><Icons.CalendarClock size={13} style={{ verticalAlign: -2 }} /> {when || "Any time"}</span>
            <span>Requested {timeAgo(lead.created_at)}</span>
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <select className="field" value={lead.status} onChange={(e) => save({ status: e.target.value })} disabled={busy} aria-label="Lead status" style={{ width: "auto", padding: "8px 10px" }} data-testid="lead-status">
            {STATUSES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <button className="icon-btn" onClick={() => window.confirm(`Delete ${lead.name}'s request? This can't be undone.`) && onDelete(lead.id)} aria-label="Delete lead" title="Delete"><Icons.Trash2 size={16} /></button>
        </div>
      </div>
      {lead.message && <div className="clay-inset" style={{ padding: "10px 12px", fontSize: 13.5, marginTop: 12 }}>“{lead.message}”</div>}
      {lead.notes?.length > 0 && (
        <div className="stack" style={{ gap: 4, marginTop: 12 }}>
          {lead.notes.map((n, i) => <div key={i} style={{ fontSize: 12.5, color: "var(--text-2)" }}><strong style={{ color: "var(--text)" }}>{n.by}</strong> · {timeAgo(n.at)}: {n.text}</div>)}
        </div>
      )}
      <div className="row" style={{ gap: 6, marginTop: 12 }}>
        <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note — e.g. Called, booked Sat 6pm" maxLength={500}
          onKeyDown={(e) => e.key === "Enter" && note.trim() && save({ note })} style={{ flex: 1, minWidth: 0, padding: "9px 12px" }} aria-label="Note" data-testid="lead-note" />
        <button className="btn btn-ghost" disabled={!note.trim() || busy} onClick={() => save({ note })} style={{ padding: "9px 14px" }}>Add</button>
      </div>
    </div>
  );
}

export default function AdminLeads() {
  const { push } = useToast();
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("open");
  const load = useCallback(() => api.get("/admin/leads").then((r) => setData(r.data)).catch(() => push("Could not load leads.", "error")), [push]);
  useEffect(() => { load(); }, [load]);

  const replace = (lead) => setData((d) => ({ ...d, leads: d.leads.map((l) => (l.id === lead.id ? lead : l)) }));
  const remove = async (id) => {
    try { await api.delete(`/admin/leads/${id}`); load(); } catch { push("Could not delete.", "error"); }
  };
  const copyLink = () => {
    const url = `${window.location.origin}/#consult`;
    navigator.clipboard?.writeText(url).then(() => push("Booking link copied.", "success")).catch(() => push(url));
  };

  if (!data) return <div className="spinner" style={{ margin: "80px auto" }} />;
  const counts = {};
  data.leads.forEach((l) => { counts[l.status] = (counts[l.status] || 0) + 1; });
  const open = (counts.new || 0) + (counts.contacted || 0) + (counts.scheduled || 0);
  const shown = data.leads.filter((l) => (filter === "open" ? ["new", "contacted", "scheduled"].includes(l.status) : filter === "all" || l.status === filter));
  const tabs = [["open", "To follow up", open], ...STATUSES.map(([k, label]) => [k, label, counts[k] || 0]), ["all", "All", data.leads.length]];

  return (
    <div>
      <PageHeader eyebrow="Growth" title="Consultation leads" subtitle="Free-call requests from the website. Call them, note what happened, and they're marked signed up automatically when they join with the same email."
        action={<button className="btn btn-ghost" onClick={copyLink}><Icons.Link size={16} /> Copy booking link</button>} />
      <div className="tabs" role="tablist" style={{ flexWrap: "wrap" }}>
        {tabs.map(([k, label, n]) => (
          <button key={k} role="tab" className={`tab${filter === k ? " active" : ""}`} onClick={() => setFilter(k)} data-testid={`leads-tab-${k}`}>
            {label} {n > 0 && <span className={k === "new" || k === "open" ? "badge" : ""} style={k === "new" || k === "open" ? undefined : { opacity: 0.6 }}>{n}</span>}
          </button>
        ))}
      </div>
      <div className="stack" style={{ gap: 12 }}>
        {shown.map((l) => <LeadCard key={l.id} lead={l} slots={data.slots} onChange={replace} onDelete={remove} />)}
        {shown.length === 0 && (
          <div className="clay empty" style={{ padding: "48px 20px" }}>
            <div className="empty-medal"><Icons.PhoneIncoming size={24} strokeWidth={1.6} /></div>
            <div className="empty-title">{data.leads.length ? "Nothing here" : "No consultation requests yet"}</div>
            <div>People book a free call from the “Book a free consultation” button on your website.</div>
          </div>
        )}
      </div>
      <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 18 }}>Requests are deleted automatically after 6 months, as promised on the form.</p>
    </div>
  );
}
