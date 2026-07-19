import { createContext, useContext, useState, useCallback, useMemo } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, type = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);
  const remove = (id) => setToasts((t) => t.filter((x) => x.id !== id));
  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className="glass fade-up" data-testid="toast"
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderRadius: 14, maxWidth: 320, borderLeft: `3px solid ${t.type === "error" ? "var(--accent)" : "var(--teal)"}` }}>
            {t.type === "error" ? <AlertCircle size={18} color="var(--accent)" /> : <CheckCircle2 size={18} color="var(--teal)" />}
            <span style={{ fontSize: 13.5, fontWeight: 500, flex: 1 }}>{t.message}</span>
            <X size={16} style={{ cursor: "pointer", color: "var(--text-3)" }} onClick={() => remove(t.id)} />
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
