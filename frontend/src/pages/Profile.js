import { useRef, useState } from "react";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { getFocus } from "@/lib/focus";

export default function Profile() {
  const { user, setUser } = useAuth();
  const { push } = useToast();
  const fileRef = useRef(null);
  const [name, setName] = useState(user?.name || "");
  const [savingName, setSavingName] = useState(false);
  const [uploading, setUploading] = useState(false);

  const initials = (user?.name || "U").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  const roleLabel = (user?.role || "client").charAt(0).toUpperCase() + (user?.role || "client").slice(1);
  const focus = getFocus(user?.focus);
  const dirty = name.trim() !== (user?.name || "").trim();
  const canSave = dirty && !!name.trim();

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed) { push("Name can't be empty.", "error"); return; }
    setSavingName(true);
    try {
      const res = await api.put("/profile", { name: trimmed });
      setUser(res.data);
      push("Profile updated.", "success");
    } catch (e) {
      push(e?.response?.data?.detail || "Could not update profile.", "error");
    } finally { setSavingName(false); }
  };

  const onPickPhoto = () => fileRef.current?.click();

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/\.(jpe?g|png|webp|gif)$/i.test(file.name)) { push("Choose a JPG, PNG, WEBP or GIF.", "error"); return; }
    if (file.size > 5 * 1024 * 1024) { push("Image must be 5MB or smaller.", "error"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post("/profile/photo", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setUser(res.data);
      push("Photo updated.", "success");
    } catch (err) {
      push(err?.response?.data?.detail || "Could not upload photo.", "error");
    } finally { setUploading(false); }
  };

  return (
    <div data-testid="profile-page">
      <PageHeader eyebrow="Account" title="Profile settings" subtitle="Update how your name and photo appear across FitCoach." />

      <div className="fade-up" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 22, maxWidth: 620 }}>
        <div className="glass" style={{ padding: 26, borderRadius: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
              {user?.picture ? (
                <img src={user.picture} alt="" data-testid="profile-avatar" style={{ width: 92, height: 92, borderRadius: "50%", objectFit: "cover", boxShadow: "0 8px 20px rgba(0,0,0,0.15)" }} />
              ) : (
                <div data-testid="profile-avatar" style={{ width: 92, height: 92, borderRadius: "50%", background: "linear-gradient(135deg, var(--accent), #7c6bd6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, fontWeight: 800, color: "#fff", boxShadow: "0 8px 20px rgba(0,0,0,0.15)" }}>{initials}</div>
              )}
              <button data-testid="change-photo-btn" onClick={onPickPhoto} disabled={uploading}
                style={{ position: "absolute", right: -4, bottom: -4, width: 34, height: 34, borderRadius: "50%", border: "3px solid var(--surface, #fff)", background: "linear-gradient(135deg, var(--accent), var(--accent-2))", display: "flex", alignItems: "center", justifyContent: "center", cursor: uploading ? "wait" : "pointer" }}>
                {uploading ? <div className="spinner" style={{ width: 15, height: 15 }} /> : <Icons.Camera size={16} color="#fff" />}
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onPhoto} data-testid="photo-input" style={{ display: "none" }} />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{user?.name}</div>
              <div style={{ fontSize: 13.5, color: "var(--text-2)", marginTop: 2 }}>{user?.email}</div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 10, padding: "5px 12px", borderRadius: 999, background: "var(--clay-inset, rgba(0,0,0,0.05))", fontSize: 12, fontWeight: 700 }}>
                <Icons.BadgeCheck size={14} color="var(--teal)" />{roleLabel}{focus ? ` · ${focus.label}` : ""}
              </div>
            </div>
          </div>
          <p style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 16 }}>JPG, PNG, WEBP or GIF · up to 5MB.</p>
        </div>

        <div className="glass" style={{ padding: 26, borderRadius: 22 }}>
          <label htmlFor="profile-name" style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-3)" }}>Display name</label>
          <input id="profile-name" data-testid="profile-name-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
            className="clay-inset" style={{ width: "100%", marginTop: 10, padding: "13px 15px", borderRadius: 14, border: "none", fontSize: 15, fontWeight: 600, background: "transparent", color: "var(--text)" }} />
          <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-3)" }}>Email addresses cannot be changed.</div>
          <button data-testid="save-profile-btn" onClick={saveName} disabled={!canSave || savingName}
            style={{ marginTop: 18, padding: "12px 24px", borderRadius: 14, border: "none", fontSize: 14, fontWeight: 700, color: "#fff", cursor: (!canSave || savingName) ? "not-allowed" : "pointer", opacity: (!canSave || savingName) ? 0.55 : 1, background: "linear-gradient(135deg, var(--accent), var(--accent-2))", boxShadow: "0 6px 16px rgba(224,92,55,0.35)", display: "inline-flex", alignItems: "center", gap: 8 }}>
            {savingName ? <div className="spinner" style={{ width: 15, height: 15 }} /> : <Icons.Check size={16} />}Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
