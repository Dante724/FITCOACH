// Copies the GTCRN and RNNoise noise-suppression worklets and WebAssembly files into public/noise so calls can load them
// from this app (no CDN). Runs automatically before `start` and `build`.
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "node_modules", "@sapphi-red", "web-noise-suppressor", "dist");
const OUT = path.join(__dirname, "..", "public", "noise");
fs.mkdirSync(OUT, { recursive: true });
for (const [from, to] of [["gtcrn/workletProcessor.js", "gtcrnWorklet.js"], ["gtcrn.wasm", "gtcrn.wasm"],
  ["rnnoise/workletProcessor.js", "rnnoiseWorklet.js"], ["rnnoise.wasm", "rnnoise.wasm"], ["rnnoise_simd.wasm", "rnnoise_simd.wasm"]]) {
  fs.copyFileSync(path.join(SRC, from), path.join(OUT, to));
}
console.log("noise suppression assets copied to public/noise");
