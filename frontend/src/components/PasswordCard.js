import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as Icons from "lucide-react";
import { api, setToken } from "@/lib/api";
import { useToast } from "@/context/ToastContext";

// Profile → Password: change it while signed in, or add one if you joined with Google.
export default function PasswordCard({ title = "Password", forced = false, onDone }) {
  const { push } = useToast();
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(forced);
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { api.get("/auth/password").then((r) => setStatus(r.data)).catch(() => {}); }, []);
  if (!status) return null;

  const reset = () => { setOpen(false); setCur(""); setPw(""); setPw2(""); setError(""); };
  const save = async (e) => {
    e.preventDefault();
    const min = status.is_main_admin ? 10 : 8;
    if (pw.length < min) { setError(`Use at least ${min} characters.`); return; }
    if (pw !== pw2) { setError("The two new passwords don't match."); return; }
    setSaving(true); setError("");
    try {
      const r = await api.put("/auth/password", { current_password: status.has_password ? cur : null, new_password: pw });
      if (r.data.access_token) setToken(r.data.access_token);
      push(status.has_password ? "Password changed. Other devices have been signed out." : "Password added — you can now sign in with email too.", "success");
      setStatus({ ...status, has_password: true });
      reset();
      onDone?.();
    } catch (err) { setError(err?.response?.data?.detail || "Couldn't change your password."); } finally { setSaving(false); }
  };

  return (
    <div className="clay" style={{ padding: 24 }} data-testid="password-card">
      <div className="row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div className="min0">
          <div className="eyebrow" style={{ marginBottom: 4 }}>{title}</div>
          <div style={{ fontSize: 13.5, color: "var(--text-2)" }}>
            {forced ? "You signed in with a temporary password. Choose your own to continue."
              : status.has_password ? "Change the password you use to sign in with email."
              : "You sign in with Google. Add a password to also sign in with your email."}
          </div>
          {status.is_main_admin && !forced && (
            <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 6 }}>
              Locked out? Change <code>ADMIN_PASSWORD</code> on the server (Render → Environment) and restart — it resets this account to that password.
            </div>
          )}
        </div>
        {!open && (
          <button className="btn btn-ghost" onClick={() => setOpen(true)} data-testid="change-password"><Icons.KeyRound size={16} /> {status.has_password ? "Change password" : "Add a password"}</button>
        )}
      </div>
      {open && (
        <form onSubmit={save} style={{ marginTop: 16 }}>
          {status.has_password && (
            <>
              <label className="label" htmlFor="cp-cur">{forced ? "Temporary password" : "Current password"}</label>
              <input id="cp-cur" className="field" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} data-testid="cp-current" />
              {!forced && <div style={{ textAlign: "right", marginTop: 6 }}><Link to="/forgot-password" style={{ fontSize: 12.5, color: "var(--ink)" }}>Forgot it?</Link></div>}
            </>
          )}
          <label className="label" htmlFor="cp-new" style={{ marginTop: 10 }}>New password</label>
          <input id="cp-new" className="field" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="cp-new" />
          <label className="label" htmlFor="cp-new2" style={{ marginTop: 10 }}>Type it again</label>
          <input id="cp-new2" className="field" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="cp-new2" />
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="row" style={{ gap: 8, marginTop: 14 }}>
            {!forced && <button type="button" className="btn btn-ghost" onClick={reset} style={{ flex: 1 }}>Cancel</button>}
            <button type="submit" className="btn btn-primary" disabled={saving || !pw || !pw2 || (status.has_password && !cur)} style={{ flex: 1 }} data-testid="cp-save">{saving ? "Saving…" : "Save"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
