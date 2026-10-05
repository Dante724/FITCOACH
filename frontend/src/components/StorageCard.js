import { useCallback, useEffect, useState } from "react";
import * as Icons from "lucide-react";
import { api, API, authHeaders } from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import { timeAgo } from "@/lib/focus";

export const fmtBytes = (n) => {
  if (!n) return "0 MB";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};

// Admin → Insights: how full the database is, where photos live, and backups.
export default function StorageCard() {
  const { push } = useToast();
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState("");
  const [moved, setMoved] = useState(0);
  const [withFiles, setWithFiles] = useState(false);
  const load = useCallback(() => api.get("/admin/storage").then((r) => setS(r.data)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  if (!s) return null;

  const pct = s.pct ?? 0;
  const tone = pct >= 90 ? "var(--accent)" : pct >= 70 ? "var(--amber)" : "var(--teal)";

  const migrate = async () => {
    setBusy("migrate"); setMoved(0);
    try {
      for (let i = 0; i < 200; i += 1) {
        const { data } = await api.post("/admin/storage/migrate", null, { params: { limit: 200 }, timeout: 120000 });
        setMoved((m) => m + data.moved);
        if (!data.remaining || (!data.moved && data.failed)) {
          push(data.failed ? `Moved files, but ${data.failed} couldn't be moved — try again later.` : "All files moved to object storage.", data.failed ? "error" : "success");
          break;
        }
      }
    } catch (e) { push(e?.response?.data?.detail || "Couldn't move files.", "error"); }
    setBusy(""); load();
  };

  const download = async () => {
    setBusy("download");
    try {
      const r = await fetch(`${API}/admin/backup${withFiles ? "?include_files=true" : ""}`, { headers: authHeaders() });
      if (!r.ok) throw new Error();
      const name = (r.headers.get("content-disposition") || "").match(/filename="([^"]+)"/)?.[1] || "fitcoach-backup.json.gz";
      const url = URL.createObjectURL(await r.blob());
      Object.assign(document.createElement("a"), { href: url, download: name }).click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      push("Backup downloaded — keep it somewhere safe (it contains client data).", "success");
    } catch { push("Couldn't create the backup.", "error"); }
    setBusy("");
  };

  const backupNow = async () => {
    setBusy("backup");
    try { const { data } = await api.post("/admin/backup/run", null, { timeout: 120000 }); push(data.error ? `Backup failed: ${data.error}` : "Backup saved to object storage.", data.error ? "error" : "success"); }
    catch (e) { push(e?.response?.data?.detail || "Backup failed.", "error"); }
    setBusy(""); load();
  };

  const b = s.backup || {};
  return (
    <div className="clay fade-up" style={{ padding: 20, marginBottom: 16 }} data-testid="storage-card">
      <div className="eyebrow" style={{ marginBottom: 12 }}>Storage &amp; backups</div>
      <div className="row" style={{ justifyContent: "space-between", fontSize: 13.5, flexWrap: "wrap", gap: 6 }}>
        <span>Database <strong>{fmtBytes(s.used_bytes)}</strong> of {fmtBytes(s.limit_bytes)}{s.estimated ? " (estimate)" : ""}</span>
        <strong style={{ color: tone }}>{pct}% full</strong>
      </div>
      <div className="meter" style={{ height: 8 }}><span style={{ width: `${Math.min(100, pct)}%`, background: tone }} /></div>

      <div className="grid-2" style={{ gap: 12, marginTop: 16 }}>
        <div className="clay-inset" style={{ padding: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}><Icons.Images size={15} style={{ verticalAlign: -2 }} /> Photos &amp; voice notes</div>
          <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
            {s.files_in_db} in the database ({fmtBytes(s.files_in_db_bytes)}) · {s.files_in_storage} in object storage ({fmtBytes(s.files_in_storage_bytes)})
          </div>
          {s.object_storage ? (
            s.files_in_db > 0 && (
              <button className="btn btn-primary" onClick={migrate} disabled={!!busy} style={{ marginTop: 10, padding: "8px 14px", fontSize: 13 }} data-testid="migrate-files">
                <Icons.CloudUpload size={15} /> {busy === "migrate" ? `Moving… ${moved}` : "Move them to object storage"}
              </button>
            )
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--amber)", marginTop: 8, lineHeight: 1.5 }}>
              Object storage isn't set up, so photos fill the database. Add Cloudflare R2 (10 GB free) — see the README, “Storage & backups”.
            </div>
          )}
        </div>
        <div className="clay-inset" style={{ padding: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}><Icons.DatabaseBackup size={15} style={{ verticalAlign: -2 }} /> Backups</div>
          <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
            {s.object_storage
              ? (b.last_backup_at ? <>Automatic, nightly · last {timeAgo(b.last_backup_at)} ({fmtBytes(b.last_backup_bytes)}), keeping 14</> : "Automatic nightly backups are on — the first runs tonight.")
              : "No automatic backups yet — they start once object storage is set up."}
            {b.error && <div style={{ color: "var(--accent)" }}>Last attempt failed: {b.error}</div>}
          </div>
          <div className="row-wrap" style={{ gap: 8, marginTop: 10 }}>
            <button className="btn btn-ghost" onClick={download} disabled={!!busy} style={{ padding: "8px 12px", fontSize: 13 }} data-testid="download-backup">
              <Icons.Download size={15} /> {busy === "download" ? "Preparing…" : "Download backup"}
            </button>
            {s.object_storage && <button className="btn btn-ghost" onClick={backupNow} disabled={!!busy} style={{ padding: "8px 12px", fontSize: 13 }}>{busy === "backup" ? "Backing up…" : "Back up now"}</button>}
          </div>
          <label className="row consent-row" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={withFiles} onChange={(e) => setWithFiles(e.target.checked)} />
            <span>Include photos stored in the database (bigger file)</span>
          </label>
        </div>
      </div>
    </div>
  );
}
