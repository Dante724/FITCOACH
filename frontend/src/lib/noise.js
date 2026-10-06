// AI noise removal for calls — always on. Runs on this device in an AudioWorklet; nothing leaves the phone.
//
// Model choice (measured on real speech + fan / hiss / clatter at 5 dB SNR, SI-SDR, higher is better):
//   GTCRN   11.2 / 15.4 / 15.8 dB, 20.2 dB on clean speech, ~32 ms delay  ← default
//   RNNoise  9.0 / 12.7 / 11.6 dB, 17.0 dB on clean speech, ~21 ms delay  ← low-end phones / if GTCRN can't load
// If neither can run, the browser's own noise filter is used so the call always has sound.
// After the model comes "voice focus" (public/worklets/voiceFocus.js): the models keep *all* speech, so it turns down
// voices clearly further from the mic than the speaker (vendors, TV, kids in the next room) and caps sudden blasts
// (horns, cooker whistles). Measured with the speaker quiet (listening) and a vendor shouting outside: background −4 dB
// with the model alone → −18 dB with voice focus; clean speech is barely touched (26.6 → 25.2 dB SI-SDR). It can't
// separate someone shouting right next to the phone (as loud as the speaker) — nothing on-device can yet.
// A rumble filter in front removes traffic/engine drone below 80 Hz.
// Files are served from /noise (copied from @sapphi-red/web-noise-suppressor by scripts/noise-assets.js).
import { GtcrnWorkletNode, RnnoiseWorkletNode, loadGtcrn, loadRnnoise } from "@sapphi-red/web-noise-suppressor";

export const MODEL_LABEL = { gtcrn: "AI noise removal · voice focus", rnnoise: "AI noise removal · voice focus", basic: "Basic noise filter" };
export const FOCUS = { range: 6, ratio: 4, hold: 25 }; // tuned on Indian street/home noise (see voiceFocus.js)

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

const MODELS = {
  gtcrn: { worklet: "/noise/gtcrnWorklet.js", load: () => loadGtcrn({ url: "/noise/gtcrn.wasm" }), Node: GtcrnWorkletNode },
  rnnoise: { worklet: "/noise/rnnoiseWorklet.js", load: () => loadRnnoise({ url: "/noise/rnnoise.wasm", simdUrl: "/noise/rnnoise_simd.wasm" }), Node: RnnoiseWorkletNode },
};
const wasm = {};
const loadWasm = (model) => {
  wasm[model] = wasm[model] || MODELS[model].load().catch((e) => { wasm[model] = null; throw e; });
  return wasm[model];
};

// Browsers can start audio "suspended" until the person taps the page (e.g. a call answered from a notification).
// Every audio context we create resumes on the first interaction, and the call screen offers a "tap to start audio" button.
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

// Wrap a raw microphone track with the given model; returns { track, stop } where `track` is the cleaned audio.
export async function createNoiseSuppressor(rawTrack, model) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ sampleRate: 48000 }); // both models run at 48 kHz
  const release = trackContext(ctx);
  try {
    const m = MODELS[model];
    const [wasmBinary] = await Promise.all([loadWasm(model), ctx.audioWorklet.addModule(m.worklet), ctx.audioWorklet.addModule("/worklets/voiceFocus.js")]);
    const source = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
    const rumble = ctx.createBiquadFilter();
    rumble.type = "highpass";
    rumble.frequency.value = 80;
    const node = new m.Node(ctx, { maxChannels: 1, wasmBinary });
    const focus = new AudioWorkletNode(ctx, "voice-focus", { outputChannelCount: [1], processorOptions: FOCUS });
    const dest = ctx.createMediaStreamDestination();
    source.connect(rumble);
    rumble.connect(node);
    node.connect(focus);
    focus.connect(dest);
    return {
      track: dest.stream.getAudioTracks()[0],
      stop() {
        try { source.disconnect(); rumble.disconnect(); node.disconnect(); focus.disconnect(); node.destroy(); } catch { /* already closed */ }
        release();
      },
    };
  } catch (e) {
    release();
    throw e;
  }
}

const constraints = (browserFilter) => ({
  echoCancellation: true,
  noiseSuppression: browserFilter, // the AI models work best on the unfiltered signal
  autoGainControl: true,
  channelCount: 1,
});

// A microphone track cleaned by the best model this device can run. Always on — there's no "off".
// Returns { track (to send), raw (the microphone), suppressor, model }.
export async function getMic() {
  const order = { gtcrn: ["gtcrn", "rnnoise"], rnnoise: ["rnnoise"], basic: [] }[preferredModel()];
  if (order.length) {
    const s = await navigator.mediaDevices.getUserMedia({ audio: constraints(false) });
    const raw = s.getAudioTracks()[0];
    for (const model of order) {
      try {
        const suppressor = await createNoiseSuppressor(raw, model);
        return { track: suppressor.track, raw, suppressor, model };
      } catch { /* try the next model */ }
    }
    raw.stop();
  }
  const s = await navigator.mediaDevices.getUserMedia({ audio: constraints(true) });
  const t = s.getAudioTracks()[0];
  return { track: t, raw: t, suppressor: null, model: "basic" };
}
