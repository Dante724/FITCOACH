import { useEffect, useRef, useState } from "react";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useToast } from "@/context/ToastContext";

export default function BodyScan() {
  const { push } = useToast();
  const fileRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [b64, setB64] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  const load = () => api.get("/bodyscan/history").then((r) => setHistory(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/image\/(png|jpe?g|webp)/.test(file.type)) { push("Use a PNG, JPG or WEBP image.", "error"); return; }
    const reader = new FileReader();
    reader.onload = () => { setPreview(reader.result); setB64(reader.result); setResult(null); };
    reader.readAsDataURL(file);
  };

  const analyze = async () => {
    if (!b64) { push("Upload a photo first.", "error"); return; }
    setAnalyzing(true);
    try {
      const res = await api.post("/bodyscan/analyze", { image_base64: b64 });
      setResult(res.data.result);
      push("Body scan complete.", "success");
      load();
    } catch (e) {
      push(e?.response?.data?.detail || "AI analysis failed.", "error");
    } finally { setAnalyzing(false); }
  };

  return (
    <div>
      <PageHeader eyebrow="Assessment" title="AI Body Scan" subtitle="Upload a clear, full-body photo. Gemini estimates your body type and tailors training and nutrition guidance." />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div className="clay fade-up" style={{ padding: 26 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Your photo</div>
          <div className="clay-inset" onClick={() => fileRef.current?.click()}
            style={{ aspectRatio: "3/4", maxHeight: 380, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", overflow: "hidden", position: "relative" }}>
            {preview ? (
              <img src={preview} alt="preview" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 14 }} />
            ) : (
              <div style={{ textAlign: "center", color: "var(--text-3)" }}>
                <Icons.ImagePlus size={40} style={{ marginBottom: 12 }} />
                <div style={{ fontSize: 14, fontWeight: 600 }}>Click to upload a photo</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>PNG, JPG or WEBP · full body works best</div>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" data-testid="bodyscan-file" onChange={onFile} style={{ display: "none" }} />
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} style={{ flex: 1 }}><Icons.Upload size={17} /> {preview ? "Change photo" : "Upload"}</button>
            <button data-testid="analyze-body-btn" className="btn btn-primary" disabled={!b64 || analyzing} onClick={analyze} style={{ flex: 1 }}>
              {analyzing ? <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Scanning...</> : <><Icons.ScanLine size={18} /> Analyze</>}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {result ? (
            <div className="glass fade-up" data-testid="bodyscan-result" style={{ padding: 26 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <div className="eyebrow">Result</div>
                  <h3 className="display" style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{result.body_type}</h3>
                </div>
                {result.confidence != null && <span className="chip chip-teal">{Math.round(result.confidence)}% confidence</span>}
              </div>
              <p style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.7, marginBottom: 18 }}>{result.description}</p>
              <div className="clay-inset" style={{ padding: 16, marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><Icons.Dumbbell size={16} color="var(--accent)" /><span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Training focus</span></div>
                <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{result.training_focus}</div>
              </div>
              <div className="clay-inset" style={{ padding: 16, marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><Icons.Salad size={16} color="var(--teal)" /><span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Nutrition focus</span></div>
                <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{result.nutrition_focus}</div>
              </div>
              {result.recommended_split && (
                <div className="clay-inset" style={{ padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><Icons.CalendarRange size={16} color="#7c6bd6" /><span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Recommended split</span></div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{result.recommended_split}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="clay fade-up" style={{ padding: 26, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", minHeight: 260, color: "var(--text-3)" }}>
              <Icons.ScanLine size={40} style={{ marginBottom: 14, opacity: 0.6 }} />
              <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-2)" }}>Your assessment will appear here</div>
              <div style={{ fontSize: 13, marginTop: 6, maxWidth: 260 }}>Upload a photo and tap Analyze to detect your body type.</div>
            </div>
          )}

          {history.length > 0 && (
            <div className="clay fade-up" style={{ padding: 22 }}>
              <div className="eyebrow" style={{ marginBottom: 12 }}>Previous scans</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {history.slice(0, 5).map((h) => (
                  <div key={h.id} className="clay-inset" style={{ padding: "11px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700 }}>{h.result?.body_type}</span>
                    <span style={{ fontSize: 12, color: "var(--text-3)" }}>{(h.created_at || "").slice(0, 10)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
