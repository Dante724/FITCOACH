import { useCallback, useEffect, useState } from "react";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { payWithRazorpay, subscribeWithRazorpay } from "@/lib/payments";
import { useMembership, membershipChanged } from "@/lib/membership";

const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
const TERM = (p) => {
  const unit = { weekly: "week", monthly: "month", yearly: "year" }[p.period] || "month";
  return p.interval > 1 ? `every ${p.interval} ${unit}s` : `per ${unit}`;
};
const TXN_LABEL = { plan: "Membership", subscription: "Membership renewal", pack: "Session pack", session: "Single session" };

function StatusCard({ m, onCancel, cancelling }) {
  const live = m.active || m.in_grace;
  return (
    <div className={live && !m.in_grace ? "clay fade-up card-dark" : "clay fade-up"} data-testid="membership-status"
      style={{ padding: 24, marginBottom: 18, display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ width: 52, height: 52, borderRadius: "50%", background: live ? "rgba(201,164,92,0.18)" : "var(--gold-soft)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icons.Crown size={24} color={live ? "#e3c88f" : "var(--gold)"} />
      </div>
      <div className="min0" style={{ flex: "1 1 240px" }}>
        <div className="eyebrow" style={{ color: live ? "#d9bd84" : undefined }}>
          {m.is_trial ? "Free trial" : m.active ? "Active membership" : m.in_grace ? "Grace period" : "No active membership"}
        </div>
        <div className="display" style={{ fontSize: 26, marginTop: 4 }}>
          {m.active ? (m.plan_name || "Member") : m.in_grace ? "Renew to keep your coach" : "Choose a plan to continue"}
        </div>
        <div style={{ fontSize: 13.5, color: "var(--text-2)", marginTop: 4 }}>
          {m.active && `${m.days_left} day${m.days_left === 1 ? "" : "s"} left · ${m.auto_renew ? "renews" : "ends"} ${fmtDate(m.expires_at)}`}
          {m.in_grace && `Access continues until ${fmtDate(m.grace_until)}`}
          {!m.active && !m.in_grace && m.expires_at && `Ended ${fmtDate(m.expires_at)}`}
        </div>
      </div>
      <div className="row-wrap" style={{ gap: 8 }}>
        <span className="chip" style={{ background: live ? "rgba(255,255,255,0.1)" : "var(--surface-2)", color: live ? "#f5efe2" : "var(--text-2)" }} data-testid="credits">
          <Icons.Video size={13} /> {m.unlimited_sessions ? "Unlimited sessions" : `${m.credits} session credit${m.credits === 1 ? "" : "s"}`}
        </span>
        {m.auto_renew && (
          <button className="btn btn-ghost" onClick={onCancel} disabled={cancelling} data-testid="cancel-autorenew"
            style={live ? { background: "transparent", color: "#f5efe2", borderColor: "rgba(245,239,226,0.3)" } : undefined}>
            {cancelling ? "Cancelling…" : "Cancel auto-renew"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function Membership() {
  const { user } = useAuth();
  const { push } = useToast();
  const [m, reload] = useMembership();
  const [config, setConfig] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState(false);

  const loadHistory = useCallback(() => api.get("/payments/history").then((r) => setHistory(r.data.filter((t) => t.status === "paid"))).catch(() => {}), []);
  useEffect(() => {
    api.get("/payments/config").then((r) => setConfig(r.data)).catch(() => setConfig({ enabled: false, plans: [], packs: [] }));
    loadHistory();
  }, [loadHistory]);

  const done = (msg) => { setBusy(""); push(msg, "success"); membershipChanged(); reload(); loadHistory(); };
  const failed = (e) => { setBusy(""); if (e?.message !== "Payment cancelled.") push(e?.response?.data?.detail || e?.message || "Payment failed.", "error"); };

  const subscribe = (p) => { setBusy(`sub-${p.id}`); subscribeWithRazorpay({ planId: p.id, user, onSuccess: () => done(`${p.name} is active and renews automatically.`), onError: failed }); };
  const payOnce = (p) => { setBusy(`once-${p.id}`); payWithRazorpay({ orderPayload: { type: "plan", plan_id: p.id }, user, onSuccess: () => done(`${p.name} membership is active.`), onError: failed }); };
  const buyPack = (pk) => { setBusy(`pack-${pk.id}`); payWithRazorpay({ orderPayload: { type: "pack", pack_id: pk.id }, user, onSuccess: () => done(`${pk.sessions} session credits added.`), onError: failed }); };
  const cancel = async () => {
    if (!window.confirm("Turn off auto-renew? You keep access until the end of the period you've paid for.")) return;
    setBusy("cancel");
    try { await api.post("/payments/subscription/cancel"); done("Auto-renew is off. You keep access until your period ends."); }
    catch (e) { failed(e); }
  };

  const referralLink = m?.referral ? `${window.location.origin}${m.referral.path}` : "";
  const shareReferral = async () => {
    const text = `Train with my coach on FitCoach — use my link for an extra free week: ${referralLink}`;
    if (navigator.share) { try { await navigator.share({ title: "FitCoach", text, url: referralLink }); return; } catch { /* cancelled */ } }
    try { await navigator.clipboard.writeText(referralLink); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* blocked */ }
  };

  return (
    <div>
      <PageHeader eyebrow="Billing" title="Membership" subtitle="Your coach, plans, chat and video sessions — renew automatically or pay once." />

      {m && <StatusCard m={m} onCancel={cancel} cancelling={busy === "cancel"} />}

      {config && !config.enabled && (
        <div className="clay-inset row" data-testid="payments-disabled-banner" style={{ padding: "12px 14px", marginBottom: 18, gap: 10, fontSize: 13.5, color: "var(--text-2)" }}>
          <Icons.Clock size={17} color="var(--amber)" style={{ flexShrink: 0 }} />
          Online payments open as soon as Razorpay is connected. Ask your admin to activate your membership in the meantime.
        </div>
      )}

      <div className="grid-cards" style={{ marginBottom: 26, alignItems: "stretch" }}>
        {(config?.plans || []).map((p, i) => (
          <div key={p.id} data-testid={`plan-${p.id}`} className={p.featured ? "clay fade-up card-dark" : "clay fade-up"}
            style={{ padding: 26, animationDelay: `${i * 70}ms`, position: "relative", display: "flex", flexDirection: "column" }}>
            {p.featured && <span className="chip" style={{ position: "absolute", top: 20, right: 20, background: "rgba(201,164,92,0.18)", color: "var(--ink)" }}>Most popular</span>}
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-2)" }}>{p.name}</div>
            <div className="display" style={{ fontSize: 40, fontWeight: 400, margin: "6px 0 0" }}>{inr(p.price_inr)}</div>
            <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 16 }}>{TERM(p)}{p.blurb ? ` · ${p.blurb}` : ""}</div>
            <div style={{ height: 1, background: "var(--border)", marginBottom: 14 }} />
            <div className="stack" style={{ gap: 10, marginBottom: 20, flex: 1 }}>
              {(p.features || []).map((f) => (
                <div key={f} className="row" style={{ gap: 9, fontSize: 13.5, color: "var(--text-2)" }}><Icons.Check size={14} color="var(--gold)" style={{ flexShrink: 0 }} />{f}</div>
              ))}
            </div>
            <button className="btn btn-primary" data-testid={`subscribe-${p.id}`} disabled={!config.enabled || !!busy || m?.auto_renew} onClick={() => subscribe(p)} style={{ width: "100%" }}>
              {busy === `sub-${p.id}` ? "Opening…" : config.enabled ? <><Icons.RefreshCw size={15} /> Subscribe · renews automatically</> : "Coming soon"}
            </button>
            {config.enabled && (
              <button className="btn btn-ghost" data-testid={`payonce-${p.id}`} disabled={!!busy} onClick={() => payOnce(p)}
                style={{ width: "100%", marginTop: 8, ...(p.featured ? { background: "transparent", color: "var(--text)", borderColor: "var(--border-strong)" } : {}) }}>
                {busy === `once-${p.id}` ? "Opening…" : "Pay once"}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="grid-main-side" style={{ marginBottom: 18 }}>
        <div className="clay fade-up" style={{ padding: 22 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Session packs</div>
          <p style={{ fontSize: 13.5, color: "var(--text-2)", marginBottom: 14 }}>
            Extra video sessions with your coach. Credits are used automatically when you book{config ? ` (single session ${inr(config.session_price_inr)})` : ""}.
          </p>
          <div className="stack" style={{ gap: 10 }}>
            {(config?.packs || []).map((pk) => (
              <div key={pk.id} className="clay-inset row" style={{ padding: "12px 14px", flexWrap: "wrap" }}>
                <div className="min0" style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{pk.name}</div>
                  <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>{inr(Math.round(pk.price_inr / pk.sessions))} per session</div>
                </div>
                <div className="display" style={{ fontSize: 22 }}>{inr(pk.price_inr)}</div>
                <button className="btn btn-primary" data-testid={`buy-${pk.id}`} disabled={!config.enabled || !!busy} onClick={() => buyPack(pk)}>
                  {busy === `pack-${pk.id}` ? "Opening…" : "Buy"}
                </button>
              </div>
            ))}
          </div>
        </div>

        {m?.referral && (
          <div className="clay fade-up" style={{ padding: 22 }} data-testid="referral-card">
            <div className="eyebrow" style={{ marginBottom: 6 }}>Give a week, get a week</div>
            <p style={{ fontSize: 13.5, color: "var(--text-2)", marginBottom: 14, lineHeight: 1.6 }}>
              Friends who join with your link get {m.referral.friend_bonus_days} extra free days. When they start a membership, you get {m.referral.reward_days} days free.
            </p>
            <div className="clay-inset row" style={{ padding: "10px 12px", marginBottom: 12 }}>
              <span className="display" style={{ fontSize: 22, letterSpacing: "0.08em", flex: 1 }} data-testid="referral-code">{m.referral.code}</span>
              <button className="btn btn-primary" onClick={shareReferral} data-testid="share-referral">
                {copied ? <><Icons.Check size={15} /> Copied</> : <><Icons.Share2 size={15} /> Share link</>}
              </button>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>{m.referral.signed_up} joined · {m.referral.rewarded} rewarded</div>
          </div>
        )}
      </div>

      <div className="clay fade-up" style={{ padding: 22 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Payment history</div>
        {history.length === 0 ? <div className="empty" style={{ padding: "24px 0" }}>No payments yet.</div> : (
          <div className="stack" style={{ gap: 8 }}>
            {history.map((t) => (
              <div key={t.id} className="clay-inset row" style={{ padding: "10px 14px", flexWrap: "wrap" }}>
                <div className="min0" style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{TXN_LABEL[t.type] || "Payment"}{t.ref?.plan_name ? ` · ${t.ref.plan_name}` : t.ref?.pack_name ? ` · ${t.ref.pack_name}` : ""}</div>
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>{fmtDate(t.paid_at || t.created_at)}{t.payment_id ? ` · ${t.payment_id}` : ""}</div>
                </div>
                <div style={{ fontWeight: 600 }}>{inr(t.amount_inr)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
