import cases from "./nutrition.cases.json";
import { analyzeMeal, dailyTargets, pyRound, seqRatio } from "./nutrition";

// Fixtures come from the Python engine (backend/tests/test_engine.py), so these prove the app
// gives exactly the same answers offline as the server does online.
describe("offline food engine matches the server", () => {
  test.each(cases.meals.map((c) => [c.text, c.expected]))("%s", (text, expected) => {
    expect(analyzeMeal(text, cases.my_foods)).toEqual(expected);
  });
  test.each(cases.targets.map((c) => [c.focus, c]))("targets: %s", (_, c) => {
    expect(dailyTargets(c.intake, c.weight, c.focus)).toEqual(c.expected);
  });
});

test("python-style rounding and difflib ratio", () => {
  expect([pyRound(2.5), pyRound(3.5), pyRound(-2.5), pyRound(2.4)]).toEqual([2, 4, -2, 2]);
  expect(seqRatio("abcd", "bcde")).toBeCloseTo(0.75);
  expect(seqRatio("paneer", "paner")).toBeCloseTo(10 / 11);
});
