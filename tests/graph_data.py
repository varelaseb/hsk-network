"""Shared loader for the data tests: the build module and the committed graph."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import build_data  # noqa: E402

GRAPH = json.loads((ROOT / "site" / "data" / "graph.json").read_text(encoding="utf-8"))
CHARS = GRAPH["chars"]


def word_reading(w):
    """A word's (zhuyin, defs): its own, or for a one-character word, through chars (#chars-words)."""
    r = CHARS[w["trad"]]["readings"][w["reading"]] if "reading" in w else w
    return r["zhuyin"], r["defs"]


def sense_text(sense):
    """A sense's plain text, each reference read as its Traditional form or Zhuyin (#schema-sense)."""
    return "".join(p if isinstance(p, str) else p.get("trad", p["zhuyin"]) for p in sense["parts"])
