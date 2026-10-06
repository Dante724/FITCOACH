import { fmtWeight, fromCm, fromKg, guessCountry, isImperial, money, sessionStart, swapsFor, toCm, toKg, toLabStandard, weightUnit } from "./locale";

describe("clients abroad", () => {
  const us = { country: "US" };
  const uk = { country: "GB" };
  const ukImperial = { country: "GB", units: "imperial" };

  test("guesses the country from the device's time zone", () => {
    expect(guessCountry("Asia/Kolkata")).toBe("IN");
    expect(guessCountry("America/New_York")).toBe("US");
    expect(guessCountry("America/Toronto")).toBe("CA");
    expect(guessCountry("Europe/London")).toBe("GB");
    expect(guessCountry("Asia/Dubai")).toBe("AE");
    expect(guessCountry("Australia/Sydney")).toBe("AU");
    expect(guessCountry("America/Sao_Paulo")).toBe("OTHER");
  });

  test("units follow the country unless chosen", () => {
    expect(isImperial(us)).toBe(true);
    expect(isImperial(uk)).toBe(false);
    expect(isImperial(ukImperial)).toBe(true);
    expect(isImperial({ country: "US", units: "metric" })).toBe(false);
    expect(weightUnit(us)).toBe("lb");
  });

  test("weights and lengths round-trip through the stored kg / cm", () => {
    expect(fmtWeight(70, us)).toBe("154.3 lb");
    expect(fmtWeight(70, uk)).toBe("70 kg");
    expect(toKg(154.3, us)).toBeCloseTo(69.99, 1);
    expect(fromKg(toKg(180, us), us)).toBe(180);
    expect(toCm(66, us)).toBe(167.6);
    expect(fromCm(167.6, us)).toBe(66);
    expect(toKg("", us)).toBeNull();
  });

  test("money in each currency", () => {
    expect(money({ amount: 15000, currency: "INR" })).toBe("₹15,000");
    expect(money({ amount: 49, currency: "USD" })).toBe("$49");
    expect(money({ amount: 39.5, currency: "GBP" })).toBe("£39.50");
    expect(money({ amount: 199, currency: "AED" })).toBe("AED 199");
  });

  test("session times are read as India time", () => {
    expect(sessionStart({ date: "2026-11-04", time: "18:30" }).toISOString()).toBe("2026-11-04T13:00:00.000Z");
    expect(sessionStart({ starts_at: "2026-11-04T13:00:00+00:00", date: "x", time: "y" }).toISOString()).toBe("2026-11-04T13:00:00.000Z");
  });

  test("swaps for what a plan uses, once each", () => {
    const s = swapsFor(["Methi thepla with dahi", "Paneer bhurji — 75 g", "Dal — 1 katori", "dahi"]);
    const items = s.map((x) => x.item);
    expect(items).toEqual(expect.arrayContaining(["methi", "paneer", "dahi", "dal"]));
    expect(new Set(items).size).toBe(items.length);
    expect(swapsFor(["Grilled chicken salad"])).toEqual([]);
  });

  test("blood tests in UK units convert to the standard ones", () => {
    expect(toLabStandard("hba1c", 42, 1)).toBe(6);        // 42 mmol/mol ≈ 6.0%
    expect(toLabStandard("vitamin_d", 50, 1)).toBe(20);   // 50 nmol/L ≈ 20 ng/mL
    expect(toLabStandard("b12", 200, 1)).toBe(271);       // 200 pmol/L ≈ 271 pg/mL
    expect(toLabStandard("hba1c", 6.1, 0)).toBe(6.1);
    expect(toLabStandard("b12", "", 0)).toBeNull();
  });
});
