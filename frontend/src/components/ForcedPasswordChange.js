import * as Icons from "lucide-react";
import Logo from "@/components/Logo";
import PasswordCard from "@/components/PasswordCard";
import { useAuth } from "@/context/AuthContext";

// Shown after someone signs in with a temporary password an admin gave them.
export default function ForcedPasswordChange() {
  const { user, setUser, logout } = useAuth();
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 16px", background: "var(--bg)" }}>
      <div className="fade-up" style={{ maxWidth: 480, width: "100%" }} data-testid="forced-password">
        <div style={{ marginBottom: 18 }}><Logo /></div>
        <h1 style={{ fontSize: 26, fontWeight: 400, marginBottom: 14 }}>Hi {user?.name?.split(" ")[0]}, choose your password</h1>
        <PasswordCard title="New password" forced onDone={() => setUser({ ...user, must_change_password: false })} />
        <button className="btn btn-ghost" onClick={logout} style={{ marginTop: 12 }}><Icons.LogOut size={15} /> Log out</button>
      </div>
    </div>
  );
}
