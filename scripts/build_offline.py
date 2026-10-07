"""Offline list: write the worker's file list and version (docs/specs/hsk-app.spec.html #offline).

Run after any change under site/: python3 scripts/build_offline.py
Standard library only, no network. Rewrites the marked block at the top of site/sw.js.
"""

import hashlib
import json
import re
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
WORKER = "sw.js"
BLOCK = re.compile(r"// BEGIN OFFLINE LIST.*?\n(.*?)// END OFFLINE LIST", re.S)


def offline_list(site=SITE):
    """Every published file except the worker, sorted, and a short hash over paths and contents."""
    files = sorted(p.relative_to(site).as_posix() for p in site.rglob("*") if p.is_file())
    files.remove(WORKER)
    h = hashlib.sha256()
    for f in files:
        h.update(f.encode() + b"\0" + hashlib.sha256((site / f).read_bytes()).digest())
    return files, h.hexdigest()[:12]


def block(files, version):
    lines = "".join(f"  {json.dumps(f, ensure_ascii=False)},\n" for f in files)
    return f'const VERSION = "{version}";\nconst FILES = [\n{lines}];\n'


def read_block(text):
    """The worker's current (files, version), parsed from its marked block."""
    body = BLOCK.search(text).group(1)
    version = re.search(r'const VERSION = "([^"]*)";', body).group(1)
    files = json.loads(re.search(r"const FILES = (\[.*?\]);", body, re.S).group(1).replace(",\n]", "\n]"))
    return files, version


def main():
    worker = SITE / WORKER
    files, version = offline_list()
    text = worker.read_text(encoding="utf-8")
    m = BLOCK.search(text)
    worker.write_text(text[:m.start(1)] + block(files, version) + text[m.end(1):], encoding="utf-8")
    size = sum((SITE / f).stat().st_size for f in files)
    print(f"{WORKER}: {len(files)} files, {size / 1e6:.1f} MB, version {version}")


if __name__ == "__main__":
    main()
