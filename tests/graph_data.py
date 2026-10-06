"""Shared loader for the data tests: the build module and the committed graph."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import build_data  # noqa: E402

GRAPH = json.loads((ROOT / "site" / "data" / "graph.json").read_text(encoding="utf-8"))
