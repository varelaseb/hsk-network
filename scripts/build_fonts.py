#!/usr/bin/env python3
"""Cut the two vendored typefaces down to what the site and game show.

Spec: docs/specs/hsk-network.spec.html (#type-faces, #face-subset, #face-budget,
#face-coverage, #boundary-fonts, #stack-fonts).

Maintainer command, run only when the shown characters change. Needs fontTools and
brotli, so run it from a throwaway environment, never from CI:

  python3 -m venv /tmp/fonts-venv && /tmp/fonts-venv/bin/pip install fonttools brotli
  /tmp/fonts-venv/bin/python scripts/build_fonts.py

Reads site/fonts/source.json (pinned releases), site/data/graph.json, and the pages'
own text; writes site/fonts/*.woff2, their licenses, and site/fonts/coverage.json.
The tests import the character rules below with the standard library only.
"""

import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
FONTS = SITE / "fonts"
SOURCE = FONTS / "source.json"
COVERAGE = FONTS / "coverage.json"
GRAPH = SITE / "data" / "graph.json"

HAN, LATIN = "noto-sans-cjk-tc", "geist"
BUDGET = {HAN: 232_000, LATIN: 23_000, "total": 255_000}  # bytes, #face-budget
# Variable weight ranges kept (#face-cjk, #face-latin, #scale-weights).
WEIGHTS = {HAN: (400, 500), LATIN: (400, 600)}
# OpenType language systems whose locl forms ship: mainland and Taiwan (#face-lang).
# Japanese, Korean, and Hong Kong alternates are dropped; the site never tags those languages.
HAN_LANGS = {"ZHS ", "ZHT "}

ZHUYIN = "".join(chr(c) for c in range(0x3105, 0x312A))  # all 37 symbols, ㄅ to ㄩ
TONE_MARKS = "ˊˇˋ˙"
# CJK punctuation: the CJK Symbols and Punctuation block and the fullwidth punctuation.
CJK_PUNCT = [(0x3000, 0x303F), (0xFF01, 0xFF0F), (0xFF1A, 0xFF20), (0xFF3B, 0xFF40), (0xFF5B, 0xFF65)]
# Ranges drawn by the Chinese face; everything else falls to Geist (#face-stack).
HAN_RANGES = [(0x2E80, 0x2FFF), (0x3000, 0x9FFF), (0xF900, 0xFAFF), (0xFE30, 0xFE4F),
                 (0xFF00, 0xFFEF), (0x20000, 0x3FFFF)]
# Geist: Basic Latin, Latin-1, pinyin tone letters, combining tone marks, typographic punctuation.
PINYIN_LETTERS = "āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛÜ"
COMBINING_TONES = "̀́̄̌"
LATIN_RANGES = [(0x20, 0x7E), (0xA0, 0xFF), (0x2010, 0x2027), (0x2030, 0x203A), (0x20AC, 0x20AC),
                (0x2122, 0x2122), (0x2212, 0x2212)]


def is_han(ch):
    c = ord(ch)
    return ch in TONE_MARKS or any(lo <= c <= hi for lo, hi in HAN_RANGES)


def strings(value):
    """Every string in a JSON value, keys included."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for k, v in value.items():
            yield k
            yield from strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from strings(v)


def page_texts(site=SITE):
    """The pages' own text: every HTML, script, and style file except vendored and built ones."""
    for path in sorted(site.rglob("*")):
        rel = path.relative_to(site).parts
        if path.is_file() and path.suffix in {".html", ".js", ".css"} and rel[0] not in {"vendor", "data"}:
            yield path.read_text(encoding="utf-8")


def shown_chars(graph, texts):
    """Chinese-face characters the site and game can show: Traditional and Simplified, readings, refs, pages."""
    found = {ch for s in strings(graph) for ch in s if is_han(ch)}
    found |= {ch for t in texts for ch in t if is_han(ch)}
    return found | set(ZHUYIN) | set(TONE_MARKS)


def latin_chars():
    out = set(PINYIN_LETTERS) | set(COMBINING_TONES)
    for lo, hi in LATIN_RANGES:
        out |= {chr(c) for c in range(lo, hi + 1)}
    return out


def punct_chars():
    return {chr(c) for lo, hi in CJK_PUNCT for c in range(lo, hi + 1)}


def _fetch(url, sha256, name):
    """Download a pinned file into the ignored build cache and check its hash."""
    sys.path.insert(0, str(ROOT / "scripts"))
    import build_data
    path = build_data.CACHE_DIR / "fonts" / name
    if not path.exists():
        build_data.download(url, path)
    data = path.read_bytes()
    if sha256 and hashlib.sha256(data).hexdigest() != sha256:
        sys.exit(f"{name}: sha256 differs from site/fonts/source.json; delete the cache file or update the pin")
    return data


def _subset(data, wanted, features, weights, langs=None):
    from fontTools import subset
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
    font = TTFont(io.BytesIO(data), recalcTimestamp=False)  # same input, same bytes
    cmap = set(font.getBestCmap())
    font = instancer.instantiateVariableFont(font, {"wght": weights})
    if langs is not None:
        for tag in ("GSUB", "GPOS"):
            for rec in font[tag].table.ScriptList.ScriptRecord if tag in font else []:
                rec.Script.LangSysRecord = [ls for ls in rec.Script.LangSysRecord if ls.LangSysTag in langs]
                rec.Script.LangSysCount = len(rec.Script.LangSysRecord)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = sorted(set(opts.layout_features) | set(features))
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=sorted(ord(c) for c in wanted if ord(c) in cmap))
    sub.subset(font)
    out = io.BytesIO()
    font.flavor = "woff2"
    font.save(out)
    return out.getvalue(), {chr(c) for c in font.getBestCmap()}, {chr(c) for c in cmap}


def main():
    source = json.loads(SOURCE.read_text(encoding="utf-8"))["fonts"]
    graph = json.loads(GRAPH.read_text(encoding="utf-8"))
    need = shown_chars(graph, page_texts())
    coverage, total = {}, 0
    # Must-haves: a face lacking one of these fails the build. Geist has no precomposed
    # ǐ ǒ ǔ or ü with a tone, so pinyin needs the combining marks over plain letters.
    musts = {HAN: set(ZHUYIN) | set(TONE_MARKS),
             LATIN: {chr(c) for c in range(0x20, 0x7F)} | set("üÜ") | set(COMBINING_TONES)}
    for key, wanted, features, langs in ((HAN, need | punct_chars(), [], HAN_LANGS),
                                         (LATIN, latin_chars(), ["tnum"], None)):
        note = source[key]
        raw = _fetch(note["asset"], note["sha256"], note["asset"].rsplit("/", 1)[1])
        if "member" in note:
            raw = zipfile.ZipFile(io.BytesIO(raw)).read(note["member"])
        woff2, covered, cmap = _subset(raw, wanted, features, WEIGHTS[key], langs)
        if musts[key] - cmap:
            sys.exit(f"{note['family']} lacks {''.join(sorted(musts[key] - cmap))}")
        entry = {}
        if key == HAN:
            # Shown characters the face has no glyph for, such as rare hub parts (#face-missing):
            # named so the test allows exactly these; they fall back to the device font.
            entry["missing"] = "".join(sorted(need - cmap))
            if entry["missing"]:
                print(f"{note['family']} lacks {entry['missing']}", file=sys.stderr)
        name = f"{key}.woff2"
        (FONTS / name).write_bytes(woff2)
        lic = _fetch(note["licenseUrl"], None, f"{key}-{note['release']}-OFL.txt")
        (FONTS / f"{key}.OFL.txt").write_bytes(lic)
        coverage[key] = {"file": name, "bytes": len(woff2), "sha256": hashlib.sha256(woff2).hexdigest(),
                         "chars": "".join(sorted(covered)), **entry}
        total += len(woff2)
        print(f"{name}: {len(covered)} characters, {len(woff2)} bytes", file=sys.stderr)
        if len(woff2) > BUDGET[key]:
            sys.exit(f"{name} is over its {BUDGET[key]} byte budget")
    if total > BUDGET["total"]:
        sys.exit(f"fonts total {total} bytes, over the {BUDGET['total']} byte budget")
    COVERAGE.write_text(json.dumps(coverage, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
