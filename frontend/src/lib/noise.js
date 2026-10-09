// AI noise removal for calls — always on. Runs on this device in AudioWorklets; nothing leaves the phone.
//
// Chain: microphone → rumble filter (cuts traffic/engine drone under 80 Hz) → AI model → voice focus → call.
//
// Models, tested on Indian street/home noise (traffic + horns, vendor shouting, kids, cooker whistle, TV):
//   DFN3 (DeepFilterNet3)  strongest: traffic 14.3 dB vs 10.5 (GTCRN), clean speech 30.9 vs 26.6 (SI-SDR, higher = better).
//                          ~2.5 MB engine + 8 MB model, downloaded once and kept on the device (built from the official
//                          source — see scripts/dfn3/BUILD.md). Needs a reasonably quick phone or laptop.
//   GTCRN                  starts instantly; used until DFN3 is ready, and on devices too slow for DFN3.
//   RNNoise                very low-end phones, or if GTCRN can't load.
//   basic                  the browser's own filter, if none of the above can run.
// Calls start on GTCRN straight away and switch to DFN3 seamlessly when it's loaded. If DFN3 can't keep up in real time
// the call switches back on its own and this device skips DFN3 from then on.
//
// Voice focus (public/worklets/voiceFocus.js): the models keep *all* speech, so it turns down voices clearly further from
// the mic than the speaker (vendor outside, TV, kids in the next room) and caps sudden blasts (horns, whistles). With the
// speaker quiet and a vendor shouting outside: −4 dB (GTCRN alone) → −18 dB (GTCRN + focus) → −31 dB (DFN3 + focus).
// Nothing on-device can separate someone shouting right next to the phone, as loud as the speaker.
import { GtcrnWorkletNode, RnnoiseWorkletNode, loadGtcrn, loadRnnoise } from "@sapphi-red/web-noise-suppressor";

export const MODEL_LABEL = {
  dfn3: "Studio noise removal · voice focus",
  gtcrn: "AI noise removal · voice focus",
  rnnoise: "AI noise removal · voice focus",
  basic: "Basic noise filter",
};
// Voice-focus settings per model (DFN3 already removes much of the distant speech, so it needs a gentler focus).
// Gentle on purpose: on phones the voice level swings a lot (distance, the phone's own volume control), and a strict
// gate clips the starts and ends of words. Hold 0.6 s keeps every word whole; at most −10 dB in longer pauses.
const GENTLE = { range: 14, ratio: 3, hold: 60, floor: -10 };
export const FOCUS = { dfn3: GENTLE, gtcrn: GENTLE, rnnoise: GENTLE };
export const isPhone = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");

export function aiNoiseSupported() {
  return typeof window !== "undefined" && typeof window.AudioWorkletNode === "function" && typeof WebAssembly === "object"
    && typeof (window.AudioContext || window.webkitAudioContext) === "function";
}

// GTCRN needs a little more processing; very low-end phones get the lighter RNNoise.
export function preferredModel() {
  if (!aiNoiseSupported()) return "basic";
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  return cores <= 2 || memory <= 2 ? "rnnoise" : "gtcrn";
}

const SLOW_KEY = "fc_dfn3_slow";
// Whether to try DFN3 here: needs 4+ cores and 3+ GB (when the browser says), and hasn't been too slow before.
export function dfn3Capable() {
  // Phones stay on GTCRN: DFN3 can fall behind on a phone's CPU (choppy sound, growing delay).
  if (isPhone() || preferredModel() !== "gtcrn" || typeof DecompressionStream !== "function") return false;
  try { if (localStorage.getItem(SLOW_KEY)) return false; } catch { /* private mode */ }
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  return cores >= 4 && memory >= 3;
}

const MODELS = {
  gtcrn: { worklet: "/noise/gtcrnWorklet.js", load: () => loadGtcrn({ url: "/noise/gtcrn.wasm" }), Node: GtcrnWorkletNode },
  rnnoise: { worklet: "/noise/rnnoiseWorklet.js", load: () => loadRnnoise({ url: "/noise/rnnoise.wasm", simdUrl: "/noise/rnnoise_simd.wasm" }), Node: RnnoiseWorkletNode },
};
const wasm = {};
const loadWasm = (model) => {
  wasm[model] = wasm[model] || MODELS[model].load().catch((e) => { wasm[model] = null; throw e; });
  return wasm[model];
};

// ── DFN3 files: downloaded once, kept in the browser's cache storage ──
export const DFN3 = { wasm: "/dfn3/df_bg.wasm.gz", model: "/dfn3/DeepFilterNet3_onnx.tar.gz", worklet: "/dfn3/dfn3Worklet.js", cache: "fc-dfn3-v1" };
const isGzip = (b) => b[0] === 0x1f && b[1] === 0x8b;
async function getBytes(url) {
  let res = null;
  let cache = null;
  try { cache = await caches.open(DFN3.cache); res = await cache.match(url); } catch { cache = null; }
  if (!res) {
    res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    if (cache) cache.put(url, res.clone()).catch(() => {});
  }
  return new Uint8Array(await res.arrayBuffer());
}
const gunzip = async (b) => new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
const gzip = async (b) => new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
let dfn3Files = null;
export function loadDfn3() {
  dfn3Files = dfn3Files || (async () => {
    const [w, m] = await Promise.all([getBytes(DFN3.wasm), getBytes(DFN3.model)]);
    // Some servers unzip files on the way; handle both.
    const module = await WebAssembly.compile(isGzip(w) ? await gunzip(w) : w);
    const model = isGzip(m) ? m : await gzip(m);
    return { module, modelBytes: model.buffer };
  })().catch((e) => { dfn3Files = null; throw e; });
  return dfn3Files;
}
// Start downloading in the background (e.g. on the call-check page) so the first call already has it.
export function prefetchDfn3() {
  if (dfn3Capable()) loadDfn3().catch(() => {});
}

// Browsers can start audio "suspended" until the person taps the page (e.g. a call answered from a notification).
// Every audio context we create resumes on the first interaction, and the call screen offers a "tap to turn on sound" button.
const contexts = new Set();
export function resumeAllAudio() {
  contexts.forEach((ctx) => { if (ctx.state === "suspended") ctx.resume().catch(() => {}); });
}
export const audioLocked = () => [...contexts].some((ctx) => ctx.state === "suspended");
if (typeof document !== "undefined") {
  ["pointerdown", "keydown", "touchend"].forEach((ev) => document.addEventListener(ev, resumeAllAudio, { capture: true }));
}
export function trackContext(ctx) {
  contexts.add(ctx);
  ctx.addEventListener?.("statechange", () => window.dispatchEvent(new CustomEvent("fc:audio-state")));
  ctx.resume?.().catch(() => {});
  return () => { contexts.delete(ctx); ctx.close().catch(() => {}); };
}

async function makeModelNode(ctx, model, onSlow) {
  if (model === "dfn3") {
    const [{ module, modelBytes }] = await Promise.all([loadDfn3(), ctx.audioWorklet.addModule(DFN3.worklet)]);
    const node = new AudioWorkletNode(ctx, "deepfilter-dfn3", {
      outputChannelCount: [1], processorOptions: { wasmModule: module, modelBytes, attenLimDb: 100 },
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("DFN3 didn't start")), 15000);
      node.port.onmessage = (e) => {
        if (e.data?.type === "READY") { clearTimeout(t); resolve(); }
        else if (e.data?.type === "ERROR") { clearTimeout(t); reject(new Error(e.data.message)); }
        else if (e.data?.type === "SLOW") onSlow?.();
      };
    });
    return { node, destroy() {} };
  }
  const m = MODELS[model];
  const [wasmBinary] = await Promise.all([loadWasm(model), ctx.audioWorklet.addModule(m.worklet)]);
  const node = new m.Node(ctx, { maxChannels: 1, wasmBinary });
  return { node, destroy() { try { node.destroy(); } catch { /* closed */ } } };
}

// Builds the cleaning chain for a raw microphone track. `use(model)` swaps the AI model while the call runs — the
// outgoing track stays the same, so the other person hears no interruption.
export async function createNoiseSuppressor(rawTrack, model, { onModel } = {}) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ sampleRate: 48000 }); // all models run at 48 kHz
  const release = trackContext(ctx);
  const source = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
  const rumble = ctx.createBiquadFilter();
  rumble.type = "highpass";
  rumble.frequency.value = 80;
  const dest = ctx.createMediaStreamDestination();
  let focus = null;
  let current = null; // { name, node, destroy }
  let stopped = false;
  source.connect(rumble);

  const chain = {
    track: dest.stream.getAudioTracks()[0],
    get model() { return current?.name || null; },
    async use(name) {
      const made = await makeModelNode(ctx, name, () => {
        // This device can't run DFN3 in real time: go back to GTCRN and don't try DFN3 here again.
        try { localStorage.setItem(SLOW_KEY, "1"); } catch { /* private mode */ }
        chain.use("gtcrn").catch(() => {});
      });
      if (stopped) { made.node.disconnect(); made.destroy(); return; }
      if (!focus) {
        await ctx.audioWorklet.addModule("/worklets/voiceFocus.js");
        focus = new AudioWorkletNode(ctx, "voice-focus", { outputChannelCount: [1], processorOptions: FOCUS[name] });
        // Leveller: evens out loud and soft speech, then lifts the voice ~5 dB so it isn't quiet on the other phone.
        const level = ctx.createDynamicsCompressor();
        level.threshold.value = -26;
        level.knee.value = 12;
        level.ratio.value = 3;
        level.attack.value = 0.004;
        level.release.value = 0.25;
        const makeup = ctx.createGain();
        makeup.gain.value = 1.8;
        focus.connect(level);
        level.connect(makeup);
        makeup.connect(dest);
      } else {
        focus.port.postMessage({ type: "settings", ...FOCUS[name] });
      }
      rumble.connect(made.node);
      made.node.connect(focus);
      if (current) { rumble.disconnect(current.node); current.node.disconnect(); current.destroy(); }
      current = { name, ...made };
      onModel?.(name);
    },
    stop() {
      stopped = true;
      try { source.disconnect(); rumble.disconnect(); current?.node.disconnect(); focus?.disconnect(); current?.destroy(); } catch { /* already closed */ }
      release();
    },
  };
  try {
    await chain.use(model);
  } catch (e) {
    chain.stop();
    throw e;
  }
  return chain;
}

const constraints = (browserFilter) => ({
  echoCancellation: true,
  noiseSuppression: browserFilter, // the AI models work best on the unfiltered signal
  autoGainControl: true,
  channelCount: 1,
});

// A microphone track cleaned by the best model this device can run. Always on — there's no "off".
// Returns { track (to send), raw (the microphone), suppressor, model }. `onModel(name)` is told when the model changes
// (e.g. GTCRN → DFN3 a few seconds in).
export async function getMic({ onModel } = {}) {
  const order = { gtcrn: ["gtcrn", "rnnoise"], rnnoise: ["rnnoise"], basic: [] }[preferredModel()];
  if (order.length) {
    const s = await navigator.mediaDevices.getUserMedia({ audio: constraints(false) });
    const raw = s.getAudioTracks()[0];
    for (const model of order) {
      try {
        const suppressor = await createNoiseSuppressor(raw, model, { onModel });
        if (model === "gtcrn" && dfn3Capable()) suppressor.use("dfn3").catch(() => {}); // upgrade in the background
        return { track: suppressor.track, raw, suppressor, model };
      } catch { /* try the next model */ }
    }
    raw.stop();
  }
  const s = await navigator.mediaDevices.getUserMedia({ audio: constraints(true) });
  const t = s.getAudioTracks()[0];
  return { track: t, raw: t, suppressor: null, model: "basic" };
}
