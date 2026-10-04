// Yoga pose definitions and scoring from MediaPipe pose landmarks (33-point model).
// Everything here runs on the device — no video leaves the phone.

export const LM = {
  nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28,
};

// Joints we draw and score (skip face/hand/foot detail).
export const SKELETON = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
];
const KEY_POINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

const deg = (r) => (r * 180) / Math.PI;

export function angle(a, b, c) {
  const v1 = [a.x - b.x, a.y - b.y];
  const v2 = [c.x - b.x, c.y - b.y];
  const dot = v1[0] * v2[0] + v1[1] * v2[1];
  const n = Math.hypot(...v1) * Math.hypot(...v2) || 1;
  return deg(Math.acos(Math.max(-1, Math.min(1, dot / n))));
}

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// Degrees between the bottom→top vector and straight up.
const tiltFromVertical = (top, bottom) => deg(Math.atan2(Math.abs(top.x - bottom.x), Math.abs(bottom.y - top.y)));

// Build a geometry context in pixel space (so x and y share a scale) with left/right resolved.
function context(landmarks, width, height) {
  const p = (i) => ({ x: landmarks[i].x * width, y: landmarks[i].y * height, v: landmarks[i].visibility ?? 1 });
  const L = { shoulder: p(11), elbow: p(13), wrist: p(15), hip: p(23), knee: p(25), ankle: p(27) };
  const R = { shoulder: p(12), elbow: p(14), wrist: p(16), hip: p(24), knee: p(26), ankle: p(28) };
  const kneeL = angle(L.hip, L.knee, L.ankle), kneeR = angle(R.hip, R.knee, R.ankle);
  // "front" = the more bent leg (side-agnostic, works facing either way)
  const [front, back, kneeFront, kneeBack] = kneeL <= kneeR ? [L, R, kneeL, kneeR] : [R, L, kneeR, kneeL];
  const midShoulder = mid(L.shoulder, R.shoulder), midHip = mid(L.hip, R.hip);
  const avg = (f) => (f(L) + f(R)) / 2;
  return {
    L, R, front, back, kneeFront, kneeBack, midShoulder, midHip, avg,
    torsoLen: dist(midShoulder, midHip) || 1,
    legLen: (dist(front.hip, front.knee) + dist(front.knee, front.ankle)) || 1,
    visible: KEY_POINTS.every((i) => (landmarks[i].visibility ?? 1) > 0.45),
  };
}

const elbowAvg = (c) => c.avg((s) => angle(s.shoulder, s.elbow, s.wrist));
const kneeAvg = (c) => c.avg((s) => angle(s.hip, s.knee, s.ankle));
const hipAvg = (c) => c.avg((s) => angle(s.shoulder, s.hip, s.knee));
const shoulderAvg = (c) => c.avg((s) => angle(s.elbow, s.shoulder, s.hip));

// Each check: value(ctx) → number, ok range [min, max], tolerance for partial credit, cue when low / high.
export const POSES = {
  warrior2: {
    label: "Warrior II", sanskrit: "Virabhadrasana II", tip: "Face the camera with your legs wide, whole body in frame.",
    match: /warrior\s*(ii|2)|virabhadrasana\s*(ii|2)/i,
    checks: [
      { id: "front_knee", label: "Front knee bend", unit: "°", value: (c) => c.kneeFront, range: [80, 115], tol: 30, low: "Front knee is too deep — ease up a little", high: "Bend your front knee more, towards 90°" },
      { id: "back_leg", label: "Back leg straight", unit: "°", value: (c) => c.kneeBack, range: [158, 180], tol: 30, low: "Straighten your back leg" },
      { id: "arms_height", label: "Arms at shoulder height", unit: "°", value: shoulderAvg, range: [72, 110], tol: 30, low: "Lift your arms to shoulder height", high: "Lower your arms to shoulder height" },
      { id: "arms_straight", label: "Arms long", unit: "°", value: elbowAvg, range: [150, 180], tol: 30, low: "Reach through your fingertips — straighten your arms" },
      { id: "torso", label: "Torso upright", unit: "°", value: (c) => tiltFromVertical(c.midShoulder, c.midHip), range: [0, 15], tol: 20, high: "Keep your torso upright, stacked over your hips" },
      { id: "knee_ankle", label: "Knee over ankle", unit: "", value: (c) => Math.abs(c.front.knee.x - c.front.ankle.x) / c.legLen, range: [0, 0.18], tol: 0.2, high: "Stack your front knee over your ankle" },
    ],
  },
  tree: {
    label: "Tree", sanskrit: "Vrikshasana", tip: "Face the camera, whole body in frame.",
    match: /tree|vrikshasana|vrksasana/i,
    checks: [
      { id: "standing_leg", label: "Standing leg straight", unit: "°", value: (c) => c.kneeBack, range: [165, 180], tol: 25, low: "Straighten your standing leg" },
      { id: "lifted_leg", label: "Foot lifted", unit: "°", value: (c) => c.kneeFront, range: [0, 100], tol: 40, high: "Lift your foot higher — rest it on your calf or inner thigh" },
      { id: "hips_level", label: "Hips level", unit: "", value: (c) => Math.abs(c.L.hip.y - c.R.hip.y) / c.torsoLen, range: [0, 0.1], tol: 0.15, high: "Level your hips — don't sink into the standing hip" },
      { id: "torso", label: "Standing tall", unit: "°", value: (c) => tiltFromVertical(c.midShoulder, c.midHip), range: [0, 10], tol: 15, high: "Stand tall — keep your torso vertical" },
    ],
  },
  triangle: {
    label: "Triangle", sanskrit: "Trikonasana", tip: "Face the camera, whole body in frame.",
    match: /triangle|trikonasana/i,
    checks: [
      { id: "legs", label: "Legs straight", unit: "°", value: kneeAvg, range: [158, 180], tol: 30, low: "Keep both legs straight (micro-bend is fine)" },
      { id: "arms_straight", label: "Arms straight", unit: "°", value: elbowAvg, range: [150, 180], tol: 30, low: "Straighten your arms" },
      { id: "arm_line", label: "Arms in one line", unit: "°", value: (c) => angle(c.L.wrist, c.midShoulder, c.R.wrist), range: [155, 180], tol: 35, low: "Stack your arms in one straight line, top hand to the sky" },
      { id: "side_bend", label: "Side bend", unit: "°", value: (c) => tiltFromVertical(c.midShoulder, c.midHip), range: [35, 90], tol: 30, low: "Hinge further sideways over your front leg" },
    ],
  },
  downdog: {
    label: "Downward Dog", sanskrit: "Adho Mukha Svanasana", tip: "Side-on to the camera, whole body in frame.",
    match: /down(ward)?\s*(facing\s*)?dog|adho\s*mukha/i,
    checks: [
      { id: "hips", label: "Hips high (inverted V)", unit: "°", value: hipAvg, range: [45, 100], tol: 35, low: "Walk your hands forward a little", high: "Lift your hips higher to make an upside-down V" },
      { id: "arms", label: "Arms straight", unit: "°", value: elbowAvg, range: [155, 180], tol: 30, low: "Straighten your arms and press the floor away" },
      { id: "shoulders", label: "Shoulders open", unit: "°", value: shoulderAvg, range: [145, 180], tol: 35, low: "Draw your chest towards your thighs to open the shoulders" },
      { id: "legs", label: "Legs long", unit: "°", value: kneeAvg, range: [145, 180], tol: 35, low: "Lengthen your legs (soft knees are fine)" },
    ],
  },
  chair: {
    label: "Chair", sanskrit: "Utkatasana", tip: "Side-on to the camera, whole body in frame.",
    match: /chair|utkatasana/i,
    checks: [
      { id: "knees", label: "Knee bend", unit: "°", value: kneeAvg, range: [85, 135], tol: 30, low: "Don't sink too deep — keep knees around 90–120°", high: "Sit lower, as if into a chair" },
      { id: "arms", label: "Arms overhead", unit: "°", value: shoulderAvg, range: [145, 180], tol: 40, low: "Reach your arms up alongside your ears" },
      { id: "torso", label: "Chest lifted", unit: "°", value: (c) => tiltFromVertical(c.midShoulder, c.midHip), range: [0, 45], tol: 25, high: "Lift your chest — avoid folding forward" },
    ],
  },
  plank: {
    label: "Plank", sanskrit: "Phalakasana", tip: "Side-on to the camera, whole body in frame.",
    match: /plank|phalakasana/i,
    checks: [
      {
        id: "body_line", label: "Straight body line", unit: "°", value: (c) => c.avg((s) => angle(s.shoulder, s.hip, s.ankle)), range: [160, 180], tol: 30,
        low: (c) => {
          // hip below the shoulder→ankle line means sagging (y grows downward)
          const t = (c.midHip.x - c.midShoulder.x) / ((mid(c.L.ankle, c.R.ankle).x - c.midShoulder.x) || 1);
          const lineY = c.midShoulder.y + t * (mid(c.L.ankle, c.R.ankle).y - c.midShoulder.y);
          return c.midHip.y > lineY ? "Lift your hips — don't let them sag" : "Lower your hips into one straight line";
        },
      },
      { id: "arms", label: "Arms straight", unit: "°", value: elbowAvg, range: [155, 180], tol: 30, low: "Straighten your arms" },
      { id: "stack", label: "Shoulders over wrists", unit: "", value: (c) => c.avg((s) => Math.abs(s.shoulder.x - s.wrist.x) / (dist(s.shoulder, s.wrist) || 1)), range: [0, 0.3], tol: 0.3, high: "Stack your shoulders over your wrists" },
    ],
  },
  cobra: {
    label: "Cobra", sanskrit: "Bhujangasana", tip: "Side-on to the camera, whole body in frame.",
    match: /cobra|bhujangasana/i,
    checks: [
      { id: "lift", label: "Chest lift", unit: "°", value: hipAvg, range: [120, 168], tol: 30, low: "Don't over-arch — lower slightly and keep your hips down", high: "Lift your chest a little higher" },
      { id: "elbows", label: "Soft elbows", unit: "°", value: elbowAvg, range: [95, 172], tol: 30, low: "Press up a little more through your hands", high: "Keep a slight bend in your elbows" },
      { id: "legs", label: "Legs long", unit: "°", value: kneeAvg, range: [155, 180], tol: 30, low: "Keep your legs long and resting on the mat" },
    ],
  },
  bridge: {
    label: "Bridge", sanskrit: "Setu Bandhasana", tip: "Side-on to the camera, whole body in frame.",
    match: /bridge|setu\s*bandha/i,
    checks: [
      { id: "hips", label: "Hips lifted", unit: "°", value: hipAvg, range: [150, 180], tol: 35, low: "Lift your hips higher" },
      { id: "knees", label: "Feet placement", unit: "°", value: kneeAvg, range: [65, 110], tol: 30, low: "Move your feet slightly away from your hips", high: "Walk your feet closer to your hips" },
    ],
  },
};

export const POSE_KEYS = Object.keys(POSES);

// Map a pose name from a coach's yoga plan to a supported pose, if any.
export function matchPose(name) {
  return POSE_KEYS.find((k) => POSES[k].match.test(name || "")) || null;
}

function checkScore(v, [lo, hi], tol) {
  if (v >= lo && v <= hi) return 1;
  const d = v < lo ? lo - v : v - hi;
  return Math.max(0, 1 - d / tol);
}

// Score one frame. Returns null when the body isn't fully visible.
export function scoreFrame(poseKey, landmarks, width, height) {
  const def = POSES[poseKey];
  if (!def || !landmarks) return null;
  const c = context(landmarks, width, height);
  if (!c.visible) return { visible: false, score: 0, checks: [] };
  const checks = def.checks.map((ch) => {
    const value = ch.value(c);
    const ok = value >= ch.range[0] && value <= ch.range[1];
    let cue = null;
    if (!ok) {
      const which = value < ch.range[0] ? ch.low : ch.high;
      cue = typeof which === "function" ? which(c) : which || null;
    }
    return { id: ch.id, label: ch.label, value: Math.round(ch.unit === "°" ? value : value * 100) / (ch.unit === "°" ? 1 : 100), unit: ch.unit, ok, cue, s: checkScore(value, ch.range, ch.tol) };
  });
  const score = Math.round((checks.reduce((t, x) => t + x.s, 0) / checks.length) * 100);
  return { visible: true, score, checks };
}

// Combine frames from a capture: drop the worst quarter (moving into/out of the pose),
// score the rest, and flag checks that failed in most of the held frames.
export function summarize(poseKey, frames) {
  const seen = frames.filter((f) => f && f.visible);
  if (seen.length < 5) return null;
  const held = [...seen].sort((a, b) => b.score - a.score).slice(0, Math.max(5, Math.ceil(seen.length * 0.75)));
  const score = Math.round(held.reduce((t, f) => t + f.score, 0) / held.length);
  const checks = POSES[poseKey].checks.map((ch) => {
    const rows = held.map((f) => f.checks.find((x) => x.id === ch.id)).filter(Boolean);
    const passRate = rows.filter((r) => r.ok).length / (rows.length || 1);
    const cues = rows.filter((r) => r.cue).map((r) => r.cue);
    const cue = cues.sort((a, b) => cues.filter((x) => x === b).length - cues.filter((x) => x === a).length)[0] || null;
    const values = rows.map((r) => r.value).sort((a, b) => a - b);
    return { id: ch.id, label: ch.label, ok: passRate >= 0.5, value: values[Math.floor(values.length / 2)], unit: ch.unit, cue: passRate >= 0.5 ? null : cue };
  });
  return { score, checks, flags: checks.filter((c) => !c.ok && c.cue).map((c) => c.cue), frames: seen.length };
}
