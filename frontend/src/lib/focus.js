// Focus programmes and the distinct feature set each one unlocks.
export const FOCUS_OPTIONS = [
  {
    key: "strength",
    label: "Strength & Conditioning",
    tagline: "Build raw power, speed and athletic capacity.",
    accent: "var(--accent)",
    features: ["workouts", "progress", "bodyscan", "booking"],
  },
  {
    key: "nutrition",
    label: "Nutrition Plan",
    tagline: "Dial in your diet with AI-assisted food tracking.",
    accent: "var(--teal)",
    features: ["food", "progress", "booking"],
  },
  {
    key: "yoga",
    label: "Yoga",
    tagline: "Mobility, balance and mindful movement.",
    accent: "#7c6bd6",
    features: ["workouts", "progress", "booking"],
  },
  {
    key: "muscle_fat",
    label: "Muscle Building & Fat Loss",
    tagline: "Recomposition through training and nutrition.",
    accent: "var(--amber)",
    features: ["bodyscan", "food", "workouts", "progress", "booking"],
  },
];

export const FEATURE_META = {
  dashboard: { path: "/dashboard", label: "Overview", icon: "LayoutDashboard" },
  workouts: { path: "/workouts", label: "Workouts", icon: "Dumbbell" },
  booking: { path: "/booking", label: "Book Session", icon: "CalendarDays" },
  progress: { path: "/progress", label: "Progress", icon: "TrendingUp" },
  food: { path: "/food", label: "AI Food Track", icon: "Utensils" },
  bodyscan: { path: "/bodyscan", label: "AI Body Scan", icon: "ScanLine" },
  membership: { path: "/membership", label: "Membership", icon: "CreditCard" },
};

export function getFocus(key) {
  return FOCUS_OPTIONS.find((f) => f.key === key) || null;
}

// Ordered nav for a given focus: Overview first, then focus-specific features, then Membership.
export function navForFocus(key) {
  const focus = getFocus(key);
  const feats = focus ? focus.features : [];
  const items = ["dashboard", ...feats, "membership"];
  return items.map((f) => ({ feature: f, ...FEATURE_META[f] }));
}

export function focusAllowsPath(key, pathname) {
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/membership")) return true;
  const focus = getFocus(key);
  if (!focus) return false;
  return focus.features.some((f) => pathname.startsWith(FEATURE_META[f].path));
}

// Where a user should land after authenticating, based on role.
export function roleHome(user) {
  if (!user) return "/login";
  if (user.role === "admin") return "/admin";
  if (user.role === "trainer") return "/trainer";
  return user.focus ? "/dashboard" : "/focus";
}
