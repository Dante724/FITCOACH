import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import Avatar from "@/components/Avatar";
import { api } from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import { getFocus, GOAL_LABEL } from "@/lib/focus";

const ROLES = ["client", "trainer", "admin"];
const PLAN_LABELS = { monthly: "Monthly", quarterly: "Quarterly", annual: "Annual" };
const FILTERS = [["all", "All"], ["needs", "Needs a coach"], ["client", "Clients"], ["trainer", "Coaches"], ["admin", "Admins"]];

function Stat({ icon: Icon, label, value, accent, delay }) {
  return (
    <div className="clay fade-up stat-card" style={{ padding: 20, animationDelay: `${delay}ms` }}>
      <div className="stat-icon" style={{ width: 40, height: 40, borderRadius: 12, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
        <Icon size={20} color={accent} />
      </div>
      <div className="display" style={{ fontSize: 26, fontWeight: 800 }}>{value}</div>
      <div style={{ fontSize: 12.5, color: "var(--text-3)", fontWeight: 600 }}>{label}</div>
    </div>
  );
}

function missingCoaches(u) {
  const need = getFocus(u.focus)?.coaches || [];
  return need.filter((t) => !u[`${t}_coach_id`]);
}

function AssignModal({ client, coaches, onClose, onSaved }) {
  const { push } = useToast();
  const [form, setForm] = useState({ fitness_coach_id: client.fitness_coach_id || "", yoga_coach_id: client.yoga_coach_id || "" });
  const [saving, setSaving] = useState(false);
  const need = getFocus(client.focus)?.coaches || [];

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/admin/users/${client.user_id}/coaches`, { fitness_coach_id: form.fitness_coach_id || null, yoga_coach_id: form.yoga_coach_id || null });
      push(`Coaches updated for ${client.name}.`, "success");
      onSaved();
    } catch (e) { push(e?.response?.data?.detail || "Could not assign coach.", "error"); } finally { setSaving(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="glass fade-up modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }} data-testid="assign-modal">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
          <h3 className="display" style={{ fontSize: 20, fontWeight: 700 }}>Assign coaches</h3>
          <button className="icon-btn" onClick={onClose}><Icons.X size={18} /></button>
        </div>
        <p style={{ fontSize: 13.5, color: "var(--text-2)", marginBottom: 18 }}>{client.name} · goal: {GOAL_LABEL[client.focus] || "not chosen yet"}</p>
        {["fitness", "yoga"].map((t) => (
          <div key={t} style={{ marginBottom: 16 }}>
            <label className="label">{t === "yoga" ? "Yoga coach" : "Fitness & nutrition coach"} {need.includes(t) ? <span className="chip chip-accent" style={{ padding: "2px 8px", fontSize: 10.5 }}>needed</span> : null}</label>
            <select className="field" data-testid={`assign-${t}`} value={form[`${t}_coach_id`]} onChange={(e) => setForm({ ...form, [`${t}_coach_id`]: e.target.value })}>
              <option value="">— None —</option>
              {coaches.filter((c) => c.coach_type === t).map((c) => (
                <option key={c.user_id} value={c.user_id}>{c.name} ({c.clients}/{c.max_clients} clients)</option>
              ))}
            </select>
          </div>
        ))}
        <button className="btn btn-primary" data-testid="assign-save" disabled={saving} onClick={save} style={{ width: "100%", padding: 13 }}>{saving ? "Saving..." : "Save"}</button>
      </div>
    </div>
  );
}

export default function AdminPanel() {
  const { push } = useToast();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [membershipFor, setMembershipFor] = useState(null);
  const [assignFor, setAssignFor] = useState(null);
  const [emailStatus, setEmailStatus] = useState(null);
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  const load = useCallback(() => {
    api.get("/admin/stats").then((r) => setStats(r.data)).catch(() => {});
    api.get("/admin/users").then((r) => setUsers(r.data)).catch(() => {});
    api.get("/admin/coaches").then((r) => setCoaches(r.data)).catch(() => {});
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

  const setCoachType = async (u, coach_type) => {
    try {
      await api.put(`/admin/users/${u.user_id}/coach-type`, { coach_type });
      push(`${u.name} is now a ${coach_type} coach.`, "success");
      load();
    } catch (e) { push(e?.response?.data?.detail || "Could not update coach type.", "error"); }
  };

  const setMembership = async (u, plan_id) => {
    try {
      await api.put(`/admin/users/${u.user_id}/membership`, { plan_id });
      push(plan_id ? `Granted ${PLAN_LABELS[plan_id]} to ${u.name}.` : `Revoked membership for ${u.name}.`, "success");
      setMembershipFor(null);
      load();
    } catch (e) { push(e?.response?.data?.detail || "Could not update membership.", "error"); }
  };

  const coachName = (id) => coaches.find((c) => c.user_id === id)?.name;
  const loadOf = (id) => coaches.find((c) => c.user_id === id);
  const filtered = users
    .filter((u) => filter === "all" || (filter === "needs" ? u.role === "client" && missingCoaches(u).length > 0 : u.role === filter))
    .filter((u) => `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(query.toLowerCase()));
  const memberActive = (u) => u.membership_expires_at && new Date(u.membership_expires_at) > new Date();

  return (
    <div>
      <PageHeader eyebrow="Administration" title="Admin Console" subtitle="Assign coaches, manage roles and control memberships." />

      <div className="grid-stats" style={{ marginBottom: 20 }}>
        <Stat icon={Icons.Users} label="Clients" value={stats?.clients ?? "—"} accent="var(--accent)" delay={0} />
        <Stat icon={Icons.UserRoundSearch} label="Need a coach" value={stats?.unassigned ?? "—"} accent="var(--accent)" delay={60} />
        <Stat icon={Icons.Dumbbell} label="Coaches" value={stats?.trainers ?? "—"} accent="var(--teal)" delay={120} />
        <Stat icon={Icons.BadgeCheck} label="Active members" value={stats?.active_members ?? "—"} accent="var(--amber)" delay={180} />
      </div>

      {stats?.unassigned > 0 && (
        <button className="clay-inset fade-up row" onClick={() => setFilter("needs")} style={{ width: "100%", border: "none", cursor: "pointer", padding: "14px 16px", marginBottom: 18, color: "var(--text)", textAlign: "left" }}>
          <Icons.TriangleAlert size={18} color="var(--accent)" />
          <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{stats.unassigned} client{stats.unassigned > 1 ? "s are" : " is"} waiting for a coach</span>
          <Icons.ChevronRight size={18} color="var(--text-3)" />
        </button>
      )}

      <div className="clay fade-up" style={{ padding: 20, marginBottom: 20 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Coach workload</div>
        <div className="grid-cards" style={{ gap: 10 }}>
          {coaches.map((c) => (
            <div key={c.user_id} className="clay-inset row" style={{ padding: "12px 14px" }}>
              <Avatar name={c.name} size={36} />
              <div className="min0" style={{ flex: 1 }}>
                <div className="truncate" style={{ fontSize: 13.5, fontWeight: 700 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: "var(--text-3)" }}>{c.coach_type === "yoga" ? "Yoga" : "Fitness"} · {c.clients}/{c.max_clients} clients</div>
                <div className="progress-track" style={{ height: 6, marginTop: 6 }}><div className="progress-fill" style={{ width: `${Math.min(100, (c.clients / c.max_clients) * 100)}%` }} /></div>
              </div>
            </div>
          ))}
          {coaches.length === 0 && <div style={{ fontSize: 13.5, color: "var(--text-3)" }}>No coaches yet. Change a user's role to "trainer" below.</div>}
        </div>
      </div>

      <div className="clay fade-up" style={{ padding: 20, marginBottom: 20 }}>
        <div className="row-wrap" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <div className="eyebrow">Users ({filtered.length})</div>
          <div style={{ position: "relative", flex: "0 1 280px", minWidth: 200 }}>
            <Icons.Search size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }} />
            <input className="field" data-testid="admin-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search users..." style={{ paddingLeft: 38 }} />
          </div>
        </div>
        <div className="tabs">
          {FILTERS.map(([id, label]) => <button key={id} className={`tab${filter === id ? " active" : ""}`} onClick={() => setFilter(id)} data-testid={`filter-${id}`}>{label}</button>)}
        </div>

        <div className="stack" data-testid="admin-users-list">
          {filtered.map((u) => {
            const missing = u.role === "client" ? missingCoaches(u) : [];
            const load = u.role === "trainer" ? loadOf(u.user_id) : null;
            return (
              <div key={u.user_id} data-testid={`user-row-${u.user_id}`} className="clay-inset" style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div className="row min0" style={{ flex: "1 1 220px" }}>
                  <Avatar name={u.name} picture={u.picture} size={36} />
                  <div className="min0">
                    <div className="truncate" style={{ fontSize: 14, fontWeight: 700 }}>{u.name}</div>
                    <div className="truncate" style={{ fontSize: 12, color: "var(--text-3)" }}>{u.email}</div>
                  </div>
                </div>

                {u.role === "client" && (
                  <div className="row-wrap" style={{ flex: "1 1 220px", gap: 6 }}>
                    <span className="chip chip-neutral">{GOAL_LABEL[u.focus] || "No goal yet"}</span>
                    {u.fitness_coach_id && <span className="chip chip-teal">Fitness: {coachName(u.fitness_coach_id) || "—"}</span>}
                    {u.yoga_coach_id && <span className="chip chip-violet">Yoga: {coachName(u.yoga_coach_id) || "—"}</span>}
                    {missing.map((t) => <span key={t} className="chip chip-accent">Needs {t} coach</span>)}
                    {memberActive(u) ? <span className="chip chip-teal">{PLAN_LABELS[u.membership_plan] || "Member"}</span> : <span className="chip chip-neutral">No membership</span>}
                  </div>
                )}
                {u.role === "trainer" && (
                  <div className="row-wrap" style={{ flex: "1 1 220px", gap: 6 }}>
                    <select className="field" data-testid={`coach-type-${u.user_id}`} value={u.coach_type || "fitness"} onChange={(e) => setCoachType(u, e.target.value)} style={{ padding: "8px 10px", fontSize: 13, width: 150 }}>
                      <option value="fitness">Fitness coach</option>
                      <option value="yoga">Yoga coach</option>
                    </select>
                    {load && <span className="chip chip-neutral">{load.clients} clients</span>}
                  </div>
                )}

                <div className="row" style={{ gap: 8, marginLeft: "auto" }}>
                  <select className="field" data-testid={`role-select-${u.user_id}`} value={u.role} onChange={(e) => setRole(u, e.target.value)} style={{ padding: "8px 10px", fontSize: 13, width: 110 }} aria-label="Role">
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  {u.role === "client" && (<>
                    <button className={missing.length ? "btn btn-primary" : "btn btn-ghost"} data-testid={`assign-${u.user_id}`} onClick={() => setAssignFor(u)} style={{ padding: "8px 12px", fontSize: 12.5 }}>
                      <Icons.UserPlus size={14} /> Coach
                    </button>
                    <button className="btn btn-ghost" data-testid={`manage-sub-${u.user_id}`} onClick={() => setMembershipFor(u)} style={{ padding: "8px 12px", fontSize: 12.5 }}>Plan</button>
                    <button className="icon-btn" title="Open client" onClick={() => navigate(`/admin/clients/${u.user_id}`)}><Icons.ChevronRight size={18} /></button>
                  </>)}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="empty">No users found.</div>}
        </div>
      </div>

      <div className="clay fade-up" data-testid="email-status-card" style={{ padding: 20 }}>
        <div className="row-wrap" style={{ justifyContent: "space-between", gap: 14 }}>
          <div className="row min0" style={{ flex: "1 1 260px" }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: emailStatus?.enabled ? "var(--teal-soft)" : "rgba(139,150,172,0.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icons.Mail size={20} color={emailStatus?.enabled ? "var(--teal)" : "var(--text-3)"} />
            </div>
            <div className="min0">
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>Email delivery (Gmail)</div>
              <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>
                {emailStatus?.enabled ? `Active · sending from ${emailStatus.from_address} · reminders ${emailStatus.reminder_hours_before}h before` : "Not configured — add GMAIL_ADDRESS and GMAIL_APP_PASSWORD to the backend, then restart."}
              </div>
            </div>
          </div>
          {emailStatus?.enabled ? (
            <div className="row-wrap" style={{ gap: 8 }}>
              <input className="field" data-testid="test-email-input" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="you@example.com" style={{ width: 200 }} />
              <button className="btn btn-primary" data-testid="send-test-email-btn" disabled={sendingTest} onClick={sendTest} style={{ padding: "11px 18px", fontSize: 13.5 }}>{sendingTest ? "Sending..." : "Send test"}</button>
            </div>
          ) : (
            <span className="chip chip-neutral">Awaiting credentials</span>
          )}
        </div>
      </div>

      {assignFor && <AssignModal client={assignFor} coaches={coaches} onClose={() => setAssignFor(null)} onSaved={() => { setAssignFor(null); load(); }} />}

      {membershipFor && (
        <div className="modal-backdrop" onClick={() => setMembershipFor(null)}>
          <div onClick={(e) => e.stopPropagation()} className="glass fade-up modal" data-testid="membership-modal" style={{ maxWidth: 420 }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
              <h3 className="display" style={{ fontSize: 20, fontWeight: 700 }}>Manage membership</h3>
              <button className="icon-btn" onClick={() => setMembershipFor(null)}><Icons.X size={18} /></button>
            </div>
            <p style={{ fontSize: 13.5, color: "var(--text-2)", marginBottom: 20 }}>{membershipFor.name} · {membershipFor.email}</p>
            <div className="stack">
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
