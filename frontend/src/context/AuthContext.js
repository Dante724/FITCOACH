import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { api, setToken } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const res = await api.get("/auth/me");
      setUser(res.data);
    } catch (e) {
      if (e?.response?.status === 401) setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  const signedIn = useCallback((data) => {
    const { access_token: token, ...profile } = data;
    setToken(token);
    setUser(profile);
    return profile;
  }, []);

  // Google Identity Services hands us an ID token; the API verifies it with Google directly.
  const googleLogin = useCallback(async (credential) => signedIn((await api.post("/auth/google", { credential })).data), [signedIn]);
  const emailLogin = useCallback(async (email, password) => signedIn((await api.post("/auth/login", { email, password })).data), [signedIn]);
  const emailRegister = useCallback(async (name, email, password) => signedIn((await api.post("/auth/register", { name, email, password })).data), [signedIn]);

  const logout = useCallback(async () => {
    try { await api.post("/auth/logout"); } catch { /* offline: still sign out locally */ }
    setToken(null);
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
