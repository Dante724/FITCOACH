// Clients in India and abroad (NRIs): time zones, units, money and ingredient swaps.
// Session times are stored in India time (the coaches' clock); everything is shown in the device's own time zone.
import foods from "../data/foods.json";

export const HOME_TZ = "Asia/Kolkata";

export function browserTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || HOME_TZ; } catch { return HOME_TZ; }
}

// Same clock as India right now (Asia/Kolkata, Asia/Calcutta, Asia/Colombo…) → show times the familiar way.
export function onIndiaTime(tz = browserTz()) {
  try {
    const at = new Date();
    const fmt = (z) => at.toLocaleString("en-GB", { timeZone: z, hour: "2-digit", minute: "2-digit", day: "2-digit" });
    return fmt(tz) === fmt(HOME_TZ);
  } catch { return true; }
}

const US = /^(America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Boise|Indiana|Kentucky|North_Dakota|Juneau|Sitka|Nome|Adak|Menominee|Metlakatla|Yakutat)|Pacific\/Honolulu|US\/)/;
const TZ_COUNTRY = [
  [/^Asia\/(Kolkata|Calcutta)$/, "IN"], [US, "US"],
  [/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|Regina|St_Johns|Montreal|Moncton|Whitehorse|Yellowknife)/, "CA"],
  [/^Europe\/London$/, "GB"], [/^Europe\/Dublin$/, "IE"], [/^Europe\/Berlin$/, "DE"], [/^Europe\/Amsterdam$/, "NL"],
  [/^Europe\/Paris$/, "FR"], [/^Europe\/Rome$/, "IT"], [/^Asia\/Dubai$/, "AE"], [/^Asia\/Riyadh$/, "SA"], [/^Asia\/Qatar$/, "QA"],
  [/^Asia\/Kuwait$/, "KW"], [/^Asia\/Muscat$/, "OM"], [/^Asia\/Bahrain$/, "BH"], [/^Australia\//, "AU"], [/^Pacific\/Auckland$/, "NZ"],
  [/^Asia\/Singapore$/, "SG"], [/^Asia\/Kuala_Lumpur$/, "MY"], [/^Africa\/Johannesburg$/, "ZA"],
];
export function guessCountry(tz = browserTz()) {
  for (const [re, code] of TZ_COUNTRY) if (re.test(tz)) return code;
  return "OTHER";
}

export const isAbroad = (user) => Boolean(user?.country && user.country !== "IN");

// ── session times ──
export function sessionStart(b) {
  if (b?.starts_at) return new Date(b.starts_at);
  return new Date(`${b.date}T${b.time}:00+05:30`); // stored in India time
}

// "18:00" in India; "Wed 9 Dec · 6:30 AM" elsewhere.
export function fmtSessionTime(b, { withDate = false } = {}) {
  if (!b?.date || !b?.time) return "";
  if (onIndiaTime()) return withDate ? `${b.date} · ${b.time}` : b.time;
  const d = sessionStart(b);
  const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return withDate ? `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · ${t}` : t;
}

// What a time zone is called in plain words: "New York", "London".
export const tzCity = (tz = browserTz()) => tz.split("/").pop().replace(/_/g, " ");

// The current time somewhere, e.g. for a coach checking a client's clock.
export function timeIn(tz, at = new Date()) {
  try { return at.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }); } catch { return ""; }
}

// ── units ──
export const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
export const isImperial = (user) => user?.units === "imperial" || (!user?.units && user?.country === "US");
export const weightUnit = (user) => (isImperial(user) ? "lb" : "kg");
export const lengthUnit = (user) => (isImperial(user) ? "in" : "cm");

export function fmtWeight(kg, user) {
  if (kg == null || kg === "") return "";
  return isImperial(user) ? `${round(kg / KG_PER_LB)} lb` : `${round(Number(kg))} kg`;
}
// For inputs: show in the person's unit, store in kg/cm.
export const fromKg = (kg, user) => (kg == null || kg === "" ? "" : isImperial(user) ? round(kg / KG_PER_LB) : kg);
export const toKg = (v, user) => (v == null || v === "" ? null : isImperial(user) ? round(Number(v) * KG_PER_LB, 2) : Number(v));
export const fromCm = (cm, user) => (cm == null || cm === "" ? "" : isImperial(user) ? round(cm / CM_PER_IN) : cm);
export const toCm = (v, user) => (v == null || v === "" ? null : isImperial(user) ? round(Number(v) * CM_PER_IN, 1) : Number(v));
export function fmtLength(cm, user) {
  if (cm == null || cm === "") return "";
  return isImperial(user) ? `${round(cm / CM_PER_IN)} in` : `${round(Number(cm))} cm`;
}
export function fmtHeight(cm, user) {
  if (!cm) return "";
  if (!isImperial(user)) return `${round(Number(cm), 0)} cm`;
  const inches = Math.round(cm / CM_PER_IN);
  return `${Math.floor(inches / 12)}′${inches % 12}″`;
}

// ── money ──
const SYMBOL = { INR: "₹", USD: "$", GBP: "£", EUR: "€", AED: "AED ", SAR: "SAR ", QAR: "QAR ", CAD: "C$", AUD: "A$", NZD: "NZ$", SGD: "S$" };
export function money(price) {
  if (!price) return "";
  const { amount, currency } = price;
  if (currency === "INR") return `₹${Math.round(amount).toLocaleString("en-IN")}`;
  const cents = Math.round(amount * 100) % 100 !== 0;
  return `${SYMBOL[currency] || `${currency} `}${Number(amount).toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 })}`;
}
export const inrPrice = (inr) => ({ amount: inr, currency: "INR" });

// ── food abroad ──
const SWAPS = foods.abroad_swaps || [];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Swaps for ingredients that appear in these texts (meal names, items…), each listed once.
export function swapsFor(texts) {
  const blob = ` ${texts.filter(Boolean).join(" ").toLowerCase()} `;
  const out = [];
  for (const sw of SWAPS) {
    const hit = sw.for.find((w) => new RegExp(`\\b${escape(w)}\\b`).test(blob));
    if (hit) out.push({ item: hit, swap: sw.swap, why: sw.why });
  }
  return out;
}
export const allSwaps = () => SWAPS;

// ── blood tests: US/India labs vs UK/Australia/Europe units → stored as %, ng/mL and pg/mL ──
export const LAB_UNITS = {
  hba1c: [["%", (v) => v], ["mmol/mol", (v) => v / 10.929 + 2.15]],
  vitamin_d: [["ng/mL", (v) => v], ["nmol/L", (v) => v / 2.496]],
  b12: [["pg/mL", (v) => v], ["pmol/L", (v) => v * 1.355]],
};
const SI_COUNTRIES = new Set(["GB", "IE", "AU", "NZ", "DE", "NL", "FR", "IT", "ZA"]);
export const labUnitIndex = (user) => (SI_COUNTRIES.has(user?.country) ? 1 : 0);
export function toLabStandard(field, value, unitIndex) {
  if (value === "" || value == null) return null;
  return Math.round(LAB_UNITS[field][unitIndex][1](Number(value)) * 10) / 10;
}
