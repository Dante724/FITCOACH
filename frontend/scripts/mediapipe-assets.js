// Copies MediaPipe's WebAssembly runtime into public/ and fetches the pose model once, so Pose Check
// is served entirely from this app (no CDN at runtime). Runs automatically before `start` and `build`.
const fs = require("fs");
const path = require("path");
const https = require("https");

const OUT = path.join(__dirname, "..", "public", "mediapipe");
const WASM_SRC = path.join(__dirname, "..", "node_modules", "@mediapipe", "tasks-vision", "wasm");
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const MODEL_OUT = path.join(OUT, "pose_landmarker_lite.task");

fs.mkdirSync(path.join(OUT, "wasm"), { recursive: true });
for (const f of fs.readdirSync(WASM_SRC)) fs.copyFileSync(path.join(WASM_SRC, f), path.join(OUT, "wasm", f));

function download(url, dest, redirects = 3) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(download(res.headers.location, dest, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const tmp = `${dest}.part`;
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on("finish", () => file.close(() => { fs.renameSync(tmp, dest); resolve(); }));
      file.on("error", reject);
    }).on("error", reject);
  });
}

(async () => {
  if (fs.existsSync(MODEL_OUT) && fs.statSync(MODEL_OUT).size > 1_000_000) {
    console.log("[mediapipe] assets ready");
    return;
  }
  try {
    await download(MODEL_URL, MODEL_OUT);
    console.log(`[mediapipe] pose model saved (${(fs.statSync(MODEL_OUT).size / 1e6).toFixed(1)} MB)`);
  } catch (e) {
    // Don't fail the whole build; Pose Check will show a "couldn't start" message until the model is present.
    console.warn(`[mediapipe] could not download the pose model: ${e.message}`);
  }
})();
