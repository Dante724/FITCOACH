import { useEffect, useState, useCallback } from "react";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useToast } from "@/context/ToastContext";

const ROLES = ["client", "trainer", "admin"];
const PLAN_LABELS = { monthly: "Monthly", quarterly: "Quarterly", annual: "Annual" };

function Stat({ icon: Icon, label, value, accent, delay }) {
  return (
    <div className="clay fade-up" style={{ padding: 22, animationDelay: `${delay}ms` }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, background: `${accent}1f`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
        <Icon size={20} color={accent} />
      </div>
      <div className="display" style={{ fontSize: 28, fontWeight: 800 }}>{value}</div>
      <div style={{ fontSize: 12.5, color: "var(--text-3)", fontWeight: 600 }}>{label}</div>
    </div>
  );
}

export default function AdminPanel() {
  const { push } = useToast();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState("");
  const [membershipFor, setMembershipFor] = useState(null);
  const [emailStatus, setEmailStatus] = useState(null);
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  const load = useCallback(() => {
    api.get("/admin/stats").then((r) => setStats(r.data)).catch(() => {});
    api.get("/admin/users").then((r) => setUsers(r.data)).catch(() => {});
    api.get("/admin/email/status").then((r) => setEmailStatus(r.data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const sendTest = async () => {
    if (!testEmail) { push("Enter an email address.", "error"); return; }
    setSendingTest(true);
    try {
      await api.post("/admin/email/test", { to: testEmail });
      push("Test email sent. Check the inbox.", "success");
    } catch (e) {
      push(e?.response?.data?.detail || "Could not send test email.", "error");
    } finally { setSendingTest(false); }
  };

  const setRole = async (u, role) => {
    try {
      await api.put(`/admin/users/${u.user_id}/role`, { role });
      push(`${u.name} is now ${role}.`, "success");
      load();
    } catch (e) { push(e?.response?.data?.detail || "Could not update role.", "error"); }
  };

  const setMembership = async (u, plan_id) => {
    try {
      await api.put(`/admin/users/${u.user_id}/membership`, { plan_id });
      push(plan_id ? `Granted ${PLAN_LABELS[plan_id]} to ${u.name}.` : `Revoked membership for ${u.name}.`, "success");
      setMembershipFor(null);
      load();
    } catch (e) { push(e?.response?.data?.detail || "Could not update membership.", "error"); }
  };

  const filtered = users.filter((u) => `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(query.toLowerCase()));
  const memberActive = (u) => u.membership_expires_at && new Date(u.membership_expires_at) > new Date();

  return (
    <div>
      <PageHeader eyebrow="Administration" title="Admin Console" subtitle="Manage members, assign trainers and control subscriptions." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 22 }}>
        <Stat icon={Icons.Users} label="Clients" value={stats?.clients ?? "—"} accent="var(--accent)" delay={0} />
        <Stat icon={Icons.Dumbbell} label="Trainers" value={stats?.trainers ?? "—"} accent="var(--teal)" delay={60} />
        <Stat icon={Icons.CalendarDays} label="Bookings" value={stats?.bookings ?? "—"} accent="#7c6bd6" delay={120} />
        <Stat icon={Icons.BadgeCheck} label="Active members" value={stats?.active_members ?? "—"} accent="var(--amber)" delay={180} />
      </div>

      <div className="clay fade-up" data-testid="email-status-card" style={{ padding: 22, marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: emailStatus?.enabled ? "var(--teal-soft)" : "rgba(139,150,172,0.14)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icons.Mail size={20} color={emailStatus?.enabled ? "var(--teal)" : "var(--text-3)"} />
            </div>
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>Email delivery (Gmail)</div>
              <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>
                {emailStatus?.enabled ? `Active · sending from ${emailStatus.from_address} · reminders ${emailStatus.reminder_hours_before}h before` : "Not configured — add GMAIL_ADDRESS and GMAIL_APP_PASSWORD to the backend, then restart."}
              </div>
            </div>
          </div>
          {emailStatus?.enabled ? (
            <div style={{ display: "flex", gap: 8 }}>
              <input className="field" data-testid="test-email-input" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="you@example.com" style={{ width: 200 }} />
              <button className="btn btn-primary" data-testid="send-test-email-btn" disabled={sendingTest} onClick={sendTest} style={{ padding: "11px 18px", fontSize: 13.5 }}>{sendingTest ? "Sending..." : "Send test"}</button>
            </div>
          ) : (
            <span className="chip chip-neutral">Awaiting credentials</span>
          )}
        </div>
      </div>

      <div className="clay fade-up" style={{ padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, gap: 14, flexWrap: "wrap" }}>
          <div className="eyebrow">All users ({users.length})</div>
          <div style={{ position: "relative", flex: "0 0 280px" }}>
            <Icons.Search size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }} />
            <input className="field" data-testid="admin-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search users..." style={{ paddingLeft: 38 }} />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="admin-users-list">
          {filtered.map((u) => (
            <div key={u.user_id} data-testid={`user-row-${u.user_id}`} className="clay-inset" style={{ padding: "14px 16px", display: "grid", gridTemplateColumns: "1fr 130px 160px 120px", alignItems: "center", gap: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{u.name}</div>
                <div style={{ fontSize: 12, color: "var(--text-3)" }}>{u.email}</div>
              </div>
              <select className="field" data-testid={`role-select-${u.user_id}`} value={u.role} onChange={(e) => setRole(u, e.target.value)} style={{ padding: "8px 10px", fontSize: 13 }}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <div>
                {u.role === "client" ? (
                  memberActive(u)
                    ? <span className="chip chip-teal">{PLAN_LABELS[u.membership_plan] || "Member"}</span>
                    : <span className="chip chip-neutral">No plan</span>
                ) : <span style={{ fontSize: 12, color: "var(--text-3)" }}>—</span>}
              </div>
              {u.role === "client" ? (
                <button className="btn btn-ghost" data-testid={`manage-sub-${u.user_id}`} onClick={() => setMembershipFor(u)} style={{ padding: "8px 12px", fontSize: 12.5 }}>Manage</button>
              ) : <span />}
            </div>
          ))}
          {filtered.length === 0 && <div style={{ textAlign: "center", padding: "30px 0", color: "var(--text-3)", fontSize: 14 }}>No users found.</div>}
        </div>
      </div>

      {membershipFor && (
        <div onClick={() => setMembershipFor(null)} style={{ position: "fixed", inset: 0, background: "rgba(27,33,48,0.45)", backdropFilter: "blur(6px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="glass fade-up" data-testid="membership-modal" style={{ width: "100%", maxWidth: 420, padding: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h3 className="display" style={{ fontSize: 20, fontWeight: 700 }}>Manage subscription</h3>
              <Icons.X size={20} style={{ cursor: "pointer", color: "var(--text-3)" }} onClick={() => setMembershipFor(null)} />
            </div>
            <p style={{ fontSize: 13.5, color: "var(--text-2)", marginBottom: 20 }}>{membershipFor.name} · {membershipFor.email}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {Object.entries(PLAN_LABELS).map(([id, label]) => (
                <button key={id} data-testid={`grant-${id}`} className="btn btn-ghost" onClick={() => setMembership(membershipFor, id)} style={{ justifyContent: "space-between", padding: "13px 16px" }}>
                  <span>Grant {label}</span><Icons.ChevronRight size={16} />
                </button>
              ))}
              <button data-testid="revoke-membership" className="btn" onClick={() => setMembership(membershipFor, null)} style={{ padding: "13px 16px", background: "var(--accent-soft)", color: "var(--accent)" }}>Revoke membership</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
