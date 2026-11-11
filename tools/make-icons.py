#!/usr/bin/env python3
"""Generate the app icons (a stylised badminton court) with no external deps."""
import struct, zlib, math, os

BG_OUTSIDE = (16, 24, 39, 255)     # app background, for the rounded corners' surround
GREEN_OUT  = (18, 104, 79, 255)    # run-off
GREEN_IN   = (14, 118, 93, 255)    # court surface
LINE       = (247, 255, 255, 255)
CORK       = (245, 219, 140, 255)
NET        = (217, 250, 255, 255)
FRONT      = (85, 192, 255, 255)
BACK       = (255, 198, 90, 255)
WEDGE      = (120, 215, 255, 255)

L, W = 13.40, 6.10          # court length / doubles width, metres
SHORT, LONGS = 1.98, 0.76
INSET_S = (6.10 - 5.18) / 2


def png(path, width, height, pixel):
    rows = []
    for y in range(height):
        row = bytearray([0])
        for x in range(width):
            row += bytes(pixel(x, y))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    out = b"\x89PNG\r\n\x1a\n"
    out += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    out += chunk(b"IDAT", zlib.compress(raw, 9))
    out += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(out)


def make(path, size, maskable=False, square=False, variant='main'):
    N = float(size)
    radius = 0.0 if (maskable or square) else 0.22 * N
    # Maskable icons must keep their content inside the 80% safe circle.
    pad = 0.145 * N if maskable else 0.085 * N

    # Court box: keep the real 13.40 x 6.10 ratio, centred.
    box_h = N - 2 * pad
    box_w = box_h * W / L
    cx0 = (N - box_w) / 2.0
    cy0 = (N - box_h) / 2.0
    s = box_h / L                      # px per metre
    lw = max(1.5, 0.016 * N)
    net_w = max(2.6, 0.034 * N)

    def mx(m): return cx0 + m * s
    def my(m): return cy0 + m * s

    x_lo, x_hi = mx(0.0), mx(W)
    y_lo, y_hi = my(0.0), my(L)
    h_lines = [my(0.0), my(L), my(LONGS), my(L - LONGS),
               my(L / 2 - SHORT), my(L / 2 + SHORT)]
    v_lines = [mx(0.0), mx(W), mx(INSET_S), mx(W - INSET_S)]
    net_y = my(L / 2)
    centre_x = mx(W / 2)

    # Role variant: two players with a cover wedge, so the two installed
    # apps do not share an icon.
    front = (mx(W / 2), my(L / 2 + 2.3), 0.072 * N)
    back = (mx(W / 2), my(L / 2 + 4.6), 0.072 * N)
    wedge_r = 0.30 * N
    half_ang = math.radians(70)

    def in_wedge(px, py):
        # Clipped to our own half and inside the court, as the app draws it.
        if py < net_y or py > y_hi or px < x_lo or px > x_hi:
            return False
        dx, dy = px - front[0], py - front[1]
        if math.hypot(dx, dy) > wedge_r:
            return False
        # facing the net, i.e. up the image
        ang = math.atan2(dy, dx) - (-math.pi / 2)
        while ang > math.pi: ang -= 2 * math.pi
        while ang < -math.pi: ang += 2 * math.pi
        return abs(ang) <= half_ang

    # Shuttle: cork ball plus a flaring skirt, sitting on the far half.
    sh_x, sh_y = mx(W / 2), my(L / 2 - 1.55)
    cork_r = 0.044 * N
    skirt_h = 0.105 * N
    skirt_top_w = 0.082 * N

    def in_skirt(px, py):
        t = (sh_y - py) / skirt_h           # 0 at the cork, 1 at the open end
        if not (0.0 <= t <= 1.0):
            return False
        half = cork_r * 0.75 + (skirt_top_w - cork_r * 0.75) * t
        return abs(px - sh_x) <= half

    def pixel(x, y):
        px, py = x + 0.5, y + 0.5

        if radius > 0:
            dx = max(radius - px, px - (N - radius), 0.0)
            dy = max(radius - py, py - (N - radius), 0.0)
            if dx > 0 and dy > 0 and math.hypot(dx, dy) > radius:
                return BG_OUTSIDE

        if variant == 'roles':
            if math.hypot(px - front[0], py - front[1]) <= front[2]:
                return FRONT
            if math.hypot(px - back[0], py - back[1]) <= back[2]:
                return BACK
        else:
            if math.hypot(px - sh_x, py - sh_y) <= cork_r:
                return CORK
            if in_skirt(px, py):
                return LINE

        on_court = x_lo <= px <= x_hi and y_lo <= py <= y_hi

        # Net first: it is the widest line and overhangs the sidelines.
        if abs(py - net_y) <= net_w / 2 and x_lo - 0.025 * N <= px <= x_hi + 0.025 * N:
            return NET
        if variant == 'roles' and in_wedge(px, py):
            base = GREEN_IN if on_court else GREEN_OUT
            for yy in h_lines:
                if abs(py - yy) <= lw / 2 and on_court:
                    return LINE
            for xx in v_lines:
                if abs(px - xx) <= lw / 2 and on_court:
                    return LINE
            return tuple(round(b + (f - b) * 0.42) for b, f in zip(base, WEDGE))
        if on_court:
            for yy in h_lines:
                if abs(py - yy) <= lw / 2:
                    return LINE
            for xx in v_lines:
                if abs(px - xx) <= lw / 2:
                    return LINE
            if abs(px - centre_x) <= lw / 2 and (
                    py <= my(L / 2 - SHORT) or py >= my(L / 2 + SHORT)):
                return LINE
            return GREEN_IN
        return GREEN_OUT

    png(path, size, size, pixel)
    print("wrote", path, size)


here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
icons = os.path.join(here, "icons")
os.makedirs(icons, exist_ok=True)
make(os.path.join(icons, "icon-192.png"), 192)
make(os.path.join(icons, "icon-512.png"), 512)
make(os.path.join(icons, "icon-maskable-512.png"), 512, maskable=True)
make(os.path.join(icons, "apple-touch-icon.png"), 180, square=True)  # iOS applies its own mask
for name, sz, kw in [("roles-192.png", 192, {}), ("roles-512.png", 512, {}),
                     ("roles-maskable-512.png", 512, {"maskable": True}),
                     ("roles-apple-touch-icon.png", 180, {"square": True})]:
    make(os.path.join(icons, name), sz, variant="roles", **kw)
