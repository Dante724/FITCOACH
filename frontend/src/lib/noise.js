// AI noise removal for calls: RNNoise (a small neural network) runs on this device in an AudioWorklet and
// strips fans, traffic, kitchen and keyboard noise from the microphone before it's sent. Nothing leaves the phone.
// Files are served from /noise (copied by scripts/noise-assets.js).
import { RnnoiseWorkletNode, loadRnnoise } from "@sapphi-red/web-noise-suppressor";

export const NOISE_MODES = ["ai", "standard", "off"];
export const NOISE_LABEL = { ai: "AI noise removal", standard: "Basic noise filter", off: "Noise filter off" };

export function aiNoiseSupported() {
  return typeof window !== "undefined" && typeof window.AudioWorkletNode === "function" && typeof WebAssembly === "object"
    && typeof (window.AudioContext || window.webkitAudioContext) === "function";
}

// Browser-level processing to request from the microphone for each mode.
export const micConstraints = (mode) => ({
  echoCancellation: true,
  noiseSuppression: mode === "standard", // the AI model works best on the unfiltered signal
  autoGainControl: true,
  channelCount: 1,
});

let wasm = null;
const loadWasm = () => {
  wasm = wasm || loadRnnoise({ url: "/noise/rnnoise.wasm", simdUrl: "/noise/rnnoise_simd.wasm" }).catch((e) => { wasm = null; throw e; });
  return wasm;
};

// Wrap a raw microphone track; returns { track, stop } where `track` is the cleaned audio to send.
export async function createNoiseSuppressor(rawTrack) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ sampleRate: 48000 }); // RNNoise is trained for 48 kHz
  try {
    const [wasmBinary] = await Promise.all([loadWasm(), ctx.audioWorklet.addModule("/noise/rnnoiseWorklet.js")]);
    const source = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
    const node = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary });
    const dest = ctx.createMediaStreamDestination();
    source.connect(node);
    node.connect(dest);
    // Browsers may start audio suspended until the person interacts with the page.
    const resume = () => { if (ctx.state === "suspended") ctx.resume().catch(() => {}); };
    resume();
    document.addEventListener("pointerdown", resume, { once: true });
    const track = dest.stream.getAudioTracks()[0];
    return {
      track,
      stop() {
        document.removeEventListener("pointerdown", resume);
        try { source.disconnect(); node.disconnect(); node.destroy(); } catch { /* already closed */ }
        ctx.close().catch(() => {});
      },
    };
  } catch (e) {
    ctx.close().catch(() => {});
    throw e;
  }
}

// Get a microphone track for the given mode, cleaned by the AI model when mode is "ai".
// Falls back to the browser's basic filter if the AI model can't run on this device.
export async function getMic(mode) {
  const wantAi = mode === "ai" && aiNoiseSupported();
  const s = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(wantAi ? "ai" : mode === "ai" ? "standard" : mode) });
  const raw = s.getAudioTracks()[0];
  if (!wantAi) return { track: raw, raw, suppressor: null, mode: mode === "ai" ? "standard" : mode };
  try {
    const suppressor = await createNoiseSuppressor(raw);
    return { track: suppressor.track, raw, suppressor, mode: "ai" };
  } catch {
    raw.stop();
    const s2 = await navigator.mediaDevices.getUserMedia({ audio: micConstraints("standard") });
    const t = s2.getAudioTracks()[0];
    return { track: t, raw: t, suppressor: null, mode: "standard" };
  }
}
