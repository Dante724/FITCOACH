// FitCoach's food intelligence, running entirely on the device — no server, no AI, works offline.
// This is an exact port of backend/engine.py (analyze_meal + targets) using the same food table
// (src/data/foods.json, copied from backend/food_data.json). Parity is checked by tests against
// fixtures generated from the Python engine, so a meal gets the same numbers online and offline.
import DATA from "../data/foods.json";

const F = DATA.foods;
const UNIT_WORDS = DATA.unit_words;
const WORD_NUM = DATA.word_numbers;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ── Python-compatible helpers ─────────────────────────
// Python's round(): halves go to the even neighbour.
export function pyRound(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : r;
}
const fmtG = (x, p) => String(parseFloat(x.toPrecision(p)));

// difflib.SequenceMatcher(None, a, b).ratio() for short strings (no junk heuristics apply under 200 chars).
export function seqRatio(a, b) {
  const b2j = {};
  for (let j = 0; j < b.length; j += 1) (b2j[b[j]] = b2j[b[j]] || []).push(j);
  const longest = (alo, ahi, blo, bhi) => {
    let besti = alo; let bestj = blo; let bestsize = 0;
    let j2len = {};
    for (let i = alo; i < ahi; i += 1) {
      const next = {};
      for (const j of b2j[a[i]] || []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len[j - 1] || 0) + 1;
        next[j] = k;
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = next;
    }
    return [besti, bestj, bestsize];
  };
  let matches = 0;
  const queue = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (k) {
      matches += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  const total = a.length + b.length;
  return total ? (2 * matches) / total : 1;
}

// difflib.get_close_matches(word, possibilities, n=1, cutoff): best score, ties → larger string.
function closest(word, possibilities, cutoff) {
  let best = null;
  for (const x of possibilities) {
    const r = seqRatio(x, word);
    if (r >= cutoff && (!best || r > best[0] || (r === best[0] && x > best[1]))) best = [r, x];
  }
  return best ? best[1] : null;
}

// ── Food table ────────────────────────────────────────
function aliasTable(table) {
  const out = [];
  for (const [key, f] of Object.entries(table)) out.push([f.name.toLowerCase(), key]);
  for (const [key, f] of Object.entries(table)) for (const a of f.aliases) if (a) out.push([a, key]);
  return out.sort((x, y) => y[0].length - x[0].length); // stable: longest phrase wins
}
const ALIASES = aliasTable(F);

export function customTable(foods) {
  const out = {};
  for (const f of foods || []) {
    out[`u_${f.id}`] = {
      name: f.name, unit: f.unit || "serving", grams: f.grams || 100, kcal: f.kcal, protein_g: f.protein_g || 0,
      carbs_g: f.carbs_g || 0, fat_g: f.fat_g || 0, tags: ["veg", "custom"],
      aliases: (f.aliases || []).map((a) => (a || "").trim().toLowerCase()).filter(Boolean),
    };
  }
  return out;
}

const TOKEN_RE = /\d+\/\d+|[a-z]+|\d+(?:\.\d+)?(?:grams|gms|gm|g|ml|kg)?|[½¼¾]/g;
const SPLIT_RE = /,|;|\n|\+|&|\band\b|\bwith\b|\baur\b/;
const QTY_UNIT_RE = /^(\d+(?:\.\d+)?)(grams|gms|gm|g|ml|kg)$/;
const VEG_SIDES = ["salad", "mixed_veg", "lauki", "cabbage", "palak", "bhindi", "sauteed_veg", "veg_soup", "sprouts", "fruit"];

function parseQty(tokens) {
  let qty = null; let unit = null; const rest = [];
  for (const t of tokens) {
    let m;
    if (qty === null && /^\d+(\.\d+)?$/.test(t)) qty = parseFloat(t);
    else if (qty === null && /^\d+\/\d+$/.test(t)) { const [n, d] = t.split("/").map(Number); qty = d ? n / d : null; }
    else if (qty === null && ["½", "¼", "¾"].includes(t)) qty = { "½": 0.5, "¼": 0.25, "¾": 0.75 }[t];
    else if (qty === null && has(WORD_NUM, t)) qty = WORD_NUM[t];
    else if ((m = QTY_UNIT_RE.exec(t))) { qty = parseFloat(m[1]); unit = UNIT_WORDS[m[2]]; }
    else if (has(UNIT_WORDS, t) && unit === null) unit = UNIT_WORDS[t];
    else rest.push(t);
  }
  return [qty, unit, rest];
}

function matchFood(text, aliases) {
  const keys = new Map();
  for (const [a, k] of aliases) keys.set(a, k);
  const padded = ` ${text} `;
  for (const [alias, key] of aliases) if (padded.includes(` ${alias} `)) return key;
  let c = closest(text, [...keys.keys()], 0.78);
  if (c) return keys.get(c);
  const single = [...keys.keys()].filter((a) => !a.includes(" "));
  for (const word of text.split(/\s+/).filter(Boolean)) {
    c = closest(word, single, 0.85);
    if (c) return keys.get(c);
  }
  return null;
}

// Estimate a meal from plain text, e.g. "2 roti, 1 katori dal and 100g paneer". Returns {} if nothing is recognised.
export function analyzeMeal(description, myFoods) {
  const extra = customTable(myFoods);
  const table = { ...F, ...extra };
  const aliases = Object.keys(extra).length
    ? [...aliasTable(extra), ...ALIASES].sort((x, y) => y[0].length - x[0].length)
    : ALIASES;
  const macros = (key, s) => { const f = table[key]; return [f.kcal * s, f.protein_g * s, f.carbs_g * s, f.fat_g * s]; };

  const text = description.toLowerCase().replace(/½/g, " ½ ").replace(/¼/g, " ¼ ").replace(/¾/g, " ¾ ");
  const parts = text.split(SPLIT_RE).map((p) => p.trim()).filter(Boolean);
  const found = []; const unknown = [];
  for (const part of parts) {
    const words = part.match(TOKEN_RE) || [];
    const taken = new Array(words.length).fill(false);
    const hits = [];
    for (const [alias, key] of aliases) {
      const a = alias.split(" ");
      for (let i = 0; i + a.length <= words.length; i += 1) {
        if (a.every((w, n) => words[i + n] === w) && !taken.slice(i, i + a.length).some(Boolean)) {
          hits.push([i, i + a.length, key]);
          for (let n = i; n < i + a.length; n += 1) taken[n] = true;
        }
      }
    }
    let hitsQ;
    if (!hits.length) {
      const [qty, unit, rest] = parseQty(words);
      const key = rest.length ? matchFood(rest.join(" "), aliases) : null;
      if (!key) { if (rest.length) unknown.push(part); continue; }
      hitsQ = [[key, qty, unit]];
    } else {
      hits.sort((x, y) => x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0));
      hitsQ = hits.map(([start, end, key], n) => {
        const prevEnd = n ? hits[n - 1][1] : 0;
        const nextStart = n + 1 < hits.length ? hits[n + 1][0] : words.length;
        let [qty, unit] = parseQty(words.slice(prevEnd, start));
        if (qty === null && unit === null) [qty, unit] = parseQty(words.slice(end, nextStart)); // "pizza 2 slices"
        return [key, qty, unit];
      });
    }
    const dish = (hitsQ.find(([k]) => k === "omelette" || k === "egg_bhurji") || [])[0];
    if (dish && hitsQ.some(([k]) => k === "egg")) { // "2 ande ka omelette" = one dish made of 2 eggs
      const eggs = hitsQ.find(([k]) => k === "egg")[1] || 2;
      hitsQ = hitsQ.filter(([k]) => k !== "egg").map(([k, q, u]) => [k, k === dish ? eggs / 2 : q, u]);
    }
    for (let [key, qty, unit] of hitsQ) {
      qty = qty === null ? 1 : qty;
      const f = table[key];
      let servings;
      if (unit === "g" || unit === "ml") servings = qty / f.grams;
      else if (unit === "kg" || unit === "l") servings = (qty * 1000) / f.grams;
      else servings = qty * (unit === "small" ? 0.75 : unit === "large" ? 1.3 : unit === "tbsp" && f.unit === "tsp" ? 3 : 1);
      found.push([key, Math.max(0.1, Math.min(servings, 20))]);
    }
  }
  if (!found.length) return {};
  let tot = [0, 0, 0, 0];
  const items = found.map(([key, s]) => {
    const vals = macros(key, s);
    tot = tot.map((v, i) => v + vals[i]);
    const q = s >= 1 ? fmtG(s, 6) : fmtG(s, 2);
    return `${table[key].name} × ${q} (${table[key].unit}) — ${pyRound(vals[0])} kcal`;
  });
  const [kcal, prot, carbs, fat] = tot;
  let score = 60;
  score += Math.min(20, (prot / Math.max(kcal, 1)) * 1000 * 0.25);
  score -= Math.max(0, (fat * 9) / Math.max(kcal, 1) - 0.35) * 100;
  score -= 15 * found.filter(([k]) => table[k].tags.includes("junk")).length;
  score += found.some(([k]) => VEG_SIDES.includes(k)) ? 8 : 0;
  const names = found.map(([k]) => table[k].name.split(" (")[0].split(" /")[0]);
  const mealName = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
  let notes = "Estimated from typical home-style portions.";
  if (unknown.length) notes += ` Couldn't recognise: ${unknown.join(", ")} — not counted. Try simpler names or add grams.`;
  return {
    meal_name: mealName.slice(0, 80), items, calories: pyRound(kcal), protein_g: pyRound(prot), carbs_g: pyRound(carbs),
    fat_g: pyRound(fat), health_score: Math.trunc(Math.max(10, Math.min(95, score))), notes, estimated_by: "food-table",
    unrecognised: unknown,
  };
}

// Daily calorie & macro targets (Mifflin–St Jeor × activity, adjusted for the goal) — same as the server.
export function dailyTargets(intake = {}, weight, focus) {
  const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  const age = num(intake.age, 30); const height = num(intake.height_cm, 165);
  const w = num(weight, null) ?? num(intake.weight_kg, 70);
  const days = Math.trunc(num(intake.days_per_week, 3));
  const base = 10 * w + 6.25 * height - 5 * age;
  const sex = (intake.sex || "").toLowerCase();
  const bmr = sex === "male" ? base + 5 : sex === "female" ? base - 161 : base - 78;
  const tdee = bmr * (days <= 2 ? 1.375 : days <= 4 ? 1.55 : 1.725);
  let kcal = focus === "fat_loss" ? Math.max(tdee * 0.8, sex === "male" ? 1500 : 1200) : focus === "muscle_gain" ? tdee * 1.1 : tdee;
  kcal = pyRound(kcal / 10) * 10;
  const bmi = w / ((height / 100) ** 2);
  const ref = bmi >= 30 ? num(intake.target_weight_kg, null) : null;
  const perKg = { fat_loss: 1.6, muscle_gain: 1.8 }[focus] || 1.2;
  const protein = pyRound(perKg * (ref || w));
  const fat = pyRound((kcal * 0.25) / 9);
  const carbs = Math.max(50, pyRound((kcal - protein * 4 - fat * 9) / 4));
  return { calories: kcal, protein_g: protein, fat_g: fat, carbs_g: carbs };
}

export const FOOD_COUNT = Object.keys(F).length;
