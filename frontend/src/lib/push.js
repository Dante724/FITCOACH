import { api, BACKEND_URL } from "@/lib/api";

// ── Installable app (PWA) + Web Push helpers ──

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
// iPhone/iPad only allow push for apps added to the Home Screen (iOS 16.4+).
export const needsInstallForPush = () => isIOS() && !isStandalone();

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`/sw.js?api=${encodeURIComponent(BACKEND_URL)}`).catch(() => {});
  });
}

// Android/desktop Chrome & Edge fire this; we keep it so an "Install app" button can show the prompt later.
let installEvent = null;
const installListeners = new Set();
export function captureInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e;
    installListeners.forEach((fn) => fn(true));
  });
  window.addEventListener("appinstalled", () => { installEvent = null; installListeners.forEach((fn) => fn(false)); });
}
export const canPromptInstall = () => Boolean(installEvent);
export const onInstallAvailability = (fn) => { installListeners.add(fn); return () => installListeners.delete(fn); };
export async function promptInstall() {
  if (!installEvent) return false;
  installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  installListeners.forEach((fn) => fn(false));
  return outcome === "accepted";
}

function urlB64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration()) || null;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** "on" | "off" | "blocked" | "unsupported" | "install-first" */
export async function pushState() {
  if (needsInstallForPush()) return "install-first";
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return Notification.permission === "granted" && (await currentSubscription()) ? "on" : "off";
}

async function saveSubscription(sub) {
  await api.post("/push/subscribe", { ...sub.toJSON(), user_agent: navigator.userAgent });
}

/** Ask permission (must be called from a tap), subscribe this device and register it with the API. */
export async function enablePush() {
  if (!pushSupported()) throw new Error("This browser doesn't support notifications.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "Notifications are blocked in your browser settings." : "Notifications weren't allowed.");
  const { data } = await api.get("/push/config");
  if (!data.public_key) throw new Error("Notifications aren't available on the server yet.");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const key = urlB64ToUint8Array(data.public_key);
  if (sub && sub.options?.applicationServerKey) {
    const existing = new Uint8Array(sub.options.applicationServerKey);
    if (existing.length !== key.length || existing.some((b, i) => b !== key[i])) { await sub.unsubscribe(); sub = null; }
  }
  sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await saveSubscription(sub);
  return sub;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.post("/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/** After login: if this device already allowed notifications, link its subscription to the signed-in user. */
export async function syncPushForSignedInUser() {
  try {
    if (!pushSupported() || Notification.permission !== "granted") return;
    const sub = await currentSubscription();
    if (sub) await saveSubscription(sub); else await enablePush();
  } catch { /* stay silent; the settings page shows the state */ }
}

/** Before logout: stop this device receiving the departing user's notifications. */
export async function detachPushOnLogout() {
  try {
    const sub = await currentSubscription();
    if (sub) await api.post("/push/unsubscribe", { endpoint: sub.endpoint });
  } catch { /* offline */ }
}
