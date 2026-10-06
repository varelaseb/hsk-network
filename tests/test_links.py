"""#tests-list test-links, #acceptance-links, #graph-model: hubs and links."""

import unittest
from collections import Counter

from graph_data import GRAPH


class Links(unittest.TestCase):
    def test_recomputed_from_trad_forms(self):
        words = GRAPH["words"]
        uses = Counter(ch for w in words for ch in set(w["trad"]))
        shared = {ch for ch, n in uses.items() if n >= 2}
        self.assertEqual({h["char"] for h in GRAPH["hubs"]}, shared)
        for h in GRAPH["hubs"]:
            self.assertEqual(h["id"], f"c-{h['char']}")
        want = {(w["id"], f"c-{ch}") for w in words for ch in set(w["trad"]) if ch in shared}
        got = [(l["word"], l["hub"]) for l in GRAPH["links"]]
        self.assertEqual(len(got), len(set(got)), "duplicate links")
        self.assertEqual(set(got), want)

    def test_xue_cluster(self):
        linked = {l["word"] for l in GRAPH["links"] if l["hub"] == "c-學"}
        trads = {w["trad"] for w in GRAPH["words"] if w["id"] in linked}
        self.assertTrue({"學生", "學校", "學習", "同學"} <= trads, trads)

    def test_two_readings_share_a_hub(self):
        linked = {l["word"] for l in GRAPH["links"] if l["hub"] == "c-長"}
        self.assertEqual(sum(1 for w in GRAPH["words"]
                             if w["id"] in linked and w["trad"] == "長"), 2)


if __name__ == "__main__":
    unittest.main()
