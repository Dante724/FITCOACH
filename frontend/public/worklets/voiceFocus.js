// Voice focus — runs after the AI noise model. The models remove noise but keep *all* speech, so a vendor shouting
// outside, the TV or kids playing in the next room still come through. This stage keeps the voice nearest the
// microphone and turns down voices that are clearly further away, and stops sudden blasts (horns, cooker whistles,
// things dropping) from jumping above the speaker's own level.
//
// How: it learns how loud the person at the mic is (the nearest voice is much louder than anyone across the room or
// the street). Sound more than `range` dB below that is turned down smoothly (downward expander, up to `floor` dB),
// with a short hold so word endings aren't clipped and 10 ms of look-ahead so word starts aren't either. Anything
// more than `ceiling` dB above the speaker is limited. Until it has heard the speaker for a moment it lets
// everything through, so it never silences someone who has just started talking.
class VoiceFocus {
  constructor(sr = 48000, opts = {}) {
    this.range = opts.range ?? 10;
    this.ratio = opts.ratio ?? 3;
    this.floor = opts.floor ?? -30;
    this.ceiling = opts.ceiling ?? 12;
    this.holdFrames = opts.hold ?? 25;
    this.frame = Math.round(0.01 * sr);           // 10 ms analysis frames
    this.look = new Float32Array(Math.round(0.01 * sr)); // 10 ms look-ahead delay line
    this.li = 0;
    this.acc = 0; this.n = 0;
    this.fg = -50;           // the near speaker's level (dBFS), learned
    this.heard = 0;          // frames of the speaker heard so far
    this.sinceNear = 0;      // frames since something near the speaker's level
    this.blast = 0;          // consecutive frames far louder than the speaker
    this.hold = 0;
    this.target = 1;         // gate gain the smoother moves towards
    this.gain = 1;
    this.pow = 0; this.lim = 1;
    this.attack = 1 - Math.exp(-1 / (0.003 * sr));
    this.release = 1 - Math.exp(-1 / (0.12 * sr));
    this.powA = 1 - Math.exp(-1 / (0.005 * sr)); // 5 ms loudness for the blast guard
    this.limRel = 1 - Math.exp(-1 / (0.06 * sr));
    this.up = 1 - Math.exp(-0.01 / 0.25);         // speaker level rises over ~250 ms of louder sound
  }

  get learned() { return this.heard >= 60; } // ~0.6 s of speech

  frameDone(rms) {
    const L = 20 * Math.log10(rms + 1e-9);
    if (L > -60) {
      // Once learned, a sound far louder than the speaker is a blast (horn, whistle) and mustn't teach us a new level —
      // unless it lasts over 2 s (they really did move closer or start speaking up).
      const blast = this.learned && L > this.fg + this.ceiling;
      this.blast = blast ? this.blast + 1 : 0;
      if (L > this.fg && (!blast || this.blast > 200)) this.fg += (L - this.fg) * this.up;
      if (L > this.fg - 6) { this.sinceNear = 0; this.heard += 1; } else this.sinceNear += 1;
      if (this.sinceNear > 300) this.fg = Math.max(-50, this.fg - 0.02); // nobody near for 3 s: re-learn slowly (2 dB/s)
    }
    if (!this.learned) { this.target = 1; return; }
    const d = L - (this.fg - this.range);
    if (d >= 0) { this.hold = this.holdFrames; this.target = 1; return; }  // hold ~250 ms after the voice
    if (this.hold > 0) { this.hold -= 1; this.target = 1; return; }
    this.target = 10 ** (Math.max(this.floor, d * (this.ratio - 1)) / 20);
  }

  process(input, output) {
    const ceil = 10 ** ((this.fg + this.ceiling) / 20);
    for (let i = 0; i < input.length; i += 1) {
      const x = input[i];
      this.acc += x * x; this.n += 1;
      if (this.n === this.frame) { this.frameDone(Math.sqrt(this.acc / this.n)); this.acc = 0; this.n = 0; }
      // blast guard (only once we know how loud the speaker is): short-term loudness far above the speaker is limited
      this.pow += (x * x - this.pow) * this.powA;
      const lvl = Math.sqrt(this.pow);
      const want = this.learned && lvl > ceil ? ceil / lvl : 1;
      this.lim = want < this.lim ? want : this.lim + (want - this.lim) * this.limRel;
      this.gain += (this.target - this.gain) * (this.target > this.gain ? this.attack : this.release);
      const delayed = this.look[this.li];
      this.look[this.li] = x;
      this.li = (this.li + 1) % this.look.length;
      output[i] = delayed * this.gain * this.lim;
    }
  }
}

if (typeof registerProcessor === "function") {
  class VoiceFocusProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      this.vf = new VoiceFocus(sampleRate, options?.processorOptions || {});
      // the page sends new settings when the AI model in front of us changes
      this.port.onmessage = (e) => {
        const d = e.data || {};
        if (d.type !== "settings") return;
        if (d.range != null) this.vf.range = d.range;
        if (d.ratio != null) this.vf.ratio = d.ratio;
        if (d.hold != null) this.vf.holdFrames = d.hold;
      };
    }

    process(inputs, outputs) {
      const out = outputs[0]?.[0];
      if (!out) return true;
      const inp = inputs[0]?.[0];
      if (!inp) { out.fill(0); return true; }
      this.vf.process(inp, out);
      for (let c = 1; c < outputs[0].length; c += 1) outputs[0][c].set(out);
      return true;
    }
  }
  registerProcessor("voice-focus", VoiceFocusProcessor);
}
if (typeof module !== "undefined") module.exports = { VoiceFocus };
