import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as Icons from "lucide-react";
import Logo from "@/components/Logo";
import { api, API, authHeaders, setToken } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";

const consentPayload = (user, patch) => ({
  health_data: true,
  photos: !!user?.consents?.photos,
  marketing: !!user?.consents?.marketing,
  ...patch,
});

// Shown once to clients who haven't recorded consent yet (e.g. signed in with Google, or joined before consent existed).
export function ConsentScreen() {
  const { user, setUser, logout } = useAuth();
  const [c, setC] = useState({ health_data: false, photos: false, marketing: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true);
    setError("");
    try { setUser((await api.post("/me/consent", c)).data); } catch (e) { setError(e?.response?.data?.detail || "Could not save — please try again."); setSaving(false); }
  };
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 16px", background: "var(--bg)" }}>
      <div className="clay fade-up" style={{ maxWidth: 520, width: "100%", padding: "30px 26px" }} data-testid="consent-screen">
        <Logo />
        <h1 style={{ fontSize: 28, fontWeight: 400, marginTop: 22 }}>Before we start, {user?.name?.split(" ")[0]}</h1>
        <p style={{ color: "var(--text-2)", fontSize: 14.5, lineHeight: 1.65, margin: "8px 0 18px" }}>
          Coaching works on personal information — your measurements, meals, check-ins and, if you choose, photos. Only you, your assigned coaches and
          our admin team can see it. You can download it or delete your account anytime from Profile.
        </p>
        <div className="stack" style={{ gap: 12 }}>
          <label className="row consent-row">
            <input type="checkbox" checked={c.health_data} onChange={(e) => setC({ ...c, health_data: e.target.checked })} data-testid="consent-screen-health" />
            <span><strong style={{ color: "var(--text)" }}>Required:</strong> I'm 18 or older, agree to the <Link to="/terms" target="_blank">Terms</Link> and <Link to="/privacy" target="_blank">Privacy policy</Link> and allow FitCoach to use my health details for my coaching.</span>
          </label>
          <label className="row consent-row">
            <input type="checkbox" checked={c.photos} onChange={(e) => setC({ ...c, photos: e.target.checked })} />
            <span>Store my progress photos and pose-check snapshots <span style={{ color: "var(--text-3)" }}>(optional)</span></span>
          </label>
          <label className="row consent-row">
            <input type="checkbox" checked={c.marketing} onChange={(e) => setC({ ...c, marketing: e.target.checked })} />
            <span>Send me tips and offers <span style={{ color: "var(--text-3)" }}>(optional)</span></span>
          </label>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="btn btn-primary" disabled={!c.health_data || saving} onClick={save} style={{ width: "100%", marginTop: 20, padding: 13 }} data-testid="consent-continue">
          {saving ? "Saving…" : "Continue"}
        </button>
        <button className="btn btn-ghost" onClick={logout} style={{ width: "100%", marginTop: 8 }}>Not now — log out</button>
      </div>
    </div>
  );
}

// Inline prompt on photo pages when photo storage is off.
export function PhotoConsentCard({ what = "progress photos" }) {
  const { user, setUser } = useAuth();
  const { push } = useToast();
  const [saving, setSaving] = useState(false);
  const allow = async () => {
    setSaving(true);
    try { setUser((await api.post("/me/consent", consentPayload(user, { photos: true }))).data); push("Photo storage turned on.", "success"); }
    catch (e) { push(e?.response?.data?.detail || "Could not update.", "error"); } finally { setSaving(false); }
  };
  return (
    <div className="clay fade-up" style={{ padding: 22, marginBottom: 18 }} data-testid="photo-consent-card">
      <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
        <div className="stat-icon" style={{ width: 42, height: 42, borderRadius: 12, background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icons.ImageOff size={20} color="var(--text-2)" />
        </div>
        <div className="min0" style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Photo storage is off</div>
          <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "4px 0 14px", lineHeight: 1.6 }}>
            To save {what}, allow FitCoach to store them. Only you and your assigned coaches can see them, and turning this off later deletes them.
          </p>
          <button className="btn btn-primary" onClick={allow} disabled={saving} data-testid="allow-photos"><Icons.Check size={16} /> {saving ? "Saving…" : "Allow photo storage"}</button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ on, onChange, label, hint, testid, disabled }) {
  return (
    <label className="row" style={{ justifyContent: "space-between", gap: 14, padding: "12px 0", borderBottom: "1px solid var(--border)", cursor: disabled ? "default" : "pointer" }}>
      <div className="min0">
        <div style={{ fontSize: 14, fontWeight: 600 }}>{label}</div>
        {hint && <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 2 }}>{hint}</div>}
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch${on ? " on" : ""}`} onClick={() => !disabled && onChange(!on)} disabled={disabled} data-testid={testid}><span /></button>
    </label>
  );
}

// Profile → Privacy & data: consent toggles, download, delete.
export function PrivacyCard() {
  const { user, setUser } = useAuth();
  const { push } = useToast();
  const [busy, setBusy] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [contact, setContact] = useState("");
  const isClient = user?.role === "client";
  useEffect(() => { api.get("/auth/config").then((r) => setContact(r.data.privacy_contact || "")).catch(() => {}); }, []);

  const update = async (patch) => {
    if (patch.photos === false && !window.confirm("Turning off photo storage permanently deletes all your progress photos and pose-check snapshots. Continue?")) return;
    setBusy("consent");
    try {
      setUser((await api.post("/me/consent", consentPayload(user, patch))).data);
      push(patch.photos === false ? "Photo storage off — your photos were deleted." : "Saved.", "success");
    } catch (e) { push(e?.response?.data?.detail || "Could not update.", "error"); } finally { setBusy(""); }
  };

  const download = async () => {
    setBusy("export");
    try {
      const r = await fetch(`${API}/me/export`, { headers: authHeaders() });
      if (!r.ok) throw new Error();
      const url = URL.createObjectURL(await r.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: `fitcoach-my-data.json` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { push("Could not prepare your download.", "error"); } finally { setBusy(""); }
  };

  const remove = async () => {
    setBusy("delete");
    try {
      await api.delete("/me", { data: { confirm } });
      setToken(null);
      window.location.href = "/?deleted=1";
    } catch (e) { push(e?.response?.data?.detail || "Could not delete your account.", "error"); setBusy(""); }
  };

  return (
    <div className="clay" style={{ padding: 24 }} data-testid="privacy-card">
      <div className="eyebrow" style={{ marginBottom: 4 }}>Privacy & data</div>
      <p style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 6 }}>
        You control what we keep. Read the <Link to="/privacy" style={{ color: "var(--ink)" }}>privacy policy</Link>.
      </p>
      {isClient && (
        <>
          <Toggle on={!!user?.consents?.health_data} disabled label="Health data for coaching" hint="Required to be coached — delete your account to withdraw it." />
          <Toggle on={!!user?.consents?.photos} onChange={(v) => update({ photos: v })} disabled={busy === "consent"} testid="toggle-photos"
            label="Store photos" hint="Progress photos and pose-check snapshots. Turning this off deletes them." />
          <Toggle on={!!user?.consents?.marketing} onChange={(v) => update({ marketing: v })} disabled={busy === "consent"} testid="toggle-marketing"
            label="Tips and offers" hint="Occasional messages about new programmes." />
        </>
      )}
      <div className="row-wrap" style={{ gap: 10, marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={download} disabled={busy === "export"} data-testid="download-data"><Icons.Download size={16} /> {busy === "export" ? "Preparing…" : "Download my data"}</button>
        {isClient && !deleting && <button className="btn btn-ghost" onClick={() => setDeleting(true)} style={{ color: "var(--accent)" }} data-testid="delete-account"><Icons.Trash2 size={16} /> Delete my account</button>}
      </div>
      {deleting && (
        <div className="clay-inset" style={{ padding: 16, marginTop: 14 }} data-testid="delete-confirm">
          <div style={{ fontWeight: 600, fontSize: 14, color: "var(--accent)" }}>Delete your account permanently?</div>
          <p style={{ fontSize: 13, color: "var(--text-2)", margin: "6px 0 12px", lineHeight: 1.6 }}>
            This erases your profile, plans, progress, photos, check-ins and chats, and cancels auto-renewal. It can't be undone.
            Payment records are kept without your name, as tax law requires.
          </p>
          <label className="label" htmlFor="del-confirm">Type DELETE to confirm</label>
          <input id="del-confirm" className="field" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" data-testid="delete-input" />
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button className="btn btn-ghost" onClick={() => { setDeleting(false); setConfirm(""); }} style={{ flex: 1 }}>Cancel</button>
            <button className="btn btn-primary" disabled={confirm.trim().toUpperCase() !== "DELETE" || busy === "delete"} onClick={remove}
              style={{ flex: 1, background: "var(--accent)", borderColor: "var(--accent)" }} data-testid="delete-final">{busy === "delete" ? "Deleting…" : "Delete forever"}</button>
          </div>
        </div>
      )}
      {contact && <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 14 }}>Questions or complaints about your data: <a href={`mailto:${contact}`} style={{ color: "var(--ink)" }}>{contact}</a></div>}
    </div>
  );
}
