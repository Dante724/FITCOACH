// Exercise & yoga library: home workouts, gym workouts and yoga poses with English, Hindi (Devanagari), Hinglish and
// Sanskrit names. Search works offline and understands Hinglish spellings ("baithak", "kamar dard", "chhati").
// Data: backend/library.json, copied to src/data/library.json by scripts/sync-foods.js (loaded on demand — it's big).

export const TABS = [
  { key: "home", label: "Home workouts", hindi: "घर पर", icon: "House" },
  { key: "gym", label: "Gym workouts", hindi: "जिम", icon: "Dumbbell" },
  { key: "yoga", label: "Yoga poses", hindi: "योग", icon: "Flower2" },
];
export const LEVEL_LABEL = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

let cache = null;
export function loadLibrary() {
  cache = cache || import("../data/library.json").then((m) => prepare(m.default || m));
  return cache;
}

// ── text matching ──
// Lowercase, strip accents/punctuation, and smooth common Hinglish spelling differences (aa→a, ee→i, oo→u, w→v,
// doubled consonants) so "kapaalbhaati" finds "kapalbhati" and "dand" finds "danda".
export function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[़]/g, "") // Devanagari nukta: ड़ = ड
    .replace(/[^a-z0-9ऀ-ॿ]+/g, " ")
    .replace(/aa/g, "a").replace(/ee/g, "i").replace(/oo/g, "u").replace(/w/g, "v")
    .replace(/([bcdfghjklmnpqrstvxz])\1/g, "$1")
    .replace(/\s+/g, " ").trim();
}

// Words that don't help find anything ("exercise for", "karne ki", "pose"…).
const STOP = new Set(["the", "a", "an", "for", "to", "of", "and", "with", "how", "do", "exercise", "exercises", "excercise", "workout",
  "ki", "ka", "ke", "ko", "se", "me", "mein", "liye", "karne", "kaise", "kare", "karen", "vala", "vali", "pose", "asana", "asan", "yoga", "yog",
  "की", "का", "के", "को", "से", "में", "लिए", "करने", "कैसे", "आसन", "योग", "व्यायाम", "एक्सरसाइज"]);

const tokens = (s) => norm(s).split(" ").filter((t) => t && !STOP.has(t));

function editDistanceAtMost1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i += 1; else if (b.length > a.length) j += 1; else { i += 1; j += 1; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// How well one search word matches one word of an entry: exact 1, prefix 0.85, typo 0.6.
function wordScore(q, w) {
  if (w === q) return 1;
  if (q.length >= 2 && w.startsWith(q)) return 0.85;
  if (q.length >= 4 && w.includes(q)) return 0.7;
  if (q.length >= 5 && editDistanceAtMost1(q, w)) return 0.6;
  return 0;
}

export function prepare(raw) {
  const entries = (Array.isArray(raw) ? raw : raw.entries || []).map((e) => {
    const fields = [
      [3, [e.name, e.hindi, e.hinglish, e.sanskrit, ...(e.aliases || [])]],
      [2, [...(e.keywords || []), ...(e.muscles || []), e.group]],
      [1, [...(e.equipment || []), ...(e.benefits || []), e.level]],
    ];
    // also index names typed without spaces/hyphens: "pushup", "uthakbaithak", "kamardard"
    const joined = (list) => list.filter(Boolean).flatMap((x) => String(x).split(",")).map((x) => norm(x).replace(/ /g, "")).filter((x) => x.length > 3);
    const words = fields.map(([weight, list]) => [weight, [...new Set([...list.flatMap((x) => tokens(x)), ...joined(list)])]]);
    const phrases = [e.name, e.hindi, e.hinglish, e.sanskrit, ...(e.aliases || []), ...(e.keywords || [])].filter(Boolean).map(norm);
    return { ...e, _words: words, _phrases: phrases };
  });
  const byName = new Map();
  for (const e of entries) {
    for (const n of [e.id, e.name, e.sanskrit, ...(e.aliases || [])]) if (n) byName.set(norm(n), e);
  }
  const byId = new Map(entries.map((e) => [e.id, e]));
  return { entries, byName, byId };
}

// Ranked results for a free-text search (English, Hindi, Hinglish or Sanskrit). Empty query → everything.
export function search(lib, query, { category, group } = {}) {
  let list = lib.entries;
  if (category) list = list.filter((e) => e.category === category);
  if (group) list = list.filter((e) => e.group === group);
  const qs = tokens(query);
  if (!qs.length) return list;
  const whole = norm(query);
  const scored = [];
  for (const e of list) {
    let total = 0, matched = 0;
    for (const q of qs) {
      let best = 0;
      for (const [weight, words] of e._words) {
        for (const w of words) {
          const s = wordScore(q, w) * weight;
          if (s > best) best = s;
        }
      }
      if (best > 0) { matched += 1; total += best; }
    }
    // most of the words must match (one stray word like "daily" is fine)
    if (matched === 0 || matched < Math.ceil(qs.length * 0.6)) continue;
    if (e._phrases.some((p) => p === whole)) total += 6;          // exact name / keyword phrase
    else if (e._phrases.some((p) => p.startsWith(whole))) total += 3;
    scored.push([total + matched, e]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map(([, e]) => e);
}

// The library entry for an exercise name used in a plan ("Push-up", "Tree (Vrikshasana)"), or null.
export function findByName(lib, name) {
  if (!lib || !name) return null;
  const n = norm(name);
  if (lib.byName.has(n)) return lib.byName.get(n);
  const inner = /\(([^)]+)\)/.exec(name); // "Tree (Vrikshasana)" → Vrikshasana
  if (inner && lib.byName.has(norm(inner[1]))) return lib.byName.get(norm(inner[1]));
  const outer = norm(name.replace(/\([^)]*\)/g, ""));
  return lib.byName.get(outer) || null;
}

export const groupsOf = (lib, category) => [...new Set(lib.entries.filter((e) => e.category === category).map((e) => e.group))];
