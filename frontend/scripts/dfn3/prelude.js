// DeepFilterNet3 AudioWorklet for FitCoach calls. Assembled by scripts/dfn3/build.sh from:
//   1. this prelude — small stand-ins for browser features that audio worklets don't have,
//   2. df.js — wasm-bindgen glue generated from the official DeepFilterNet source (see scripts/dfn3/BUILD.md),
//   3. processor.js — our real-time processor.
/* eslint-disable */
if (typeof globalThis.self === "undefined") globalThis.self = globalThis;
// Only used to seed hash tables inside the engine — not for anything secret.
if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = { getRandomValues(a) { for (let i = 0; i < a.length; i += 1) a[i] = (Math.random() * 256) | 0; return a; } };
}
if (typeof globalThis.TextDecoder === "undefined") {
  globalThis.TextDecoder = class { decode(b) { if (!b) return ""; let s = ""; for (let i = 0; i < b.length; i += 1) s += String.fromCharCode(b[i]); try { return decodeURIComponent(escape(s)); } catch { return s; } } };
}
