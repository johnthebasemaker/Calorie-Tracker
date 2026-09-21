#!/usr/bin/env python3
"""Generate the Android launcher icons and splash screens from icons/.

Run after changing the artwork in icons/:

    python3 scripts/android-assets.py

Everything is derived from icons/icon-maskable-512.png, which is the only
source of truth for the app mark. Nothing here is hand-edited, so the Android
icons cannot drift away from the web ones.

Why the maskable variant and not icon-512.png: a maskable icon is drawn with
its artwork pulled well inside the frame so a launcher can crop it to any
shape, which is the same thing Android's adaptive icons want.

The sizing needs care, and getting it wrong is not obvious from the XML - only
from looking at the launcher. An adaptive icon's layers are 108dp, but the
system shows only the central 72dp and crops the 18dp border away. That crop
is a 1.5x magnification. The mark in icon-maskable-512.png measures 62.1% of
its own canvas, so pasted full-bleed it renders at 93% of the visible circle
and sits hard against the edge while every other icon on the home screen has
generous margin.

So the mark is cropped to its own bounding box and re-placed at MARK_DP of the
108dp canvas, which is 61% of the visible circle - the proportion Material's
icon keylines use for a round glyph. It is composited onto a field of the
artwork's own background colour rather than onto transparency, which avoids
having to key that flat colour out and re-introduce anti-aliasing halos
around the ring.
"""
import pathlib
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("Pillow is required:  python3 -m pip install Pillow")

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "icons" / "icon-maskable-512.png"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

# Read the flat field the mark sits on rather than hard-coding it, so a
# re-coloured icon carries its own background through to the adaptive layer
# and the splash without anyone remembering to update a hex value here.
src = Image.open(SRC).convert("RGBA")
BG = src.getpixel((2, 2))[:3]
BG_HEX = "#%02X%02X%02X" % BG

# Legacy launcher icon, API 24-25. dp -> px at each density.
LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
# Adaptive foreground, API 26+. The canvas is 108dp at every density.
ADAPTIVE = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
# How much of that 108dp canvas the mark itself should occupy. 44dp reads as
# 61% of the 72dp the launcher actually shows. Raising this crowds the edge;
# lowering it makes the icon look timid next to its neighbours.
MARK_DP = 44.0
ADAPTIVE_CANVAS_DP = 108.0
# Capacitor's own splash dimensions, kept as generated so the drawable set
# stays the shape the theme already expects.
SPLASH = {
    "drawable": (480, 320),
    "drawable-port-mdpi": (320, 480), "drawable-land-mdpi": (480, 320),
    "drawable-port-hdpi": (480, 800), "drawable-land-hdpi": (800, 480),
    "drawable-port-xhdpi": (720, 1280), "drawable-land-xhdpi": (1280, 720),
    "drawable-port-xxhdpi": (960, 1600), "drawable-land-xxhdpi": (1600, 960),
    "drawable-port-xxxhdpi": (1280, 1920), "drawable-land-xxxhdpi": (1920, 1280),
}

LANCZOS = Image.Resampling.LANCZOS


def _artwork_bbox(img: Image.Image) -> tuple:
    """Tightest box around everything that is not the flat background field.

    Image.getbbox() is no use here: the source is opaque edge to edge, so it
    always answers with the whole canvas.
    """
    px = img.load()
    w, h = img.size
    x0, y0, x1, y1 = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 8 and abs(r - BG[0]) + abs(g - BG[1]) + abs(b - BG[2]) > 24:
                x0, y0 = min(x0, x), min(y0, y)
                x1, y1 = max(x1, x), max(y1, y)
    if x1 <= x0:
        return (0, 0, w, h)
    # Square it off around the centre so the mark is not subtly stretched.
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    half = max(x1 - x0, y1 - y0) / 2
    return (round(cx - half), round(cy - half), round(cx + half) + 1, round(cy + half) + 1)


def circular(img: Image.Image) -> Image.Image:
    """Mask to a circle for ic_launcher_round.

    Only API 24-25 reads this; from 26 the adaptive icon replaces it. Those
    launchers do not mask the bitmap themselves, so a square here shows up as
    a square on a platform whose whole visual language is round.
    """
    out = img.copy()
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, img.size[0] - 1, img.size[1] - 1), fill=255)
    out.putalpha(mask)
    return out


def write(img: Image.Image, path: pathlib.Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG", optimize=True)


written = 0
for density, px in LEGACY.items():
    square = src.resize((px, px), LANCZOS)
    write(square, RES / f"mipmap-{density}" / "ic_launcher.png")
    write(circular(square), RES / f"mipmap-{density}" / "ic_launcher_round.png")
    written += 2

# The mark on its own, without the source image's surrounding margin, so the
# placement below is driven by the artwork rather than by whatever padding the
# web icon happened to be drawn with.
mark = src.crop(_artwork_bbox(src))

for density, px in ADAPTIVE.items():
    canvas = Image.new("RGBA", (px, px), BG + (255,))
    size = max(1, round(px * MARK_DP / ADAPTIVE_CANVAS_DP))
    canvas.alpha_composite(mark.resize((size, size), LANCZOS),
                           ((px - size) // 2, (px - size) // 2))
    write(canvas, RES / f"mipmap-{density}" / "ic_launcher_foreground.png")
    written += 1

# Splash: the mark centred on the flat field, sized to a quarter of the
# shorter edge. Small on purpose - a splash that fills the screen reads as a
# loading state that has stalled, and this one is on screen for well under a
# second because every asset is already on the filesystem.
for folder, (w, h) in SPLASH.items():
    canvas = Image.new("RGBA", (w, h), BG + (255,))
    mark_px = max(96, int(min(w, h) * 0.22))
    canvas.alpha_composite(mark.resize((mark_px, mark_px), LANCZOS),
                           ((w - mark_px) // 2, (h - mark_px) // 2))
    write(canvas.convert("RGB").convert("RGBA"), RES / folder / "splash.png")
    written += 1

# Colours derived from the artwork itself, kept apart from the hand-written
# brand palette in values/colors.xml so regenerating cannot clobber it.
#
# The adaptive background layer is only ever seen if a launcher insets the
# foreground, which is opaque and full-bleed - matching it to the artwork's
# own field means that shows as more of the same colour rather than a seam.
(RES / "values").mkdir(parents=True, exist_ok=True)
(RES / "values" / "generated_icon_colors.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    "<resources>\n"
    f'    <color name="ic_launcher_background">{BG_HEX}</color>\n'
    f'    <color name="splashBackground">{BG_HEX}</color>\n'
    "</resources>\n"
)

# Capacitor ships a vector foreground in drawable-v24 that would win over the
# mipmap PNGs on API 24+. It is the Capacitor logo, so it has to go.
# Capacitor's placeholder vector foreground would win over the mipmap PNGs on
# API 24+, and its old colour file is superseded by generated_icon_colors.xml.
for stale in (RES / "drawable-v24" / "ic_launcher_foreground.xml",
              RES / "values" / "ic_launcher_background.xml"):
    if stale.exists():
        stale.unlink()
        print(f"removed stale {stale.name}")

print(f"android-assets: {written} images written from {SRC.name}, field {BG_HEX}")
