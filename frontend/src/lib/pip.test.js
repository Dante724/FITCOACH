import { cornerPos, nearestCorner, savedCorner, saveCorner } from "./pip";

const { VoiceFocus } = require("../../public/worklets/voiceFocus.js");

describe("floating self-view", () => {
  const W = 1000, H = 700, w = 200, h = 260;

  test("each corner sits inside the stage, top corners below the top bar", () => {
    expect(cornerPos("tl", W, H, w, h)).toEqual({ x: 16, y: 76 });
    expect(cornerPos("tr", W, H, w, h)).toEqual({ x: 784, y: 76 });
    expect(cornerPos("bl", W, H, w, h)).toEqual({ x: 16, y: 424 });
    expect(cornerPos("br", W, H, w, h)).toEqual({ x: 784, y: 424 });
  });

  test("a tiny stage never pushes the tile off the top or left", () => {
    expect(cornerPos("br", 150, 200, w, h)).toEqual({ x: 16, y: 76 });
  });

  test("dropping snaps to the nearest corner", () => {
    expect(nearestCorner(30, 40, W, H, w, h)).toBe("tl");
    expect(nearestCorner(700, 60, W, H, w, h)).toBe("tr");
    expect(nearestCorner(100, 500, W, H, w, h)).toBe("bl");
    expect(nearestCorner(420, 300, W, H, w, h)).toBe("br"); // centre (520, 430) is right of and below the middle
  });

  test("the chosen corner is remembered", () => {
    localStorage.clear();
    expect(savedCorner()).toBe("br");
    saveCorner("tl");
    expect(savedCorner()).toBe("tl");
    localStorage.setItem("fc_pip_corner", "middle");
    expect(savedCorner()).toBe("br");
  });
});

describe("voice focus", () => {
  const SR = 48000;
  const tone = (secs, amp, f = 220) => Float32Array.from({ length: Math.round(secs * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / SR));
  const run = (vf, x) => { const y = new Float32Array(x.length); for (let i = 0; i < x.length; i += 128) vf.process(x.subarray(i, i + 128), y.subarray(i, i + 128)); return y; };
  const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i += 1) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
  const db = (r) => 20 * Math.log10(r);

  test("lets everything through until it has heard the speaker", () => {
    const vf = new VoiceFocus(SR);
    const quiet = tone(0.3, 0.01);
    const y = run(vf, quiet);
    expect(db(rms(y, SR * 0.05) / rms(quiet, 0, quiet.length - SR * 0.05))).toBeGreaterThan(-0.5);
  });

  const GENTLE = { range: 14, ratio: 3, hold: 60, floor: -10 }; // what calls use (lib/noise.js)

  test("softens a much quieter voice once the speaker has paused for a while", () => {
    const vf = new VoiceFocus(SR, GENTLE);
    run(vf, tone(2, 0.1));                       // the speaker (−23 dBFS)
    const far = tone(2, 0.01, 330);              // someone 20 dB quieter
    const y = run(vf, far);
    const cut = db(rms(y, SR) / rms(far, SR));
    expect(cut).toBeLessThan(-8);
    expect(cut).toBeGreaterThan(-11);            // never more than ~10 dB — background is softened, not muted
  });

  test("never clips quiet word endings or short gaps between words", () => {
    const vf = new VoiceFocus(SR, GENTLE);
    run(vf, tone(1.5, 0.1));                     // talking
    const tail = tone(0.5, 0.012, 300);          // a soft word ending / short pause, 18 dB down
    const y = run(vf, tail);
    expect(db(rms(y, 960) / rms(tail, 960))).toBeGreaterThan(-1);   // within the 0.6 s hold: untouched
  });

  test("keeps the speaker's own voice untouched", () => {
    const vf = new VoiceFocus(SR, GENTLE);
    const near = tone(3, 0.1);
    const y = run(vf, near);
    expect(Math.abs(db(rms(y, SR) / rms(near, SR)))).toBeLessThan(0.5);
  });

  test("caps a sudden blast far louder than the speaker", () => {
    const vf = new VoiceFocus(SR);
    run(vf, tone(2, 0.05));                      // speaker ~−29 dBFS
    const horn = tone(0.5, 0.9, 420);            // horn ~25 dB louder
    const y = run(vf, horn);
    expect(db(rms(y, SR * 0.1) / rms(horn, SR * 0.1))).toBeLessThan(-10);
  });
});
