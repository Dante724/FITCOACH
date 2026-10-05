import { fitWithin } from "./image";

test("photos are scaled to fit, never enlarged, keeping the shape", () => {
  expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
  expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
  expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  expect(fitWithin(512, 512, 512)).toEqual({ width: 512, height: 512 });
});
