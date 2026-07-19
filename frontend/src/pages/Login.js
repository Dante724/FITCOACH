import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Zap, Activity, CalendarCheck, ScanLine, AlertCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

function formatApiErrorDetail(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).filter(Boolean).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export default function Login() {
  const { user, login, emailLogin, emailRegister, loading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to={user.focus ? "/dashboard" : "/focus"} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const u = tab === "login"
        ? await emailLogin(email.trim(), password)
        : await emailRegister(name.trim(), email.trim(), password);
      navigate(u.focus ? "/dashboard" : "/focus", { replace: true });
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setBusy(false);
    }
  };

  const tabBtn = (key, label) => (
    <button type="button" data-testid={`auth-tab-${key}`} onClick={() => { setTab(key); setError(""); }}
      style={{ flex: 1, padding: "10px 0", fontSize: 14, fontWeight: 700, cursor: "pointer", border: "none", background: "transparent",
        color: tab === key ? "var(--accent)" : "var(--text-3)", borderBottom: tab === key ? "2px solid var(--accent)" : "2px solid transparent", fontFamily: "inherit" }}>
      {label}
    </button>
  );

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
        <div className="glass fade-up" style={{ width: "100%", maxWidth: 400, padding: "40px 38px" }}>
          <h2 className="display" style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>{tab === "login" ? "Welcome back" : "Create account"}</h2>
          <p style={{ fontSize: 14, color: "var(--text-2)", marginBottom: 22 }}>Access your training workspace.</p>

          <div style={{ display: "flex", gap: 24, borderBottom: "1px solid rgba(139,150,172,0.2)", marginBottom: 22 }}>
            {tabBtn("login", "Sign in")}
            {tabBtn("register", "Create account")}
          </div>

          {error && (
            <div data-testid="auth-error" style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderRadius: 12, background: "var(--accent-soft)", color: "var(--accent)", fontSize: 13, marginBottom: 16 }}>
              <AlertCircle size={16} /> {error}
            </div>
          )}

          <form onSubmit={submit}>
            {tab === "register" && (
              <div style={{ marginBottom: 14 }}>
                <label className="label">Full name</label>
                <input className="field" data-testid="auth-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" required />
              </div>
            )}
            <div style={{ marginBottom: 14 }}>
              <label className="label">Email</label>
              <input className="field" type="email" data-testid="auth-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label className="label">Password</label>
              <input className="field" type="password" data-testid="auth-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={tab === "register" ? "Min 8 characters" : "Enter password"} required />
            </div>
            <button type="submit" disabled={busy} data-testid={tab === "login" ? "email-login-btn" : "email-register-btn"} className="btn btn-primary" style={{ width: "100%", padding: 14, fontSize: 15 }}>
              {busy ? "Please wait..." : tab === "login" ? "Sign in" : "Create account"}
            </button>
          </form>

          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "22px 0" }}>
            <div style={{ flex: 1, height: 1, background: "rgba(139,150,172,0.2)" }} />
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>or</span>
            <div style={{ flex: 1, height: 1, background: "rgba(139,150,172,0.2)" }} />
          </div>

          <button type="button" data-testid="google-login-btn" onClick={login} className="btn" style={{ width: "100%", padding: "13px", background: "#fff", color: "var(--text)", boxShadow: "0 8px 22px rgba(70,85,120,0.14)", fontSize: 14.5 }}>
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" width={20} height={20} />
            Continue with Google
          </button>
        </div>
      </div>
    </div>
  );
}
