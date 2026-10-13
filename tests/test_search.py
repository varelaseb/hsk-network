"""Search ranking in site/app.js (spec #ix-search, #acceptance-search-zhuyin, #acceptance-search-english,
#acceptance-script-search).

Runs the real search functions from app.js under Node against the built graph.json.
"""

import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

from graph_data import sense_text, word_reading

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "site" / "app.js"
GRAPH = ROOT / "site" / "data" / "graph.json"
FUNCS = ["wordReading", "zhuyinKey", "pinyinKey", "englishText", "searchKey", "escapeRe", "cmpId", "cmpWord", "holds",
         "search"]
NODE = shutil.which("node")


def extract(src, name):
    start = re.search(r"(?m)^function " + name + r"\(", src).start()
    depth, i = 0, src.index("{", start)
    while True:
        depth += {"{": 1, "}": -1}.get(src[i], 0)
        i += 1
        if depth == 0:
            return src[start:i]


def run_search(queries, mode="zhuyin", on=("1", "2")):
    src = APP.read_text(encoding="utf-8")
    script = "\n".join(
        [
            "const fs = require('fs');",
            "const MAX_RESULTS = %s;" % re.search(r"MAX_RESULTS = (\d+);", src).group(1),
            "const collectionOn = %s;" % json.dumps({k: True for k in on}),
            re.search(r"(?m)^const ZY_TONES = .*;", src).group(0),
        ]
        + [extract(src, f) for f in FUNCS]
        + [
            "const data = JSON.parse(fs.readFileSync(%s, 'utf8'));" % json.dumps(str(GRAPH)),
            "const order = {}; data.meta.collections.forEach((c, i) => { order[c.key] = i; });",
            "const words = data.words.map(w => Object.assign({}, w, wordReading(w, data.chars),"
            " { home: w.collections[0] }))"
            ".map(w => Object.assign(w, { key: searchKey(w) }));",
            "const out = {};",
            "for (const q of %s) out[q] = search(q, %s).map(w => w.id);" % (json.dumps(queries), json.dumps(mode)),
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
        cls.results = run_search(
            ["ㄒㄩㄝㄕㄥ", "ㄒㄩㄝˊ ˙ㄕㄥ", "ㄒㄩㄝ ㄕㄥ", "ㄍㄜ", "ㄍㄜˋ", "xuesheng", "ge", "be", "student"]
            + ["ㄒㄩㄝˊㄕㄥ", "ㄅㄚˋㄅㄚ", "ㄉㄜ˙", "ㄒㄩㄝˊ ㄕ", "ㄒㄩㄝ ㄒㄧˊ"]
        )

    def trads(self, q):
        return [self.words[i]["trad"] for i in self.results[q]]

    def test_zhuyin_without_tones_finds_word(self):
        self.assertEqual(self.trads("ㄒㄩㄝㄕㄥ")[0], "學生")
        self.assertEqual(self.trads("ㄍㄜ")[0], "個")

    def test_zhuyin_with_tones_and_spaces(self):
        self.assertEqual(self.trads("ㄒㄩㄝˊ ˙ㄕㄥ")[0], "學生")
        self.assertEqual(self.trads("ㄒㄩㄝ ㄕㄥ")[0], "學生")
        self.assertEqual(self.trads("ㄍㄜˋ")[0], "個")

    def test_partial_or_misplaced_tone_marks(self):
        # Tone marks are ignored wherever they sit, so partly toned queries still match.
        self.assertEqual(self.trads("ㄒㄩㄝˊㄕㄥ")[0], "學生")
        self.assertEqual(self.trads("ㄅㄚˋㄅㄚ")[0], "爸爸")
        self.assertIn("的", self.trads("ㄉㄜ˙"))
        self.assertIn("學生", self.trads("ㄒㄩㄝˊ ㄕ"))
        self.assertEqual(self.trads("ㄒㄩㄝ ㄒㄧˊ")[0], "學習")

    def test_pinyin_is_not_searched(self):
        self.assertEqual(self.results["xuesheng"], [])
        self.assertNotIn("個", self.trads("ge"))

    def test_classifier_refs_are_not_english(self):
        # 家 lists "CL:個|个[ge4]"; that must not make it an English hit for "ge".
        self.assertNotIn("家", self.trads("ge"))

    def test_english_hits_only_definitions(self):
        hit = re.compile(r"(^|[^a-z])be($|[^a-z])")
        flags = [any(hit.search(sense_text(d).lower()) for d in word_reading(self.words[i])[1])
                 for i in self.results["be"]]
        self.assertTrue(flags and all(flags), flags)
        self.assertIn("學生", self.trads("student"))



@unittest.skipUnless(NODE, "node not installed")
class PinyinSearchTest(unittest.TestCase):
    """Pinyin mode matches the shown reading, pinyin, with or without tones (#default-reading)."""

    @classmethod
    def setUpClass(cls):
        cls.words = {w["id"]: w for w in json.loads(GRAPH.read_text(encoding="utf-8"))["words"]}
        cls.results = run_search(
            ["xuesheng", "xue sheng", "xuésheng", "xue2 sheng5", "ge", "nu", "nü", "nv", "nu:er", "student", "学生", "學生", "ㄒㄩㄝㄕㄥ"],
            mode="pinyin")

    def simps(self, q):
        return [self.words[i]["simp"] for i in self.results[q]]

    def test_pinyin_without_tones_finds_word(self):
        for q in ("xuesheng", "xue sheng", "xuésheng", "xue2 sheng5"):
            with self.subTest(q=q):
                self.assertEqual(self.simps(q)[0], "学生")
        self.assertEqual(self.simps("ge")[0], "个")

    def test_u_umlaut_spellings(self):
        for q in ("nu", "nü", "nv"):
            with self.subTest(q=q):
                self.assertEqual(self.simps(q)[0], "女儿")
        self.assertEqual(self.simps("nu:er")[0], "女儿")

    def test_english_and_characters_still_match(self):
        self.assertIn("学生", self.simps("student"))
        self.assertEqual(self.simps("学生")[0], "学生")
        self.assertEqual(self.simps("學生")[0], "学生")

    def test_zhuyin_is_not_searched_in_pinyin_mode(self):
        self.assertEqual(self.results["ㄒㄩㄝㄕㄥ"], [])


@unittest.skipUnless(NODE, "node not installed")
class CollectionSearchTest(unittest.TestCase):
    """Search lists only words of switched-on collections, grouped by home collection in
    collection order (#ix-search, #acceptance-level-off, #acceptance-collection-on)."""

    @classmethod
    def setUpClass(cls):
        cls.words = {w["id"]: w for w in json.loads(GRAPH.read_text(encoding="utf-8"))["words"]}
        cls.hsk = run_search(["orchid", "apple", "蘭"])
        cls.all = run_search(["orchid", "apple", "蘭", "果", "花"], on=("1", "2", "flora", "produce"))
        cls.hsk1 = run_search(["fruit", "student"], on=("1",))

    def trads(self, res, q):
        return [self.words[i]["trad"] for i in res[q]]

    def test_themed_off_at_load_lists_none_of_its_words(self):
        for q in ("orchid", "蘭"):
            with self.subTest(q=q):
                self.assertNotIn("蘭花", self.trads(self.hsk, q))
        for i in self.hsk["apple"]:
            self.assertTrue(set(self.words[i]["collections"]) & {"1", "2"}, i)

    def test_themed_on_lists_its_words(self):
        self.assertIn("蘭花", self.trads(self.all, "蘭"))
        self.assertIn("蝴蝶蘭", self.trads(self.all, "orchid"))

    def test_shared_word_listed_while_any_holding_collection_is_on(self):
        # 蘋果 is in HSK and Fruit and vegetables, home HSK.
        self.assertIn("蘋果", self.trads(self.hsk, "apple"))

    def test_hsk2_off_lists_no_hsk2_only_word(self):
        for q, ids in self.hsk1.items():
            for i in ids:
                with self.subTest(q=q, id=i):
                    self.assertIn("1", self.words[i]["collections"])

    def test_groups_by_home_collection_in_order(self):
        # Every word containing 果 or 花 (none is the bare character) is one "contains" group.
        rank = {"1": 0, "2": 1, "flora": 2, "produce": 3}
        for q in ("果", "花"):
            ws = [self.words[i] for i in self.all[q]]
            self.assertNotIn(q, [w["trad"] for w in ws])
            keys = [(rank[w["collections"][0]], int(w["id"].split("-")[1])) for w in ws]
            with self.subTest(q=q):
                self.assertGreater(len({k[0] for k in keys}), 1, keys)
                self.assertEqual(keys, sorted(keys))


if __name__ == "__main__":
    unittest.main()
