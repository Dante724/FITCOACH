"""Reusable pose presets (figure() keyword sets). See figkit.py for the angle convention."""
from figkit import pair

# ── standing ──
STAND = dict()
STAND_FWD = dict(la=(90, 90))                       # arms straight forward
STAND_UP = dict(la=(180, 180))                      # arms overhead
HANDS_HIPS = dict(la=(-30, 40))
SQUAT = dict(torso=150, ll=(78, -18), la=(95, 95))  # thighs ~parallel, arms out front
HALF_SQUAT = dict(torso=163, ll=(45, -20), la=(80, 80))
CHAIR = dict(torso=150, ll=(65, -20), la=(150, 150))
LUNGE = dict(torso=180, ll=(88, 0), rl=(-38, -82), la=(0, 0))             # left (near) leg forward, back knee low
LUNGE_ARMS_UP = dict(LUNGE, la=(180, 180))
SPLIT_SQUAT_TOP = dict(torso=180, ll=(30, -5), rl=(-35, -40))
HINGE = dict(torso=105, ll=(10, -5), la=(0, 0))                           # flat back, arms hanging
HINGE_ROW = dict(torso=105, ll=(10, -5), la=(-80, 10))                    # elbows pulled back
STEP_UP = dict(ll=(80, -5), rl=(0, 0))

# ── floor: hands / knees ──
PLANK = dict(torso=115, ll=(-65, -65), la=(5, 5))
PUSHUP_LOW = dict(torso=98, ll=(-82, -82), la=(-110, 5))
FOREARM_PLANK = dict(torso=102, ll=(-78, -78), la=(0, 90))
QUADRUPED = dict(torso=90, ll=(0, -90), la=(0, 0))                        # hands and knees, flat back
BIRD_DOG = dict(torso=90, ll=(0, -90), rl=(-90, -90), la=(0, 0), ra=(90, 90))
MOUNTAIN_CLIMBER = dict(PLANK, rl=(70, -30))
DOWN_DOG = dict(torso=40, ll=(-40, -20), la=(40, 40), head=20)
CHILD = dict(torso=78, ll=(40, -90), la=(88, 92), head=75)
COBRA = dict(torso=125, ll=(-90, -90), la=(-10, 15))                      # prone, chest lifted on straight-ish arms
SPHINX = dict(torso=105, ll=(-90, -90), la=(-10, 90))

# ── lying on the back (head to the left, feet to the right) ──
SUPINE = dict(torso=-90, ll=(90, 90), la=(-90, -90))
SUPINE_KNEES = dict(torso=-90, ll=(140, 10), la=(-10, 50))                # knees bent, feet flat
BRIDGE = dict(torso=-112, ll=(110, 0), la=(-10, 60))
CRUNCH = dict(torso=-130, ll=(140, 10), la=(70, 80))
DEAD_BUG = dict(torso=-90, ll=(180, 90), la=(-180, -180))
LEGS_UP = dict(torso=-90, ll=(180, 180), la=(-90, -90))

# ── lying on the front ──
PRONE = dict(torso=90, ll=(-90, -90), la=(180, 180), head=95)
SUPERMAN = dict(torso=97, ll=(-97, -97), la=(165, 165), head=110)

# ── seated / kneeling ──
STAFF = dict(torso=180, ll=(90, 90), la=(0, 0))                           # sitting tall, legs straight
FORWARD_BEND = dict(torso=115, ll=(90, 90), la=(100, 100), head=105)
BOAT = dict(torso=-145, ll=(130, 130), la=(90, 90))
VAJRASANA = dict(torso=180, ll=(95, -85), la=(30, 90))                    # sitting on heels
CROSS_LEGGED = dict(torso=180, ll=(75, -80), la=(40, 70))
KNEEL_TALL = dict(torso=180, ll=(0, -90), la=(0, 0))
CAMEL = dict(torso=200, ll=(10, -90), la=(-30, -20), head=230)

# ── front view ──
F_STAND = dict(la=(10, 4))
F_ARMS_SIDE = dict(la=(90, 90))
F_ARMS_UP = dict(la=(170, 175))
F_JACK = dict(la=(160, 170), ll=(18, 18), spread=2)
F_WARRIOR2 = dict(la=(90, 90), ll=(60, 0), rl=(30, 30), spread=6)
F_TREE = dict(la=(165, 200), ll=(0, 0), rl=(70, -95))
F_GODDESS = dict(la=(90, 180), ll=(60, 5), spread=8)
F_TRIANGLE = dict(torso=110, la=(0, 0), ra=(180, 180), ll=(30, 30), spread=6)
F_SIDE_BEND = dict(torso=160, la=(0, 0), ra=(160, 170))
F_WIDE = dict(ll=(20, 20), spread=3, la=(10, 4))
F_PRESS_START = dict(la=(90, 180))
F_LAT_RAISE = dict(la=(85, 85))


def side(a, b, floor=None):
    return pair(a, b, "side", floor)


def front(a, b, floor=None):
    return pair(a, b, "front", floor)
