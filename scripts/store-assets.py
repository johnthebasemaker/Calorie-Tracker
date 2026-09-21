#!/usr/bin/env python3
"""Generate the Play Store listing graphics.

    python3 scripts/store-assets.py

Produces, in store/:
    icon-512.png        512x512  Play app icon
    feature-graphic.png 1024x500 Play feature graphic

Everything is drawn from the same palette as the app (the :root custom
properties in styles.css), so the listing and the product cannot drift apart.

Drawn rather than exported from a design tool for one practical reason: the
Play icon and the in-app launcher icon have to stay in step, and a hand-made
PNG is the thing that quietly goes stale. Rerun this after changing the
palette and both come out consistent.

Everything is rendered at 4x and downsampled, because Pillow's arc and
rounded-rectangle drawing is not anti-aliased. Supersampling is what makes
the ring edges clean at 512.
"""
import pathlib

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "store"
OUT.mkdir(exist_ok=True)

# --- palette, from styles.css -------------------------------------------
FIELD      = (0x10, 0x12, 0x15)   # --bg (dark)
FIELD_LIFT = (0x1B, 0x20, 0x26)   # a touch lighter, for the radial lift
ACCENT     = (0x2E, 0xA8, 0x6A)   # --accent-2
ACCENT_HI  = (0x48, 0xD6, 0x8F)   # --accent-2 (dark theme)
TRACK      = (0x2A, 0x2F, 0x36)   # --line, the unfilled part of the ring
TEXT       = (0xE9, 0xEC, 0xF0)   # --text (dark)
DIM        = (0x90, 0x99, 0xA3)   # --dim (dark)

SS = 4                            # supersampling factor
LANCZOS = Image.Resampling.LANCZOS

FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FONT_REG = "/System/Library/Fonts/Supplemental/Arial.ttf"


def radial_field(size, inner=FIELD_LIFT, outer=FIELD):
    """Flat dark field with a subtle lift toward the centre.

    A perfectly flat square reads as cheap at icon sizes; this is barely
    perceptible but gives the mark something to sit on.
    """
    grad = Image.radial_gradient("L").resize((size, size), LANCZOS)
    return Image.composite(
        Image.new("RGB", (size, size), outer),
        Image.new("RGB", (size, size), inner),
        grad,
    )


def linear_gradient(size, a, b):
    """Diagonal two-stop gradient, used to give the green some direction."""
    w = h = size
    base = Image.new("RGB", (w, h), a)
    top = Image.new("RGB", (w, h), b)
    mask = Image.new("L", (w, h))
    px = mask.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = int(255 * ((x / w) * 0.45 + (1 - y / h) * 0.55))
    return Image.composite(top, base, mask)


def draw_mark(size, ring_frac=0.62, stroke_frac=0.072, progress=0.75):
    """The app mark: a progress ring with three ascending bars inside.

    Returned as an RGBA image on transparency so it can be placed on any
    field. `progress` is how much of the ring is filled - 75% reads as
    "most of the way through the day", which is what the app is about.
    """
    S = size * SS
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    cx = cy = S / 2
    r = ring_frac * S / 2            # centre-line radius of the ring
    w = stroke_frac * S

    # --- the unfilled track, full circle ---
    track = Image.new("L", (S, S), 0)
    ImageDraw.Draw(track).ellipse(
        [cx - r - w / 2, cy - r - w / 2, cx + r + w / 2, cy + r + w / 2], fill=255)
    ImageDraw.Draw(track).ellipse(
        [cx - r + w / 2, cy - r + w / 2, cx + r - w / 2, cy + r - w / 2], fill=0)
    layer.paste(Image.new("RGB", (S, S), TRACK), (0, 0), track)

    # --- the filled arc, clockwise from 12 o'clock ---
    arc = Image.new("L", (S, S), 0)
    ad = ImageDraw.Draw(arc)
    start = -90.0
    end = start + 360.0 * progress
    ad.arc([cx - r, cy - r, cx + r, cy + r], start, end, fill=255, width=int(w))
    # Round the two ends. Pillow's arc has butt caps, which look unfinished
    # where the ring stops.
    import math
    for ang in (start, end):
        ex = cx + r * math.cos(math.radians(ang))
        ey = cy + r * math.sin(math.radians(ang))
        ad.ellipse([ex - w / 2, ey - w / 2, ex + w / 2, ey + w / 2], fill=255)
    layer.paste(linear_gradient(S, ACCENT, ACCENT_HI), (0, 0), arc)

    # --- three ascending bars ---
    bars = Image.new("L", (S, S), 0)
    bd = ImageDraw.Draw(bars)
    bw = 0.055 * S
    gap = 0.038 * S
    total = 3 * bw + 2 * gap
    x0 = cx - total / 2
    base_y = cy + 0.115 * S
    for i, hfrac in enumerate((0.115, 0.175, 0.235)):
        bx = x0 + i * (bw + gap)
        bd.rounded_rectangle(
            [bx, base_y - hfrac * S, bx + bw, base_y],
            radius=bw / 2, fill=255)
    layer.paste(linear_gradient(S, ACCENT, ACCENT_HI), (0, 0), bars)

    return layer.resize((size, size), LANCZOS)


def build_icon():
    """512x512 Play icon: full-bleed, opaque, no transparency to mask badly."""
    size = 512
    field = radial_field(size * SS).resize((size, size), LANCZOS)
    icon = field.convert("RGBA")
    icon.alpha_composite(draw_mark(size))
    icon = icon.convert("RGB")           # Play wants no surprise alpha here
    p = OUT / "icon-512.png"
    icon.save(p, "PNG", optimize=True)
    return p, icon


def fit_font(path, text, target_px, max_size=400):
    """Largest size whose cap height fits target_px, so headlines line up."""
    lo, hi = 8, max_size
    best = ImageFont.truetype(path, 8)
    while lo <= hi:
        mid = (lo + hi) // 2
        f = ImageFont.truetype(path, mid)
        h = f.getbbox(text)[3] - f.getbbox(text)[1]
        if h <= target_px:
            best, lo = f, mid + 1
        else:
            hi = mid - 1
    return best


def build_feature():
    """1024x500 feature graphic.

    Play crops this to different ratios and may lay a play button over the
    middle, so nothing important goes near an edge and the mark sits off to
    one side rather than dead centre.
    """
    W, H = 1024, 500
    img = radial_field(max(W, H) * SS).resize((max(W, H), max(W, H)), LANCZOS)
    img = img.crop((0, (max(W, H) - H) // 2, W, (max(W, H) - H) // 2 + H)).convert("RGB")

    mark_px = 236
    img.paste(draw_mark(mark_px), (86, (H - mark_px) // 2), draw_mark(mark_px))

    d = ImageDraw.Draw(img)
    tx = 86 + mark_px + 62

    title = ImageFont.truetype(FONT_BOLD, 74)
    sub = ImageFont.truetype(FONT_REG, 33)
    small = ImageFont.truetype(FONT_REG, 27)

    d.text((tx, 168), "Calorie Tracker", font=title, fill=TEXT)
    d.text((tx, 262), "South Indian & Gulf food,", font=sub, fill=ACCENT_HI)
    d.text((tx, 304), "tracked offline.", font=sub, fill=ACCENT_HI)
    d.text((tx, 366), "No account  ·  No ads  ·  Works with no signal",
           font=small, fill=DIM)

    p = OUT / "feature-graphic.png"
    img.save(p, "PNG", optimize=True)
    return p, img


if __name__ == "__main__":
    ip, icon = build_icon()
    fp, feature = build_feature()
    for p in (ip, fp):
        im = Image.open(p)
        print(f"  {p.relative_to(ROOT)}  {im.size[0]}x{im.size[1]}  "
              f"{im.mode}  {p.stat().st_size/1024:.0f} KB")
