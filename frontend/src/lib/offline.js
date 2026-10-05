// Things done while the server can't be reached — logging a meal, saving a food — wait here on this
// device and are sent, in order, as soon as it's back. Each item has an id the server uses to ignore
// repeats, so a retry can never create duplicates.
import { useEffect, useState } from "react";
import { api, getUid, isOfflineError, isOffline } from "@/lib/api";

const key = () => `fc_queue:${getUid() || "anon"}`;
const read = () => { try { return JSON.parse(localStorage.getItem(key()) || "[]"); } catch { return []; } };
const write = (items) => {
  try { localStorage.setItem(key(), JSON.stringify(items)); } catch { /* storage full */ }
  window.dispatchEvent(new CustomEvent("fc:queue"));
};

export const newId = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
export const pending = (type) => read().filter((i) => !type || i.type === type);
export function enqueue(item) { write([...read(), { ...item, queued_at: new Date().toISOString() }]); }
export function dequeue(id) { write(read().filter((i) => i.id !== id)); }

const SEND = {
  my_food: (i) => api.post("/me/foods", i.payload),
  food_log: (i) => api.post("/food/analyze", i.payload, { timeout: 15000 }),
};
const ORDER = { my_food: 0, food_log: 1 }; // foods first, so logs that use them are understood

let flushing = null;
export function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    const failed = [];
    for (const item of [...read()].sort((a, b) => ORDER[a.type] - ORDER[b.type])) {
      try {
        await SEND[item.type](item);
        dequeue(item.id);
        sent += 1;
      } catch (e) {
        if (isOfflineError(e) || e?.response?.status === 429) break; // still offline — try again later
        dequeue(item.id); // the server refused it (e.g. membership ended); don't retry forever
        failed.push({ item, reason: e?.response?.data?.detail || "Couldn't sync" });
      }
    }
    if (sent || failed.length) window.dispatchEvent(new CustomEvent("fc:synced", { detail: { sent, failed } }));
    return { sent, failed };
  })().finally(() => { flushing = null; });
  return flushing;
}

// Start background syncing once the app is open: on reconnect, when the API answers again, and every 30 s while items wait.
let started = false;
export function startSync() {
  if (started) return;
  started = true;
  const tryFlush = () => { if (read().length) flush(); };
  window.addEventListener("online", tryFlush);
  window.addEventListener("fc:online", tryFlush);
  setInterval(tryFlush, 30000);
  tryFlush();
}

export function useQueue(type) {
  const [items, setItems] = useState(() => pending(type));
  useEffect(() => {
    const update = () => setItems(pending(type));
    window.addEventListener("fc:queue", update);
    window.addEventListener("storage", update);
    return () => { window.removeEventListener("fc:queue", update); window.removeEventListener("storage", update); };
  }, [type]);
  return items;
}

export function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" || navigator.onLine) && !isOffline());
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("fc:online", up);
    window.addEventListener("offline", down); window.addEventListener("fc:offline", down);
    return () => {
      window.removeEventListener("online", up); window.removeEventListener("fc:online", up);
      window.removeEventListener("offline", down); window.removeEventListener("fc:offline", down);
    };
  }, []);
  return online;
}
