"""#tests-list test-complete: one node per list entry."""

import json
import unittest

from graph_data import GRAPH, ROOT, word_reading


class Complete(unittest.TestCase):
    def test_every_entry_once_and_nothing_else(self):
        """#acceptance-complete, #test-complete: one node per (Traditional, pinyin), naming
        in order every collection that lists it; its id is its home entry's."""
        index = json.loads((ROOT / "data" / "collections.json").read_text(encoding="utf-8"))
        self.assertEqual([(c["key"], c["name"]) for c in index],
                         [("1", "HSK 1"), ("2", "HSK 2"), ("flora", "Flowers and trees"),
                          ("produce", "Fruit and vegetables")])
        self.assertEqual(GRAPH["meta"]["collections"],
                         [{"key": c["key"], "name": c["name"]} for c in index])
        sizes = {"1": 150, "2": 150, "flora": 65, "produce": 73}
        by_id = {w["id"]: w for w in GRAPH["words"]}
        self.assertEqual(len(by_id), len(GRAPH["words"]), "duplicate word ids")
        node_of = {(w["trad"], w["pinyin"]): w for w in GRAPH["words"]}
        self.assertEqual(len(node_of), len(GRAPH["words"]), "two nodes share a form and pinyin")
        expected = {}  # id -> (collections, simp)
        for c in index:
            rows = json.loads((ROOT / "data" / c["list"]).read_text(encoding="utf-8"))
            self.assertEqual(len(rows), sizes[c["key"]], c["key"])
            for pos, row in enumerate(rows, 1):
                entry = f"{c['key']}-{pos}"
                if entry in by_id:  # its home entry
                    expected[entry] = ([c["key"]], row["hanzi"])
                    continue
                # a shared entry: the node of the same Simplified form in an earlier collection
                homes = [i for i, (cs, simp) in expected.items()
                         if simp == row["hanzi"] and c["key"] not in cs]
                self.assertEqual(len(homes), 1, f"{entry} {row['hanzi']} has no node")
                expected[homes[0]][0].append(c["key"])
        got = {w["id"]: (w["collections"], w["simp"]) for w in GRAPH["words"]}
        self.assertEqual(got, expected)

    def test_shared_entries_are_one_node(self):
        """#model-shared."""
        shared = {w["trad"]: w["collections"] for w in GRAPH["words"] if len(w["collections"]) > 1}
        self.assertEqual(shared["蘋果"], ["1", "produce"])
        self.assertEqual(shared["西瓜"], ["2", "produce"])
        self.assertEqual(sum(w["trad"] == "蘋果" for w in GRAPH["words"]), 1)

    def test_every_word_is_filled(self):
        for w in GRAPH["words"]:
            with self.subTest(id=w["id"]):
                for key in ("trad", "pinyin"):
                    self.assertTrue(w[key])
                zhuyin, defs = word_reading(w)
                self.assertTrue(zhuyin)
                self.assertTrue(defs and all(defs))

    def test_meta(self):
        self.assertRegex(GRAPH["meta"]["cedictRelease"], r"^\d{4}-\d{2}-\d{2}$")
        self.assertRegex(GRAPH["meta"]["hskSource"],
                         r"^https://github\.com/clem109/hsk-vocabulary@[0-9a-f]{40}$")


if __name__ == "__main__":
    unittest.main()
