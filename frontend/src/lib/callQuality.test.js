import { networkVerdict, rateQuality } from "./callQuality";

test("connection quality from round-trip time and packet loss", () => {
  expect(rateQuality(0.05, 0)).toBe("good");
  expect(rateQuality(0.3, 0.01)).toBe("fair");
  expect(rateQuality(0.1, 0.05)).toBe("fair");
  expect(rateQuality(0.6, 0)).toBe("poor");
  expect(rateQuality(0.05, 0.12)).toBe("poor");
  expect(rateQuality(null, null)).toBe(null);
  expect(rateQuality(0.08, null)).toBe("good");
});

test("network verdicts", () => {
  expect(networkVerdict(["host", "srflx", "relay"], true).level).toBe("good");
  expect(networkVerdict(["host", "srflx"], false).title).toBe("Works on most networks");
  expect(networkVerdict(["host", "srflx"], true).title).toBe("Should work");
  expect(networkVerdict(["host"], false).level).toBe("poor");
});
