import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

// Membership state for the signed-in client. Refreshes when the API reports a lapsed membership
// (402) or after a purchase (dispatch "fc:membership-changed").
export function useMembership() {
  const [m, setM] = useState(null);
  const load = useCallback(() => api.get("/me/membership").then((r) => setM(r.data)).catch(() => {}), []);
  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener("fc:membership-required", refresh);
    window.addEventListener("fc:membership-changed", refresh);
    return () => { window.removeEventListener("fc:membership-required", refresh); window.removeEventListener("fc:membership-changed", refresh); };
  }, [load]);
  return [m, load];
}

export const membershipChanged = () => window.dispatchEvent(new CustomEvent("fc:membership-changed"));

export function membershipNotice(m) {
  if (!m) return null;
  if (m.active && m.is_trial) return { tone: "gold", text: `Free trial · ${m.days_left} day${m.days_left === 1 ? "" : "s"} left` };
  if (m.active && m.days_left <= 3 && !m.auto_renew) return { tone: "accent", text: `Membership ends in ${m.days_left} day${m.days_left === 1 ? "" : "s"}` };
  if (m.in_grace) return { tone: "accent", text: "Membership ended · grace period" };
  if (!m.active) return { tone: "accent", text: "Membership ended" };
  return null;
}

// Referral links (/r/CODE) are remembered so the code is applied when the visitor signs up.
const REF_KEY = "fc_ref";
export const rememberReferral = (code) => { try { localStorage.setItem(REF_KEY, String(code || "").toUpperCase()); } catch { /* private mode */ } };
export const pendingReferral = () => { try { return localStorage.getItem(REF_KEY) || ""; } catch { return ""; } };
export const clearReferral = () => { try { localStorage.removeItem(REF_KEY); } catch { /* private mode */ } };
