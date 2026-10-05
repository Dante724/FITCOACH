import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { api, setToken, setUid, clearOfflineCache, rememberResponse } from "@/lib/api";
import { syncPushForSignedInUser, detachPushOnLogout } from "@/lib/push";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const res = await api.get("/auth/me", { timeout: 8000 });  // offline: the last copy is served from this device
      setUser(res.data);
      setUid(res.data.user_id);
      syncPushForSignedInUser();
    } catch (e) {
      if (e?.response?.status === 401) { setToken(null); setUid(null); clearOfflineCache(); }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);
  // keep the offline copy of the profile current (consent, goal, name changes made in the app)
  useEffect(() => { if (user?.user_id) rememberResponse("/auth/me", user); }, [user]);

  const signedIn = useCallback((data) => {
    const { access_token: token, ...profile } = data;
    setToken(token);
    if (profile.user_id !== undefined) setUid(profile.user_id);
    setUser(profile);
    syncPushForSignedInUser();
    return profile;
  }, []);

  // Google Identity Services hands us an ID token; the API verifies it with Google directly.
  const googleLogin = useCallback(async (credential, referralCode, consents = {}) => signedIn((await api.post("/auth/google", { credential, referral_code: referralCode || undefined, ...consents })).data), [signedIn]);
  const emailLogin = useCallback(async (email, password) => signedIn((await api.post("/auth/login", { email, password })).data), [signedIn]);
  const emailRegister = useCallback(async (name, email, password, referralCode, consents = {}) => signedIn((await api.post("/auth/register", { name, email, password, referral_code: referralCode || undefined, ...consents })).data), [signedIn]);

  const logout = useCallback(async () => {
    await detachPushOnLogout();
    try { await api.post("/auth/logout"); } catch { /* offline: still sign out locally */ }
    setToken(null);
    setUid(null);
    clearOfflineCache();
    setUser(null);
    window.location.href = "/login";
  }, []);

  const value = useMemo(
    () => ({ user, setUser, loading, checkAuth, googleLogin, emailLogin, emailRegister, logout }),
    [user, loading, checkAuth, googleLogin, emailLogin, emailRegister, logout]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
