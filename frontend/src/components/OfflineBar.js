import { useEffect } from "react";
import * as Icons from "lucide-react";
import { startSync, useOnline, useQueue } from "@/lib/offline";
import { useToast } from "@/context/ToastContext";

// Shown while the server can't be reached; also starts background syncing of anything saved offline.
export default function OfflineBar() {
  const online = useOnline();
  const queued = useQueue();
  const { push } = useToast();
  useEffect(() => { startSync(); }, []);
  useEffect(() => {
    const onSynced = (e) => {
      const { sent, failed } = e.detail || {};
      if (sent) push(`Synced ${sent} item${sent > 1 ? "s" : ""} saved while offline.`, "success");
      (failed || []).forEach((f) => push(`Couldn't sync “${f.item.label || "an item"}”: ${f.reason}`, "error"));
    };
    window.addEventListener("fc:synced", onSynced);
    return () => window.removeEventListener("fc:synced", onSynced);
  }, [push]);
  if (online && !queued.length) return null;
  return (
    <div className={`offline-bar${online ? " syncing" : ""}`} role="status" data-testid="offline-bar">
      {online ? <Icons.RefreshCw size={14} className="spin" /> : <Icons.WifiOff size={14} />}
      <span>
        {online ? `Syncing ${queued.length} item${queued.length > 1 ? "s" : ""}…`
          : `Offline — food tracking still works${queued.length ? ` · ${queued.length} waiting to sync` : ""}.`}
      </span>
    </div>
  );
}
