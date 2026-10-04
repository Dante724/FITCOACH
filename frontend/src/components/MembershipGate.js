import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useMembership } from "@/lib/membership";

// Wraps coaching pages: clients whose membership (and grace period) has ended see a friendly renewal screen.
export default function MembershipGate({ children }) {
  const { user } = useAuth();
  const [m] = useMembership();
  const navigate = useNavigate();
  if (user?.role !== "client" || !m || m.has_access) return children;
  return (
    <div className="fade-up" style={{ maxWidth: 560, margin: "40px auto" }} data-testid="renewal-screen">
      <div className="hero-band" style={{ display: "block", textAlign: "center", padding: "40px 28px" }}>
        <div className="empty-medal" style={{ background: "rgba(201,164,92,0.16)", borderColor: "rgba(201,164,92,0.4)" }}><Icons.Crown size={26} color="#e3c88f" /></div>
        <h1 style={{ fontSize: "32px", fontWeight: 400 }}>{m.is_trial ? "Your free trial has ended" : "Your membership has ended"}</h1>
        <p style={{ color: "var(--text-2)", fontSize: 15, margin: "10px auto 22px", maxWidth: 400, lineHeight: 1.6 }}>
          Renew to pick up where you left off — your coach, your plans, chat and video sessions are all waiting.
        </p>
        <button className="btn btn-primary" onClick={() => navigate("/membership")} style={{ padding: "12px 24px" }} data-testid="renew-cta">
          <Icons.Sparkles size={16} /> See membership plans
        </button>
        {m.credits > 0 && <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 14 }}>You still have {m.credits} session credit{m.credits > 1 ? "s" : ""} — you can book sessions from Book Session.</div>}
      </div>
      <div className="clay-inset row" style={{ padding: 14, gap: 10, fontSize: 13.5, color: "var(--text-2)" }}>
        <Icons.ShieldCheck size={17} color="var(--teal)" style={{ flexShrink: 0 }} />
        Your progress, measurements and photos are safe — you can keep logging them anytime.
      </div>
    </div>
  );
}
