import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/focus";
import StorageCard from "@/components/StorageCard";

const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const pct = (n) => (n == null ? "—" : `${n}%`);

export function fmtMinutes(m) {
  if (m == null) return "—";
  if (m < 60) return `${Math.max(1, Math.round(m))} min`;
  if (m < 60 * 24) return `${Math.round(m / 6) / 10} h`.replace(".0 h", " h");
  return `${Math.round(m / 144) / 10} days`.replace(".0 days", " days");
}

function Stat({ label, value, sub, icon, tone }) {
  const Icon = Icons[icon] || Icons.Circle;
  return (
    <div className="clay fade-up" style={{ padding: 18 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 12.5, color: "var(--text-3)", fontWeight: 600 }}>{label}</span>
        <Icon size={17} color={tone || "var(--gold)"} />
      </div>
      <div className="display" style={{ fontSize: 28, fontWeight: 500 }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function DropList({ title, rows, total, empty, navigate }) {
  return (
    <div className="clay fade-up min0" style={{ padding: 20 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div className="eyebrow">{title}</div>
        <span className="chip chip-neutral">{total} in 30 days</span>
      </div>
      {rows.length === 0 ? <div style={{ fontSize: 13.5, color: "var(--text-3)" }}>{empty}</div> : (
        <div className="stack" style={{ gap: 6 }}>
          {rows.map((r) => (
            <button key={r.user_id} className="clay-inset row" onClick={() => navigate(`/admin/clients/${r.user_id}`)}
              style={{ padding: "10px 12px", border: "none", cursor: "pointer", textAlign: "left", font: "inherit", color: "inherit", justifyContent: "space-between", width: "100%" }}>
              <span className="truncate" style={{ fontWeight: 600, fontSize: 13.5 }}>{r.name}</span>
              <span style={{ fontSize: 12, color: r.in_grace ? "var(--amber)" : "var(--text-3)", flexShrink: 0 }}>{r.in_grace ? "in grace · " : ""}ended {timeAgo(r.expired_at)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminInsights() {
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api.get("/admin/insights").then((r) => setD(r.data)).catch(() => setError("Could not load insights.")); }, []);
  if (error) return <div className="clay empty">{error}</div>;
  if (!d) return <div className="spinner" style={{ margin: "80px auto" }} />;

  const max = Math.max(1, ...d.signups.map((w) => w.count));
  const rev = d.revenue;
  const revDelta = rev.last_month ? Math.round(((rev.this_month - rev.last_month) / rev.last_month) * 100) : null;
  const lc = d.leads.counts;

  return (
    <div data-testid="admin-insights">
      <PageHeader eyebrow="Business" title="Insights" subtitle="Sign-ups, renewals, drop-offs and how quickly coaches reply — updated live." />

      <div className="grid-stats" style={{ marginBottom: 16 }}>
        <Stat label="Sign-ups · 30 days" value={d.signups_30d} sub={`${d.clients_total} clients in total`} icon="UserPlus" />
        <Stat label="Members on a plan" value={d.status.paid_active} sub={`${d.status.auto_renew} on auto-renew`} icon="Crown" />
        <Stat label="Trial → paid" value={pct(d.trial_conversion.rate)} sub={`${d.trial_conversion.converted} joined · ${d.trial_conversion.ended_unpaid} didn't (90 days)`} icon="Sparkles" />
        <Stat label="Revenue this month" value={inr(rev.this_month)} sub={revDelta == null ? `Last month ${inr(rev.last_month)}` : `${revDelta >= 0 ? "▲" : "▼"} ${Math.abs(revDelta)}% vs last month`} icon="IndianRupee" />
      </div>

      <div className="grid-main-side" style={{ marginBottom: 16 }}>
        <div className="clay fade-up min0" style={{ padding: 20 }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
            <div className="eyebrow">New clients per week</div>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>last 8 weeks</span>
          </div>
          <div className="bar-chart" role="img" aria-label={`Sign-ups per week: ${d.signups.map((w) => w.count).join(", ")}`}>
            {d.signups.map((w, i) => (
              <div key={w.week} className="bar-col">
                <span style={{ fontSize: 12, fontWeight: 600 }}>{w.count || ""}</span>
                <div className="bar" style={{ height: `${(w.count / max) * 100}%`, opacity: i === d.signups.length - 1 ? 1 : 0.75 }} />
                <span style={{ fontSize: 10.5, color: "var(--text-3)", whiteSpace: "nowrap" }}>{new Date(`${w.week}T12:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="clay fade-up min0" style={{ padding: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Members right now</div>
          {[["On a plan", d.status.paid_active, "var(--teal)"], ["On free trial", d.status.trial, "var(--gold)"], ["In grace period", d.status.grace, "var(--amber)"], ["Lapsed", d.status.lapsed, "var(--text-3)"]].map(([label, n, c]) => (
            <div key={label} className="row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
              <span className="row" style={{ gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: c }} />{label}</span><strong>{n}</strong>
            </div>
          ))}
          <div className="row" style={{ justifyContent: "space-between", padding: "10px 0 0", fontSize: 13 }}>
            <span style={{ color: "var(--text-2)" }}>Renewals · 30 days</span>
            <strong>{d.renewals_30d} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>({pct(d.renewal_rate)} renewed)</span></strong>
          </div>
          <div className="row" style={{ justifyContent: "space-between", padding: "6px 0 0", fontSize: 13 }}>
            <span style={{ color: "var(--text-2)" }}>First payments · 30 days</span><strong>{d.new_paid_30d}</strong>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <DropList title="Paid members who left" rows={d.dropoffs.paid} total={d.dropoffs.paid_count} empty="No paid members lapsed in the last 30 days." navigate={navigate} />
        <DropList title="Trials that ended unpaid" rows={d.dropoffs.trial} total={d.dropoffs.trial_count} empty="No trials ended unpaid in the last 30 days." navigate={navigate} />
      </div>

      <div className="clay fade-up" style={{ padding: 20, marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <div className="eyebrow">Consultation leads</div>
          <button className="btn btn-ghost" onClick={() => navigate("/admin/leads")} style={{ padding: "7px 12px", fontSize: 12.5 }}>Open leads <Icons.ArrowRight size={14} /></button>
        </div>
        <div className="grid-stats" style={{ gap: 10 }}>
          {[["New", lc.new], ["Contacted / booked", (lc.contacted || 0) + (lc.scheduled || 0)], ["Signed up", lc.converted], ["Requests · 30 days", d.leads.last_30d]].map(([label, n]) => (
            <div key={label} className="clay-inset" style={{ padding: "12px 14px" }}>
              <div style={{ fontSize: 12, color: "var(--text-3)" }}>{label}</div>
              <div className="display" style={{ fontSize: 22 }}>{n || 0}</div>
            </div>
          ))}
        </div>
      </div>

      <StorageCard />

      <div className="clay fade-up" style={{ padding: 20 }} data-testid="coach-response">
        <div className="eyebrow" style={{ marginBottom: 4 }}>Coach response times</div>
        <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 14 }}>How long clients wait for a reply in chat, over the last 30 days.</div>
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-3)", fontSize: 12 }}>
                {["Coach", "Clients", "Typical reply", "Within 24 h", "Waiting now", "Plan drafts open"].map((h) => <th key={h} style={{ padding: "8px 10px", fontWeight: 600, borderBottom: "1px solid var(--border)" }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {d.coaches.map((c) => (
                <tr key={c.coach_id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "10px" }}><div style={{ fontWeight: 600 }}>{c.name}</div><div style={{ fontSize: 12, color: "var(--text-3)" }}>{c.coach_type === "yoga" ? "Yoga" : "Fitness"}</div></td>
                  <td style={{ padding: "10px" }}>{c.clients}</td>
                  <td style={{ padding: "10px", fontWeight: 600 }}>{fmtMinutes(c.median_minutes)}</td>
                  <td style={{ padding: "10px" }}>{pct(c.within_24h_pct)}</td>
                  <td style={{ padding: "10px" }}>
                    {c.waiting > 0 ? <span className={`chip ${c.overdue ? "chip-accent" : "chip-amber"}`}>{c.waiting}{c.overdue ? ` · ${c.overdue} over 24 h` : ""}</span> : <span style={{ color: "var(--text-3)" }}>0</span>}
                  </td>
                  <td style={{ padding: "10px" }}>{c.open_drafts}</td>
                </tr>
              ))}
              {d.coaches.length === 0 && <tr><td colSpan={6} style={{ padding: 16, color: "var(--text-3)" }}>No coaches yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
