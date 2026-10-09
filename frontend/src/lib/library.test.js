import { findByName, norm, prepare, search } from "./library";

const fig = { view: "side", start: [], end: [] };
const lib = prepare([
  { id: "bodyweight_squat", category: "home", group: "Legs & glutes", name: "Bodyweight Squat", hindi: "स्क्वाट / उठक-बैठक", hinglish: "squat, baithak, uthak baithak",
    aliases: ["Bodyweight Squat", "Air squat"], muscles: ["quads", "glutes"], equipment: ["none"], level: "beginner",
    keywords: ["pair", "पैर", "jangh", "legs", "ghar par", "knee friendly"], figure: fig },
  { id: "push_up", category: "home", group: "Chest & arms", name: "Push-up", hindi: "पुश-अप", hinglish: "push up, dand",
    aliases: ["Push-up"], muscles: ["chest", "triceps"], equipment: ["none"], level: "beginner",
    keywords: ["chhati", "छाती", "seena", "chest", "upper body"], figure: fig },
  { id: "yoga_tree", category: "yoga", group: "Balance", name: "Tree Pose", hindi: "वृक्षासन", hinglish: "vrikshasana, vriksh asan", sanskrit: "Vrikshasana",
    aliases: ["Tree (Vrikshasana)"], muscles: ["calves", "core"], equipment: ["none"], level: "beginner",
    keywords: ["balance", "santulan", "focus"], benefits: ["Improves balance"], figure: fig },
  { id: "yoga_kapalbhati", category: "yoga", group: "Pranayama (breathing)", name: "Skull-shining Breath", hindi: "कपालभाति", hinglish: "kapalbhati, kapal bhati", sanskrit: "Kapalbhati",
    aliases: [], muscles: ["core"], equipment: ["mat"], level: "intermediate",
    keywords: ["pet", "belly fat", "pet ki charbi", "digestion"], figure: fig },
  { id: "cat_cow_back", category: "yoga", group: "Warm-up", name: "Cat-Cow", hindi: "मार्जरी आसन", hinglish: "marjariasana", sanskrit: "Marjaryasana-Bitilasana",
    aliases: ["Cat–Cow (Marjaryasana–Bitilasana)"], muscles: ["spine"], equipment: ["mat"], level: "beginner",
    keywords: ["kamar dard", "back pain", "कमर दर्द"], figure: fig },
]);
const ids = (q, opts) => search(lib, q, opts).map((e) => e.id);

describe("exercise library search", () => {
  test("English, Hinglish and Devanagari all find the same exercise", () => {
    expect(ids("squat")[0]).toBe("bodyweight_squat");
    expect(ids("baithak")[0]).toBe("bodyweight_squat");
    expect(ids("छाती")[0]).toBe("push_up");
    expect(ids("chhati ki exercise")[0]).toBe("push_up");
  });

  test("Hinglish spelling variations and small typos still match", () => {
    expect(ids("kapaalbhaati")[0]).toBe("yoga_kapalbhati");
    expect(ids("vrikshaasan")[0]).toBe("yoga_tree");
    expect(ids("pushup")).toContain("push_up");
    expect(ids("kapalbhti")).toContain("yoga_kapalbhati"); // one letter missing
  });

  test("problems and body parts find the right poses", () => {
    expect(ids("kamar dard")[0]).toBe("cat_cow_back");
    expect(ids("pet ki charbi kam karne ke liye")[0]).toBe("yoga_kapalbhati");
    expect(ids("कमर दर्द")[0]).toBe("cat_cow_back");
  });

  test("tab filter without a query lists everything in that tab", () => {
    expect(ids("", { category: "yoga" }).sort()).toEqual(["cat_cow_back", "yoga_kapalbhati", "yoga_tree"]);
    expect(ids("zzzz")).toEqual([]);
  });

  test("plan exercise names link to library entries", () => {
    expect(findByName(lib, "Bodyweight Squat").id).toBe("bodyweight_squat");
    expect(findByName(lib, "Tree (Vrikshasana)").id).toBe("yoga_tree");
    expect(findByName(lib, "Cat–Cow (Marjaryasana–Bitilasana)").id).toBe("cat_cow_back");
    expect(findByName(lib, "Kapalbhati").id).toBe("yoga_kapalbhati");
    expect(findByName(lib, "Unknown move")).toBeNull();
  });

  test("normalising", () => {
    expect(norm("Kapaal-Bhaati!")).toBe("kapal bhati");
    expect(norm("ताड़ासन")).toBe(norm("ताडासन"));
  });
});
