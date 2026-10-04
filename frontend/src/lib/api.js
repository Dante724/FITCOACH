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

export const api = axios.create({ baseURL: API, withCredentials: true });
api.interceptors.request.use((config) => {
  const t = getToken();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});
// 402 = the client's membership has lapsed; the app shell shows the renewal screen.
api.interceptors.response.use((res) => res, (error) => {
  if (error?.response?.status === 402) window.dispatchEvent(new CustomEvent("fc:membership-required"));
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
