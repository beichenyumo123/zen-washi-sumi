#!/usr/bin/env python3
"""
Generate seamless wallpaper textures for Zen Washi & Sumi:
  - textures/grain.png              (128x128 @2x Retina monochrome noise, xorshift32 ported from Yab Grain.tile)
  - textures/pattern-browser.svg    (320x320 seamless doodle tile, ported from Yab LookDrawings.Set.browser)
  - textures/pattern-life.svg       (320x320 seamless doodle tile, ported from Yab LookDrawings.Set.life)
  - textures/pattern-halloween.svg  (320x320 seamless doodle tile, ported from Yab LookDrawings.Set.halloween)
  - textures/pattern-washi.svg      (320x320 seamless East Asian washi ink-line motif tile)

Uses only the Python standard library.
"""

import math
import pathlib
import struct
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "textures"
SIDE = 320.0


# ---------------------------------------------------------------------------
# 1. Grain PNG generator (128x128 grayscale + alpha, exact Yab xorshift32)
# ---------------------------------------------------------------------------
def write_png_ga(path: pathlib.Path, width: int, height: int, rows: list[bytes]) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    # Color type 4 = grayscale + alpha, 8-bit depth
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 4, 0, 0, 0)
    raw = b"".join(b"\x00" + row for row in rows)
    idat = zlib.compress(raw, level=9)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    path.write_bytes(png)


def generate_grain_png(path: pathlib.Path, side: int = 128) -> None:
    seed = 0x2545F491
    rows: list[bytes] = []
    for _ in range(side):
        row = bytearray(side * 2)
        for x in range(side):
            seed ^= (seed << 13) & 0xFFFFFFFF
            seed ^= (seed >> 17) & 0xFFFFFFFF
            seed ^= (seed << 5) & 0xFFFFFFFF
            row[x * 2] = 0 if (seed & 1) == 0 else 255
            row[x * 2 + 1] = (seed >> 8) & 0xFF
        rows.append(bytes(row))
    write_png_ga(path, side, side, rows)


# ---------------------------------------------------------------------------
# 2. SVG Path helpers for glyphs in [-1, 1] x [-1, 1] (y-down)
# ---------------------------------------------------------------------------
def fmt(v: float) -> str:
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def poly(pts: list[tuple[float, float]], closed: bool = False) -> str:
    head = f"M {fmt(pts[0][0])} {fmt(pts[0][1])}"
    body = " ".join(f"L {fmt(x)} {fmt(y)}" for x, y in pts[1:])
    return f"{head} {body}{' Z' if closed else ''}"


def circle_el(cx: float, cy: float, r: float) -> str:
    return f'<circle cx="{fmt(cx)}" cy="{fmt(cy)}" r="{fmt(r)}"/>'


def ellipse_el(cx: float, cy: float, rx: float, ry: float, rot_deg: float = 0.0) -> str:
    if abs(rot_deg) > 1e-6:
        return (
            f'<ellipse cx="{fmt(cx)}" cy="{fmt(cy)}" rx="{fmt(rx)}" ry="{fmt(ry)}" '
            f'transform="rotate({fmt(rot_deg)} {fmt(cx)} {fmt(cy)})"/>'
        )
    return f'<ellipse cx="{fmt(cx)}" cy="{fmt(cy)}" rx="{fmt(rx)}" ry="{fmt(ry)}"/>'


def rect_el(x: float, y: float, w: float, h: float, r: float = 0.0) -> str:
    rx_attr = f' rx="{fmt(r)}" ry="{fmt(r)}"' if r > 0 else ""
    return f'<rect x="{fmt(x)}" y="{fmt(y)}" width="{fmt(w)}" height="{fmt(h)}"{rx_attr}/>'


def path_el(d: str) -> str:
    return f'<path d="{d}"/>'


def arc_pts(cx: float, cy: float, r: float, a0: float, a1: float, steps: int = 16) -> list[tuple[float, float]]:
    return [
        (cx + math.cos(a0 + (a1 - a0) * i / steps) * r, cy + math.sin(a0 + (a1 - a0) * i / steps) * r)
        for i in range(steps + 1)
    ]


def glyph_svg(name: str) -> str:
    pi = math.pi
    if name == "globe":
        return circle_el(0, 0, 1) + ellipse_el(0, 0, 0.45, 1) + path_el(poly([(-1, 0), (1, 0)]))
    if name == "cursor":
        return path_el(poly([(-0.55, -1), (-0.55, 0.6), (-0.18, 0.25), (0.15, 0.95), (0.42, 0.83), (0.1, 0.15), (0.55, 0.12)], closed=True))
    if name == "mail":
        return rect_el(-1, -0.65, 2, 1.3, 0.18) + path_el(poly([(-0.95, -0.55), (0, 0.12), (0.95, -0.55)]))
    if name == "bookmark":
        return path_el(poly([(-0.55, -1), (0.55, -1), (0.55, 1), (0, 0.55), (-0.55, 1)], closed=True))
    if name == "key":
        return (
            circle_el(-0.5, 0, 0.42)
            + path_el(poly([(-0.08, 0), (1, 0)]))
            + path_el(poly([(0.68, 0), (0.68, 0.35)]))
            + path_el(poly([(0.92, 0), (0.92, 0.28)]))
        )
    if name == "lock":
        shackle = [(-0.45, -0.1)] + arc_pts(0, -0.4, 0.45, pi, 2 * pi, 14) + [(0.45, -0.1)]
        return rect_el(-0.7, -0.1, 1.4, 1.05, 0.2) + path_el(poly(shackle))
    if name == "search":
        return circle_el(-0.2, -0.2, 0.6) + path_el(poly([(0.23, 0.23), (0.95, 0.95)]))
    if name == "command":
        o, r = 0.38, 0.3
        c = o + r * 0.62
        out = rect_el(-o, -o, o * 2, o * 2)
        for u, v in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
            out += circle_el(u * c, v * c, r)
        return out
    if name == "tab":
        return path_el(poly([(-1, 0.55), (-0.6, 0.55), (-0.6, -0.4), (-0.4, -0.55), (0.4, -0.55), (0.6, -0.4), (0.6, 0.55), (1, 0.55)]))
    if name == "download":
        return (
            path_el(poly([(0, -1), (0, 0.35)]))
            + path_el(poly([(-0.45, -0.1), (0, 0.35), (0.45, -0.1)]))
            + path_el(poly([(-0.9, 0.5), (-0.9, 0.9), (0.9, 0.9), (0.9, 0.5)]))
        )
    if name == "puzzle":
        pts = (
            [(-0.8, -0.8)]
            + arc_pts(0, -0.8, 0.2, pi, 2 * pi, 10)
            + [(0.8, -0.8)]
            + arc_pts(0.8, 0, 0.2, -pi / 2, pi / 2, 10)
            + [(0.8, 0.8), (-0.8, 0.8)]
        )
        return path_el(poly(pts, closed=True))
    if name == "compass":
        return circle_el(0, 0, 1) + path_el(poly([(0, -0.7), (0.22, 0), (0, 0.7), (-0.22, 0)], closed=True))
    if name == "bolt":
        return path_el(poly([(0.15, -1), (-0.55, 0.12), (-0.02, 0.12), (-0.18, 1), (0.6, -0.22), (0.06, -0.22)], closed=True))
    if name == "pencil":
        return path_el(poly([(-0.9, 0.9), (-0.75, 0.45), (0.6, -0.9), (0.9, -0.6), (-0.45, 0.75)], closed=True))
    if name == "star":
        pts = []
        for i in range(10):
            r = 0.42 if i % 2 == 1 else 1.0
            a = -pi / 2 + i * pi / 5
            pts.append((math.cos(a) * r, math.sin(a) * r))
        return path_el(poly(pts, closed=True))
    if name == "cup":
        handle = [(0.52, 0.1)] + arc_pts(0.68, 0.35, 0.25, -pi / 2, pi / 2, 10)
        return (
            path_el(poly([(-0.65, -0.1), (-0.55, 0.85), (0.45, 0.85), (0.55, -0.1)], closed=True))
            + path_el(poly(handle))
            + path_el("M -0.3 -0.35 C -0.45 -0.55 -0.15 -0.7 -0.3 -0.95")
        )
    if name == "heart":
        return path_el("M 0 0.85 C -1.2 0 -0.7 -1 0 -0.4 C 0.7 -1 1.2 0 0 0.85")
    if name == "cat":
        return (
            path_el(
                "M -0.8 -0.2 L -0.75 -0.95 L -0.3 -0.55 Q 0 -0.65 0.3 -0.55 "
                "L 0.75 -0.95 L 0.8 -0.2 C 0.95 0.6 0.4 0.85 0 0.85 "
                "C -0.4 0.85 -0.95 0.6 -0.8 -0.2"
            )
            + path_el(poly([(-0.35, 0.3), (-1.05, 0.2)]))
            + path_el(poly([(0.35, 0.3), (1.05, 0.2)]))
        )
    if name == "moon":
        outer = arc_pts(0, 0, 0.9, pi * 0.35, pi * 1.65, 16)
        inner = arc_pts(0.45, -0.05, 0.72, pi * 1.45, pi * 0.55, 14)
        return path_el(poly(outer + inner, closed=True))
    if name == "note":
        return (
            ellipse_el(-0.4, 0.65, 0.32, 0.24)
            + path_el("M -0.1 0.6 L -0.1 -1 Q 0.3 -0.6 0.55 -0.55")
        )
    if name == "planet":
        return circle_el(0, 0, 0.55) + ellipse_el(0, 0, 1.05, 0.3, rot_deg=-0.35 * 180 / pi)
    if name == "cloud":
        pts = (
            [(-0.55, 0.55)]
            + arc_pts(-0.5, 0.15, 0.4, pi * 0.5, pi * 1.5, 10)
            + arc_pts(0, -0.15, 0.5, pi * 1.15, pi * 1.9, 10)
            + arc_pts(0.55, 0.15, 0.4, pi * 1.5, pi * 2.5, 10)
        )
        return path_el(poly(pts, closed=True))
    if name == "plane":
        return (
            path_el(poly([(-1, -0.05), (1, -0.8), (0.35, 0.9), (0.02, 0.18)], closed=True))
            + path_el(poly([(0.02, 0.18), (1, -0.8)]))
        )
    if name == "sparkle":
        return path_el("M 0 -1 Q 0.12 -0.12 1 0 Q 0.12 0.12 0 1 Q -0.12 0.12 -1 0 Q -0.12 -0.12 0 -1")
    if name == "play":
        return rect_el(-1, -0.68, 2, 1.36, 0.38) + path_el(poly([(-0.25, -0.35), (0.4, 0), (-0.25, 0.35)], closed=True))
    if name == "pumpkin":
        return (
            path_el("M -0.92 0.12 C -1 -0.62 -0.36 -0.74 0 -0.5 C 0.36 -0.74 1 -0.62 0.92 0.12 C 0.86 0.8 -0.86 0.8 -0.92 0.12 Z")
            + path_el("M -0.3 -0.6 C -0.52 -0.12 -0.52 0.42 -0.3 0.7 M 0.3 -0.6 C 0.52 -0.12 0.52 0.42 0.3 0.7 M 0 -0.52 C 0 -0.8 0.1 -0.95 0.32 -1")
        )
    if name == "ghost":
        return (
            path_el("M -0.7 0.92 L -0.7 -0.2 C -0.7 -1.12 0.7 -1.12 0.7 -0.2 L 0.7 0.92 L 0.35 0.66 L 0 0.92 L -0.35 0.66 Z")
            + path_el("M -0.28 -0.34 L -0.28 -0.04 M 0.08 -0.16 Q 0.24 -0.38 0.42 -0.24")
        )
    if name == "bat":
        return path_el("M -1 -0.1 Q -0.7 -0.62 -0.36 -0.2 Q -0.18 -0.56 0 -0.26 Q 0.18 -0.56 0.36 -0.2 Q 0.7 -0.62 1 -0.1 Q 0.62 -0.04 0.48 0.3 Q 0.25 0.02 0 0.36 Q -0.25 0.02 -0.48 0.3 Q -0.62 -0.04 -1 -0.1 Z")
    if name == "spider":
        return (
            path_el("M 0 -1 L 0 -0.12")
            + ellipse_el(0, 0.22, 0.26, 0.3)
            + path_el("M -0.22 0.1 Q -0.6 -0.15 -0.8 0.1 M -0.22 0.3 Q -0.6 0.3 -0.8 0.6 M 0.22 0.1 Q 0.6 -0.15 0.8 0.1 M 0.22 0.3 Q 0.6 0.3 0.8 0.6")
        )
    if name == "web":
        angles = [0.0, 0.4, 0.8, 1.17, pi / 2]
        out = "".join(path_el(poly([(-1, -1), (-1 + math.cos(a) * 2.05, -1 + math.sin(a) * 2.05)])) for a in angles)
        for r in (0.7, 1.25, 1.8):
            segs = [f"M {fmt(-1 + r)} -1"]
            for a, b in zip(angles, angles[1:]):
                m = (a + b) / 2
                segs.append(
                    f"Q {fmt(-1 + math.cos(m) * r * 0.86)} {fmt(-1 + math.sin(m) * r * 0.86)} "
                    f"{fmt(-1 + math.cos(b) * r)} {fmt(-1 + math.sin(b) * r)}"
                )
            out += path_el(" ".join(segs))
        return out
    if name == "hat":
        return path_el("M -1 0.62 Q 0 0.9 1 0.62 Q 0.4 0.44 0.42 0.42 L 0.12 -0.38 Q 0.22 -0.8 0.74 -0.9 Q 0.06 -0.98 -0.16 -0.44 L -0.42 0.42 Q -0.4 0.44 -1 0.62 Z M -0.38 0.3 Q 0 0.4 0.38 0.3")
    if name == "candy":
        return ellipse_el(0, 0, 0.42, 0.32) + path_el("M -0.42 0 L -1 -0.42 L -1 0.42 Z M 0.42 0 L 1 -0.42 L 1 0.42 Z M -0.12 -0.28 L 0.1 0.28")
    if name == "corn":
        return path_el("M -0.66 0.8 Q 0 -1.7 0.66 0.8 Q 0 1 -0.66 0.8 Z M -0.5 0.24 Q 0 0.4 0.5 0.24 M -0.28 -0.3 Q 0 -0.2 0.28 -0.3")
    if name == "cauldron":
        return (
            path_el("M -0.86 -0.2 L 0.86 -0.2 M -0.76 -0.2 C -0.92 0.66 0.92 0.66 0.76 -0.2 M -0.48 0.56 L -0.6 0.86 M 0.48 0.56 L 0.6 0.86")
            + circle_el(-0.18, -0.48, 0.14)
            + circle_el(0.24, -0.72, 0.1)
        )
    if name == "candle":
        return path_el("M -0.3 -0.16 L -0.3 0.92 L 0.3 0.92 L 0.3 -0.16 Z M 0 -0.16 L 0 -0.38 M 0 -0.42 Q -0.26 -0.68 0 -1 Q 0.26 -0.68 0 -0.42 M 0.3 0.1 Q 0.44 0.2 0.36 0.42")
    if name == "squiggle":
        pts = [(-1 + (i / 16) * 2, math.sin((i / 16) * pi * 3) * 0.32) for i in range(17)]
        return path_el(poly(pts))
    if name == "plus":
        return path_el(poly([(-0.6, 0), (0.6, 0)])) + path_el(poly([(0, -0.6), (0, 0.6)]))

    # --- Custom Washi / East Asian ink-line motifs ---
    if name == "teacup":
        # Yunomi teacup with rising steam
        return (
            path_el("M -0.62 -0.15 L -0.52 0.62 Q 0 0.82 0.52 0.62 L 0.62 -0.15 Q 0 -0.28 -0.62 -0.15 Z")
            + path_el("M -0.34 0.74 L 0.34 0.74")
            + path_el("M -0.18 -0.42 Q -0.34 -0.62 -0.14 -0.84 M 0.18 -0.38 Q 0.34 -0.58 0.14 -0.8")
        )
    if name == "fan":
        # Folding fan (sensu)
        outer = arc_pts(0, 0.75, 1.35, -pi * 0.78, -pi * 0.22, 14)
        inner = list(reversed(arc_pts(0, 0.75, 0.42, -pi * 0.78, -pi * 0.22, 10)))
        ribs = "".join(
            path_el(poly([(0, 0.75), (math.cos(a) * 1.35, 0.75 + math.sin(a) * 1.35)]))
            for a in (-pi * 0.64, -pi * 0.5, -pi * 0.36)
        )
        return path_el(poly(outer + inner, closed=True)) + ribs
    if name == "bamboo":
        # Bamboo stem + two leaves
        return (
            path_el("M -0.1 -0.95 L -0.05 0.95 M -0.22 -0.28 L 0.08 -0.28 M -0.18 0.34 L 0.12 0.34")
            + path_el("M -0.06 -0.28 Q 0.42 -0.68 0.85 -0.46 Q 0.42 -0.14 -0.06 -0.28 Z")
            + path_el("M -0.08 0.34 Q -0.54 0.04 -0.88 0.26 Q -0.48 0.54 -0.08 0.34 Z")
        )
    if name == "ginkgo":
        # Ginkgo leaf with central notch
        return (
            path_el("M 0 0.9 L 0 0.22")
            + path_el("M 0 0.22 C -0.78 0.12 -0.96 -0.45 -0.56 -0.78 Q -0.18 -0.92 -0.04 -0.45 L 0 -0.28 L 0.04 -0.45 Q 0.18 -0.92 0.56 -0.78 C 0.96 -0.45 0.78 0.12 0 0.22 Z")
        )
    if name == "plum":
        # Five-petal plum blossom (ume)
        petals = []
        for i in range(5):
            a = -pi / 2 + i * 2 * pi / 5
            cx, cy = math.cos(a) * 0.5, math.sin(a) * 0.5
            petals.append(circle_el(cx, cy, 0.36))
        return "".join(petals) + circle_el(0, 0, 0.16)
    if name == "wave":
        # Seigaiha-inspired gentle wave crest
        return (
            path_el("M -0.95 0.42 Q -0.48 -0.28 0 0.42 Q 0.48 -0.28 0.95 0.42")
            + path_el("M -0.68 0.05 Q -0.34 -0.45 0 0.05 Q 0.34 -0.45 0.68 0.05")
        )
    if name == "lantern":
        # Paper lantern (chochin)
        return (
            path_el("M 0 -0.96 L 0 -0.68 M -0.28 -0.68 L 0.28 -0.68 M -0.24 0.68 L 0.24 0.68 M 0 0.68 L 0 0.96")
            + ellipse_el(0, 0, 0.56, 0.68)
            + path_el("M -0.52 -0.22 Q 0 -0.1 0.52 -0.22 M -0.52 0.22 Q 0 0.34 0.52 0.22")
        )
    if name == "mountain":
        # Minimalist ink-wash mountain peaks
        return (
            path_el("M -0.95 0.65 L -0.28 -0.58 L 0.25 0.38 L 0.55 -0.15 L 0.95 0.65")
            + path_el("M -0.46 -0.24 Q -0.28 -0.06 -0.12 -0.26")
        )
    if name == "origami":
        # Simple paper crane silhouette
        return (
            path_el(poly([(-0.95, 0.05), (-0.15, -0.12), (0.05, -0.88), (0.28, -0.08), (0.95, -0.32), (0.38, 0.32), (-0.15, 0.42)], closed=True))
            + path_el(poly([(-0.15, -0.12), (0.28, -0.08)]))
        )
    if name == "pine":
        # Pine needle cluster (matsu)
        return (
            path_el("M 0 0.85 L 0 -0.85 M 0 0.65 L -0.65 -0.45 M 0 0.65 L 0.65 -0.45 M 0 0.72 L -0.35 -0.75 M 0 0.72 L 0.35 -0.75")
        )
    raise ValueError(f"Unknown glyph: {name}")


# ---------------------------------------------------------------------------
# 3. Torus-wrapped deterministic layout (exact port of LookDrawings.layout)
# ---------------------------------------------------------------------------
SETS: dict[str, tuple[int, list[str]]] = {
    "browser": (
        0x51A7E5ED,
        ["globe", "cursor", "mail", "bookmark", "key", "lock", "search", "command", "tab", "download", "puzzle", "compass", "bolt", "pencil", "star"],
    ),
    "life": (
        0x0B1FEDA7,
        ["cup", "heart", "cat", "moon", "note", "planet", "cloud", "plane", "sparkle", "star", "play", "globe"],
    ),
    "halloween": (
        0x0A11E031,
        ["pumpkin", "ghost", "bat", "spider", "web", "hat", "candy", "corn", "cauldron", "candle", "moon", "cat", "star"],
    ),
    "washi": (
        0x7A541C0D,
        ["teacup", "fan", "bamboo", "ginkgo", "plum", "cloud", "moon", "wave", "lantern", "mountain", "origami", "pine"],
    ),
}


def layout_set(name: str) -> list[tuple[str, float, float, float, float]]:
    seed, big = SETS[name]
    small = ["squiggle", "plus", "sparkle"]
    mask64 = (1 << 64) - 1

    def nxt() -> float:
        nonlocal seed
        seed = (seed * 6364136223846793005 + 1442695040888963407) & mask64
        return (seed >> 33) / float(1 << 31)

    items: list[tuple[str, float, float, float, float]] = []
    for _ in range(5000):
        if len(items) >= 140:
            break
        is_big = nxt() < 0.62
        size = 8.5 + nxt() * 5.5 if is_big else 3.6 + nxt() * 2.6
        x = nxt() * SIDE
        y = nxt() * SIDE
        clear = True
        for _, ox, oy, osize, _ in items:
            dx = abs(ox - x)
            dy = abs(oy - y)
            dx = min(dx, SIDE - dx)
            dy = min(dy, SIDE - dy)
            room = (osize + size) * 1.15 + 5.0
            if dx * dx + dy * dy < room * room:
                clear = False
                break
        if not clear:
            continue
        pool = big if is_big else small
        glyph = pool[min(len(pool) - 1, int(nxt() * len(pool)))]
        angle = (nxt() - 0.5) * 1.1
        items.append((glyph, x, y, size, angle))
    return items


def generate_pattern_svg(name: str, path: pathlib.Path) -> None:
    items = layout_set(name)
    groups: list[str] = []
    for glyph, ix, iy, size, angle in items:
        inner = glyph_svg(glyph)
        deg = angle * 180.0 / math.pi
        sw = 1.3 / size
        for dx in (-SIDE, 0.0, SIDE):
            for dy in (-SIDE, 0.0, SIDE):
                x = ix + dx
                y = iy + dy
                if not (-size * 1.6 < x < SIDE + size * 1.6 and -size * 1.6 < y < SIDE + size * 1.6):
                    continue
                groups.append(
                    f'  <g transform="translate({fmt(x)} {fmt(y)}) rotate({fmt(deg)}) scale({fmt(size)})" '
                    f'stroke-width="{fmt(sw)}">{inner}</g>'
                )
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{int(SIDE)}" height="{int(SIDE)}" '
        f'viewBox="0 0 {int(SIDE)} {int(SIDE)}" fill="none" stroke="#000" '
        f'stroke-linecap="round" stroke-linejoin="round">\n'
        + "\n".join(groups)
        + "\n</svg>\n"
    )
    path.write_text(svg, encoding="utf-8")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    generate_grain_png(OUT_DIR / "grain.png")
    print(f"Generated {OUT_DIR / 'grain.png'}")
    for name in SETS:
        out = OUT_DIR / f"pattern-{name}.svg"
        generate_pattern_svg(name, out)
        print(f"Generated {out}")


if __name__ == "__main__":
    main()
