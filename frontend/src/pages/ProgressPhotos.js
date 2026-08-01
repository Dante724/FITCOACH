import { useEffect, useState, useRef, useCallback } from "react";
import * as Icons from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/context/ToastContext";

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => { try { return new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); } catch { return d; } };

function CompareBar({ photos, onClose }) {
  const [a, b] = photos;
  return (
    <div className="glass fade-up" data-testid="compare-panel" style={{ padding: 22, marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div className="eyebrow">Before / After</div>
        <Icons.X size={18} data-testid="close-compare-btn" style={{ cursor: "pointer", color: "var(--text-3)" }} onClick={onClose} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {[a, b].map((p, i) => (
          <div key={p.id}>
            <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", aspectRatio: "3/4", background: "var(--clay-inset, rgba(0,0,0,0.05))" }}>
              <img src={p.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", top: 10, left: 10, padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 800, color: "#fff", background: i === 0 ? "rgba(27,33,48,0.7)" : "linear-gradient(135deg, var(--accent), var(--accent-2))" }}>
                {i === 0 ? "BEFORE" : "AFTER"}
              </div>
            </div>
            <div style={{ marginTop: 8, textAlign: "center" }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{fmtDate(p.date)}</div>
              {p.weight != null && <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>{p.weight} kg</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ProgressPhotos() {
  const { push } = useToast();
  const fileRef = useRef(null);
  const [photos, setPhotos] = useState([]);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ date: today(), weight: "", note: "" });
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [compareMode, setCompareMode] = useState(false);
  const [selected, setSelected] = useState([]);

  const load = useCallback(() => api.get("/progress/photos").then((r) => setPhotos(r.data)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const pickFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!/\.(jpe?g|png|webp|gif)$/i.test(f.name)) { push("Choose a JPG, PNG, WEBP or GIF.", "error"); return; }
    if (f.size > 5 * 1024 * 1024) { push("Image must be 5MB or smaller.", "error"); return; }
    setFile(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
    setForm({ date: today(), weight: "", note: "" });
    setOpen(true);
  };

  const closeModal = () => {
    setOpen(false); setFile(null);
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("date", form.date || today());
      if (form.weight) fd.append("weight", form.weight);
      if (form.note) fd.append("note", form.note);
      await api.post("/progress/photos", fd, { headers: { "Content-Type": "multipart/form-data" } });
      push("Progress photo added.", "success");
      closeModal();
      load();
    } catch (e) {
      push(e?.response?.data?.detail || "Upload failed.", "error");
    } finally { setUploading(false); }
  };

  const remove = async (id) => {
    try { await api.delete(`/progress/photos/${id}`); push("Photo removed."); setSelected((s) => s.filter((x) => x !== id)); load(); }
    catch { push("Could not remove photo.", "error"); }
  };

  const toggleSelect = (id) => {
    setSelected((s) => {
      if (s.includes(id)) return s.filter((x) => x !== id);
      if (s.length >= 2) return [s[1], id];
      return [...s, id];
    });
  };

  const selPhotos = selected.map((id) => photos.find((p) => p.id === id)).filter(Boolean)
    .sort((x, y) => (x.date || "").localeCompare(y.date || ""));

  return (
    <div data-testid="progress-photos">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13.5, color: "var(--text-2)", maxWidth: 460 }}>Snap a photo regularly and watch your transformation on a timeline. Tap Compare to see any two side by side.</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button data-testid="toggle-compare-btn" onClick={() => { setCompareMode((c) => !c); setSelected([]); }}
            className="btn" style={{ padding: "11px 18px", background: compareMode ? "var(--teal)" : "var(--clay-inset, rgba(0,0,0,0.05))", color: compareMode ? "#fff" : "var(--text-2)", border: "none" }}>
            <Icons.GitCompareArrows size={17} /> {compareMode ? "Done" : "Compare"}
          </button>
          <button data-testid="add-photo-btn" className="btn btn-primary" onClick={() => fileRef.current?.click()} style={{ padding: "11px 18px" }}>
            <Icons.Camera size={17} /> Add photo
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={pickFile} data-testid="progress-photo-input" style={{ display: "none" }} />
        </div>
      </div>

      {compareMode && selPhotos.length === 2 && <CompareBar photos={selPhotos} onClose={() => setSelected([])} />}
      {compareMode && selPhotos.length < 2 && (
        <div className="clay-inset" style={{ padding: "14px 18px", marginBottom: 18, fontSize: 13, color: "var(--text-2)", display: "flex", alignItems: "center", gap: 8 }}>
          <Icons.MousePointerClick size={16} color="var(--teal)" /> Select {2 - selPhotos.length} more photo{2 - selPhotos.length === 1 ? "" : "s"} to compare.
        </div>
      )}

      {photos.length === 0 ? (
        <div className="clay" style={{ padding: "50px 24px", textAlign: "center" }}>
          <Icons.ImagePlus size={30} color="var(--text-3)" style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 14.5, fontWeight: 700 }}>No progress photos yet</div>
          <div style={{ fontSize: 13, color: "var(--text-3)", marginTop: 4 }}>Add your first photo to start your timeline.</div>
        </div>
      ) : (
        <div data-testid="photo-timeline" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
          {[...photos].reverse().map((p) => {
            const isSel = selected.includes(p.id);
            const selIdx = selected.indexOf(p.id);
            return (
              <div key={p.id} data-testid={`photo-card-${p.id}`} className="clay fade-up" style={{ padding: 10, position: "relative", cursor: compareMode ? "pointer" : "default", outline: isSel ? "2.5px solid var(--teal)" : "none", outlineOffset: 2 }}
                onClick={() => compareMode && toggleSelect(p.id)}>
                <div style={{ position: "relative", borderRadius: 14, overflow: "hidden", aspectRatio: "3/4", background: "var(--clay-inset, rgba(0,0,0,0.05))" }}>
                  <img src={p.url} alt={`Progress ${p.date}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  {compareMode && isSel && (
                    <div style={{ position: "absolute", top: 8, right: 8, width: 26, height: 26, borderRadius: "50%", background: "var(--teal)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>{selIdx + 1}</div>
                  )}
                  {!compareMode && (
                    <button data-testid={`delete-photo-${p.id}`} onClick={(e) => { e.stopPropagation(); remove(p.id); }}
                      style={{ position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: "50%", border: "none", background: "rgba(27,33,48,0.6)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                      <Icons.Trash2 size={14} />
                    </button>
                  )}
                </div>
                <div style={{ padding: "10px 4px 2px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>{fmtDate(p.date)}</span>
                  {p.weight != null && <span className="chip chip-neutral" style={{ fontSize: 11 }}>{p.weight} kg</span>}
                </div>
                {p.note && <div style={{ fontSize: 11.5, color: "var(--text-3)", padding: "0 4px 4px", lineHeight: 1.5 }}>{p.note}</div>}
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <div onClick={closeModal} style={{ position: "fixed", inset: 0, background: "rgba(27,33,48,0.45)", backdropFilter: "blur(6px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="glass fade-up" style={{ width: "100%", maxWidth: 440, padding: 28 }} data-testid="photo-upload-modal">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h3 className="display" style={{ fontSize: 19, fontWeight: 700 }}>Add progress photo</h3>
              <Icons.X size={20} style={{ cursor: "pointer", color: "var(--text-3)" }} onClick={closeModal} />
            </div>
            {previewUrl && (
              <div style={{ borderRadius: 14, overflow: "hidden", aspectRatio: "3/4", maxHeight: 260, marginBottom: 16, background: "var(--clay-inset, rgba(0,0,0,0.05))" }}>
                <img src={previewUrl} alt="preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 13 }}>
              <div>
                <label className="label">Date</label>
                <input type="date" className="field" data-testid="photo-date-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div>
                <label className="label">Weight (kg)</label>
                <input type="number" step="0.1" className="field" data-testid="photo-weight-input" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} placeholder="optional" />
              </div>
            </div>
            <div style={{ marginTop: 13 }}>
              <label className="label">Note</label>
              <input className="field" data-testid="photo-note-input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. end of week 4" maxLength={200} />
            </div>
            <button className="btn btn-primary" data-testid="save-photo-btn" disabled={uploading} onClick={upload} style={{ width: "100%", marginTop: 22, padding: 14, justifyContent: "center" }}>
              {uploading ? <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Uploading...</> : <><Icons.Upload size={17} /> Save photo</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
