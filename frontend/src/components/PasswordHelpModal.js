import { useState } from "react";
import { createPortal } from "react-dom";
import * as Icons from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/context/ToastContext";

// Easy to read aloud or type on a phone: no 0/O, 1/l/I.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generatePassword(length = 12) {
  const bytes = new Uint32Array(length);
  window.crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
}

// Admin → a person's key icon: send a reset link (they pick their own password), or set a temporary one.
export default function PasswordHelpModal({ user, onClose, onCopyLink }) {
  const { push } = useToast();
  const [pw, setPw] = useState(() => generatePassword());
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const copy = async () => {
    try { await navigator.clipboard.writeText(pw); push("Copied.", "success"); } catch { window.prompt("Temporary password:", pw); }
  };
  const save = async () => {
    setSaving(true);
    try {
      await api.post(`/admin/users/${user.user_id}/password`, { new_password: pw });
      setDone(true);
    } catch (e) { push(e?.response?.data?.detail || "Could not set the password.", "error"); } finally { setSaving(false); }
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="glass modal fade-up" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }} data-testid="password-help">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
          <h3 style={{ fontSize: 22 }}>Password for {user.name.split(" ")[0]}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icons.X size={18} /></button>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 14 }}>{user.email}</p>

        <div className="clay-inset" style={{ padding: 14, marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Send a reset link <span className="chip chip-teal" style={{ fontSize: 11, marginLeft: 6 }}>Recommended</span></div>
          <div style={{ fontSize: 12.5, color: "var(--text-2)", margin: "4px 0 10px" }}>They choose their own password. Works once, for an hour.</div>
          <button className="btn btn-ghost" onClick={() => onCopyLink(user)} style={{ padding: "8px 12px", fontSize: 13 }} data-testid="copy-reset-link"><Icons.Link size={15} /> Copy reset link</button>
        </div>

        <div className="clay-inset" style={{ padding: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Set a temporary password</div>
          {done ? (
            <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6, lineHeight: 1.6 }} data-testid="temp-password-done">
              <Icons.CircleCheck size={15} color="var(--teal)" style={{ verticalAlign: -3 }} /> Done. Share <strong style={{ fontFamily: "var(--mono, monospace)" }}>{pw}</strong> with them privately
              (in person or by phone). They're signed out everywhere and will choose their own password when they sign in.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12.5, color: "var(--text-2)", margin: "4px 0 10px" }}>
                For someone who can't get email. They'll be asked to choose their own password the next time they sign in.
              </div>
              <div className="row" style={{ gap: 6 }}>
                <input className="field" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Temporary password" data-testid="temp-password"
                  style={{ flex: 1, minWidth: 0, fontFamily: "var(--mono, monospace)", letterSpacing: "0.04em" }} />
                <button className="icon-btn" onClick={() => setPw(generatePassword())} aria-label="Generate another" title="Generate another"><Icons.RefreshCw size={16} /></button>
                <button className="icon-btn" onClick={copy} aria-label="Copy password" title="Copy"><Icons.Copy size={16} /></button>
              </div>
              <button className="btn btn-primary" onClick={save} disabled={saving || pw.length < 8} style={{ width: "100%", marginTop: 12 }} data-testid="set-temp-password">
                <Icons.KeyRound size={16} /> {saving ? "Setting…" : "Set temporary password"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
