import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useToast } from "@/context/ToastContext";

const FIELDS = [
  { id: "weight", label: "Weight", unit: "kg" },
  { id: "body_fat", label: "Body Fat", unit: "%" },
  { id: "chest", label: "Chest", unit: "cm" },
  { id: "waist", label: "Waist", unit: "cm" },
  { id: "hips", label: "Hips", unit: "cm" },
  { id: "arms", label: "Arms", unit: "cm" },
];

function Sparkline({ data }) {
  const pts = data.map((d) => d.weight).filter((v) => typeof v === "number");
  if (pts.length < 2) return <div style={{ height: 150, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)", fontSize: 13.5 }}>Log at least two weight entries to see your trend.</div>;
  const W = 520, H = 150, pad = 16;
  const min = Math.min(...pts) - 1, max = Math.max(...pts) + 1;
  const sx = (i) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const sy = (v) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);
  const line = pts.map((v, i) => `${i === 0 ? "M" : "L"}${sx(i)},${sy(v)}`).join(" ");
  const area = `${line} L${sx(pts.length - 1)},${H} L${sx(0)},${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 150 }}>
      <defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgba(224,92,55,0.28)" /><stop offset="100%" stopColor="rgba(224,92,55,0)" /></linearGradient></defs>
      <path d={area} fill="url(#wg)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((v, i) => <circle key={i} cx={sx(i)} cy={sy(v)} r="3.5" fill="var(--accent)" />)}
    </svg>
  );
}

export default function Progress() {
  const { push } = useToast();
  const [entries, setEntries] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const load = () => api.get("/progress").then((r) => setEntries(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    const payload = {};
    let has = false;
    FIELDS.forEach((f) => { const v = parseFloat(form[f.id]); if (!isNaN(v)) { payload[f.id] = v; has = true; } });
    if (!has) { push("Enter at least one value.", "error"); return; }
    setSaving(true);
    try {
      await api.post("/progress", payload);
      push("Progress saved.", "success");
      setOpen(false); setForm({});
      load();
    } catch { push("Could not save.", "error"); } finally { setSaving(false); }
  };

  const remove = async (id) => { await api.delete(`/progress/${id}`).catch(() => {}); push("Entry deleted."); load(); };

  const latest = entries[entries.length - 1] || {};
  const prev = entries[entries.length - 2] || {};

  return (
    <div>
      <PageHeader eyebrow="Progress Tracker" title="Body Progress" subtitle="Log measurements over time and watch your trend take shape."
        action={<button className="btn btn-primary" data-testid="log-progress-btn" onClick={() => setOpen(true)}><Icons.Plus size={18} /> Log today</button>} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
        {["weight", "body_fat", "waist", "chest"].map((fid, i) => {
          const f = FIELDS.find((x) => x.id === fid);
          const val = latest[fid], pv = prev[fid];
          const diff = (typeof val === "number" && typeof pv === "number") ? Math.round((val - pv) * 10) / 10 : null;
          const better = diff !== null && (["weight", "body_fat", "waist"].includes(fid) ? diff < 0 : diff > 0);
          return (
            <div key={fid} className="clay fade-up" style={{ padding: 20, animationDelay: `${i * 60}ms` }}>
              <div style={{ fontSize: 12.5, color: "var(--text-3)", fontWeight: 600, marginBottom: 8 }}>{f.label}</div>
              <div className="display" style={{ fontSize: 26, fontWeight: 800 }}>{val ?? "—"}<span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-2)" }}> {val != null ? f.unit : ""}</span></div>
              {diff !== null ? (
                <div style={{ fontSize: 12, marginTop: 6, color: better ? "var(--teal)" : "var(--accent)", display: "flex", alignItems: "center", gap: 3 }}>
                  {diff < 0 ? <Icons.ArrowDown size={13} /> : <Icons.ArrowUp size={13} />} {Math.abs(diff)} {f.unit} vs last
                </div>
              ) : <div style={{ fontSize: 12, marginTop: 6, color: "var(--text-3)" }}>{val != null ? "First entry" : "No data yet"}</div>}
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 18 }}>
        <div className="clay fade-up" style={{ padding: 26 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Trend</div>
          <h3 className="display" style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>Weight over time</h3>
          <Sparkline data={entries} />
        </div>
        <div className="clay fade-up" style={{ padding: 26, animationDelay: "80ms" }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Latest measurements</div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {FIELDS.map((f) => (
              <div key={f.id} style={{ display: "flex", justifyContent: "space-between", padding: "11px 0", borderBottom: "1px solid rgba(139,150,172,0.16)" }}>
                <span style={{ fontSize: 13.5, color: "var(--text-2)" }}>{f.label}</span>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{latest[f.id] != null ? `${latest[f.id]} ${f.unit}` : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="clay fade-up" style={{ padding: 26, marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div className="eyebrow">History</div>
          <span className="chip chip-neutral">{entries.length} entries</span>
        </div>
        {entries.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-3)", fontSize: 14 }}>No entries yet. Log your first measurement.</div>
        ) : (
          <div data-testid="progress-list">
            {[...entries].reverse().map((e) => (
              <div key={e.id} className="clay-inset" style={{ padding: "13px 16px", marginBottom: 9, display: "grid", gridTemplateColumns: "120px repeat(4, 1fr) 40px", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{e.date}</span>
                <span style={{ fontSize: 13 }}>{e.weight != null ? `${e.weight} kg` : "—"}</span>
                <span style={{ fontSize: 13 }}>{e.body_fat != null ? `${e.body_fat} %` : "—"}</span>
                <span style={{ fontSize: 13 }}>{e.waist != null ? `${e.waist} cm` : "—"}</span>
                <span style={{ fontSize: 13 }}>{e.chest != null ? `${e.chest} cm` : "—"}</span>
                <Icons.Trash2 size={16} data-testid={`delete-progress-${e.id}`} style={{ cursor: "pointer", color: "var(--text-3)", justifySelf: "end" }} onClick={() => remove(e.id)} />
              </div>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(27,33,48,0.45)", backdropFilter: "blur(6px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="glass fade-up" style={{ width: "100%", maxWidth: 460, padding: 30 }} data-testid="progress-modal">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 className="display" style={{ fontSize: 20, fontWeight: 700 }}>Log measurements</h3>
              <Icons.X size={20} style={{ cursor: "pointer", color: "var(--text-3)" }} onClick={() => setOpen(false)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 13 }}>
              {FIELDS.map((f) => (
                <div key={f.id}>
                  <label className="label">{f.label} ({f.unit})</label>
                  <input type="number" step="0.1" className="field" data-testid={`input-${f.id}`} value={form[f.id] || ""} onChange={(e) => setForm({ ...form, [f.id]: e.target.value })} placeholder={f.unit} />
                </div>
              ))}
            </div>
            <button className="btn btn-primary" data-testid="save-progress-btn" disabled={saving} onClick={save} style={{ width: "100%", marginTop: 22, padding: 14 }}>{saving ? "Saving..." : "Save entry"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
