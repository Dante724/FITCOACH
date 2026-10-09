"""Helper for writing library entries compactly."""


def E(id, category, group, name, hindi, hinglish, muscles, equipment, level, dose, steps, mistakes, avoid, keywords, figure,
      aliases=(), benefits=(), sanskrit=None, pose_check=None):
    e = {"id": id, "category": category, "group": group, "name": name, "hindi": hindi, "hinglish": hinglish,
         "aliases": list(aliases), "muscles": list(muscles), "equipment": list(equipment), "level": level, "dose": dose,
         "steps": list(steps), "mistakes": list(mistakes), "avoid_if": list(avoid), "benefits": list(benefits),
         "keywords": list(keywords), "figure": figure}
    if sanskrit:
        e["sanskrit"] = sanskrit
    if pose_check:
        e["pose_check"] = pose_check
    return e
