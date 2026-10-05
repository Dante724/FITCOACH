import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import { canPromptInstall, isIOS, isStandalone, onInstallAvailability, promptInstall } from "@/lib/push";

const KEY = "fc_install_hint_dismissed";
const SNOOZE_DAYS = 14;

// Nudges people to add FitCoach to their Home Screen. On iPhone that's the only way to get session reminders
// and call notifications, and missed reminders turn into no-shows.
export default function InstallPrompt() {
  const [can, setCan] = useState(canPromptInstall());
  const [hidden, setHidden] = useState(() => {
    try { return Date.now() - Number(localStorage.getItem(KEY) || 0) < SNOOZE_DAYS * 86400000; } catch { return false; }
  });
  useEffect(() => onInstallAvailability(setCan), []);
  if (hidden || isStandalone() || !(isIOS() || can)) return null;
  const dismiss = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } setHidden(true); };
  return (
    <div className="clay fade-up row" style={{ padding: "14px 16px", gap: 12, marginBottom: 16, alignItems: "flex-start" }} data-testid="install-prompt">
      <Icons.BellRing size={20} color="var(--gold)" style={{ flexShrink: 0, marginTop: 2 }} />
      <div className="min0" style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14.5 }}>Don't miss a session</div>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2, lineHeight: 1.55 }}>
          {isIOS()
            ? <>Add FitCoach to your Home Screen to get session reminders and calls from your coach: tap <Icons.Share size={12} style={{ verticalAlign: -1 }} /> <strong>Share</strong> in Safari, then <strong>Add to Home Screen</strong>, and open it from there.</>
            : <>Install FitCoach for session reminders and incoming calls, even when the browser is closed.</>}
        </div>
        {!isIOS() && can && (
          <button className="btn btn-primary" onClick={async () => { if (await promptInstall()) dismiss(); }} style={{ marginTop: 10, padding: "8px 14px", fontSize: 13 }} data-testid="install-now">
            <Icons.Download size={15} /> Install
          </button>
        )}
      </div>
      <button className="icon-btn" onClick={dismiss} aria-label="Not now"><Icons.X size={16} /></button>
    </div>
  );
}
