#!/usr/bin/env python3
"""Build site/data/graph.json and site/audio/ from the HSK lists, CC-CEDICT, and audio-cmn.

Spec: docs/specs/hsk-network.spec.html (#data, #match-rules, #zhuyin-tones,
#schema-example, #graph-model, #hub-reading, #audio-rules). Python standard library only.

Usage: python3 scripts/build_data.py [--cedict PATH] [--refresh]
"""

import argparse
import gzip
import json
import os
import re
import sys
import tempfile
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HSK_DIR = ROOT / "data" / "hsk"
AUDIO_NOTE = ROOT / "data" / "audio" / "source.json"
AUDIO_OUT = ROOT / "site" / "audio"
AUDIO_CREDITS = AUDIO_OUT / "CREDITS.txt"
OVERRIDES = ROOT / "data" / "overrides.json"
OUT = ROOT / "site" / "data" / "graph.json"
CACHE_DIR = ROOT / ".cache"
CEDICT_URL = "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz"
CEDICT_CACHE = CACHE_DIR / "cedict_1_0_ts_utf-8_mdbg.txt.gz"
DOWNLOAD_TIMEOUT = 60  # seconds
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
        with os.fdopen(fd, "wb") as f, urllib.request.urlopen(url, timeout=DOWNLOAD_TIMEOUT) as r:
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
    defs = []
    for c in cands:
        for d in c["defs"]:
            if d not in defs:
                defs.append(d)
    kept = [d for d in defs if not d.startswith(POINTER_PREFIXES)]
    return kept or defs


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


def hub_readings(char, by_trad):
    """#hub-reading: one reading per distinct pinyin of char's own entries.

    Lowercase entries only, capitalized ones only when no lowercase exists.
    Raises ValueError when char has no entry or a reading has no Zhuyin.
    """
    cands = by_trad.get(char, [])
    if not cands:
        raise ValueError("no CC-CEDICT entry")
    cands = [c for c in cands if not c["cap"]] or cands
    groups = {}
    for c in cands:
        groups.setdefault(c["pinyin"], []).append(c)
    return [{"pinyin": py, "zhuyin": to_zhuyin(py), "defs": _merge(cs)}
            for py, cs in groups.items()]


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


def build(cedict_entries, release, hsk_entries, overrides):
    index = index_by_simp(cedict_entries)
    words, problems = [], []
    for e in hsk_entries:
        override = overrides.get(e["id"])
        try:
            if override and override["simp"] != e["simp"]:
                raise ValueError(f"override names {override['simp']}, list has {e['simp']}")
            trad, pinyin, defs = match_entry(e, index, override)
            zhuyin = to_zhuyin(pinyin)
        except ValueError as err:
            problems.append(f"{e['id']} {e['simp']} [{e['pinyin']}]: {err}")
            continue
        words.append({"id": e["id"], "level": e["level"], "trad": trad,
                      "simp": e["simp"], "pinyin": pinyin, "zhuyin": zhuyin,
                      "defs": defs})
    unused = sorted(set(overrides) - {e["id"] for e in hsk_entries})
    problems += [f"{i}: override names no HSK entry" for i in unused]
    if problems:
        raise BuildError(problems)
    hubs, links = build_links(words)
    by_trad = {}
    for c in cedict_entries:
        by_trad.setdefault(c["trad"], []).append(c)
    for h in hubs:
        try:
            h["readings"] = hub_readings(h["char"], by_trad)
        except ValueError as err:
            problems.append(f"{h['id']} {h['char']}: {err}")
    if problems:
        raise BuildError(problems)
    return {"meta": {"cedictRelease": release, "hskSource": hsk_source(),
                     "audioSource": audio_source()},
            "words": words, "hubs": hubs, "links": links}


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


def load_audio_index(note, refresh=False):
    """Return {simp: file name} for every recording in the pinned folder."""
    tree = _audio_cache(note) / "tree.json"
    if refresh or not tree.exists():
        download(f"https://api.github.com/repos/{_github_repo(note)}/git/trees/"
                 f"{note['commit']}?recursive=1", tree)
    data = json.loads(tree.read_text(encoding="utf-8"))
    if data.get("truncated"):
        raise BuildError([f"{note['url']}: file list truncated"])
    prefix = note["folder"] + "/cmn-"
    return {e["path"][len(prefix):-4]: e["path"].rsplit("/", 1)[1]
            for e in data["tree"]
            if e["type"] == "blob" and e["path"].startswith(prefix) and e["path"].endswith(".mp3")}


def write_audio(words, index, note):
    """Copy each word's recording unchanged to site/audio/<id>.mp3; drop stale ones."""
    cache = _audio_cache(note)
    AUDIO_OUT.mkdir(parents=True, exist_ok=True)
    keep = set()
    for w in words:
        if "audio" not in w:
            continue
        name = index[w["simp"]]
        cached = cache / name
        if not cached.exists():
            download(f"https://raw.githubusercontent.com/{_github_repo(note)}/{note['commit']}/"
                     f"{note['folder']}/{urllib.parse.quote(name)}", cached)
        target = ROOT / "site" / w["audio"]
        target.write_bytes(cached.read_bytes())
        keep.add(target.name)
    for old in AUDIO_OUT.glob("*.mp3"):
        if old.name not in keep:
            old.unlink()
    AUDIO_CREDITS.write_text(
        f"Word recordings: {note['speaker']}, via {_github_repo(note)}.\n"
        f"Source: {note['url']} (commit {note['commit']}, folder {note['folder']}).\n"
        f"License: {note['license']}, {note['licenseUrl']}\n"
        "Each file is copied unchanged and renamed to its word id. Unmodified clips\n"
        "beside the site code form a collection; the license does not extend to the code.\n",
        encoding="utf-8")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--cedict", type=Path, help="local CC-CEDICT file (.txt or .gz)")
    ap.add_argument("--refresh", action="store_true",
                    help="re-download CC-CEDICT and the audio-cmn file list")
    args = ap.parse_args(argv)
    try:
        overrides = load_overrides()
        entries, release = load_cedict(args.cedict, args.refresh)
        graph = build(entries, release, load_hsk(), overrides)
        note = audio_note()
        index = load_audio_index(note, args.refresh)
    except BuildError as err:
        print(f"build failed, {len(err.problems)} entries:", file=sys.stderr)
        for p in err.problems:
            print(f"  {p}", file=sys.stderr)
        return 1
    missing = attach_audio(graph["words"], index)
    write_audio(graph["words"], index, note)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(graph, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(graph['words'])} words, "
          f"{len(graph['hubs'])} hubs, {len(graph['links'])} links, "
          f"CC-CEDICT {release}", file=sys.stderr)
    recorded = sum("audio" in w for w in graph["words"])
    print(f"wrote {AUDIO_OUT.relative_to(ROOT)}: {recorded} recordings; "
          f"{len(missing)} words have none:", file=sys.stderr)
    for w in missing:
        print(f"  {w['id']} {w['simp']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
