import { angle, scoreFrame, summarize, matchPose } from "./poses";

const W = 1000, H = 1000;

// Build a 33-point landmark array from pixel coords for the joints we use.
function skeleton(pts) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  Object.entries(pts).forEach(([i, [x, y]]) => { lm[i] = { x: x / W, y: y / H, visibility: 1 }; });
  return lm;
}

// Side view, facing right: left leg forward and bent 90°, right leg straight back, arms level.
const WARRIOR_GOOD = {
  11: [500, 300], 12: [500, 300], 13: [620, 300], 15: [740, 300], 14: [380, 300], 16: [260, 300],
  23: [500, 500], 24: [500, 500], 25: [650, 500], 27: [650, 650], 26: [380, 575], 28: [260, 650],
};

describe("angle", () => {
  it("measures a right angle", () => {
    expect(Math.round(angle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }))).toBe(90);
  });
});

describe("Warrior II", () => {
  it("scores a correct pose highly with no corrections", () => {
    const r = scoreFrame("warrior2", skeleton(WARRIOR_GOOD), W, H);
    expect(r.visible).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(95);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
  });

  it("flags a bent back leg and dropped arms", () => {
    const bad = { ...WARRIOR_GOOD, 26: [420, 620], 28: [260, 650], 13: [600, 400], 15: [680, 480], 14: [400, 400], 16: [320, 480] };
    const r = scoreFrame("warrior2", skeleton(bad), W, H);
    const cues = r.checks.filter((c) => !c.ok).map((c) => c.cue);
    expect(cues).toContain("Straighten your back leg");
    expect(cues).toContain("Lift your arms to shoulder height");
    expect(r.score).toBeLessThan(85);
  });

  it("asks for a deeper bend when the front knee is too straight", () => {
    const shallow = { ...WARRIOR_GOOD, 25: [610, 560], 27: [700, 650] };
    const r = scoreFrame("warrior2", skeleton(shallow), W, H);
    expect(r.checks.find((c) => c.id === "front_knee").cue).toBe("Bend your front knee more, towards 90°");
  });

  it("reports the body as not visible when key joints are hidden", () => {
    const lm = skeleton(WARRIOR_GOOD);
    lm[27].visibility = 0.1;
    expect(scoreFrame("warrior2", lm, W, H).visible).toBe(false);
  });
});

describe("Plank", () => {
  const PLANK = { 11: [300, 400], 12: [300, 400], 13: [300, 500], 14: [300, 500], 15: [300, 600], 16: [300, 600],
    23: [550, 420], 24: [550, 420], 25: [700, 430], 26: [700, 430], 27: [850, 440], 28: [850, 440] };
  it("passes a straight plank", () => {
    expect(scoreFrame("plank", skeleton(PLANK), W, H).checks.every((c) => c.ok)).toBe(true);
  });
  it("tells a sagging plank to lift the hips", () => {
    const sag = { ...PLANK, 23: [550, 520], 24: [550, 520] };
    const r = scoreFrame("plank", skeleton(sag), W, H);
    expect(r.checks.find((c) => c.id === "body_line").cue).toBe("Lift your hips — don't let them sag");
  });
  it("tells a piked plank to lower the hips", () => {
    const pike = { ...PLANK, 23: [550, 300], 24: [550, 300] };
    const r = scoreFrame("plank", skeleton(pike), W, H);
    expect(r.checks.find((c) => c.id === "body_line").cue).toBe("Lower your hips into one straight line");
  });
});

describe("summarize", () => {
  it("flags what was wrong for most of the hold, ignoring transition frames", () => {
    const good = scoreFrame("warrior2", skeleton(WARRIOR_GOOD), W, H);
    const bentBack = scoreFrame("warrior2", skeleton({ ...WARRIOR_GOOD, 26: [420, 620] }), W, H);
    const frames = [...Array(8).fill(bentBack), ...Array(4).fill(good), { visible: false, score: 0, checks: [] }];
    const s = summarize("warrior2", frames);
    expect(s.frames).toBe(12);
    expect(s.flags).toContain("Straighten your back leg");
  });
  it("does not flag a brief wobble in an otherwise good hold", () => {
    const good = scoreFrame("warrior2", skeleton(WARRIOR_GOOD), W, H);
    const bentBack = scoreFrame("warrior2", skeleton({ ...WARRIOR_GOOD, 26: [420, 620] }), W, H);
    const s = summarize("warrior2", [...Array(10).fill(good), ...Array(2).fill(bentBack)]);
    expect(s.flags).toEqual([]);
    expect(s.score).toBeGreaterThanOrEqual(95);
  });
  it("returns null when too few frames saw the body", () => {
    expect(summarize("warrior2", [{ visible: false }])).toBeNull();
  });
});

describe("matchPose", () => {
  it("maps plan names (English or Sanskrit) to supported poses", () => {
    expect(matchPose("Warrior II (Virabhadrasana II)")).toBe("warrior2");
    expect(matchPose("Downward Dog (Adho Mukha Svanasana)")).toBe("downdog");
    expect(matchPose("Vrikshasana")).toBe("tree");
    expect(matchPose("Seated Meditation")).toBeNull();
  });
});
