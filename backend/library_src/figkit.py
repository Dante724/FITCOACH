"""
Stick figures for the exercise library, built from joint angles so limb lengths are always right.

Joints (output order): 0 head, 1 L shoulder, 2 R shoulder, 3 L elbow, 4 R elbow, 5 L wrist, 6 R wrist, 7 L hip, 8 R hip,
9 L knee, 10 R knee, 11 L ankle, 12 R ankle. Box 0–100, x right, y down, floor at y = 92.

Angles are in degrees, measured from straight DOWN, turning towards +x (the way the figure faces in side view):
0 = down, 90 = forward (+x), 180 = up, -90 = backward. Each limb is (upper, lower) — absolute angles, not relative.
"""
import math

UPPER_ARM, FOREARM, THIGH, SHIN, TORSO, NECK = 14, 13, 19, 19, 26, 9
FLOOR = 92


def _v(angle, length):
    a = math.radians(angle)
    return (math.sin(a) * length, math.cos(a) * length)


def _add(p, d):
    return (p[0] + d[0], p[1] + d[1])


def figure(torso=180, head=None, la=(0, 0), ra=None, ll=(0, 0), rl=None, view="side", spread=0, arm_spread=0):
    """Build one pose. torso: angle from hips to shoulders (180 = upright). head: angle from neck to head (default =
    torso). la/ra: left/right arm (upper, lower). ll/rl: left/right leg (thigh, shin). In front view, `spread` widens the
    stance and the limb angles are mirrored for the right side (so 30 means "out to the side" for both)."""
    ra = ra if ra is not None else la
    rl = rl if rl is not None else ll
    head = torso if head is None else head
    pelvis = (50.0, 50.0)
    neck = _add(pelvis, _v(torso, TORSO))
    headp = _add(neck, _v(head, NECK))
    if view == "front":
        # shoulders/hips sit across the body; right side mirrors the angles
        perp = _v(torso + 90, 1)
        # "left" joints on the -x side, "right" on +x (perp points to -x when upright)
        ls, rs = _add(neck, (perp[0] * 7, perp[1] * 7)), _add(neck, (-perp[0] * 7, -perp[1] * 7))
        lh, rh = _add(pelvis, (perp[0] * (5 + spread), perp[1] * (5 + spread))), _add(pelvis, (-perp[0] * (5 + spread), -perp[1] * (5 + spread)))
        mir = lambda a: -a  # noqa: E731
        le = _add(ls, _v(mir(la[0]), UPPER_ARM)); lw = _add(le, _v(mir(la[1]), FOREARM))
        re = _add(rs, _v(ra[0], UPPER_ARM)); rw = _add(re, _v(ra[1], FOREARM))
        lk = _add(lh, _v(mir(ll[0]), THIGH)); lan = _add(lk, _v(mir(ll[1]), SHIN))
        rk = _add(rh, _v(rl[0], THIGH)); ran = _add(rk, _v(rl[1], SHIN))
    else:
        ls, rs = _add(neck, (0.8, 0)), _add(neck, (-0.8, 0))
        lh, rh = _add(pelvis, (0.8, 0)), _add(pelvis, (-0.8, 0))
        le = _add(ls, _v(la[0], UPPER_ARM)); lw = _add(le, _v(la[1], FOREARM))
        re = _add(rs, _v(ra[0], UPPER_ARM)); rw = _add(re, _v(ra[1], FOREARM))
        lk = _add(lh, _v(ll[0], THIGH)); lan = _add(lk, _v(ll[1], SHIN))
        rk = _add(rh, _v(rl[0], THIGH)); ran = _add(rk, _v(rl[1], SHIN))
    return [headp, ls, rs, le, re, lw, rw, lh, rh, lk, rk, lan, ran]


def place(pts, floor_joints=None, x=50.0, floor=FLOOR):
    """Shift a pose so its lowest point (or the given joints) rests on the floor and it's centred at x."""
    ys = [pts[i][1] for i in (floor_joints or range(13))]
    dy = floor - max(ys) - (0 if floor_joints else 0)
    if not floor_joints:
        dy = floor - max(p[1] for p in pts) - (5 if max(range(13), key=lambda i: pts[i][1]) == 0 else 0)
    xs = [p[0] for p in pts]
    dx = x - (min(xs) + max(xs)) / 2
    return [(round(p[0] + dx, 1), round(p[1] + dy, 1)) for p in pts]


def pair(start, end, view="side", floor_joints=None):
    """start/end are dicts of figure() kwargs. Both frames share one floor and centre so the movement reads clearly."""
    a = figure(view=view, **start)
    b = figure(view=view, **end)
    # place each on the floor, then use a common horizontal centre (average) so the figure doesn't jump sideways
    a, b = place(a, floor_joints), place(b, floor_joints)
    cx = (sum(p[0] for p in a) + sum(p[0] for p in b)) / 26
    a = [(round(p[0] - cx + 50, 1), p[1]) for p in a]
    b = [(round(p[0] - cx + 50, 1), p[1]) for p in b]
    return {"view": view, "start": [list(p) for p in a], "end": [list(p) for p in b]}
