"""Writes an HTML page showing every preset (start → end) for eyeballing. python3 library_src/preview.py out.html"""
import json, sys
sys.path.insert(0, __file__.rsplit("/", 1)[0])
import poses as P
from figkit import pair
names = [n for n in dir(P) if n.isupper()]
figs = {n: pair(getattr(P, n), getattr(P, n), "front" if n.startswith("F_") else "side") for n in names}
L = [[1,3],[3,5],[2,4],[4,6],[7,9],[9,11],[8,10],[10,12],[1,2],[7,8]]
def svg(pts):
    neck = ((pts[1][0]+pts[2][0])/2, (pts[1][1]+pts[2][1])/2); pel = ((pts[7][0]+pts[8][0])/2, (pts[7][1]+pts[8][1])/2)
    lines = "".join(f'<line x1="{pts[a][0]}" y1="{pts[a][1]}" x2="{pts[b][0]}" y2="{pts[b][1]}"/>' for a, b in L)
    lines += f'<line x1="{neck[0]}" y1="{neck[1]}" x2="{pel[0]}" y2="{pel[1]}"/>'
    return f'<svg viewBox="0 0 100 100" width="120" height="120"><line x1="0" y1="93.5" x2="100" y2="93.5" stroke="#bbb"/><g stroke="#123" stroke-width="3" stroke-linecap="round">{lines}</g><circle cx="{pts[0][0]}" cy="{pts[0][1]}" r="5" fill="#123"/></svg>'
src = sys.argv[2] if len(sys.argv) > 2 else None
items = json.load(open(src)) if src else [{"name": n, "figure": f} for n, f in figs.items()]
cells = "".join(f'<div style="display:inline-block;margin:6px;text-align:center;font:11px sans-serif;border:1px solid #eee">{svg(e["figure"]["start"])}{svg(e["figure"]["end"])}<br>{e.get("id", e["name"])}</div>' for e in items)
open(sys.argv[1], "w").write(f"<!doctype html><body style='background:#fff'>{cells}</body>")
print(len(items))
