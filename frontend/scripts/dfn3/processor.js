
// ── FitCoach DeepFilterNet3 AudioWorklet processor ─────────────────────────────────────────────
// Appended to the wasm-bindgen glue above by scripts/dfn3/build.sh. Runs DFN3 on 10 ms frames.
// Messages to the page: READY, ERROR, and SLOW (this device can't keep up in real time → the page switches models).
class DeepFilterProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ok = false;
    try {
      const o = options.processorOptions;
      wasm_bindgen.initSync(o.wasmModule);
      this.st = wasm_bindgen.df_create(new Uint8Array(o.modelBytes), o.attenLimDb ?? 100);
      this.hop = wasm_bindgen.df_get_frame_length(this.st);
      const size = this.hop * 8;
      this.inBuf = new Float32Array(size); this.outBuf = new Float32Array(size); this.size = size;
      this.inW = 0; this.inR = 0; this.outW = 0; this.outR = 0;
      this.frame = new Float32Array(this.hop);
      this.started = false;
      this.slowFrames = 0; this.frames = 0;
      this.ok = true;
      this.port.postMessage({ type: "READY", hop: this.hop });
    } catch (e) {
      this.port.postMessage({ type: "ERROR", message: String(e) });
    }
  }

  avail(w, r) { return (w - r + this.size) % this.size; }

  process(inputs, outputs) {
    const out = outputs[0]?.[0];
    if (!out) return true;
    const inp = inputs[0]?.[0];
    if (!this.ok) { if (inp) out.set(inp); else out.fill(0); return true; }
    if (inp) for (let i = 0; i < inp.length; i += 1) { this.inBuf[this.inW] = inp[i]; this.inW = (this.inW + 1) % this.size; }
    while (this.avail(this.inW, this.inR) >= this.hop) {
      for (let i = 0; i < this.hop; i += 1) { this.frame[i] = this.inBuf[this.inR]; this.inR = (this.inR + 1) % this.size; }
      const t0 = Date.now();
      const y = wasm_bindgen.df_process_frame(this.st, this.frame);
      const ms = Date.now() - t0;
      for (let i = 0; i < y.length; i += 1) { this.outBuf[this.outW] = y[i]; this.outW = (this.outW + 1) % this.size; }
      // A 10 ms frame must be processed well within 10 ms. If over 7 ms for a quarter of frames in a 2 s window, give up.
      this.frames += 1;
      if (ms > 7) this.slowFrames += 1;
      if (this.frames === 200) {
        if (this.slowFrames > 50) this.port.postMessage({ type: "SLOW" });
        this.frames = 0; this.slowFrames = 0;
      }
    }
    // Start output once one frame is buffered, then stream steadily (fixed ~10 ms extra delay, no gaps).
    if (!this.started && this.avail(this.outW, this.outR) >= this.hop) this.started = true;
    if (this.started && this.avail(this.outW, this.outR) >= out.length) {
      for (let i = 0; i < out.length; i += 1) { out[i] = this.outBuf[this.outR]; this.outR = (this.outR + 1) % this.size; }
    } else {
      out.fill(0);
    }
    for (let c = 1; c < outputs[0].length; c += 1) outputs[0][c].set(out);
    return true;
  }
}
registerProcessor("deepfilter-dfn3", DeepFilterProcessor);
