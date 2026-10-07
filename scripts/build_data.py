#!/usr/bin/env python3
"""Build site/data/graph.json, site/data/drawing.json, and site/audio/ from the HSK lists, CC-CEDICT, audio-cmn, Unihan, BabelStone IDS, and GlyphWiki.

Spec: docs/specs/hsk-network.spec.html (#data, #match-rules, #zhuyin-tones,
#schema-example, #schema-sense, #senses-table, #graph-model, #chars-table, #chars-words, #hub-reading, #char-coverage, #breakdown-rules,
#drawing-rules, #drawing-file, #drawing-schema, #audio-rules, #syllable-audio-rules, #schema-syllables).
Python standard library only.

Usage: python3 scripts/build_data.py [--cedict PATH] [--refresh]
"""

import argparse
import datetime
import gzip
import json
import os
import re
import sys
import tarfile
import tempfile
import unicodedata
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HSK_DIR = ROOT / "data" / "hsk"
AUDIO_NOTE = ROOT / "data" / "audio" / "source.json"
AUDIO_OUT = ROOT / "site" / "audio"
AUDIO_CREDITS = AUDIO_OUT / "CREDITS.txt"
SYLLABLE_OUT = AUDIO_OUT / "s"
OVERRIDES = ROOT / "data" / "overrides.json"
OUT = ROOT / "site" / "data" / "graph.json"
CACHE_DIR = ROOT / ".cache"
CEDICT_URL = "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz"
CEDICT_CACHE = CACHE_DIR / "cedict_1_0_ts_utf-8_mdbg.txt.gz"
UNIHAN_VERSION = "18.0.0"
UNIHAN_URL = f"https://www.unicode.org/Public/{UNIHAN_VERSION}/ucd/Unihan.zip"
RADICALS_URL = f"https://www.unicode.org/Public/{UNIHAN_VERSION}/ucd/CJKRadicals.txt"
UNIHAN_CACHE = CACHE_DIR / f"unicode-{UNIHAN_VERSION}"
IDS_URL = "https://babelstone.co.uk/CJK/IDS.TXT"
IDS_CACHE = CACHE_DIR / "IDS.TXT"
GLYPHWIKI_URL = "https://glyphwiki.org/dump.tar.gz"
GLYPHWIKI_CACHE = CACHE_DIR / "glyphwiki"
GLYPHWIKI_MEMBERS = ("dump_newest_only.txt", "LICENSE.txt")
DRAWING_OUT = ROOT / "site" / "data" / "drawing.json"
DRAWING_LICENSE = ROOT / "site" / "data" / "glyphwiki-LICENSE.txt"
DOWNLOAD_TIMEOUT = 60  # seconds
USER_AGENT = "hsk-network-build"  # GlyphWiki's host refuses the default Python agent
LEVELS = (1, 2)
POINTER_PREFIXES = ("variant of", "old variant of", "see ", "surname ")


class BuildError(Exception):
    """Carries every failing entry so the build reports them all at once."""

    def __init__(self, problems):
        super().__init__("\n".join(problems))
        self.problems = problems


# ---------------------------------------------------------------- pinyin

_TONE_MARKS = {"̄": 1, "́": 2, "̌": 3, "̀": 4}


def toned_syllable_to_numbered(syl):
    """'xué' -> 'xue2', 'nǚ' -> 'nu:3', 'ba' -> 'ba5'. Keeps case."""
    tone = 5
    out = []
    for ch in unicodedata.normalize("NFD", syl):
        if ch in _TONE_MARKS:
            tone = _TONE_MARKS[ch]
        elif ch == "̈":  # combining diaeresis: ü
            out.append(":")
        else:
            out.append(ch)
    return "".join(out) + str(tone)


def normalize_numbered(syllables):
    """Lowercase numbered syllables, missing tone as 5, ü/v as u:."""
    out = []
    for syl in syllables:
        s = syl.lower().replace("ü", "u:").replace("v", "u:")
        if not s[-1].isdigit():
            s += "5"
        out.append(s)
    return " ".join(out)


def normalize_toned(pinyin):
    return normalize_numbered(toned_syllable_to_numbered(s) for s in pinyin.split())


def is_capitalized(pinyin):
    return any(c.isupper() for c in pinyin)


# ---------------------------------------------------------------- zhuyin

_INITIALS = {
    "b": "ㄅ", "p": "ㄆ", "m": "ㄇ", "f": "ㄈ", "d": "ㄉ", "t": "ㄊ", "n": "ㄋ",
    "l": "ㄌ", "g": "ㄍ", "k": "ㄎ", "h": "ㄏ", "j": "ㄐ", "q": "ㄑ", "x": "ㄒ",
    "zh": "ㄓ", "ch": "ㄔ", "sh": "ㄕ", "r": "ㄖ", "z": "ㄗ", "c": "ㄘ", "s": "ㄙ",
}
_FINALS = {
    "a": "ㄚ", "o": "ㄛ", "e": "ㄜ", "ai": "ㄞ", "ei": "ㄟ", "ao": "ㄠ", "ou": "ㄡ",
    "an": "ㄢ", "en": "ㄣ", "ang": "ㄤ", "eng": "ㄥ", "ong": "ㄨㄥ",
    "i": "ㄧ", "ia": "ㄧㄚ", "ie": "ㄧㄝ", "iao": "ㄧㄠ", "iu": "ㄧㄡ", "ian": "ㄧㄢ",
    "in": "ㄧㄣ", "iang": "ㄧㄤ", "ing": "ㄧㄥ", "iong": "ㄩㄥ",
    "u": "ㄨ", "ua": "ㄨㄚ", "uo": "ㄨㄛ", "uai": "ㄨㄞ", "ui": "ㄨㄟ", "uan": "ㄨㄢ",
    "un": "ㄨㄣ", "uang": "ㄨㄤ",
    "u:": "ㄩ", "u:e": "ㄩㄝ", "u:an": "ㄩㄢ", "u:n": "ㄩㄣ",
}
# Syllables without an initial, spelled with y/w, plus standalone forms.
_ZERO_INITIAL = {
    "a": "ㄚ", "o": "ㄛ", "e": "ㄜ", "ê": "ㄝ", "ai": "ㄞ", "ei": "ㄟ", "ao": "ㄠ",
    "ou": "ㄡ", "an": "ㄢ", "en": "ㄣ", "ang": "ㄤ", "eng": "ㄥ", "er": "ㄦ",
    "yi": "ㄧ", "ya": "ㄧㄚ", "yo": "ㄧㄛ", "ye": "ㄧㄝ", "yai": "ㄧㄞ", "yao": "ㄧㄠ",
    "you": "ㄧㄡ", "yan": "ㄧㄢ", "yin": "ㄧㄣ", "yang": "ㄧㄤ", "ying": "ㄧㄥ",
    "yong": "ㄩㄥ", "wu": "ㄨ", "wa": "ㄨㄚ", "wo": "ㄨㄛ", "wai": "ㄨㄞ", "wei": "ㄨㄟ",
    "wan": "ㄨㄢ", "wen": "ㄨㄣ", "wang": "ㄨㄤ", "weng": "ㄨㄥ", "yu": "ㄩ",
    "yue": "ㄩㄝ", "yuan": "ㄩㄢ", "yun": "ㄩㄣ",
    "m": "ㄇ", "n": "ㄋ", "ng": "ㄫ", "hm": "ㄏㄇ", "hng": "ㄏㄫ",
}
_BUZZ = {"zh", "ch", "sh", "r", "z", "c", "s"}  # zhi chi shi ri zi ci si
_PALATAL = {"j", "q", "x"}  # ju = jü


def _build_syllable_table():
    table = dict(_ZERO_INITIAL)
    for ini, zi in _INITIALS.items():
        for fin, zf in _FINALS.items():
            if ini in _PALATAL and fin[0] not in "iu":
                continue
            if ini in _PALATAL and fin.startswith("u") and not fin.startswith("u:"):
                continue
            table[ini + fin] = zi + zf
    for ini in _BUZZ:  # zhi chi shi ri zi ci si: initial alone
        table[ini + "i"] = _INITIALS[ini]
    for ini in _PALATAL:  # ju, jue, juan, jun spell ü as u
        for fin in ("", "e", "an", "n"):
            table[ini + "u" + fin] = _INITIALS[ini] + _FINALS["u:" + fin]
    return table


SYLLABLES = _build_syllable_table()
_TONE_SUFFIX = {1: "", 2: "ˊ", 3: "ˇ", 4: "ˋ"}


def syllable_to_zhuyin(numbered):
    """'xue2' -> 'ㄒㄩㄝˊ', 'men5' -> '˙ㄇㄣ', 'r5' -> 'ㄦ' (erhua).

    Takes one syllable as normalize_numbered emits it: lowercase, ü as u:,
    tone digit 1 to 5.
    """
    base, tone = numbered[:-1], int(numbered[-1])
    if base == "r":
        return "ㄦ"
    if base not in SYLLABLES:
        raise ValueError(f"unknown pinyin syllable: {numbered}")
    bopo = SYLLABLES[base]
    if tone == 5:
        return "˙" + bopo
    return bopo + _TONE_SUFFIX[tone]


def to_zhuyin(numbered_pinyin):
    return " ".join(syllable_to_zhuyin(s) for s in numbered_pinyin.split())


# ---------------------------------------------------------------- CC-CEDICT

_LINE = re.compile(r"^(\S+) (\S+) \[([^\]]*)\] /(.*)/\s*$")


def parse_cedict(lines):
    """Return (entries, release). Entries keep dictionary order."""
    entries = []
    release = None
    for line in lines:
        if line.startswith("#"):
            m = re.match(r"#! date=(\d{4}-\d{2}-\d{2})", line)
            if m:
                release = m.group(1)
            continue
        m = _LINE.match(line)
        if not m:
            continue
        trad, simp, pinyin, defs = m.groups()
        entries.append({
            "trad": trad,
            "simp": simp,
            "raw_pinyin": pinyin,
            "pinyin": normalize_numbered(pinyin.split()),
            "cap": is_capitalized(pinyin),
            "defs": defs.split("/"),
        })
    return entries, release


def download(url, path):
    """Fetch url into path atomically: a failed or partial fetch leaves no file."""
    CACHE_DIR.mkdir(exist_ok=True)
    (CACHE_DIR / ".gitignore").write_text("*\n")
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {url}", file=sys.stderr)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".part")
    try:
        with os.fdopen(fd, "wb") as f, urllib.request.urlopen(
            urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=DOWNLOAD_TIMEOUT) as r:
            f.write(r.read())
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp)
        raise


def load_cedict(path=None, refresh=False):
    if path is None:
        path = CEDICT_CACHE
        if refresh or not path.exists():
            download(CEDICT_URL, path)
    path = Path(path)
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as f:
        return parse_cedict(f)


# ---------------------------------------------------------------- matching


def _merge(cands):
    """#match-merge, #match-drop: raw definitions, dictionary order, de-duplicated."""
    defs = []
    for c in cands:
        for d in c["defs"]:
            if d not in defs:
                defs.append(d)
    kept = [d for d in defs if not d.startswith(POINTER_PREFIXES)]
    return kept or defs


# ---------------------------------------------------------------- senses

_HAN_CHAR = r"[\u3006\u3007\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0003ffff·]"
_HAN = rf"[0-9A-Za-z]*(?:{_HAN_CHAR}[0-9A-Za-z]*)+"  # a cited form: Han, maybe with digits or Latin
_CITE = rf"({_HAN})(?:\|({_HAN}))?\[([^\[\]]*)\]"
_TOKEN = re.compile(rf"{_CITE}|\[([^\[\]]*)\]")
_CL_LIST = rf"CL:\s*{_HAN}(?:\|{_HAN})?\[[^\[\]]*\](?:\s*,\s*{_HAN}(?:\|{_HAN})?\[[^\[\]]*\])*"
_CL_PAREN = re.compile(rf"\s*\(\s*({_CL_LIST})\s*\)")
_CL_BARE = re.compile(rf"[\s;,]*({_CL_LIST})")
_LEADING_TAG = re.compile(r"^\(([^()]*)\)\s*(\S.*)$")
_SYLLABLE = re.compile(r"[A-Za-zü:]+[1-5]")
_NUMBERED = re.compile(r"\b([A-Za-zü:]+)([1-5])\b")
# #sense-tag: tags that open a sense, abbreviations spelled out.
TAGS = {"coll.": "colloquial", "Tw": "Taiwan", "lit.": "literally", "fig.": "figuratively",
        "math.": "mathematics", "abbr.": "short for", "onom.": "onomatopoeia",
        **{t: t for t in ("bound form", "literary", "classical", "archaic", "old", "dialect",
                          "Beijing dialect", "slang", "loanword", "polite", "vulgar",
                          "military", "sports", "physics")}}
# #sense-pr, #sense-abbr: spelled out in plain text, in this order.
_SPELL = [(re.compile(r"\bTaiwan pr\."), "Taiwan reading"), (re.compile(r"\bpr\."), "pronounced"),
          (re.compile(r"\bsb\b"), "someone"), (re.compile(r"\bsth\b"), "something"),
          (re.compile(r"\besp\."), "especially")]


def _pinyin(text):
    """CC-CEDICT bracket text -> (pinyin, zhuyin), or None when it is not pinyin.

    Takes CC-CEDICT's spellings 'zhi1dao5' and 'nu : 3'; pinyin keeps its case
    as numbered syllables separated by one space."""
    text = re.sub(r"\s*:\s*", ":", text)
    syllables = _SYLLABLE.findall(text)
    if not syllables or "".join(syllables) != "".join(text.split()):
        return None
    try:
        return " ".join(syllables), to_zhuyin(normalize_numbered(syllables))
    except ValueError:
        return None


def _ref(trad, simp, bracket):
    """#sense-ref: a citation -> reference, or None when its bracket is not pinyin."""
    py = _pinyin(bracket)
    if py is None:
        return None
    return {"trad": trad, "simp": simp or trad, "pinyin": py[0], "zhuyin": py[1]}


def _spell(text):
    for pattern, words in _SPELL:
        text = pattern.sub(words, text)
    return text


def parse_sense(definition):
    """#senses-table: one CC-CEDICT definition -> (sense or None, measure words).

    sense: {"tag"?, "parts": [text | reference]}; None when nothing is left
    after its "CL:" lists leave (#sense-cl). Measure words are references in
    order, as cited."""
    mw = []

    def take(m):
        for item in m.group(1)[3:].split(","):
            cm = re.fullmatch(_CITE, item.strip())
            mw.append(_ref(cm.group(1), cm.group(2), cm.group(3)) or item.strip())
        return ""

    text = _CL_BARE.sub(take, _CL_PAREN.sub(take, definition)).strip(" ;,")
    if any(isinstance(m, str) for m in mw):
        raise ValueError(f"measure word without pinyin: {definition!r}")
    sense = {}
    m = _LEADING_TAG.match(text)
    if m and m.group(1) in TAGS:
        sense["tag"], text = TAGS[m.group(1)], m.group(2)
    parts, at = [], 0
    for m in _TOKEN.finditer(text):
        ref = _ref(*m.group(1, 2, 3)) if m.group(1) else _pinyin(m.group(4))
        if ref is None:
            continue
        if isinstance(ref, tuple):  # #sense-pr: a reading reference
            ref = {"pinyin": ref[0], "zhuyin": ref[1]}
        parts += [_spell(text[at:m.start()]), ref]
        at = m.end()
    parts.append(_spell(text[at:]))
    parts = [p for p in parts if p != ""]
    if not any(not isinstance(p, str) or p.strip() for p in parts):
        return None, mw
    sense["parts"] = parts
    return sense, mw


def simplified_only(cedict_entries):
    """#sense-fail: characters CC-CEDICT knows only as a Simplified form."""
    trad = {ch for e in cedict_entries for ch in e["trad"]}
    return {ch for e in cedict_entries for ch in e["simp"]} - trad


def senses(definitions, simp_only=frozenset()):
    """#senses-table, #sense-fail: definitions -> {"defs": [sense], "mw"?: [reference]}.

    Raises ValueError naming a sense whose plain text still holds a Simplified-only
    character, a tone-numbered syllable, a vertical bar, or a square bracket."""
    defs, mw = [], []
    for d in definitions:
        sense, found = parse_sense(d)
        mw += [r for r in found if r not in mw]
        if sense is None:
            continue
        plain = "".join(p for p in sense["parts"] if isinstance(p, str))
        bad = ("|" in plain or "[" in plain or "]" in plain
               or any(ch in simp_only for ch in plain)
               or any(b.lower() == "r" or b.lower().replace("v", "u:") in SYLLABLES
                      for b, _ in _NUMBERED.findall(plain)))
        if bad:
            raise ValueError(f"unclean sense {d!r}")
        defs.append(sense)
    return {"defs": defs, **({"mw": mw} if mw else {})}


def match_entry(entry, index, override=None):
    """Return (trad, numbered pinyin, defs) or raise ValueError with reason.

    entry: {"simp", "pinyin" (toned)}; index: simp -> [cedict entries].
    override: {"trad", "pinyin"} naming the CC-CEDICT entry to use, or, for a
    word CC-CEDICT lacks, {"trad", "pinyin", "defs"} giving it outright.
    """
    if override and "defs" in override:
        return override["trad"], normalize_numbered(override["pinyin"].split()), override["defs"]
    if override:
        want = normalize_numbered(override["pinyin"].split())
    else:
        want = normalize_toned(entry["pinyin"])
    cands = [c for c in index.get(entry["simp"], []) if c["pinyin"] == want]
    if len({c["cap"] for c in cands}) > 1:
        cap = is_capitalized(override["pinyin"] if override else entry["pinyin"])
        cands = [c for c in cands if c["cap"] == cap]
    if override:
        cands = [c for c in cands if c["trad"] == override["trad"]]
        if not cands:
            raise ValueError(f"override {override['trad']} [{override['pinyin']}] matches no CC-CEDICT entry")
    if not cands:
        raise ValueError("no CC-CEDICT candidate")
    trads = sorted({c["trad"] for c in cands})
    if len(trads) > 1:
        raise ValueError(f"differing Traditional forms {', '.join(trads)}")
    return trads[0], want, _merge(cands)


def index_by_simp(entries):
    index = {}
    for e in entries:
        index.setdefault(e["simp"], []).append(e)
    return index


# ---------------------------------------------------------------- graph


def build_links(words):
    """Hubs for chars in 2+ words; each word links once per distinct char."""
    count = {}
    for w in words:
        for ch in dict.fromkeys(w["trad"]):
            count[ch] = count.get(ch, 0) + 1
    hubs, links, seen = [], [], set()
    for w in words:
        for ch in dict.fromkeys(w["trad"]):
            if count[ch] < 2:
                continue
            if ch not in seen:
                seen.add(ch)
                hubs.append({"id": f"c-{ch}", "char": ch})
            links.append({"word": w["id"], "hub": f"c-{ch}"})
    return hubs, links


def char_readings(char, single, mandarin=None, simp_only=frozenset()):
    """#hub-reading: one reading per distinct pinyin of char's own entries.

    single: single_char_index(). Entries by Traditional form, else by Simplified
    form for a radical or part that is a character only as written there
    (#breakdown-zhuyin). Lowercase entries only, capitalized ones only when no
    lowercase exists. mandarin: char's first Unihan kMandarin value (toned);
    the reading matching it comes first, the rest stay in dictionary order.
    Each reading's definitions become senses (#sense-scope).
    Raises ValueError when char has no entry, a reading has no Zhuyin, or a
    sense is unclean (#sense-fail).
    """
    cands = single[0].get(char) or single[1].get(char, [])
    if not cands:
        raise ValueError(f"{char} has no CC-CEDICT entry")
    cands = [c for c in cands if not c["cap"]] or cands
    groups = {}
    for c in cands:
        groups.setdefault(c["pinyin"], []).append(c)
    standard = mandarin and normalize_toned(mandarin)
    if standard in groups:
        groups = {standard: groups.pop(standard), **groups}
    return [{"pinyin": py, "zhuyin": to_zhuyin(py), **senses(_merge(cs), simp_only)}
            for py, cs in groups.items()]


def char_simp(char, single, mandarin=None, in_words=None):
    """#stack-script: char's Simplified form: as the HSK words write it (in_words),
    else from the CC-CEDICT entries of its standard reading (#hub-reading order),
    else char itself when no entry has it as Traditional form."""
    if in_words:
        return in_words
    cands = single[0].get(char, [])
    cands = [c for c in cands if not c["cap"]] or cands
    if not cands:
        return char
    standard = mandarin and normalize_toned(mandarin)
    return next((c for c in cands if c["pinyin"] == standard), cands[0])["simp"]


def load_hsk():
    """Return list of {"id", "level", "simp", "pinyin"} in list order."""
    entries = []
    for level in LEVELS:
        rows = json.loads((HSK_DIR / f"hsk-level-{level}.json").read_text(encoding="utf-8"))
        for pos, row in enumerate(rows, 1):
            entries.append({"id": f"{level}-{pos}", "level": level,
                            "simp": row["hanzi"], "pinyin": row["pinyin"]})
    return entries


def load_overrides(path=OVERRIDES):
    """Return id -> override. Raises BuildError naming any duplicated id."""
    if not Path(path).exists():
        return {}
    overrides, dups = {}, []
    for o in json.loads(Path(path).read_text(encoding="utf-8")):
        if o["id"] in overrides and o["id"] not in dups:
            dups.append(o["id"])
        overrides[o["id"]] = o
    if dups:
        raise BuildError([f"{i}: duplicate override id" for i in dups])
    return overrides


def hsk_source():
    src = json.loads((HSK_DIR / "source.json").read_text(encoding="utf-8"))
    return f"{src['url']}@{src['commit']}"


def audio_note():
    return json.loads(AUDIO_NOTE.read_text(encoding="utf-8"))


def audio_source():
    note = audio_note()
    return f"{note['url']}@{note['commit']}"


# ---------------------------------------------------------------- breakdown

# Ideographic Description Characters and their operand counts.
_IDC_ARITY = {chr(c): 2 for c in range(0x2FF0, 0x3000)}
_IDC_ARITY.update({"⿲": 3, "⿳": 3, "⿾": 1, "⿿": 1, "㇯": 2})
_IDS_TOKEN = re.compile(r"\{\d+\}|.")
_RADICAL_WORD = re.compile(r"radical", re.I)


def parse_unihan(fields):
    """Lines of Unihan_*.txt -> (kRSUnicode first value, kDefinition, kMandarin
    first value) by character."""
    rs, kdef, mandarin = {}, {}, {}
    for line in fields:
        p = line.rstrip("\n").split("\t")
        if len(p) != 3 or not p[0].startswith("U+"):
            continue
        ch = chr(int(p[0][2:], 16))
        if p[1] == "kRSUnicode":
            rs[ch] = p[2].split()[0]
        elif p[1] == "kDefinition":
            kdef[ch] = p[2]
        elif p[1] == "kMandarin":
            mandarin[ch] = p[2].split()[0]
    return rs, kdef, mandarin


def parse_radicals(lines):
    """CJKRadicals.txt -> {radical number as written: CJK unified ideograph}."""
    out = {}
    for line in lines:
        line = line.split("#")[0].strip()
        if line:
            num, _, uni = (f.strip() for f in line.split(";"))
            out[num] = chr(int(uni, 16))
    return out


def parse_ids(lines):
    """BabelStone IDS.TXT -> ({char: [sequence fields]}, file date)."""
    ids, date = {}, None
    for line in lines:
        line = line.lstrip("\ufeff").rstrip("\r\n")
        if line.startswith("#"):
            m = re.match(r"# File Date: (\d{4}-\d{2}-\d{2})", line)
            if m:
                date = m.group(1)
            continue
        p = line.split("\t")
        if len(p) > 2:
            ids[p[1]] = p[2:]
    return ids, date


def ids_parts(char, sequences):
    """#breakdown-parts, #breakdown-single: top-level components, deduplicated.

    Uses the first sequence tagged T, else the first. A component that is
    itself a nested description is returned as its description string.
    """
    tagged = [s for s in sequences if "T" in s.partition("$")[2]]
    seq = (tagged or sequences)[0].partition("$")[0].lstrip("^").lstrip("〾")
    tokens = _IDS_TOKEN.findall(seq)

    def operand(i):  # -> index after the operand starting at i
        n = _IDC_ARITY.get(tokens[i], 0)
        i += 1
        for _ in range(n):
            i = operand(i)
        return i

    if not tokens or tokens[0] not in _IDC_ARITY:
        return [] if "".join(tokens) == char else ["".join(tokens)]
    parts, i = [], 1
    while i < len(tokens):
        j = operand(i)
        parts.append("".join(tokens[i:j]))
        i = j
    return list(dict.fromkeys(parts))


def meaning(kdefinition):
    """#breakdown-meaning: first clause not naming a radical, no parentheses, cut at comma."""
    for clause in (kdefinition or "").split(";"):
        if _RADICAL_WORD.search(clause):
            continue
        text = re.sub(r"\([^)]*\)", "", clause).split(",")[0].strip()
        if text:
            return text
    return None


def is_character(ch, single):
    """#breakdown-zhuyin: ch has a lowercase entry, by Traditional then Simplified
    form, with a definition not mentioning "radical"."""
    by_trad, by_simp = ([e for e in ix.get(ch, []) if not e["cap"]] for ix in single)
    pool = by_trad or by_simp
    return any(not _RADICAL_WORD.search(d) for e in pool for d in _merge([e]))


def single_char_index(cedict_entries):
    """({char: [entries by Traditional form]}, {char: [by Simplified form]}),
    single-character CC-CEDICT entries in dictionary order, capitalized included."""
    by_trad, by_simp = {}, {}
    for e in cedict_entries:
        if len(e["trad"]) == 1:
            by_trad.setdefault(e["trad"], []).append(e)
        if len(e["simp"]) == 1:
            by_simp.setdefault(e["simp"], []).append(e)
    return by_trad, by_simp


def hub_breakdown(char, chars, override=None):
    """#breakdown-rules: return (radical, parts, meanings) or raise ValueError naming what failed.

    radical: {"char", "number"}; parts: [char]; meanings: [(char, meaning)] for
    the radical, then each part.
    chars: {"rs", "kdef", "mandarin", "radicals", "ids"} from Unihan, CJKRadicals, and IDS.
    override: may hold "parts" ([{"char", "meaning"}], or [] for none) replacing
    the derived parts, and "radicalMeaning" replacing the derived radical meaning.
    """
    override = override or {}
    if char not in chars["rs"]:
        raise ValueError("no kRSUnicode")
    num = chars["rs"][char].split(".")[0]
    rad = chars["radicals"][num]
    rad_meaning = override.get("radicalMeaning") or meaning(chars["kdef"].get(rad))
    if not rad_meaning:
        raise ValueError(f"radical {rad} has no meaning")
    radical = {"char": rad, "number": int(num.rstrip("'"))}
    if "parts" in override:
        parts = {p["char"]: p["meaning"] for p in override["parts"]}
    else:
        if char not in chars["ids"]:
            raise ValueError("no IDS sequence")
        parts = {p: rad_meaning if p == rad else meaning(chars["kdef"].get(p)) if len(p) == 1 else None
                 for p in ids_parts(char, chars["ids"][char])}
        missing = [p for p, m in parts.items() if not m]
        if missing:
            raise ValueError(f"part {', '.join(missing)} has no meaning")
    return radical, list(parts), [(rad, rad_meaning), *parts.items()]


def build(cedict_entries, release, hsk_entries, overrides, chars):
    index = index_by_simp(cedict_entries)
    simp_only = simplified_only(cedict_entries)
    words, problems = [], []
    for e in hsk_entries:
        override = overrides.get(e["id"])
        try:
            if override and override["simp"] != e["simp"]:
                raise ValueError(f"override names {override['simp']}, list has {e['simp']}")
            trad, pinyin, defs = match_entry(e, index, override)
            zhuyin = to_zhuyin(pinyin)
            cleaned = senses(defs, simp_only)
        except ValueError as err:
            problems.append(f"{e['id']} {e['simp']} [{e['pinyin']}]: {err}")
            continue
        words.append({"id": e["id"], "level": e["level"], "trad": trad,
                      "simp": e["simp"], "pinyin": pinyin, "zhuyin": zhuyin,
                      **cleaned})
    hub_overrides = {i: o for i, o in overrides.items() if i.startswith("c-")}
    unused = sorted(i for i in set(overrides) - set(hub_overrides) - {e["id"] for e in hsk_entries}
                    if not i.startswith("s-"))
    problems += [f"{i}: override names no HSK entry" for i in unused]
    if problems:
        raise BuildError(problems)
    hubs, links = build_links(words)
    single = single_char_index(cedict_entries)
    table = {}  # #chars-table: char -> {"simp", "readings"?, "meaning"?}

    def readings(ch):
        entry = table.setdefault(ch, {})
        if "readings" not in entry:
            entry["readings"] = char_readings(ch, single, chars.get("mandarin", {}).get(ch), simp_only)
        return entry["readings"]

    for w in words:  # #chars-words
        if len(w["trad"]) != 1:
            continue
        try:
            pinyins = [r["pinyin"] for r in readings(w["trad"])]
            if w["pinyin"] not in pinyins:
                raise ValueError(f"reading {w['pinyin']} missing from {w['trad']}'s entry")
        except ValueError as err:
            problems.append(f"{w['id']} {w['simp']}: {err}")
            continue
        del w["zhuyin"], w["defs"]
        w.pop("mw", None)
        w["reading"] = pinyins.index(w["pinyin"])
    for w in words:  # #char-coverage: every character of every word
        for ch in dict.fromkeys(w["trad"]):
            try:
                readings(ch)
            except ValueError as err:
                problems.append(f"{w['id']} {w['simp']}: {err}")
    for h in hubs:  # a hub's character is a word's, so it has its readings
        try:
            override = hub_overrides.get(h["id"])
            if override and override["char"] != h["char"]:
                raise ValueError(f"override names {override['char']}")
            h["radical"], h["parts"], meanings = hub_breakdown(h["char"], chars, override)
            for ch, m in meanings:
                entry = table.setdefault(ch, {})
                if entry.setdefault("meaning", m) != m:
                    raise ValueError(f"{ch} has differing meanings {entry['meaning']}, {m}")
                if is_character(ch, single):
                    readings(ch)
        except ValueError as err:
            problems.append(f"{h['id']} {h['char']}: {err}")
    in_words = {}  # trad char -> Simplified as the first word containing it writes it
    for w in words:
        for t, s in zip(w["trad"], w["simp"]):
            in_words.setdefault(t, s)
    for ch, entry in table.items():
        simp = char_simp(ch, single, chars.get("mandarin", {}).get(ch), in_words.get(ch))
        table[ch] = {"simp": simp, **entry}
    problems += [f"{i}: override names no hub"
                 for i in sorted(set(hub_overrides) - {h["id"] for h in hubs})]
    if problems:
        raise BuildError(problems)
    return {"meta": {"cedictRelease": release, "hskSource": hsk_source(),
                     "audioSource": audio_source(), "unihanVersion": chars.get("unihanVersion"),
                     "idsDate": chars.get("idsDate")},
            "words": words, "chars": table, "hubs": hubs, "links": links}


def load_chars(refresh=False):
    """Download (once) and parse Unihan, CJKRadicals, and IDS into build()'s chars."""
    zpath, rpath = UNIHAN_CACHE / "Unihan.zip", UNIHAN_CACHE / "CJKRadicals.txt"
    for url, path in ((UNIHAN_URL, zpath), (RADICALS_URL, rpath)):
        if not path.exists():
            download(url, path)
    if refresh or not IDS_CACHE.exists():
        download(IDS_URL, IDS_CACHE)
    with zipfile.ZipFile(zpath) as z:
        lines = [l for name in ("Unihan_IRGSources.txt", "Unihan_Readings.txt")
                 for l in z.read(name).decode("utf-8").splitlines()]
    rs, kdef, mandarin = parse_unihan(lines)
    radicals = parse_radicals(rpath.read_text(encoding="utf-8").splitlines())
    ids, date = parse_ids(IDS_CACHE.read_text(encoding="utf-8").splitlines())
    return {"rs": rs, "kdef": kdef, "mandarin": mandarin, "radicals": radicals, "ids": ids,
            "unihanVersion": UNIHAN_VERSION, "idsDate": date}


# ---------------------------------------------------------------- drawing

_GLYPH_CODE = re.compile(r"u([0-9a-f]{4,6})(?=-|$)")
# KAGE points per stroke type (type 1 line, 2 curve, 3 and 4 bends, 6 double curve,
# 7 line then curve); a type not listed keeps every point it has.
_KAGE_POINTS = {1: 2, 2: 3, 3: 3, 4: 3, 6: 4, 7: 4}
_ALIAS_BOX = ["0", "0", "0", "0", "200", "200"]


def parse_glyphwiki(lines):
    """GlyphWiki dump_newest_only.txt lines -> {glyph name: KAGE data}."""
    glyphs = {}
    for line in lines:
        p = line.split("|")
        if len(p) == 3:
            glyphs[p[0].strip()] = p[2].strip()
    return glyphs


def glyph_code(name):
    """The character a GlyphWiki glyph name stands for, such as 訁 for u8a01-tv01@3, or None."""
    m = _GLYPH_CODE.match(name.split("@")[0])
    return chr(int(m.group(1), 16)) if m else None


def _kage_type(fields):
    """A KAGE line's stroke type; hundreds carry options; 0 is meta and skipped."""
    try:
        return int(fields[0]) % 100
    except ValueError:
        return 0


def _glyph_lines(glyphs, name):
    """KAGE lines of a glyph, meta lines dropped; "@n" pins a version, the dump holds the newest."""
    data = glyphs.get(name.split("@")[0])
    if data is None:
        raise ValueError(f"glyph {name} is missing")
    return [f for f in (l.split(":") for l in data.split("$")) if _kage_type(f)]


def _followed(glyphs, name):
    """#drawing-glyph: a glyph that only points to another is followed to it."""
    lines, seen = _glyph_lines(glyphs, name), {name}
    while len(lines) == 1 and lines[0][0] == "99" and lines[0][1:7] == _ALIAS_BOX:
        name = lines[0][7].split("@")[0]
        if name in seen:
            raise ValueError(f"glyph {name} points to itself")
        seen.add(name)
        lines = _glyph_lines(glyphs, name)
    return lines


def _line_strokes(glyphs, f, depth=0):
    """One KAGE line -> [(type, [(x, y), ...])] on the 200 grid, a component expanded into its box."""
    t = _kage_type(f)
    if t != 99:
        nums = [float(v) for v in f[3:11] if v != ""]
        pts = list(zip(nums[0::2], nums[1::2]))
        return [(t, pts[:_KAGE_POINTS.get(t, len(pts))])]
    if depth > 20:
        raise ValueError(f"component {f[7]} nests too deep")
    sub = [s for g in _glyph_lines(glyphs, f[7]) for s in _line_strokes(glyphs, g, depth + 1)]
    # KAGE's stretch fields (1, 2, 9, 10) are ignored: no hub glyph uses them.
    x1, y1, x2, y2 = (float(v) for v in f[3:7])
    return [(k, [(x1 + x * (x2 - x1) / 200, y1 + y * (y2 - y1) / 200) for x, y in pts]) for k, pts in sub]


def _num(v):
    s = f"{v:.1f}".rstrip("0").rstrip(".")
    return "0" if s == "-0" else s


def stroke_path(t, pts):
    """#drawing-strokes: a KAGE stroke as an SVG centerline path."""
    xy = [f"{_num(x)} {_num(y)}" for x, y in pts]
    if t == 2 and len(xy) == 3:
        return f"M{xy[0]} Q{xy[1]} {xy[2]}"
    if t == 6 and len(xy) == 4:
        return f"M{xy[0]} C{xy[1]} {xy[2]} {xy[3]}"
    if t == 7 and len(xy) == 4:
        return f"M{xy[0]} L{xy[1]} Q{xy[2]} {xy[3]}"
    return "M" + " L".join(xy)


def _is_radical_form(ch, number, rs):
    """#drawing-radical: ch is radical number itself, with no extra strokes, so 訁 counts for 言."""
    num, _, extra = rs.get(ch, "").partition(".")
    return num.rstrip("'") == str(number) and extra == "0"


def hub_drawing(hub, glyphs, rs, override=None):
    """#drawing-rules: {"glyph", "strokes", "parts", "radical"} for a graph hub, or ValueError.

    hub: a graph hub ({"char", "radical": {"number"}, "parts"}); rs: Unihan kRSUnicode by
    character; override: its "strokes" ({"parts": {part: [positions]}, "radical": [positions]})
    replaces the derived positions (#drawing-override).
    """
    char = hub["char"]
    code = f"u{ord(char):04x}"
    name = f"{code}-t" if f"{code}-t" in glyphs else code
    if name not in glyphs:
        raise ValueError(f"no GlyphWiki glyph {code}")
    groups = [(glyph_code(f[7]) if _kage_type(f) == 99 else None, _line_strokes(glyphs, f))
              for f in _followed(glyphs, name)]
    strokes = [stroke_path(*s) for _, sub in groups for s in sub]
    if override and "strokes" in override:
        parts, radical = _override_positions(hub, len(strokes), override["strokes"])
    else:
        parts, rest, pos = {p: [] for p in hub["parts"]}, [], 0
        for part, sub in groups:
            (parts[part] if part in parts else rest).extend(range(pos, pos + len(sub)))
            pos += len(sub)
        unnamed = [p for p, ix in parts.items() if not ix]
        if len(unnamed) > 1:
            raise ValueError(f"parts {', '.join(unnamed)} are not components of {name}")
        if unnamed:
            parts[unnamed[0]], rest = rest, []
        if parts and rest:
            raise ValueError(f"strokes {rest} belong to no part")
        number = hub["radical"]["number"]
        if _is_radical_form(char, number, rs):
            radical = list(range(len(strokes)))
        else:
            radical = next((ix for p, ix in parts.items() if _is_radical_form(p, number, rs)), [])
    empty = [p for p, ix in parts.items() if not ix] + ([hub["radical"]["char"]] if not radical else [])
    if empty:
        raise ValueError(f"{', '.join(empty)} names no stroke")
    return {"glyph": name, "strokes": strokes, "parts": parts, "radical": radical}


def _override_positions(hub, count, strokes):
    """#drawing-override, #drawing-fail: an override's (parts, radical), checked."""
    parts, radical = strokes.get("parts", {}), strokes.get("radical", [])
    if list(parts) != hub["parts"]:
        raise ValueError(f"override strokes name parts {', '.join(parts) or 'none'}, hub has "
                         f"{', '.join(hub['parts']) or 'none'}")
    named = [i for ix in parts.values() for i in ix]
    outside = sorted({i for i in named + radical if not 0 <= i < count})
    if outside:
        raise ValueError(f"override positions {outside} fall outside the {count} strokes")
    overlap = sorted({i for i in named if named.count(i) > 1} | {i for i in radical if radical.count(i) > 1})
    if overlap:
        raise ValueError(f"override positions {overlap} overlap")
    left = sorted(set(range(count)) - set(named)) if parts else []
    if left:
        raise ValueError(f"override leaves strokes {left} out")
    return {p: sorted(ix) for p, ix in parts.items()}, sorted(radical)


def build_drawing(hubs, glyphs, rs, overrides, date):
    """#drawing-file, #drawing-schema: the drawing data for the graph's hubs, or BuildError
    naming each failing character (#drawing-fail)."""
    out, problems = {}, []
    for h in hubs:
        try:
            out[h["char"]] = hub_drawing(h, glyphs, rs, overrides.get(h["id"]))
        except ValueError as err:
            problems.append(f"{h['id']} {h['char']}: {err}")
    if problems:
        raise BuildError(problems)
    return {"meta": {"glyphwikiDate": date}, "hubs": out}


def load_glyphwiki(refresh=False):
    """Download (once) the GlyphWiki dump into the cache, keeping only its newest glyphs and
    license. Returns (glyphs, dump date, license path)."""
    paths = [GLYPHWIKI_CACHE / m for m in GLYPHWIKI_MEMBERS]
    if refresh or not all(p.exists() for p in paths):
        tgz = GLYPHWIKI_CACHE / "dump.tar.gz"
        download(GLYPHWIKI_URL, tgz)
        with tarfile.open(tgz, "r:gz") as tar:
            for m in tar:
                if m.name in GLYPHWIKI_MEMBERS:
                    tmp = GLYPHWIKI_CACHE / f"{m.name}.part"
                    tmp.write_bytes(tar.extractfile(m).read())
                    os.utime(tmp, (m.mtime, m.mtime))
                    os.replace(tmp, GLYPHWIKI_CACHE / m.name)
        tgz.unlink()
    with open(paths[0], encoding="utf-8") as f:
        glyphs = parse_glyphwiki(f)
    date = datetime.datetime.fromtimestamp(paths[0].stat().st_mtime, datetime.timezone.utc).date()
    return glyphs, date.isoformat(), paths[1]


# ---------------------------------------------------------------- audio


def attach_audio(words, recorded):
    """#audio-rules: set w["audio"] for each word whose Simplified form is in recorded.

    Words sharing a Simplified form get none. Returns the other words left
    without a recording, for the build to list.
    """
    count = {}
    for w in words:
        count[w["simp"]] = count.get(w["simp"], 0) + 1
    missing = []
    for w in words:
        w.pop("audio", None)
        if count[w["simp"]] > 1:
            continue
        if w["simp"] in recorded:
            w["audio"] = f"audio/{w['id']}.mp3"
        else:
            missing.append(w)
    return missing


def _audio_cache(note):
    return CACHE_DIR / f"audio-cmn-{note['commit']}"


def _github_repo(note):
    return note["url"].removeprefix("https://github.com/")


def load_audio_index(note, folder, refresh=False):
    """Return {stem: file name} for every cmn-<stem>.mp3 in folder at the pinned commit."""
    tree = _audio_cache(note) / "tree.json"
    if refresh or not tree.exists():
        download(f"https://api.github.com/repos/{_github_repo(note)}/git/trees/"
                 f"{note['commit']}?recursive=1", tree)
    data = json.loads(tree.read_text(encoding="utf-8"))
    if data.get("truncated"):
        raise BuildError([f"{note['url']}: file list truncated"])
    prefix = folder + "/cmn-"
    return {e["path"][len(prefix):-4]: e["path"].rsplit("/", 1)[1]
            for e in data["tree"]
            if e["type"] == "blob" and e["path"].startswith(prefix) and e["path"].endswith(".mp3")}


# #symbols-table: each Zhuyin symbol's name syllable, said in the first tone.
# ㄝ (ê) has no recording in the set, so it needs none (#symbols-why).
SYMBOL_NAME_SYLLABLES = (
    "bo1 po1 mo1 fo1 de1 te1 ne1 le1 ge1 ke1 he1 ji1 qi1 xi1 zhi1 chi1 shi1 ri1 zi1 ci1 si1 "
    "yi1 wu1 yu1 "
    "a1 o1 e1 ai1 ei1 ao1 ou1 an1 en1 ang1 eng1 er1").split()


def syllable_key(numbered):
    """#syllable-key: a normalized syllable ('nu:3', 'Ri4') -> its recording name ('nv3', 'ri4')."""
    return numbered.lower().replace("u:", "v")


def needed_syllables(graph):
    """#syllable-which: every syllable a card can show, plus every symbol name syllable.

    Walks every "pinyin" in the graph (words, readings, measure words,
    references). An erhua r5 is said as the symbol ㄦ, so needs none (#syllable-erhua).
    """
    found = set(SYMBOL_NAME_SYLLABLES)

    def walk(o):
        if isinstance(o, dict):
            if isinstance(o.get("pinyin"), str):
                found.update(syllable_key(x) for x in o["pinyin"].split())
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(graph)
    found.discard("r5")
    return found


def attach_syllables(graph, index, overrides=None):
    """#syllable-fail, #syllable-override, #syllable-field: set graph["syllables"].

    index maps each listed syllable to its file. An override "s-<syllable>"
    names the set's other spelling ("spelling") or states it has none
    ("none": true). A needed tone 1 to 4 syllable with neither fails the
    build. Returns (resolved index, neutral-tone syllables with none).
    """
    overrides = {i[2:]: o for i, o in (overrides or {}).items() if i.startswith("s-")}
    needed = needed_syllables(graph)
    files, problems = {}, []
    for x in sorted(needed):
        o = overrides.get(x)
        if o and o.get("none"):
            continue
        if o:
            if o["spelling"] in index:
                files[x] = index[o["spelling"]]
            else:
                problems.append(f"syllable {x}: override spelling {o['spelling']} has no recording")
        elif x in index:
            files[x] = index[x]
        elif not x.endswith("5"):
            problems.append(f"syllable {x}: no recording in the syllable set")
    problems += [f"s-{x}: override names no needed syllable" for x in sorted(set(overrides) - needed)]
    if problems:
        raise BuildError(problems)
    out = {}
    for k, v in graph.items():
        if k != "syllables":
            out[k] = v
        if k == "words":
            out["syllables"] = sorted(files)
    graph.clear()
    graph.update(out)
    return files, sorted(x for x in needed if x.endswith("5") and x not in files)


def _copy_pinned(note, folder, name, target):
    cached = _audio_cache(note) / folder / name
    if not cached.exists():
        download(f"https://raw.githubusercontent.com/{_github_repo(note)}/{note['commit']}/"
                 f"{folder}/{urllib.parse.quote(name)}", cached)
    target.write_bytes(cached.read_bytes())


def write_audio(graph, index, syllable_index, note):
    """Copy each word's recording unchanged to site/audio/<id>.mp3 and each listed
    syllable's to site/audio/s/<syllable>.mp3; drop stale ones."""
    syl = note["syllables"]
    SYLLABLE_OUT.mkdir(parents=True, exist_ok=True)
    keep = set()
    for w in graph["words"]:
        if "audio" not in w:
            continue
        target = ROOT / "site" / w["audio"]
        _copy_pinned(note, note["folder"], index[w["simp"]], target)
        keep.add(target)
    for x in graph["syllables"]:
        target = SYLLABLE_OUT / f"{x}.mp3"
        _copy_pinned(note, syl["folder"], syllable_index[x], target)
        keep.add(target)
    for old in [*AUDIO_OUT.glob("*.mp3"), *SYLLABLE_OUT.glob("*.mp3")]:
        if old not in keep:
            old.unlink()
    AUDIO_CREDITS.write_text(
        f"Word recordings: {note['speaker']}, via {_github_repo(note)}.\n"
        f"Source: {note['url']} (commit {note['commit']}, folder {note['folder']}).\n"
        f"License: {note['license']}, {note['licenseUrl']}\n"
        "\n"
        f"Syllable recordings (s/): {syl['speaker']}, via {_github_repo(note)}.\n"
        f"Source: {note['url']} (commit {note['commit']}, folder {syl['folder']}).\n"
        f"License: {syl['license']}, as stated in the source's README\n"
        "\n"
        "Each file is copied unchanged and renamed to its word id or syllable. Unmodified clips\n"
        "beside the site code form a collection; the license does not extend to the code.\n",
        encoding="utf-8")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--cedict", type=Path, help="local CC-CEDICT file (.txt or .gz)")
    ap.add_argument("--refresh", action="store_true",
                    help="re-download CC-CEDICT, IDS, GlyphWiki, and the audio-cmn file list")
    args = ap.parse_args(argv)
    try:
        overrides = load_overrides()
        entries, release = load_cedict(args.cedict, args.refresh)
        chars = load_chars(args.refresh)
        graph = build(entries, release, load_hsk(), overrides, chars)
        glyphs, glyphwiki_date, glyphwiki_license = load_glyphwiki(args.refresh)
        drawing = build_drawing(graph["hubs"], glyphs, chars["rs"], overrides, glyphwiki_date)
        del glyphs
        note = audio_note()
        index = load_audio_index(note, note["folder"], args.refresh)
        syllable_index = load_audio_index(note, note["syllables"]["folder"])
        syllable_index, silent = attach_syllables(graph, syllable_index, overrides)
    except BuildError as err:
        print(f"build failed, {len(err.problems)} entries:", file=sys.stderr)
        for p in err.problems:
            print(f"  {p}", file=sys.stderr)
        return 1
    missing = attach_audio(graph["words"], index)
    write_audio(graph, index, syllable_index, note)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(graph, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    DRAWING_OUT.write_text(json.dumps(drawing, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    DRAWING_LICENSE.write_bytes(glyphwiki_license.read_bytes())
    print(f"wrote {OUT.relative_to(ROOT)}: {len(graph['words'])} words, "
          f"{len(graph['hubs'])} hubs, {len(graph['links'])} links, "
          f"CC-CEDICT {release}", file=sys.stderr)
    print(f"wrote {DRAWING_OUT.relative_to(ROOT)}: {len(drawing['hubs'])} hubs, "
          f"GlyphWiki {glyphwiki_date}", file=sys.stderr)
    recorded = sum("audio" in w for w in graph["words"])
    print(f"wrote {AUDIO_OUT.relative_to(ROOT)}: {recorded} recordings; "
          f"{len(missing)} words have none:", file=sys.stderr)
    for w in missing:
        print(f"  {w['id']} {w['simp']}", file=sys.stderr)
    print(f"wrote {SYLLABLE_OUT.relative_to(ROOT)}: {len(graph['syllables'])} syllable recordings; "
          f"{len(silent)} neutral-tone syllables have none: {' '.join(silent)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
