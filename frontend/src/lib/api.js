import axios from "axios";

// Where the API lives, e.g. https://fitcoach-api.onrender.com (set at build time on Render).
export const BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
export const API = `${BACKEND_URL}/api`;

// The login token is kept in this browser and sent as a Bearer header, so sign-in works even when
// the frontend and API are on different domains (Safari and others block cross-site cookies).
const TOKEN_KEY = "fc_token";
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };
export const authHeaders = () => { const t = getToken(); return t ? { Authorization: `Bearer ${t}` } : {}; };

export const api = axios.create({ baseURL: API, withCredentials: true, timeout: 25000 });
api.interceptors.request.use((config) => {
  const t = getToken();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

// ── Offline: remember the last good copy of key screens per person, and serve it when the
// server can't be reached (no internet, server asleep or down). Writes are queued in lib/offline.js.
const UID_KEY = "fc_uid";
export const getUid = () => { try { return localStorage.getItem(UID_KEY) || ""; } catch { return ""; } };
export const setUid = (uid) => { try { if (uid) localStorage.setItem(UID_KEY, uid); else localStorage.removeItem(UID_KEY); } catch { /* ignore */ } };
const CACHEABLE = [/^\/auth\/me$/, /^\/food\/logs$/, /^\/me\/foods$/, /^\/my\/plans$/, /^\/my\/coaches$/, /^\/today$/,
  /^\/me\/membership$/, /^\/progress$/, /^\/workouts\/plan$/, /^\/workouts\/sessions$/, /^\/plans$/, /^\/legal$/, /^\/bookings$/];
const cacheKey = (config) => {
  const path = (config.url || "").replace(API, "");
  if ((config.method || "get") !== "get" || !CACHEABLE.some((re) => re.test(path))) return null;
  const params = config.params ? `?${new URLSearchParams(config.params)}` : "";
  return `fc_cache:${getUid() || "anon"}:${path}${params}`;
};
export const isOfflineError = (e) => !e?.response || [502, 503, 504].includes(e.response.status);
let offline = false;
const setOffline = (v) => {
  if (offline === v) return;
  offline = v;
  window.dispatchEvent(new CustomEvent(v ? "fc:offline" : "fc:online"));
};
export const isOffline = () => offline;
export function rememberResponse(path, data) {
  try { localStorage.setItem(`fc_cache:${getUid() || "anon"}:${path}`, JSON.stringify({ at: Date.now(), data })); } catch { /* ignore */ }
}
export function cachedResponse(path) {
  try { return JSON.parse(localStorage.getItem(`fc_cache:${getUid() || "anon"}:${path}`) || "null")?.data ?? null; } catch { return null; }
}
export function clearOfflineCache() {
  try { Object.keys(localStorage).filter((k) => k.startsWith("fc_cache:")).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
}

api.interceptors.response.use((res) => {
  setOffline(false);
  const key = cacheKey(res.config);
  if (key) { try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data: res.data })); } catch { /* storage full */ } }
  return res;
}, (error) => {
  // 402 = the client's membership has lapsed; the app shell shows the renewal screen.
  if (error?.response?.status === 402) window.dispatchEvent(new CustomEvent("fc:membership-required"));
  if (error?.config && isOfflineError(error) && !axios.isCancel(error)) {
    setOffline(true);
    const key = cacheKey(error.config);
    let hit = null;
    try { hit = key && JSON.parse(localStorage.getItem(key) || "null"); } catch { hit = null; }
    if (hit) return Promise.resolve({ data: hit.data, status: 200, headers: {}, config: error.config, offline: true, cachedAt: hit.at });
  }
  return Promise.reject(error);
});

// Uploaded photos are served by the API at /api/files/...; <img> tags can't send headers,
// so add the token as a query parameter. External URLs (e.g. Google profile photos) pass through.
export function fileSrc(url) {
  if (!url) return url;
  if (url.startsWith("data:") || /^https?:\/\//.test(url) && !url.includes("/api/files/")) return url;
  const full = url.startsWith("/api/") ? `${BACKEND_URL}${url}` : url;
  const t = getToken();
  return t ? `${full}${full.includes("?") ? "&" : "?"}auth=${encodeURIComponent(t)}` : full;
}
