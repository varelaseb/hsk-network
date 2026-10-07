#!/usr/bin/env python3
"""Draw the app icons and launch images.

Spec: docs/specs/hsk-app.spec.html (#default-icon, #default-identity, #default-launch,
#manifest-icons, #head-launch, #boundary-icon-build, #build-icon-cmd).

Maintainer command, run only when the icon or the look's colors change. Needs Pillow and
the pinned Noto Sans CJK TC release (site/fonts/source.json, fetched into the ignored cache
by the font command's own fetch), so run it from a throwaway environment, never from CI:

  python3 -m venv /tmp/fonts-venv && /tmp/fonts-venv/bin/pip install fonttools brotli pillow
  /tmp/fonts-venv/bin/python scripts/build_icons.py

Writes site/icons/*.png. The tests import the sizes and color rules below with the
standard library only.
"""

import io
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
ICONS = SITE / "icons"
STYLE = SITE / "style.css"

CHAR, ZHUYIN, TONE = "學", "ㄒㄩㄝ", "ˊ"
WEIGHT = 500  # medium (#default-icon)
ZHUYIN_ALPHA = 0.62  # Zhuyin in paper at lower contrast over night
SAFE = 0.40  # maskable safe circle radius, as a share of the side
HOME_ICON = ("apple-touch-icon.png", 180)
# file name: (side in pixels, manifest purpose)
MANIFEST_ICONS = {"icon-192.png": (192, "any"), "icon-512.png": (512, "any"),
                  "icon-maskable-512.png": (512, "maskable")}
# Current iPhone portrait screens: CSS width, CSS height, pixel ratio (#head-launch).
LAUNCH = [(440, 956, 3), (420, 912, 3), (430, 932, 3), (402, 874, 3), (393, 852, 3), (428, 926, 3),
          (390, 844, 3), (375, 812, 3), (414, 896, 3), (414, 896, 2), (375, 667, 2)]


# Appearance: launch image color, file name part (#head-launch: a paper and a night image per screen).
SCHEMES = {"light": ("paper", ""), "dark": ("night", "-dark")}


def launch_name(w, h, r, scheme="light"):
    return f"launch{SCHEMES[scheme][1]}-{w * r}x{h * r}.png"


def launch_media(w, h, r, scheme="light"):
    return (f"(device-width: {w}px) and (device-height: {h}px) and "
            f"(-webkit-device-pixel-ratio: {r}) and (orientation: portrait) and "
            f"(prefers-color-scheme: {scheme})")


def look_colors(css=None):
    """The shared look's paper and night, read from the stylesheet that owns them."""
    css = STYLE.read_text(encoding="utf-8") if css is None else css
    return {k: re.search(rf"--{k}:\s*(#[0-9a-fA-F]{{6}})\s*;", css).group(1).lower() for k in ("paper", "night")}


def png_size(data):
    """Width and height from a PNG header."""
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise ValueError("not a PNG")
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def _rgb(hex_color):
    return tuple(int(hex_color[i:i + 2], 16) for i in (1, 3, 5))


def _face():
    sys.path.insert(0, str(ROOT / "scripts"))
    import build_fonts as bf
    note = json.loads(bf.SOURCE.read_text(encoding="utf-8"))["fonts"][bf.HAN]
    raw = bf._fetch(note["asset"], note["sha256"], note["asset"].rsplit("/", 1)[1])
    return zipfile.ZipFile(io.BytesIO(raw)).read(note["member"])


def _font(face, px):
    from PIL import ImageFont
    font = ImageFont.truetype(io.BytesIO(face), px)
    font.set_variation_by_axes([WEIGHT])
    return font


def _ink(font, text):
    """Ink box of text drawn with its left-top anchor at the origin."""
    from PIL import Image, ImageDraw
    pad = font.size * 2
    img = Image.new("L", (pad * 2, pad * 2), 0)
    ImageDraw.Draw(img).text((pad, pad), text, font=font, fill=255, anchor="lt")
    x0, y0, x1, y1 = img.getbbox()
    return x0 - pad, y0 - pad, x1 - pad, y1 - pad


def _layout(face, em=1000):
    """(text, font, left-top position, ink box) of the character, the Zhuyin column at its right,
    and the tone mark, at a fixed em; positions place each ink box where it belongs."""
    char_font, zy_font, tone_font = _font(face, em), _font(face, round(em * 0.30)), _font(face, round(em * 0.22))
    cb = _ink(char_font, CHAR)
    parts = [(CHAR, char_font, (0, 0), cb)]
    boxes = [_ink(zy_font, sym) for sym in ZHUYIN]
    col_w = max(b[2] - b[0] for b in boxes)
    gap = em * 0.035
    col_h = sum(b[3] - b[1] for b in boxes) + gap * (len(boxes) - 1)
    left = cb[2] + em * 0.09  # narrow column just right of the character
    y = cb[1] + (cb[3] - cb[1] - col_h) / 2  # centered on the character
    for sym, b in zip(ZHUYIN, boxes):
        x = left + (col_w - (b[2] - b[0])) / 2  # each symbol centered in the column
        parts.append((sym, zy_font, (x - b[0], y - b[1]), b))
        last_top, last_h = y, b[3] - b[1]
        y += b[3] - b[1] + gap
    # Tone mark beside the last symbol, right of the column at its upper half (Taiwan textbook print).
    tb = _ink(tone_font, TONE)
    tx = left + col_w + em * 0.025
    ty = last_top + last_h * 0.3 - (tb[3] - tb[1]) / 2
    parts.append((TONE, tone_font, (tx - tb[0], ty - tb[1]), tb))
    return parts


def draw_icon(face, side, colors):
    from PIL import Image, ImageDraw
    night, paper = _rgb(colors["night"]), _rgb(colors["paper"])
    zy = tuple(round(n + (p - n) * ZHUYIN_ALPHA) for n, p in zip(night, paper))
    em = 1000
    parts = _layout(face, em)
    xs = [px + b[i] for _, _, (px, _), b in parts for i in (0, 2)]
    ys = [py + b[i] for _, _, (_, py), b in parts for i in (1, 3)]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    # Scale so the pair's whole box lies inside the maskable safe circle, with a little air.
    scale = (SAFE * 0.94 * side * 2) / (w * w + h * h) ** 0.5
    ox = side / 2 - (min(xs) + w / 2) * scale
    oy = side / 2 - (min(ys) + h / 2) * scale
    img = Image.new("RGB", (side, side), night)
    d = ImageDraw.Draw(img)
    for i, (text, font, (px, py), _) in enumerate(parts):
        f = _font(face, max(1, round(font.size * scale)))
        d.text((ox + px * scale, oy + py * scale), text, font=f, fill=paper if i == 0 else zy, anchor="lt")
    return img


def _save(img, name):
    out = io.BytesIO()
    img.save(out, "PNG", optimize=True)
    (ICONS / name).write_bytes(out.getvalue())
    print(f"{name}: {img.size[0]}x{img.size[1]}, {out.tell()} bytes", file=sys.stderr)


def main():
    colors = look_colors()
    face = _face()
    ICONS.mkdir(exist_ok=True)
    for name, (side, _) in MANIFEST_ICONS.items():
        _save(draw_icon(face, side, colors), name)
    _save(draw_icon(face, HOME_ICON[1], colors), HOME_ICON[0])
    for scheme, (color, _) in SCHEMES.items():
        for w, h, r in LAUNCH:
            _save(_plain(w * r, h * r, colors[color]), launch_name(w, h, r, scheme))


def _plain(w, h, color):
    from PIL import Image
    img = Image.new("P", (w, h), 0)
    img.putpalette(list(_rgb(color)))
    return img


if __name__ == "__main__":
    main()
