import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { browserTz, isImperial, tzCity } from "@/lib/locale";
import HealthFlags from "@/components/HealthFlags";

// Profile → where you live: country (sets the currency you pay in), units, and the time zone sessions are shown in.
export default function LocaleCard() {
  const { user, setUser } = useAuth();
  const { push } = useToast();
  const [countries, setCountries] = useState([]);
  const [health, setHealth] = useState(null);
  useEffect(() => { api.get("/locale/options").then((r) => setCountries(r.data.countries)).catch(() => {}); }, []);
  useEffect(() => { if (user?.role === "client") api.get("/me/health").then((r) => setHealth(r.data.flags)).catch(() => {}); }, [user?.role, user?.country]);

  const save = async (patch) => {
    try {
      const { data } = await api.put("/me/locale", { country: user.country || "IN", timezone: browserTz(), ...patch });
      setUser((u) => ({ ...u, country: data.country, timezone: data.timezone, units: patch.units ?? u.units }));
      push("Saved.", "success");
    } catch (e) {
      push(e?.response?.data?.detail || "Could not save.", "error");
    }
  };
  const imperial = isImperial(user);
  const country = countries.find((c) => c.code === (user?.country || "IN"));

  return (
    <>
      <div className="clay" style={{ padding: 22 }} data-testid="locale-card">
        <div className="eyebrow" style={{ marginBottom: 12 }}>Where you live</div>
        <label className="label">Country</label>
        <select className="field" value={user?.country || "IN"} onChange={(e) => save({ country: e.target.value, units: countries.find((c) => c.code === e.target.value)?.units })} data-testid="locale-country">
          {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        {country && user?.role === "client" && (
          <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 6 }}>Prices are shown in {country.currency}{country.code !== "IN" ? " where a local price is set" : ""}.</div>
        )}
        <label className="label" style={{ marginTop: 14 }}>Units</label>
        <div className="row" style={{ gap: 8 }}>
          {[["metric", "kg · cm"], ["imperial", "lb · in"]].map(([u, label]) => (
            <button key={u} className={`pill${(imperial ? "imperial" : "metric") === u ? " on" : ""}`} onClick={() => save({ units: u })}
              aria-pressed={(imperial ? "imperial" : "metric") === u} data-testid={`units-${u}`}>{label}</button>
          ))}
        </div>
        <div className="row" style={{ gap: 8, marginTop: 14, fontSize: 13, color: "var(--text-2)" }}>
          <Icons.Clock size={15} /> Session times are shown in your time: <strong>{tzCity()}</strong>
        </div>
      </div>
      {health && <HealthFlags flags={health} />}
    </>
  );
}
