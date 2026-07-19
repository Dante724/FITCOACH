import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import { api } from "@/lib/api";

function loadJitsi() {
  return new Promise((resolve) => {
    if (window.JitsiMeetExternalAPI) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://meet.jit.si/external_api.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export default function VideoCall() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const apiRef = useRef(null);
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/sessions/${bookingId}`);
        if (cancelled) return;
        setSession(data);
        const ok = await loadJitsi();
        if (!ok) { setError("Could not load the video service."); return; }
        if (cancelled || !containerRef.current) return;
        apiRef.current = new window.JitsiMeetExternalAPI("meet.jit.si", {
          roomName: data.room,
          parentNode: containerRef.current,
          userInfo: { displayName: data.display_name },
          configOverwrite: { prejoinPageEnabled: true, startWithAudioMuted: false },
          interfaceConfigOverwrite: { MOBILE_APP_PROMO: false, SHOW_JITSI_WATERMARK: false },
        });
        apiRef.current.addEventListener("readyToClose", () => navigate(-1));
      } catch (e) {
        setError(e?.response?.data?.detail || "Session not found.");
      }
    })();
    return () => {
      cancelled = true;
      if (apiRef.current) { apiRef.current.dispose(); apiRef.current = null; }
    };
  }, [bookingId, navigate]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#12151d" }}>
      <div className="glass" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderRadius: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn btn-ghost" data-testid="leave-call-btn" onClick={() => navigate(-1)} style={{ padding: "8px 16px", fontSize: 13.5 }}><Icons.ArrowLeft size={16} /> Leave</button>
          {session && (
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Session with {session.with}</div>
              <div style={{ fontSize: 12, color: "var(--text-3)" }}>{session.date} · {session.time} · {session.specialty}</div>
            </div>
          )}
        </div>
        <div className="chip chip-teal"><Icons.Video size={13} /> Live video</div>
      </div>
      {error ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", gap: 12 }}>
          <Icons.VideoOff size={40} />
          <div>{error}</div>
          <button className="btn btn-primary" onClick={() => navigate(-1)}>Go back</button>
        </div>
      ) : (
        <div ref={containerRef} data-testid="jitsi-container" style={{ flex: 1, width: "100%" }} />
      )}
    </div>
  );
}
