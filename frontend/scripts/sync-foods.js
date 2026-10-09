// Copies the shared food table from the backend into the app so offline estimates use the same data.
// Runs before start/build; if the backend folder isn't there (e.g. a frontend-only checkout) the committed copy is used.
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "..", "backend", "food_data.json");
const dest = path.join(__dirname, "..", "src", "data", "foods.json");
if (fs.existsSync(src)) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log("food table synced from backend/food_data.json");
} else {
  console.log("backend/food_data.json not found — using the committed src/data/foods.json");
}

// The exercise & yoga library is shared the same way (backend/library.json → src/data/library.json).
const libSrc = path.join(__dirname, "..", "..", "backend", "library.json");
const libDest = path.join(__dirname, "..", "src", "data", "library.json");
if (fs.existsSync(libSrc)) {
  fs.copyFileSync(libSrc, libDest);
  console.log("exercise library synced from backend/library.json");
}
