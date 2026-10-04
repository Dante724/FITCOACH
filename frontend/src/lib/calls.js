import { api } from "@/lib/api";

// Start (or rejoin) an instant call with a client's coach / a coach's client and open the call screen.
export async function startCall(peerId, navigate, push) {
  try {
    const { data } = await api.post("/calls/instant", { peer_id: peerId });
    navigate(`/call/live/${data.id}`);
  } catch (e) {
    push?.(e?.response?.data?.detail || "Couldn't start the call.", "error");
  }
}

export const desktopAlertsSupported = () => typeof window !== "undefined" && "Notification" in window;

export function desktopAlert(title, body, onClick) {
  if (!desktopAlertsSupported() || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, icon: "/favicon.ico", tag: title });
    n.onclick = () => { window.focus(); onClick?.(); n.close(); };
  } catch { /* some mobile browsers only allow notifications from a service worker */ }
}
