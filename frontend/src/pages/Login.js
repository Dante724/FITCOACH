import { Navigate } from "react-router-dom";
import { Zap, Activity, CalendarCheck, ScanLine } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export default function Login() {
  const { user, login, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to={user.focus ? "/dashboard" : "/focus"} replace />;

  return (
    <div style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 0 }}>
      {/* Hero */}
      <div style={{ position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "52px 56px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 13, background: "linear-gradient(135deg, var(--accent), var(--accent-2))", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 18px rgba(224,92,55,0.4)" }}>
            <Zap size={22} color="#fff" fill="#fff" />
          </div>
          <span className="display" style={{ fontSize: 23, fontWeight: 800 }}>FitCoach</span>
        </div>

        <div className="fade-up">
          <div className="chip chip-accent" style={{ marginBottom: 22 }}>Personal training, elevated</div>
          <h1 className="display" style={{ fontSize: 58, fontWeight: 800, lineHeight: 1.02, marginBottom: 20 }}>
            Train with<br /><span style={{ color: "var(--accent)" }}>intelligence.</span>
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-2)", lineHeight: 1.7, maxWidth: 400 }}>
            Book sessions, track your progress, log meals with AI nutrition analysis and scan your body type — all in one focused workspace.
          </p>
          <div style={{ display: "flex", gap: 14, marginTop: 34 }}>
            {[{ i: Activity, t: "Progress tracking" }, { i: CalendarCheck, t: "Easy booking" }, { i: ScanLine, t: "AI body scan" }].map(({ i: Ic, t }) => (
              <div key={t} className="clay-sm" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                <Ic size={20} color="var(--accent)" />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-2)" }}>{t}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>Evidence-based protocols · ACE · NASM · ACSM</div>
      </div>

      {/* Auth card */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <div className="glass fade-up" style={{ width: "100%", maxWidth: 400, padding: "44px 40px" }}>
          <h2 className="display" style={{ fontSize: 27, fontWeight: 700, marginBottom: 6 }}>Welcome</h2>
          <p style={{ fontSize: 14.5, color: "var(--text-2)", marginBottom: 32 }}>Sign in to access your training workspace.</p>

          <button data-testid="google-login-btn" onClick={login} className="btn" style={{ width: "100%", padding: "14px", background: "#fff", color: "var(--text)", boxShadow: "0 8px 22px rgba(70,85,120,0.14)", fontSize: 15 }}>
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" width={20} height={20} />
            Continue with Google
          </button>

          <div style={{ marginTop: 26, paddingTop: 24, borderTop: "1px solid rgba(139,150,172,0.2)", fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.7 }}>
            By continuing you agree to train consistently and log your progress. Your data stays private to your account.
          </div>
        </div>
      </div>
    </div>
  );
}
