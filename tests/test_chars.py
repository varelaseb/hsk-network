"""#test-chars-once, #acceptance-chars-once, #acceptance-char-simp: per-character facts stored once (#chars-table, #chars-words)."""

import unittest

from graph_data import CHARS, GRAPH, build_data, word_reading


class StoredOnce(unittest.TestCase):
    def test_hubs_radicals_parts_name_a_char_entry_and_carry_nothing_else(self):
        for hub in GRAPH["hubs"]:
            with self.subTest(char=hub["char"]):
                self.assertEqual(set(hub), {"id", "char", "radical", "parts"})
                self.assertEqual(set(hub["radical"]), {"char", "number"})
                self.assertTrue(CHARS[hub["char"]]["readings"])
                for ch in [hub["radical"]["char"], *hub["parts"]]:
                    self.assertIsInstance(ch, str)
                    self.assertTrue(CHARS[ch]["meaning"])

    def test_char_entries_hold_only_readings_and_meaning(self):
        for ch, entry in CHARS.items():
            with self.subTest(char=ch):
                self.assertTrue(entry)
                self.assertLessEqual(set(entry), {"simp", "readings", "meaning"})
                self.assertIn("simp", entry)  # #stack-script

    def test_one_character_words_name_their_reading(self):
        for w in GRAPH["words"]:
            with self.subTest(id=w["id"]):
                if len(w["trad"]) == 1:
                    self.assertNotIn("zhuyin", w)
                    self.assertNotIn("defs", w)
                    self.assertEqual(CHARS[w["trad"]]["readings"][w["reading"]]["pinyin"], w["pinyin"])
                else:
                    self.assertNotIn("reading", w)
                    self.assertTrue(w["zhuyin"] and w["defs"])

    def test_every_word_character_has_readings(self):
        """#char-coverage: hub or not, e.g. 們."""
        for w in GRAPH["words"]:
            for ch in w["trad"]:
                with self.subTest(char=ch):
                    self.assertTrue(CHARS[ch]["readings"][0]["defs"])
        self.assertNotIn("們", {h["char"] for h in GRAPH["hubs"]})

    def test_both_readings_of_one_character(self):
        chang, zhang = (w for w in GRAPH["words"] if w["trad"] == "長")
        self.assertNotEqual(chang["reading"], zhang["reading"])

    def test_standard_reading_first_by_kmandarin(self):  # #hub-reading
        for ch, zhuyin in {"舌": "ㄕㄜˊ", "丨": "ㄍㄨㄣˇ", "長": "ㄓㄤˇ", "好": "ㄏㄠˇ",
                           "了": "˙ㄌㄜ", "得": "ㄉㄜˊ"}.items():
            with self.subTest(char=ch):
                self.assertGreater(len(CHARS[ch]["readings"]), 1)
                self.assertEqual(CHARS[ch]["readings"][0]["zhuyin"], zhuyin)

    def test_chang_and_zhang_keep_their_zhuyin_through_reading(self):
        by_pinyin = {w["pinyin"]: w for w in GRAPH["words"] if w["trad"] == "長"}
        self.assertEqual({p: word_reading(w)[0] for p, w in by_pinyin.items()},
                         {"chang2": "ㄔㄤˊ", "zhang3": "ㄓㄤˇ"})


CEDICT = build_data.parse_cedict("""\
王 王 [Wang2] /surname Wang/
王 王 [wang4] /to rule/
公主 公主 [gong1 zhu3] /princess/
兒 儿 [er2] /child/
公 公 [gong1] /public/
主 主 [zhu3] /owner/
""".splitlines())[0]
NO_CHARS = {"rs": {}, "kdef": {}, "radicals": {}, "ids": {}}


class Build(unittest.TestCase):
    def test_one_character_word_reading_missing_fails_naming_it(self):
        hsk = [{"id": "1-1", "collection": "1", "simp": "王", "pinyin": "Wáng"}]
        with self.assertRaises(build_data.BuildError) as err:
            build_data.build(CEDICT, None, hsk, {}, NO_CHARS)
        self.assertEqual(err.exception.problems, ["1-1 王: reading wang2 missing from 王's entry"])

    def test_one_character_word_points_at_its_reading(self):
        hsk = [{"id": "1-1", "collection": "1", "simp": "王", "pinyin": "wàng"},
               {"id": "1-2", "collection": "1", "simp": "公主", "pinyin": "gōng zhǔ"}]
        graph = build_data.build(CEDICT, None, hsk, {}, NO_CHARS)
        self.assertEqual(graph["words"][0], {"id": "1-1", "collections": ["1"], "trad": "王", "simp": "王",
                                             "pinyin": "wang4", "reading": 0})
        self.assertEqual(graph["chars"]["王"], {"simp": "王", "readings": [
            {"pinyin": "wang4", "zhuyin": "ㄨㄤˋ", "defs": [{"parts": ["to rule"]}]}]})
        self.assertEqual(graph["words"][1]["zhuyin"], "ㄍㄨㄥ ㄓㄨˇ")

    def test_part_written_only_as_simplified_reads_simplified_entries(self):
        single = build_data.single_char_index(CEDICT)
        self.assertTrue(build_data.is_character("儿", single))
        self.assertEqual(build_data.char_readings("儿", single),
                         [{"pinyin": "er2", "zhuyin": "ㄦˊ", "defs": [{"parts": ["child"]}]}])


XING = build_data.single_char_index(build_data.parse_cedict("""\
行 行 [hang2] /row/
行 行 [xing2] /to walk/
行 行 [xing4] /behavior/
""".splitlines())[0])


class StandardReadingFirst(unittest.TestCase):
    """#hub-reading: the reading matching kMandarin's first value comes first."""

    def zhuyin(self, mandarin):
        return [r["zhuyin"] for r in build_data.char_readings("行", XING, mandarin)]

    def test_kmandarin_reading_moves_first_rest_in_dictionary_order(self):
        self.assertEqual(self.zhuyin("xíng"), ["ㄒㄧㄥˊ", "ㄏㄤˊ", "ㄒㄧㄥˋ"])

    def test_no_match_or_no_kmandarin_keeps_dictionary_order(self):
        for mandarin in ("háng", "xīng", None):
            with self.subTest(mandarin=mandarin):
                self.assertEqual(self.zhuyin(mandarin), ["ㄏㄤˊ", "ㄒㄧㄥˊ", "ㄒㄧㄥˋ"])

    def test_parse_unihan_keeps_first_kmandarin_value(self):
        _, _, mandarin = build_data.parse_unihan(["U+884C\tkMandarin\txíng háng"])
        self.assertEqual(mandarin, {"行": "xíng"})

    def test_build_points_one_character_word_at_reordered_reading(self):
        entries = build_data.parse_cedict(["行 行 [hang2] /row/", "行 行 [xing2] /to walk/"])[0]
        hsk = [{"id": "1-1", "collection": "1", "simp": "行", "pinyin": "xíng"}]
        graph = build_data.build(entries, None, hsk, {}, {**NO_CHARS, "mandarin": {"行": "xíng"}})
        self.assertEqual(graph["words"][0]["reading"], 0)
        self.assertEqual(graph["chars"]["行"]["readings"][0]["pinyin"], "xing2")


class CharSimp(unittest.TestCase):
    """#acceptance-char-simp, #stack-script: each character table entry's Simplified form."""

    QIAN = build_data.single_char_index(build_data.parse_cedict(
        ["乾 干 [gan1] /dry/", "乾 乾 [qian2] /one of the Eight Trigrams/"])[0])

    def test_word_character_takes_the_first_word_writing_it(self):
        in_words = {}
        for w in GRAPH["words"]:
            for t, s in zip(w["trad"], w["simp"]):
                in_words.setdefault(t, s)
        self.assertTrue(in_words)
        for t, s in in_words.items():
            with self.subTest(char=t):
                self.assertEqual(CHARS[t]["simp"], s)

    def test_first_word_wins_over_the_dictionary(self):
        self.assertEqual(build_data.char_simp("乾", self.QIAN, "qián", "干"), "干")

    def test_other_character_takes_its_standard_readings_entry(self):
        self.assertEqual(build_data.char_simp("乾", self.QIAN, "qián"), "乾")
        self.assertEqual(build_data.char_simp("乾", self.QIAN, "gān"), "干")
        self.assertEqual(build_data.char_simp("乾", self.QIAN), "干")  # no kMandarin: dictionary order

    def test_character_with_no_entry_is_itself(self):
        self.assertEqual(build_data.char_simp("訁", self.QIAN), "訁")


if __name__ == "__main__":
    unittest.main()
