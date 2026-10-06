// Floating self-view on calls (like WhatsApp): drag it anywhere, it snaps to the nearest corner and stays there.
export const CORNERS = ["tl", "tr", "bl", "br"];
const KEY = "fc_pip_corner";

// Where a tile of size w×h sits in a corner of a stage W×H. Top corners stay clear of the call's top bar.
export function cornerPos(corner, W, H, w, h, { top = 76, side = 16, bottom = 16 } = {}) {
  const x = corner[1] === "l" ? side : Math.max(side, W - w - side);
  const y = corner[0] === "t" ? top : Math.max(top, H - h - bottom);
  return { x, y };
}

// The corner nearest to where the tile was dropped (judged by the tile's centre).
export function nearestCorner(x, y, W, H, w, h) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  return `${cy < H / 2 ? "t" : "b"}${cx < W / 2 ? "l" : "r"}`;
}

export const TAP_SLOP = 6; // px — less movement than this is a tap (swap views), not a drag

export function savedCorner() {
  try {
    const c = localStorage.getItem(KEY);
    return CORNERS.includes(c) ? c : "br";
  } catch {
    return "br";
  }
}

export function saveCorner(c) {
  try { localStorage.setItem(KEY, c); } catch { /* private mode */ }
}
