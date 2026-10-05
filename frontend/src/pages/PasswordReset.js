import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import * as Icons from "lucide-react";
import Logo from "@/components/Logo";
import { api } from "@/lib/api";

function Shell({ children, testid }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 16px", background: "var(--bg)" }}>
      <div className="clay fade-up" style={{ maxWidth: 420, width: "100%", padding: "30px 26px" }} data-testid={testid}>
        <Link to="/" style={{ color: "inherit", textDecoration: "none" }}><Logo /></Link>
        {children}
        <Link to="/login" className="row" style={{ color: "var(--text-3)", fontSize: 13, textDecoration: "none", marginTop: 22, gap: 6 }}>
          <Icons.ArrowLeft size={14} /> Back to sign in
        </Link>
      </div>
    </div>
  );
}

// /forgot-password — ask for a reset link by email.
export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState("idle"); // idle | sending | sent
  const [emailEnabled, setEmailEnabled] = useState(true);
  const submit = async (e) => {
    e.preventDefault();
    setState("sending");
    try { setEmailEnabled((await api.post("/auth/forgot", { email: email.trim() })).data.email_enabled !== false); } catch { /* same message either way */ }
    setState("sent");
  };
  return (
    <Shell testid="forgot-password">
      {state === "sent" ? (
        <>
          <h1 style={{ fontSize: 26, fontWeight: 400, marginTop: 22 }}>Check your email</h1>
          <p style={{ color: "var(--text-2)", fontSize: 14.5, lineHeight: 1.65, marginTop: 8 }}>
            If <strong>{email.trim()}</strong> has a FitCoach account, we've sent a link to choose a new password. It works once, for the next hour.
            Check spam if it doesn't arrive in a few minutes.
          </p>
          {!emailEnabled && (
            <div className="clay-inset" style={{ padding: 12, fontSize: 13, marginTop: 14, color: "var(--text-2)" }}>
              Not getting an email? Ask your coach or the FitCoach admin to send you a reset link directly.
            </div>
          )}
        </>
      ) : (
        <form onSubmit={submit}>
          <h1 style={{ fontSize: 26, fontWeight: 400, marginTop: 22 }}>Forgot your password?</h1>
          <p style={{ color: "var(--text-2)", fontSize: 14.5, lineHeight: 1.65, margin: "8px 0 18px" }}>Enter the email you signed up with and we'll send you a link to choose a new one.</p>
          <label className="label" htmlFor="fp-email">Email</label>
          <input id="fp-email" className="field" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="forgot-email" />
          <button className="btn btn-primary" type="submit" disabled={!email.includes("@") || state === "sending"} style={{ width: "100%", marginTop: 16, padding: 13 }} data-testid="forgot-submit">
            {state === "sending" ? "Sending…" : "Send reset link"}
          </button>
          <p style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 12 }}>Signed up with Google? Just use “Continue with Google” — no password needed.</p>
        </form>
      )}
    </Shell>
  );
}

// /reset-password?token=… — choose a new password from the emailed link.
export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [saving, setSaving] = useState(false);
  const mismatch = pw2 && pw !== pw2;
  const submit = async (e) => {
    e.preventDefault();
    if (pw.length < 8) { setError("Use at least 8 characters."); return; }
    if (pw !== pw2) { setError("The two passwords don't match."); return; }
    setSaving(true); setError("");
    try { setDone((await api.post("/auth/reset", { token, password: pw })).data.email || "your account"); }
    catch (err) { setError(err?.response?.data?.detail || "Couldn't reset your password. Try again."); }
    finally { setSaving(false); }
  };
  if (!token) {
    return (
      <Shell testid="reset-password">
        <h1 style={{ fontSize: 26, fontWeight: 400, marginTop: 22 }}>Link incomplete</h1>
        <p style={{ color: "var(--text-2)", fontSize: 14.5, marginTop: 8 }}>Open the full link from your email, or <Link to="/forgot-password">ask for a new one</Link>.</p>
      </Shell>
    );
  }
  return (
    <Shell testid="reset-password">
      {done ? (
        <>
          <div className="empty-medal" style={{ margin: "22px 0 10px" }}><Icons.ShieldCheck size={24} strokeWidth={1.6} /></div>
          <h1 style={{ fontSize: 26, fontWeight: 400 }}>Password changed</h1>
          <p style={{ color: "var(--text-2)", fontSize: 14.5, lineHeight: 1.65, marginTop: 8 }}>
            Sign in to {done} with your new password. For your security, other devices have been signed out.
          </p>
          <button className="btn btn-primary" onClick={() => navigate("/login", { replace: true })} style={{ width: "100%", marginTop: 16, padding: 13 }} data-testid="reset-signin">Sign in</button>
        </>
      ) : (
        <form onSubmit={submit}>
          <h1 style={{ fontSize: 26, fontWeight: 400, marginTop: 22 }}>Choose a new password</h1>
          <p style={{ color: "var(--text-2)", fontSize: 14.5, margin: "8px 0 18px" }}>At least 8 characters. Avoid one you use elsewhere.</p>
          <label className="label" htmlFor="rp-1">New password</label>
          <div style={{ position: "relative" }}>
            <input id="rp-1" className="field" type={show ? "text" : "password"} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="reset-pw" style={{ paddingRight: 44 }} />
            <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)" }}>
              {show ? <Icons.EyeOff size={16} /> : <Icons.Eye size={16} />}
            </button>
          </div>
          <label className="label" htmlFor="rp-2" style={{ marginTop: 12 }}>Type it again</label>
          <input id="rp-2" className="field" type={show ? "text" : "password"} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="reset-pw2"
            aria-invalid={mismatch ? "true" : undefined} />
          {mismatch && <div className="form-error" style={{ marginTop: 6 }}>The two passwords don't match.</div>}
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={saving || !pw || !pw2} style={{ width: "100%", marginTop: 16, padding: 13 }} data-testid="reset-submit">
            {saving ? "Saving…" : "Save new password"}
          </button>
        </form>
      )}
    </Shell>
  );
}
