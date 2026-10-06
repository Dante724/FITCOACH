import { useCallback, useEffect, useState } from "react";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api, API, authHeaders } from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import { money } from "@/lib/locale";

const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const BLANK_PLAN = { name: "", price_inr: 0, prices: {}, days: 30, period: "monthly", interval: 1, included_sessions: 0, unlimited_sessions: false,
  blurb: "", features: [], featured: false, active: true, sort: 10 };
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

function Num({ label, value, onChange, suffix, testid, min = 0 }) {
  return (
    <label style={{ display: "block" }}>
      <span className="label">{label}</span>
      <div className="row" style={{ gap: 6 }}>
        <input className="field" type="number" min={min} value={value} data-testid={testid}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />
        {suffix && <span style={{ fontSize: 13, color: "var(--text-3)", whiteSpace: "nowrap" }}>{suffix}</span>}
      </div>
    </label>
  );
}

// Prices for clients abroad (NRIs). Blank = they pay the rupee price in INR.
const ABROAD_CURRENCIES = ["USD", "GBP", "EUR", "AED", "SAR", "QAR", "CAD", "AUD", "NZD", "SGD"];
function LocalPrices({ value, onChange, testid }) {
  const v = value || {};
  const set = (cur, amount) => {
    const next = { ...v };
    if (amount === "" || Number(amount) <= 0) delete next[cur]; else next[cur] = Number(amount);
    onChange(next);
  };
  const count = Object.keys(v).length;
  return (
    <details style={{ gridColumn: "1 / -1" }} data-testid={testid}>
      <summary style={{ cursor: "pointer", fontSize: 13.5, fontWeight: 600 }}>
        Prices for clients abroad {count ? `(${count} set)` : <span style={{ fontWeight: 400, color: "var(--text-3)" }}>— optional</span>}
      </summary>
      <div style={{ fontSize: 12, color: "var(--text-3)", margin: "6px 0 10px" }}>
        Clients living in these countries see and pay this price. Leave blank to charge them the rupee price (in ₹). Needs international payments switched on in Razorpay.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
        {ABROAD_CURRENCIES.map((cur) => (
          <label key={cur}><span className="label">{cur}</span>
            <input className="field" type="number" min={0} step="0.01" value={v[cur] ?? ""} onChange={(e) => set(cur, e.target.value)} data-testid={`${testid}-${cur}`} /></label>
        ))}
      </div>
    </details>
  );
}

function PlanModal({ plan, onClose, onSaved }) {
  const { push } = useToast();
  const [f, setF] = useState({ ...BLANK_PLAN, ...plan, features: plan?.features || [] });
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setSaving(true);
    try {
      const body = { ...BLANK_PLAN, ...Object.fromEntries(Object.keys(BLANK_PLAN).map((k) => [k, f[k]])),
        features: (typeof f.features === "string" ? f.features.split("\n") : f.features).map((x) => x.trim()).filter(Boolean) };
      if (plan?.id) await api.put(`/admin/plans/${plan.id}`, body); else await api.post("/admin/plans", body);
      push("Plan saved.", "success");
      onSaved();
    } catch (e) { push(e?.response?.data?.detail || "Couldn't save the plan.", "error"); } finally { setSaving(false); }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="glass modal fade-up" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }} data-testid="plan-modal">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ fontSize: 22 }}>{plan?.id ? `Edit ${plan.name}` : "New plan"}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icons.X size={18} /></button>
        </div>
        <div className="grid-pair" style={{ gap: 12 }}>
          <label style={{ gridColumn: "1 / -1" }}><span className="label">Name</span><input className="field" value={f.name} onChange={(e) => set("name")(e.target.value)} data-testid="plan-name" /></label>
          <Num label="Price" value={f.price_inr} onChange={set("price_inr")} suffix="₹" testid="plan-price" />
          <Num label="Access length" value={f.days} onChange={set("days")} suffix="days" min={1} />
          <label><span className="label">Auto-renew every</span>
            <div className="row" style={{ gap: 6 }}>
              <input className="field" type="number" min={1} max={12} value={f.interval} onChange={(e) => set("interval")(Number(e.target.value))} style={{ width: 70 }} />
              <select className="field" value={f.period} onChange={(e) => set("period")(e.target.value)}>
                <option value="weekly">week(s)</option><option value="monthly">month(s)</option><option value="yearly">year(s)</option>
              </select>
            </div>
          </label>
          <Num label="Included video sessions" value={f.included_sessions} onChange={set("included_sessions")} suffix="per period" />
          <LocalPrices value={f.prices} onChange={set("prices")} testid="plan-prices" />
          <label style={{ gridColumn: "1 / -1" }}><span className="label">Short description</span><input className="field" value={f.blurb} onChange={(e) => set("blurb")(e.target.value)} /></label>
          <label style={{ gridColumn: "1 / -1" }}><span className="label">Features (one per line)</span>
            <textarea className="field" rows={4} value={Array.isArray(f.features) ? f.features.join("\n") : f.features} onChange={(e) => set("features")(e.target.value)} style={{ resize: "vertical" }} /></label>
        </div>
        <div className="row-wrap" style={{ gap: 16, margin: "14px 0 4px", fontSize: 14 }}>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.unlimited_sessions} onChange={(e) => set("unlimited_sessions")(e.target.checked)} /> Unlimited sessions</label>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.featured} onChange={(e) => set("featured")(e.target.checked)} /> Highlight as most popular</label>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.active} onChange={(e) => set("active")(e.target.checked)} /> On sale</label>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-3)", margin: "8px 0 14px" }}>Price changes apply to new purchases and new auto-renew sign-ups; existing auto-renewals keep their price.</p>
        <button className="btn btn-primary" onClick={save} disabled={saving} style={{ width: "100%" }} data-testid="plan-save">{saving ? "Saving…" : "Save plan"}</button>
      </div>
    </div>
  );
}

function PlansTab() {
  const [plans, setPlans] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api.get("/admin/plans").then((r) => setPlans(r.data)).catch(() => setPlans([])), []);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setEditing({})} data-testid="new-plan"><Icons.Plus size={16} /> New plan</button>
      </div>
      <div className="grid-cards">
        {(plans || []).map((p) => (
          <div key={p.id} className={p.featured ? "clay card-dark" : "clay"} style={{ padding: 22, opacity: p.active ? 1 : 0.6 }} data-testid={`admin-plan-${p.id}`}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <span className={`chip ${p.active ? "chip-teal" : "chip-neutral"}`}>{p.active ? "On sale" : "Hidden"}</span>
            </div>
            <div className="display" style={{ fontSize: 32, margin: "6px 0 2px" }}>{inr(p.price_inr)}</div>
            {Object.keys(p.prices || {}).length > 0 && (
              <div style={{ fontSize: 12, color: "var(--text-3)" }}>Abroad: {Object.entries(p.prices).map(([c, a]) => money({ amount: a, currency: c })).join(" · ")}</div>
            )}
            <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>{p.days} days · renews every {p.interval > 1 ? `${p.interval} ` : ""}{p.period.replace("ly", "")}{p.interval > 1 ? "s" : ""}</div>
            <div style={{ fontSize: 13, color: "var(--text-2)", margin: "10px 0 14px" }}>
              {p.unlimited_sessions ? "Unlimited sessions" : `${p.included_sessions} session${p.included_sessions === 1 ? "" : "s"} included`} · {p.members} active member{p.members === 1 ? "" : "s"}
            </div>
            <button className="btn btn-ghost" onClick={() => setEditing(p)} style={{ width: "100%" }}><Icons.PencilLine size={15} /> Edit</button>
          </div>
        ))}
      </div>
      {editing && <PlanModal plan={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function SettingsTab() {
  const { push } = useToast();
  const [s, setS] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.get("/admin/billing").then((r) => setS(r.data)).catch(() => {}); }, []);
  if (!s) return <div className="spinner" style={{ margin: "40px auto" }} />;
  const set = (k) => (v) => setS((x) => ({ ...x, [k]: v }));
  const setPack = (i, patch) => setS((x) => ({ ...x, packs: x.packs.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));
  const save = async () => {
    setSaving(true);
    try { const { trial_feature_options: opts, ...body } = s; setS({ ...(await api.put("/admin/billing", body)).data, trial_feature_options: opts }); push("Billing settings saved.", "success"); }
    catch (e) { push(e?.response?.data?.detail || "Couldn't save settings.", "error"); } finally { setSaving(false); }
  };
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="clay" style={{ padding: 22 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Membership rules</div>
        <div className="grid-stats" style={{ gap: 14 }}>
          <Num label="Free trial for new clients" value={s.trial_days} onChange={set("trial_days")} suffix="days" testid="trial-days" />
          <Num label="Grace period after expiry" value={s.grace_days} onChange={set("grace_days")} suffix="days" />
          <Num label="Single session price" value={s.session_price_inr} onChange={set("session_price_inr")} suffix="₹" />
        </div>
        <div style={{ marginTop: 12 }}><LocalPrices value={s.session_prices} onChange={set("session_prices")} testid="session-prices" /></div>
      </div>
      <div className="clay" style={{ padding: 22 }} data-testid="trial-settings">
        <div className="eyebrow" style={{ marginBottom: 4 }}>What the free trial includes</div>
        <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 14 }}>Everything else unlocks when they choose a plan. Progress tracking, check-ins and targets are always included.</div>
        <div className="row-wrap" style={{ gap: 8, marginBottom: 16 }}>
          {Object.entries(s.trial_feature_options || {}).map(([k, label]) => {
            const on = (s.trial_features || []).includes(k);
            return (
              <button key={k} type="button" className={`pill${on ? " on" : ""}`} aria-pressed={on} data-testid={`trial-feature-${k}`}
                onClick={() => setS((x) => ({ ...x, trial_features: on ? x.trial_features.filter((f) => f !== k) : [...(x.trial_features || []), k] }))}>
                {on && <Icons.Check size={13} style={{ verticalAlign: -2, marginRight: 4 }} />}{label}
              </button>
            );
          })}
        </div>
        <div className="grid-stats" style={{ gap: 14 }}>
          <Num label="Free intro video sessions" value={s.trial_session_credits} onChange={set("trial_session_credits")} suffix="sessions" />
        </div>
        <label className="row consent-row" style={{ marginTop: 14 }}>
          <input type="checkbox" checked={s.trial_intro_approval !== false} onChange={(e) => setS((x) => ({ ...x, trial_intro_approval: e.target.checked }))} data-testid="trial-intro-approval" />
          <span>Coach confirms each free intro session first <span style={{ color: "var(--text-3)" }}>(stops people signing up again and again for free sessions)</span></span>
        </label>
      </div>
      <div className="clay" style={{ padding: 22 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Referrals</div>
        <div className="grid-stats" style={{ gap: 14 }}>
          <Num label="Friend gets (extra trial)" value={s.referee_bonus_days} onChange={set("referee_bonus_days")} suffix="days" />
          <Num label="Referrer gets (on friend's first payment)" value={s.referral_reward_days} onChange={set("referral_reward_days")} suffix="days" />
        </div>
      </div>
      <div className="clay" style={{ padding: 22 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Coach payout rates</div>
        <div className="grid-stats" style={{ gap: 14 }}>
          <Num label="Per active client / month" value={s.payout_per_client_inr} onChange={set("payout_per_client_inr")} suffix="₹" />
          <Num label="Per video session held" value={s.payout_per_session_inr} onChange={set("payout_per_session_inr")} suffix="₹" />
        </div>
      </div>
      <div className="clay" style={{ padding: 22 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
          <div className="eyebrow">Session packs</div>
          <button className="btn btn-ghost" onClick={() => setS((x) => ({ ...x, packs: [...x.packs, { name: "", sessions: 5, price_inr: 0, active: true }] }))}><Icons.Plus size={15} /> Add pack</button>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          {s.packs.map((p, i) => (
            <div key={i} className="clay-inset" style={{ padding: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ flex: "2 1 160px" }}><span className="label">Name</span><input className="field" value={p.name} onChange={(e) => setPack(i, { name: e.target.value })} /></label>
              <div style={{ flex: "1 1 90px" }}><Num label="Sessions" value={p.sessions} onChange={(v) => setPack(i, { sessions: v })} min={1} /></div>
              <div style={{ flex: "1 1 110px" }}><Num label="Price" value={p.price_inr} onChange={(v) => setPack(i, { price_inr: v })} suffix="₹" /></div>
              <label className="row" style={{ gap: 6, fontSize: 13.5, paddingBottom: 10 }}><input type="checkbox" checked={p.active} onChange={(e) => setPack(i, { active: e.target.checked })} /> On sale</label>
              <button className="icon-btn" onClick={() => setS((x) => ({ ...x, packs: x.packs.filter((_, j) => j !== i) }))} aria-label="Remove pack"><Icons.Trash2 size={16} /></button>
              <div style={{ flexBasis: "100%" }}><LocalPrices value={p.prices} onChange={(v) => setPack(i, { prices: v })} testid={`pack-prices-${i}`} /></div>
            </div>
          ))}
        </div>
      </div>
      <div className="sticky-cta"><button className="btn btn-primary" onClick={save} disabled={saving} data-testid="save-billing"><Icons.Save size={16} /> {saving ? "Saving…" : "Save settings"}</button></div>
    </div>
  );
}

function PayoutsTab() {
  const { push } = useToast();
  const [month, setMonth] = useState(thisMonth());
  const [rep, setRep] = useState(null);
  useEffect(() => { setRep(null); api.get("/admin/payouts", { params: { month } }).then((r) => setRep(r.data)).catch(() => setRep({ coaches: [] })); }, [month]);
  const download = async () => {
    try {
      const res = await fetch(`${API}/admin/payouts.csv?month=${month}`, { headers: authHeaders() });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      Object.assign(document.createElement("a"), { href: url, download: `fitcoach-payouts-${month}.csv` }).click();
      URL.revokeObjectURL(url);
    } catch { push("Couldn't download the report.", "error"); }
  };
  return (
    <>
      <div className="row-wrap" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <label className="row" style={{ gap: 8 }}><span className="label" style={{ margin: 0 }}>Month</span>
          <input className="field" type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 170 }} data-testid="payout-month" /></label>
        <button className="btn btn-ghost" onClick={download} data-testid="payout-csv"><Icons.Download size={15} /> Download CSV</button>
      </div>
      {rep && rep.rates && (
        <div className="grid-stats" style={{ marginBottom: 14 }}>
          {[["Revenue this month", inr(rep.revenue_inr)], ["Total coach payouts", inr(rep.total_payout_inr)],
            ["Per active client", inr(rep.rates.per_client_inr)], ["Per session", inr(rep.rates.per_session_inr)]].map(([l, v]) => (
            <div key={l} className="clay stat-card" style={{ padding: 18 }}><div style={{ fontSize: 12.5, color: "var(--text-3)" }}>{l}</div><div className="display" style={{ fontSize: 26, marginTop: 4 }}>{v}</div></div>
          ))}
        </div>
      )}
      <div className="clay" style={{ padding: 18 }}>
        {!rep && <div className="spinner" style={{ margin: "30px auto" }} />}
        {rep?.coaches?.length === 0 && <div className="empty">No coaches yet.</div>}
        <div className="stack" style={{ gap: 8 }} data-testid="payout-rows">
          {rep?.coaches?.map((r) => (
            <div key={r.coach_id} className="clay-inset" style={{ padding: "12px 14px", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <div className="min0" style={{ flex: "1 1 180px" }}>
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                <div style={{ fontSize: 12, color: "var(--text-3)" }}>{r.coach_type === "yoga" ? "Yoga" : "Fitness"} coach</div>
              </div>
              {[["Clients", r.active_clients], ["Sessions", r.sessions], ["Plans", r.plans_approved], ["Reviews", r.pose_reviews], ["Messages", r.messages]].map(([l, v]) => (
                <div key={l} style={{ textAlign: "center", minWidth: 58 }}><div className="display" style={{ fontSize: 20 }}>{v}</div><div style={{ fontSize: 11, color: "var(--text-3)" }}>{l}</div></div>
              ))}
              <div style={{ marginLeft: "auto", textAlign: "right", minWidth: 100 }}>
                <div className="display" style={{ fontSize: 22, color: "var(--ink)" }}>{inr(r.payout_inr)}</div>
                <div style={{ fontSize: 11, color: "var(--text-3)" }}>payout</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default function AdminBilling() {
  const [tab, setTab] = useState("plans");
  return (
    <div>
      <PageHeader eyebrow="Administration" title="Billing & payouts" subtitle="Plans and prices, session packs, trials and referrals, and what each coach earned." />
      <div className="tabs">
        {[["plans", "Plans", "Crown"], ["settings", "Packs & settings", "Settings2"], ["payouts", "Coach payouts", "Wallet"]].map(([id, label, icon]) => {
          const Icon = Icons[icon] || Icons.Circle;
          return <button key={id} className={`tab${tab === id ? " active" : ""}`} onClick={() => setTab(id)} data-testid={`billing-tab-${id}`}><Icon size={15} /> {label}</button>;
        })}
      </div>
      {tab === "plans" && <PlansTab />}
      {tab === "settings" && <SettingsTab />}
      {tab === "payouts" && <PayoutsTab />}
    </div>
  );
}
