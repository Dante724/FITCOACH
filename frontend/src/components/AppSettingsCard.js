import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import {
  pushState, enablePush, disablePush, isIOS, isStandalone, canPromptInstall, promptInstall, onInstallAvailability,
} from "@/lib/push";

const STATE_TEXT = {
  on: ["On for this device", "chip-teal"],
  off: ["Off", "chip-neutral"],
  blocked: ["Blocked in browser settings", "chip-accent"],
  unsupported: ["Not supported in this browser", "chip-neutral"],
  "install-first": ["Add to Home Screen first", "chip-amber"],
};

function Row({ icon: Icon, title, children, aside }) {
  return (
    <div className="clay-inset" style={{ padding: 14, display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--gold-soft)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={17} color="var(--gold)" />
      </div>
      <div className="min0" style={{ flex: "1 1 200px" }}>
        <div style={{ fontWeight: 600, fontSize: 14.5 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2, lineHeight: 1.55 }}>{children}</div>
      </div>
      {aside && <div className="row-wrap" style={{ gap: 8, marginLeft: "auto" }}>{aside}</div>}
    </div>
  );
}

// Profile → "App & notifications": install FitCoach and manage push notifications on this device.
export default function AppSettingsCard() {
  const { push } = useToast();
  const [state, setState] = useState(null);
  const [installable, setInstallable] = useState(canPromptInstall());
  const [busy, setBusy] = useState("");
  const installed = isStandalone();

  useEffect(() => { pushState().then(setState).catch(() => setState("unsupported")); }, []);
  useEffect(() => onInstallAvailability(setInstallable), []);

  const run = async (kind, fn) => {
    setBusy(kind);
    try { await fn(); } catch (e) { push(e.message || "Something went wrong.", "error"); } finally {
      setBusy(""); setState(await pushState().catch(() => "unsupported"));
    }
  };
  const turnOn = () => run("on", async () => { await enablePush(); push("Notifications are on for this device.", "success"); });
  const turnOff = () => run("off", async () => { await disablePush(); push("Notifications turned off for this device."); });
  const test = () => run("test", async () => {
    const { data } = await api.post("/push/test");
    push(data.sent ? "Test sent — check your notifications." : "No device received it. Try turning notifications off and on.", data.sent ? "success" : "error");
  });
  const install = () => run("install", async () => { if (await promptInstall()) push("FitCoach is installed.", "success"); });

  const [label, chip] = STATE_TEXT[state] || ["Checking…", "chip-neutral"];

  return (
    <div className="clay" style={{ padding: 24 }} data-testid="app-settings">
      <div className="eyebrow" style={{ marginBottom: 14 }}>App & notifications</div>
      <div className="stack" style={{ gap: 10 }}>
        <Row icon={Icons.Smartphone} title="Install FitCoach"
          aside={installed ? <span className="chip chip-teal"><Icons.Check size={13} /> Installed</span>
            : installable ? <button className="btn btn-primary" onClick={install} disabled={!!busy} data-testid="install-app"><Icons.Download size={16} /> Install</button>
            : null}>
          {installed ? "You're using the installed app."
            : isIOS() ? <>On iPhone or iPad: tap <Icons.Share size={12} /> <strong>Share</strong> in Safari, then <strong>Add to Home Screen</strong>.</>
            : installable ? "Add FitCoach to your home screen or desktop — it opens like an app, without the browser bar."
            : <>Use your browser menu → <strong>Install app</strong> / <strong>Add to Home screen</strong>.</>}
        </Row>
        <Row icon={state === "on" ? Icons.BellRing : Icons.BellOff} title="Notifications"
          aside={<>
            <span className={`chip ${chip}`} data-testid="push-state">{label}</span>
            {state === "off" && <button className="btn btn-primary" onClick={turnOn} disabled={!!busy} data-testid="push-on">{busy === "on" ? "Turning on…" : "Turn on"}</button>}
            {state === "on" && <button className="btn btn-ghost" onClick={test} disabled={!!busy} data-testid="push-test"><Icons.Send size={15} /> Test</button>}
            {state === "on" && <button className="btn btn-ghost" onClick={turnOff} disabled={!!busy}>Turn off</button>}
          </>}>
          {state === "blocked" ? "Allow notifications for this site in your browser's settings, then come back here."
            : state === "install-first" ? "iPhone only delivers web notifications to apps added to the Home Screen (iOS 16.4 or later)."
            : "Incoming calls, session reminders, messages and plan updates — even when FitCoach is closed."}
        </Row>
      </div>
    </div>
  );
}
