// Which numbers go on the shareable weekly card.
export function weekTiles(w) {
  // Only celebrate what went well — a share card shouldn't show zeros.
  const plural = (n, one, many) => (n === 1 ? one : many);
  const options = [
    w.workouts > 0 && { value: String(w.workouts), label: plural(w.workouts, "workout", "workouts") },
    w.streak > 0 && { value: String(w.streak), label: "day streak" },
    w.targets_pct >= 50 ? { value: `${w.targets_pct}%`, label: "daily targets hit" }
      : w.targets_hit > 0 && { value: String(w.targets_hit), label: plural(w.targets_hit, "target ticked", "targets ticked") },
    w.weight_change && ((w.focus === "fat_loss" && w.weight_change < 0) || (w.focus === "muscle_gain" && w.weight_change > 0)) &&
      { value: `${w.weight_change > 0 ? "+" : "−"}${Math.abs(w.weight_change)} kg`, label: "this week" },
    w.checkins > 0 && { value: `${w.checkins}/7`, label: "daily check-ins" },
    w.pose_checks > 0 && { value: String(w.pose_checks), label: plural(w.pose_checks, "pose check", "pose checks") },
    w.meals > 0 && { value: String(w.meals), label: plural(w.meals, "meal logged", "meals logged") },
  ].filter(Boolean).slice(0, 4);
  if (options.length === 0) options.push({ value: "Day 1", label: "of something new" });
  return options;
}
