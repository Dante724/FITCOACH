import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import { api } from "@/lib/api";
import { desktopAlert } from "@/lib/calls";
import { pushState, enablePush } from "@/lib/push";
import { useToast } from "@/context/ToastContext";

const PROMPT_KEY = "fc_push_prompt_dismissed";
const promptSnoozed = () => { try { return Date.now() - Number(localStorage.getItem(PROMPT_KEY) || 0) < 7 * 86400000; } catch { return false; } };
const snoozePrompt = () => { try { localStorage.setItem(PROMPT_KEY, String(Date.now())); } catch { /* private mode */ } };

// Soft two-tone ring generated in the browser (no audio files needed).
function useRingtone() {
  const ctxRef = useRef(null);
  const timerRef = useRef(null);
  const stop = useCallback(() => { clearInterval(timerRef.current); timerRef.current = null; }, []);
  const start = useCallback(() => {
    if (timerRef.current) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    ctxRef.current = ctxRef.current || new Ctx();
    const ring = () => {
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      [0, 0.35].forEach((offset, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = i ? 660 : 880;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
        g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + offset + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.3);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + offset); o.stop(ctx.currentTime + offset + 0.32);
      });
    };
    ring();
    timerRef.current = setInterval(ring, 2200);
  }, []);
  useEffect(() => stop, [stop]);
  return { start, stop };
}

/**
 * Lives in the app shell: rings for incoming calls, shows a "starting soon" banner for booked
 * sessions, and mirrors new notifications as desktop alerts while the tab is in the background.
 */
export default function CallCenter() {
  const navigate = useNavigate();
  const [incoming, setIncoming] = useState(null);
  const [soon, setSoon] = useState(null);
  const [dismissed, setDismissed] = useState(() => new Set());
  const { push } = useToast();
  const [notifState, setNotifState] = useState(null); // on | off | blocked | unsupported | install-first
  const [snoozed, setSnoozed] = useState(promptSnoozed);
  const pushOn = notifState === "on";
  useEffect(() => { pushState().then(setNotifState).catch(() => setNotifState("unsupported")); }, []);
  const ring = useRingtone();
  const pushOnRef = useRef(false);
  pushOnRef.current = pushOn;
  const seen = useRef({ calls: new Set(), notes: null });

  const poll = useCallback(async () => {
    try {
      const { data } = await api.get("/calls-live");
      const call = data.incoming[0] || null;
      setIncoming(call);
      if (call && !seen.current.calls.has(call.id)) {
        seen.current.calls.add(call.id);
        if (document.hidden && !pushOnRef.current) desktopAlert(`Incoming call from ${call.peer_name}`, "Tap to answer in FitCoach.", () => navigate(`/call/live/${call.id}`));
      }
      setSoon(data.starting_soon.find((s) => s.minutes >= -45 && s.minutes <= 10) || null);
    } catch { /* offline */ }
  }, [navigate]);

  const pollNotes = useCallback(async () => {
    try {
      const { data } = await api.get("/notifications");
      const unread = data.notifications.filter((n) => !n.read);
      if (seen.current.notes) {
        unread.filter((n) => !seen.current.notes.has(n.id) && !n.title.startsWith("Incoming call"))
          .forEach((n) => document.hidden && !pushOnRef.current && desktopAlert(n.title, n.body, () => n.link && navigate(n.link)));
      }
      seen.current.notes = new Set(data.notifications.map((n) => n.id));
    } catch { /* offline */ }
  }, [navigate]);

  useEffect(() => {
    poll(); pollNotes();
    const a = setInterval(poll, 4000);
    const b = setInterval(pollNotes, 20000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [poll, pollNotes]);

  useEffect(() => { if (incoming) ring.start(); else ring.stop(); }, [incoming, ring]);

  const accept = () => { ring.stop(); navigate(`/call/live/${incoming.id}`); setIncoming(null); };
  const decline = async () => {
    ring.stop();
    const id = incoming.id;
    setIncoming(null);
    await api.post(`/calls/${id}/decline`).catch(() => {});
  };
  const turnOnNotifications = async () => {
    try {
      await enablePush();
      setNotifState("on");
      push("Notifications are on for this device.", "success");
    } catch (e) {
      push(e.message || "Couldn't turn on notifications.", "error");
      setNotifState(await pushState().catch(() => "unsupported"));
    }
  };
  const dismissPrompt = () => { snoozePrompt(); setSnoozed(true); };
  const askNotifications = !snoozed && (notifState === "off" || notifState === "install-first");

  const showSoon = soon && !dismissed.has(soon.booking_id) && !incoming;
  const bannerUp = showSoon || (askNotifications && !incoming);
  useEffect(() => {
    document.body.classList.toggle("has-banner", !!bannerUp);
    return () => document.body.classList.remove("has-banner");
  }, [bannerUp]);

  return (
    <>
      {incoming && (
        <div className="ring-card fade-up" role="alertdialog" aria-label={`Incoming call from ${incoming.peer_name}`} data-testid="incoming-call">
          <div className="row" style={{ gap: 12, marginBottom: 14 }}>
            <div className="call-avatar pulse" style={{ width: 48, height: 48, fontSize: 18 }}>{(incoming.peer_name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2)}</div>
            <div className="min0">
              <div style={{ fontSize: 12, color: "#c9a45c", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>Incoming video call</div>
              <div className="truncate" style={{ fontFamily: "var(--serif)", fontSize: 20 }}>{incoming.peer_name}</div>
            </div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn" onClick={decline} data-testid="decline-call" style={{ flex: 1, background: "#c0532f", color: "#fff" }}><Icons.PhoneOff size={16} /> Decline</button>
            <button className="btn" onClick={accept} data-testid="accept-call" style={{ flex: 1, background: "#c9a45c", color: "#0c3328" }}><Icons.Video size={16} /> Accept</button>
          </div>
        </div>
      )}

      {showSoon && (
        <div className="soon-banner fade-up" data-testid="session-soon">
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--gold-soft)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icons.Video size={17} color="var(--gold)" />
          </div>
          <div className="min0" style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Session with {soon.with}</div>
            <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>{soon.minutes > 0 ? `Starts in ${soon.minutes} min` : soon.minutes === 0 ? "Starting now" : `Started ${-soon.minutes} min ago`} · {soon.time}</div>
          </div>
          <button className="btn btn-primary" onClick={() => navigate(`/call/${soon.booking_id}`)} data-testid="join-soon"><Icons.Video size={15} /> Join</button>
          <button className="icon-btn" onClick={() => setDismissed((d) => new Set(d).add(soon.booking_id))} aria-label="Dismiss"><Icons.X size={16} /></button>
        </div>
      )}

      {askNotifications && !incoming && !showSoon && (
        <div className="soon-banner fade-up" data-testid="enable-notifications">
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--gold-soft)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icons.BellRing size={17} color="var(--gold)" />
          </div>
          {notifState === "install-first" ? (
            <div className="min0" style={{ flex: 1, fontSize: 13.5 }}>
              <div style={{ fontWeight: 600 }}>Get call alerts on your iPhone</div>
              <div style={{ color: "var(--text-2)", fontSize: 12.5 }}>Tap <Icons.Share size={12} /> Share, then <strong>Add to Home Screen</strong>. Open FitCoach from there and turn on notifications.</div>
            </div>
          ) : (
            <>
              <div className="min0" style={{ flex: 1, fontSize: 13.5 }}>
                <div style={{ fontWeight: 600 }}>Never miss a call</div>
                <div style={{ color: "var(--text-2)", fontSize: 12.5 }}>Get calls, reminders and messages even when FitCoach is closed.</div>
              </div>
              <button className="btn btn-primary" onClick={turnOnNotifications} data-testid="turn-on-notifications">Turn on</button>
            </>
          )}
          <button className="icon-btn" onClick={dismissPrompt} aria-label="Not now"><Icons.X size={16} /></button>
        </div>
      )}
    </>
  );
}
