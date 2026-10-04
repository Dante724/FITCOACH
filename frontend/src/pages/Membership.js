import { useEffect, useState, useCallback } from "react";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { payWithRazorpay } from "@/lib/payments";

const PLAN_FEATURES = {
  monthly: ["Your own assigned coach", "AI food tracking", "1 trainer session / week", "In-app progress tracking"],
  quarterly: ["Everything in Monthly", "Priority trainer booking", "2 trainer sessions / week", "Coach-approved nutrition plan"],
  annual: ["Everything in Quarterly", "Quarterly body assessments", "Unlimited video sessions", "Best value — save vs monthly"],
};
const PLAN_TERM = { monthly: "per month", quarterly: "per 3 months", annual: "per year" };

export default function Membership() {
  const { user, checkAuth } = useAuth();
  const { push } = useToast();
  const [config, setConfig] = useState(null);
  const [history, setHistory] = useState([]);
  const [payingPlan, setPayingPlan] = useState(null);

  const loadHistory = useCallback(() => api.get("/payments/history").then((r) => setHistory(r.data)).catch(() => {}), []);
  useEffect(() => {
    api.get("/payments/config").then((r) => setConfig(r.data)).catch(() => {});
    loadHistory();
  }, [loadHistory]);

  const subscribe = (plan) => {
    if (!config?.enabled) { push("Payments are not enabled yet.", "error"); return; }
    setPayingPlan(plan.id);
    payWithRazorpay({
      orderPayload: { type: "plan", plan_id: plan.id },
      user,
      onSuccess: async () => { setPayingPlan(null); push(`${plan.name} membership activated.`, "success"); await checkAuth(); loadHistory(); },
      onError: (e) => { setPayingPlan(null); push(e?.response?.data?.detail || e.message || "Payment failed.", "error"); },
    });
  };

  const activeExpiry = user?.membership_expires_at ? new Date(user.membership_expires_at) : null;
  const isActive = activeExpiry && activeExpiry > new Date();
  const plans = config?.plans || [];

  return (
    <div>
      <PageHeader eyebrow="Billing" title="Membership" subtitle="Keep your coach, your plans and your progress tracking active." />

      {config && !config.enabled && (
        <div className="glass fade-up" data-testid="payments-disabled-banner" style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 12, marginBottom: 20, borderLeft: "3px solid var(--amber)" }}>
          <Icons.Clock size={20} color="var(--amber)" />
          <span style={{ fontSize: 14, color: "var(--text-2)" }}>Online payments will be enabled as soon as your Razorpay keys are added. You can still preview the plans below.</span>
        </div>
      )}

      <div className={isActive ? "clay fade-up card-dark" : "clay fade-up"} data-testid="membership-status" style={{ padding: 24, marginBottom: 22, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: isActive ? "rgba(201,164,92,0.18)" : "var(--gold-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icons.Crown size={22} color={isActive ? "#e3c88f" : "var(--gold)"} />
          </div>
          <div>
            <div style={{ fontSize: 12.5, color: "var(--text-3)", fontWeight: 600 }}>Current status</div>
            <div className="display" style={{ fontSize: 19, fontWeight: 600 }}>
              {isActive ? `${(user.membership_plan || "").charAt(0).toUpperCase() + (user.membership_plan || "").slice(1)} member` : "No active membership"}
            </div>
          </div>
        </div>
        {isActive && <span className="chip chip-teal">Renews / expires {activeExpiry.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>}
      </div>

      <div className="grid-cards" style={{ marginBottom: 16, alignItems: "stretch" }}>
        {plans.map((p, i) => {
          const featured = p.id === "quarterly";
          const features = PLAN_FEATURES[p.id] || [];
          return (
            <div key={p.id} data-testid={`plan-${p.id}`} className={featured ? "clay fade-up card-dark" : "clay fade-up"} style={{ padding: 26, animationDelay: `${i * 70}ms`, position: "relative", display: "flex", flexDirection: "column" }}>
              {featured && <span className="chip" style={{ position: "absolute", top: 20, right: 20, background: "rgba(201,164,92,0.18)", color: "var(--ink)" }}>Most popular</span>}
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-2)" }}>{p.name}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 5, margin: "6px 0 2px" }}>
                <span className="display" style={{ fontSize: 40, fontWeight: 400 }}>₹{p.price_inr.toLocaleString("en-IN")}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 18 }}>{PLAN_TERM[p.id] || p.blurb}</div>
              <div style={{ height: 1, background: "var(--border)", marginBottom: 16 }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 11, marginBottom: 22, flex: 1 }}>
                {features.map((f) => (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-2)" }}>
                    <Icons.Check size={14} color="var(--gold)" style={{ flexShrink: 0 }} />{f}
                  </div>
                ))}
              </div>
              <button data-testid={`subscribe-${p.id}`} className={featured ? "btn btn-primary" : "btn btn-ghost"} disabled={!config?.enabled || payingPlan === p.id} onClick={() => subscribe(p)} style={{ width: "100%" }}>
                {payingPlan === p.id ? "Opening..." : config?.enabled ? "Subscribe" : "Coming soon"}
              </button>
            </div>
          );
        })}
      </div>

      <div className="clay-inset fade-up" style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icons.Ticket size={20} color="var(--accent)" /></div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Prefer to pay as you go?</div>
          <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>Book individual trainer sessions at ₹1,000 each — no membership required.</div>
        </div>
        <span className="chip chip-accent">₹1,000 / session</span>
      </div>

      <div className="clay fade-up" style={{ padding: 26 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div className="eyebrow">Payment history</div>
          <span className="chip chip-neutral">{history.length}</span>
        </div>
        {history.length === 0 ? (
          <div style={{ textAlign: "center", padding: "36px 0", color: "var(--text-3)", fontSize: 14 }}>No payments yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }} data-testid="payment-history">
            {history.map((t) => (
              <div key={t.id} className="clay-inset" style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                <Icons.Receipt size={18} color="var(--text-3)" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t.type === "plan" ? `${t.ref?.plan_name || "Plan"} membership` : "Training session"}</div>
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>{(t.created_at || "").slice(0, 10)}</div>
                </div>
                <span style={{ fontSize: 14, fontWeight: 600 }}>₹{Number(t.amount_inr).toLocaleString("en-IN")}</span>
                <span className={t.status === "paid" ? "chip chip-teal" : "chip chip-neutral"}>{t.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
