"""#tests-list test-complete, #acceptance-complete: one node per list entry."""

import json
import unittest

from graph_data import GRAPH, ROOT


class Complete(unittest.TestCase):
    def test_every_entry_once_and_nothing_else(self):
        expected = {}
        for level in (1, 2):
            path = ROOT / "data" / "hsk" / f"hsk-level-{level}.json"
            rows = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(len(rows), 150)
            for pos, row in enumerate(rows, 1):
                expected[f"{level}-{pos}"] = (level, row["hanzi"])
        ids = [w["id"] for w in GRAPH["words"]]
        self.assertEqual(len(ids), len(set(ids)), "duplicate word ids")
        got = {w["id"]: (w["level"], w["simp"]) for w in GRAPH["words"]}
        self.assertEqual(got, expected)

    def test_every_word_is_filled(self):
        for w in GRAPH["words"]:
            with self.subTest(id=w["id"]):
                for key in ("trad", "pinyin", "zhuyin"):
                    self.assertTrue(w[key])
                self.assertTrue(w["defs"] and all(w["defs"]))

    def test_meta(self):
        self.assertRegex(GRAPH["meta"]["cedictRelease"], r"^\d{4}-\d{2}-\d{2}$")
        self.assertRegex(GRAPH["meta"]["hskSource"],
                         r"^https://github\.com/clem109/hsk-vocabulary@[0-9a-f]{40}$")


if __name__ == "__main__":
    unittest.main()
