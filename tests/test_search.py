"""Search ranking in site/app.js (spec #ix-search, #acceptance-search-pinyin, #acceptance-search-english).

Runs the real search functions from app.js under Node against the built graph.json.
"""

import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "site" / "app.js"
GRAPH = ROOT / "site" / "data" / "graph.json"
FUNCS = ["foldPinyin", "englishText", "searchKey", "escapeRe", "cmpId", "search"]
NODE = shutil.which("node")


def extract(src, name):
    start = src.index("  function " + name + "(")
    depth, i = 0, src.index("{", start)
    while True:
        depth += {"{": 1, "}": -1}.get(src[i], 0)
        i += 1
        if depth == 0:
            return src[start:i]


def run_search(queries):
    src = APP.read_text(encoding="utf-8")
    script = "\n".join(
        [
            "const fs = require('fs');",
            "const MAX_RESULTS = %s;" % re.search(r"MAX_RESULTS = (\d+);", src).group(1),
            "const levelOn = { 1: true, 2: true };",
        ]
        + [extract(src, f) for f in FUNCS]
        + [
            "const data = JSON.parse(fs.readFileSync(%s, 'utf8'));" % json.dumps(str(GRAPH)),
            "const words = data.words.map(w => Object.assign({}, w, { key: searchKey(w) }));",
            "const out = {};",
            "for (const q of %s) out[q] = search(q).map(w => w.id);" % json.dumps(queries),
            "console.log(JSON.stringify(out));",
        ]
    )
    res = subprocess.run([NODE, "-e", script], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


@unittest.skipUnless(NODE, "node not installed")
class SearchTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.words = {w["id"]: w for w in json.loads(GRAPH.read_text(encoding="utf-8"))["words"]}
        cls.results = run_search(["ge", "wei", "jia", "zhang", "shi", "be"])

    def trads(self, q):
        return [self.words[i]["trad"] for i in self.results[q]]

    def test_pinyin_finds_exact_syllable_words(self):
        for q, trad in [("ge", "個"), ("wei", "為"), ("jia", "家"), ("shi", "是")]:
            with self.subTest(q=q):
                self.assertIn(trad, self.trads(q))

    def test_classifier_refs_are_not_english(self):
        # 家 lists "CL:個|个[ge4]"; that must not make it an English hit for "ge".
        ids = self.results["ge"]
        self.assertLess(ids.index("1-32"), 20)
        self.assertEqual(self.trads("ge")[0], "個")

    def test_english_definition_hits_rank_first(self):
        hit = re.compile(r"(^|[^a-z])be($|[^a-z])")
        flags = [any(hit.search(d.lower()) for d in self.words[i]["defs"]) for i in self.results["be"]]
        self.assertTrue(flags and flags[0], flags)
        self.assertEqual(flags, sorted(flags, reverse=True))


if __name__ == "__main__":
    unittest.main()
