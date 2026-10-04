import { weekTiles } from "./week";

const base = { workouts: 0, streak: 0, targets_pct: null, targets_hit: 0, weight_change: null, checkins: 0, pose_checks: 0, meals: 0, focus: "fat_loss" };

test("never shows zeros", () => {
  const tiles = weekTiles({ ...base, workouts: 0, streak: 2, checkins: 2 });
  expect(tiles.map((t) => t.label)).toEqual(["day streak", "daily check-ins"]);
  expect(tiles.some((t) => t.value === "0")).toBe(false);
});

test("low target % falls back to a count", () => {
  expect(weekTiles({ ...base, targets_pct: 5, targets_hit: 1 })[0]).toEqual({ value: "1", label: "target ticked" });
  expect(weekTiles({ ...base, targets_pct: 80, targets_hit: 17 })[0]).toEqual({ value: "80%", label: "daily targets hit" });
});

test("weight only when it moved the right way for the goal", () => {
  expect(weekTiles({ ...base, weight_change: -0.6 }).map((t) => t.value)).toEqual(["−0.6 kg"]);
  expect(weekTiles({ ...base, weight_change: 0.6, streak: 1 }).map((t) => t.label)).toEqual(["day streak"]);
  expect(weekTiles({ ...base, focus: "muscle_gain", weight_change: 0.4 })[0].value).toBe("+0.4 kg");
});

test("caps at four tiles and has a friendly empty state", () => {
  expect(weekTiles({ ...base, workouts: 3, streak: 4, targets_pct: 90, weight_change: -1, checkins: 5, meals: 9 })).toHaveLength(4);
  expect(weekTiles(base)).toEqual([{ value: "Day 1", label: "of something new" }]);
});
