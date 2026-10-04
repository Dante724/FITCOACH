import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowLeft } from "lucide-react";
import Logo from "@/components/Logo";
import GoogleButton from "@/components/GoogleButton";
import { pendingReferral, clearReferral } from "@/lib/membership";
import { useAuth } from "@/context/AuthContext";
import { roleHome } from "@/lib/focus";

function formatApiErrorDetail(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).filter(Boolean).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export default function Login() {
  const { user, googleLogin, emailLogin, emailRegister, loading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState(() => (new URLSearchParams(window.location.search).get("signup") || pendingReferral() ? "register" : "login"));
  const [referral, setReferral] = useState(pendingReferral);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState({ consent: false, photo_consent: false, marketing: false });
  const needsConsent = tab === "register" && !consent.consent;

  if (loading) return null;
  if (user) return <Navigate to={roleHome(user)} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const u = tab === "login"
        ? await emailLogin(email.trim(), password)
        : await emailRegister(name.trim(), email.trim(), password, referral.trim(), consent);
      clearReferral();
      navigate(roleHome(u), { replace: true });
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setBusy(false);
    }
  };

  const tabBtn = (key, label) => (
    <button type="button" data-testid={`auth-tab-${key}`} onClick={() => { setTab(key); setError(""); }}
      className={`tab${tab === key ? " active" : ""}`} style={{ flex: 1, justifyContent: "center" }}>
      {label}
    </button>
  );

  return (
    <div className="split">
      <div className="split-aside" style={{ background: "var(--surface-2)", borderRight: "1px solid var(--border)", padding: "40px 48px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <Link to="/" style={{ color: "inherit", textDecoration: "none" }}><Logo /></Link>
        <div className="fade-up" style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 46, fontWeight: 400, marginBottom: 16 }}>Your own coach.<br /><span className="serif-italic">Plans they approve.</span></h1>
          <p style={{ fontSize: 15, color: "var(--text-2)", lineHeight: 1.65 }}>Training, nutrition and yoga plans drafted by AI and checked by a certified coach, with progress tracking and chat in one place.</p>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>Certified coaches · ACE · NASM · ACSM</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
        <div className="fade-up" style={{ width: "100%", maxWidth: 360 }}>
          <Link to="/" className="row" style={{ color: "var(--text-3)", fontSize: 13, textDecoration: "none", marginBottom: 32, gap: 6 }}><ArrowLeft size={14} /> Back to site</Link>
          <h2 style={{ fontSize: 24, marginBottom: 4 }}>{tab === "login" ? "Welcome back" : "Create your account"}</h2>
          <p style={{ fontSize: 14, color: "var(--text-2)", marginBottom: 24 }}>{tab === "login" ? "Sign in to continue." : "It takes less than a minute."}</p>

          <div className="row" style={{ gap: 6, marginBottom: 22 }}>
            {tabBtn("login", "Sign in")}
            {tabBtn("register", "Create account")}
          </div>

          {error && (
            <div data-testid="auth-error" className="row" style={{ padding: "10px 12px", borderRadius: 10, background: "var(--accent-soft)", color: "var(--accent)", fontSize: 13, marginBottom: 16, gap: 8 }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} /> {error}
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
            {tab === "register" && (
              <div style={{ marginTop: -6, marginBottom: 20 }}>
                <label className="label" htmlFor="referral">Referral code <span style={{ color: "var(--text-3)", fontWeight: 400 }}>(optional)</span></label>
                <input id="referral" className="field" data-testid="auth-referral" value={referral} onChange={(e) => setReferral(e.target.value.toUpperCase())}
                  placeholder="e.g. 7F3A2C" maxLength={12} style={{ textTransform: "uppercase", letterSpacing: "0.08em" }} />
                {referral && <div style={{ fontSize: 12, color: "var(--teal)", marginTop: 6 }}>A friend's code — you'll get extra free days.</div>}
              </div>
            )}
            {tab === "register" && (
              <div className="stack" style={{ gap: 10, marginBottom: 18 }} data-testid="signup-consent">
                <label className="row consent-row">
                  <input type="checkbox" checked={consent.consent} onChange={(e) => setConsent((c) => ({ ...c, consent: e.target.checked }))} data-testid="consent-health" />
                  <span>I'm 18 or older and agree to the <Link to="/terms" target="_blank">Terms</Link> and <Link to="/privacy" target="_blank">Privacy policy</Link>, and allow FitCoach to use my health details (measurements, meals, check-ins) so my coach can coach me.</span>
                </label>
                <label className="row consent-row">
                  <input type="checkbox" checked={consent.photo_consent} onChange={(e) => setConsent((c) => ({ ...c, photo_consent: e.target.checked }))} data-testid="consent-photos" />
                  <span>Store my progress photos and pose-check snapshots <span style={{ color: "var(--text-3)" }}>(optional — you can change this later)</span></span>
                </label>
                <label className="row consent-row">
                  <input type="checkbox" checked={consent.marketing} onChange={(e) => setConsent((c) => ({ ...c, marketing: e.target.checked }))} />
                  <span>Send me tips and offers <span style={{ color: "var(--text-3)" }}>(optional)</span></span>
                </label>
              </div>
            )}
            <button type="submit" disabled={busy || needsConsent} data-testid={tab === "login" ? "email-login-btn" : "email-register-btn"} className="btn btn-primary" style={{ width: "100%", minHeight: 44 }}>
              {busy ? "Please wait..." : tab === "login" ? "Sign in" : "Create account"}
            </button>
          </form>

          <div style={needsConsent ? { opacity: 0.45, pointerEvents: "none" } : undefined} aria-disabled={needsConsent || undefined}>
            <GoogleButton onError={setError} onCredential={async (credential) => {
              setError(""); setBusy(true);
              try { const u = await googleLogin(credential, referral.trim(), tab === "register" ? consent : {}); clearReferral(); navigate(roleHome(u), { replace: true }); }
              catch (err) { setError(formatApiErrorDetail(err.response?.data?.detail) || "Google sign-in failed."); }
              finally { setBusy(false); }
            }} />
          </div>
          {needsConsent && <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 8, textAlign: "center" }}>Tick the first box to create your account.</div>}
        </div>
      </div>
    </div>
  );
}
