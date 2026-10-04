import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

let gisPromise = null;
const loadGis = () => {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = Object.assign(document.createElement("script"), { src: "https://accounts.google.com/gsi/client", async: true, defer: true });
      s.onload = resolve;
      s.onerror = () => { gisPromise = null; reject(new Error("Google sign-in failed to load")); };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
};

// "Sign in with Google" using Google Identity Services. Renders nothing until a client ID is configured on the API.
export default function GoogleButton({ onCredential, onError }) {
  const ref = useRef(null);
  const handlers = useRef({ onCredential, onError });
  handlers.current = { onCredential, onError };
  const [clientId, setClientId] = useState(null);

  useEffect(() => { api.get("/auth/config").then((r) => setClientId(r.data.google_client_id)).catch(() => {}); }, []);

  useEffect(() => {
    if (!clientId || !ref.current) return;
    let cancelled = false;
    loadGis().then(() => {
      if (cancelled || !ref.current) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: (res) => handlers.current.onCredential(res.credential), ux_mode: "popup" });
      window.google.accounts.id.renderButton(ref.current, {
        theme: "outline", size: "large", shape: "pill", text: "continue_with", width: Math.min(360, ref.current.offsetWidth || 360),
      });
    }).catch((e) => handlers.current.onError?.(e.message));
    return () => { cancelled = true; };
  }, [clientId]);

  if (!clientId) return null;
  return (
    <>
      <div className="row" style={{ gap: 12, margin: "20px 0" }}>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>or</span>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
      </div>
      <div ref={ref} data-testid="google-login-btn" style={{ display: "flex", justifyContent: "center", minHeight: 44 }} />
    </>
  );
}
