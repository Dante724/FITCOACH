const PHOTO = (id) => `https://images.unsplash.com/${id}?crop=entropy&cs=srgb&fm=jpg&q=75&w=700`;

// Client goals and the feature set each one unlocks.
export const FOCUS_OPTIONS = [
  {
    key: "fat_loss",
    label: "Fat Loss",
    tagline: "Lose fat and keep your strength, with a coach-approved training and nutrition plan.",
    accent: "var(--accent)",
    icon: "Flame",
    img: PHOTO("photo-1644704170910-a0cdf183649b"),
    coaches: ["fitness"],
    features: ["workouts", "mealplan", "food", "progress", "booking", "messages"],
  },
  {
    key: "muscle_gain",
    label: "Muscle Gain",
    tagline: "Build lean muscle with progressive training and the right amount of food.",
    accent: "var(--amber)",
    icon: "Dumbbell",
    img: PHOTO("photo-1672344048213-76b6e77304bd"),
    coaches: ["fitness"],
    features: ["workouts", "mealplan", "food", "progress", "booking", "messages"],
  },
  {
    key: "yoga",
    label: "Yoga",
    tagline: "Mobility, balance and calm with a practice built for your body by a yoga coach.",
    accent: "#7c6bd6",
    icon: "Flower2",
    img: PHOTO("photo-1769416945759-4660fd121172"),
    coaches: ["yoga"],
    features: ["yoga", "posecheck", "progress", "booking", "messages"],
  },
  {
    key: "hybrid",
    label: "Fitness + Yoga",
    tagline: "A fitness coach and a yoga coach working on the same goal.",
    accent: "var(--teal)",
    icon: "Sparkles",
    img: PHOTO("photo-1637430308606-86576d8fef3c"),
    coaches: ["fitness", "yoga"],
    features: ["workouts", "yoga", "posecheck", "mealplan", "food", "progress", "booking", "messages"],
  },
];

// v1 programme keys → v2 goals (the backend migrates these too)
const LEGACY = { strength: "muscle_gain", muscle_fat: "fat_loss", nutrition: "fat_loss" };

export const FEATURE_META = {
  dashboard: { path: "/dashboard", label: "Today", icon: "LayoutDashboard" },
  workouts: { path: "/workouts", label: "My Training", icon: "Dumbbell" },
  yoga: { path: "/yoga", label: "My Yoga", icon: "Flower2" },
  posecheck: { path: "/pose-check", label: "Pose Check", icon: "ScanEye" },
  mealplan: { path: "/meal-plans", label: "My Nutrition", icon: "UtensilsCrossed" },
  food: { path: "/food", label: "Food Log", icon: "Utensils" },
  progress: { path: "/progress", label: "Progress", icon: "TrendingUp" },
  booking: { path: "/booking", label: "Book Session", icon: "CalendarDays" },
  messages: { path: "/messages", label: "Messages", icon: "MessageCircle" },
  library: { path: "/library", label: "Exercise Library", icon: "LibraryBig" },
  membership: { path: "/membership", label: "Membership", icon: "CreditCard" },
};

export const PLAN_LABEL = { workout: "Training plan", meal: "Nutrition plan", yoga: "Yoga practice" };
export const GOAL_LABEL = { fat_loss: "Fat loss", muscle_gain: "Muscle gain", yoga: "Yoga", hybrid: "Fitness + Yoga" };

export function getFocus(key) {
  const k = LEGACY[key] || key;
  return FOCUS_OPTIONS.find((f) => f.key === k) || null;
}

export function hasFeature(focusKey, feature) {
  return !!getFocus(focusKey)?.features.includes(feature);
}

// Ordered nav for a given goal: Today first, then goal-specific features, then Membership.
export function navForFocus(key) {
  const focus = getFocus(key);
  const feats = focus ? focus.features : [];
  const items = ["dashboard", ...feats, "library", "membership"];
  return items.map((f) => ({ feature: f, ...FEATURE_META[f] }));
}

export function focusAllowsPath(key, pathname) {
  if (["/dashboard", "/membership", "/profile", "/library"].some((p) => pathname.startsWith(p))) return true;
  const focus = getFocus(key);
  if (!focus) return false;
  return focus.features.some((f) => pathname.startsWith(FEATURE_META[f].path));
}

// Where a user should land after authenticating, based on role.
export function roleHome(user) {
  if (!user) return "/login";
  if (user.role === "admin") return "/admin";
  if (user.role === "trainer") return "/trainer";
  return getFocus(user.focus) ? "/dashboard" : "/focus";
}

// Link that opens the chat with a coach, optionally attaching what the question is about.
export function askCoachPath(coachId, context) {
  const q = new URLSearchParams({ coach: coachId || "" });
  if (context) {
    q.set("ctype", context.type);
    q.set("cid", context.id);
    q.set("clabel", context.label || "");
  }
  return `/messages?${q.toString()}`;
}

export function initials(name) {
  return (name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

export function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// YYYY-MM-DD in the viewer's local timezone (toISOString() would give the UTC date).
export function localDate(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
