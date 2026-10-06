"""#tests-list test-known, test-hub-known."""

import unittest

from graph_data import GRAPH, build_data

# (simplified, toned list pinyin, traditional, zhuyin, expected gloss)
KNOWN = [
    ("学生", "xué sheng", "學生", "ㄒㄩㄝˊ ˙ㄕㄥ", "student"),
    ("喜欢", "xǐ huan", "喜歡", "ㄒㄧˇ ˙ㄏㄨㄢ", "to like"),
    ("长", "cháng", "長", "ㄔㄤˊ", "long"),
    ("长", "zhǎng", "長", "ㄓㄤˇ", "to grow"),
    ("得", "de", "得", "˙ㄉㄜ", "structural particle"),
    ("得", "děi", "得", "ㄉㄟˇ", "must"),
    ("中国", "Zhōng guó", "中國", "ㄓㄨㄥ ㄍㄨㄛˊ", "China"),
    ("女儿", "nǚ ér", "女兒", "ㄋㄩˇ ㄦˊ", "daughter"),
    ("是", "shì", "是", "ㄕˋ", "to be"),
    ("我们", "wǒ men", "我們", "ㄨㄛˇ ˙ㄇㄣ", "we"),
    ("去", "qù", "去", "ㄑㄩˋ", "to go"),
    ("医生", "yī shēng", "醫生", "ㄧ ㄕㄥ", "doctor"),
    ("鱼", "yú", "魚", "ㄩˊ", "fish"),
    ("里", "lǐ", "裡", "ㄌㄧˇ", "inside"),
    ("着", "zhe", "著", "˙ㄓㄜ", "aspect particle"),
]


class KnownWords(unittest.TestCase):
    def test_reference_words(self):
        """#acceptance-data-known."""
        for simp, toned, trad, zhuyin, gloss in KNOWN:
            with self.subTest(simp=simp, pinyin=toned):
                want = [w for w in GRAPH["words"] if w["simp"] == simp
                        and w["zhuyin"] == zhuyin]
                self.assertEqual(len(want), 1, f"{simp} {zhuyin} not found once")
                w = want[0]
                self.assertEqual(w["trad"], trad)
                self.assertTrue(any(gloss in d for d in w["defs"]), w["defs"])

    def test_both_readings_are_distinct_nodes(self):
        for trad, count in (("長", 2), ("得", 2)):
            with self.subTest(trad=trad):
                nodes = [w for w in GRAPH["words"] if w["trad"] == trad]
                self.assertEqual(len(nodes), count)
                self.assertEqual(len({w["id"] for w in nodes}), count)
                self.assertEqual(len({w["zhuyin"] for w in nodes}), count)


# char -> [(zhuyin, expected gloss)] for every reading, in order.
KNOWN_HUBS = {
    "學": [("ㄒㄩㄝˊ", "to learn")],
    "子": [("ㄗˇ", "son"), ("˙ㄗ", "noun suffix")],
}


class KnownCharacters(unittest.TestCase):
    def test_reference_hubs(self):
        """#acceptance-hub-known."""
        hubs = {h["char"]: h for h in GRAPH["hubs"]}
        for char, readings in KNOWN_HUBS.items():
            with self.subTest(char=char):
                got = hubs[char]["readings"]
                self.assertEqual([r["zhuyin"] for r in got], [z for z, _ in readings])
                for r, (_, gloss) in zip(got, readings):
                    self.assertTrue(any(gloss in d for d in r["defs"]), r["defs"])

    def test_every_hub_has_readings_with_defs(self):
        for h in GRAPH["hubs"]:
            with self.subTest(char=h["char"]):
                self.assertTrue(h["readings"])
                for r in h["readings"]:
                    self.assertEqual(r["zhuyin"], build_data.to_zhuyin(r["pinyin"]))
                    self.assertTrue(r["defs"])


if __name__ == "__main__":
    unittest.main()
