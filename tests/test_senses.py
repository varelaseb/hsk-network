"""#test-senses: the sense rules (#senses-table, #sense-fail, #sense-scope, #schema-sense)."""

import re
import unittest

from graph_data import CHARS, GRAPH, build_data

RELEASE = "2026-10-01"
NO_CHARS = {"rs": {}, "kdef": {}, "radicals": {}, "ids": {}}


def ref(trad, simp, pinyin, zhuyin):
    return {"trad": trad, "simp": simp, "pinyin": pinyin, "zhuyin": zhuyin}


GE = ref("個", "个", "ge4", "ㄍㄜˋ")


class Rules(unittest.TestCase):
    def senses(self, line):
        """One fixture CC-CEDICT line -> senses() of its definitions."""
        [entry], _ = build_data.parse_cedict([line])
        return build_data.senses(entry["defs"])

    def test_split_keeps_order_and_semicolons(self):  # #sense-split
        self.assertEqual(self.senses("愛 爱 [ai4] /to love; to be fond of/affection/"),
                         {"defs": [{"parts": ["to love; to be fond of"]}, {"parts": ["affection"]}]})

    def test_cl_sense_becomes_measure_words_and_is_dropped(self):  # #sense-cl
        got = self.senses("石頭 石头 [shi2 tou5] /stone/CL:塊|块[kuai4],隻|只[zhi1],個|个[ge4]/")
        self.assertEqual(got, {"defs": [{"parts": ["stone"]}], "mw": [
            ref("塊", "块", "kuai4", "ㄎㄨㄞˋ"), ref("隻", "只", "zhi1", "ㄓ"), GE]})

    def test_parenthesized_cl_leaves_text_each_measure_word_once(self):  # #sense-cl
        got = self.senses("學生 学生 [xue2 sheng5] /student (CL:個|个[ge4],名[ming2])/pupil; CL:個|个[ge4]/")
        self.assertEqual(got, {"defs": [{"parts": ["student"]}, {"parts": ["pupil"]}],
                               "mw": [GE, ref("名", "名", "ming2", "ㄇㄧㄥˊ")]})

    def test_citation_becomes_reference(self):  # #sense-ref
        got = self.senses("號 号 [hao4] /see 大夫[dai4 fu5]/used in 號脈|号脉[hao4 mai4]/")
        self.assertEqual(got["defs"], [
            {"parts": ["see ", ref("大夫", "大夫", "dai4 fu5", "ㄉㄞˋ ˙ㄈㄨ")]},
            {"parts": ["used in ", ref("號脈", "号脉", "hao4 mai4", "ㄏㄠˋ ㄇㄞˋ")]}])

    def test_citation_spellings(self):  # #sense-ref: CC-CEDICT's 'nu : 3', 'zhi1dao5', digits in a form
        got = self.senses("紅 红 [gong1] /used in 女紅|女红[nu : 3 gong1]/as in 237號|237号[er4 san1 qi1 hao4]/")
        self.assertEqual([d["parts"][1] for d in got["defs"]], [
            ref("女紅", "女红", "nu:3 gong1", "ㄋㄩˇ ㄍㄨㄥ"),
            ref("237號", "237号", "er4 san1 qi1 hao4", "ㄦˋ ㄙㄢ ㄑㄧ ㄏㄠˋ")])

    def test_pronunciation_notes_become_reading_references(self):  # #sense-pr
        got = self.senses("聽 听 [ting1] /to listen (Taiwan pr. [ting4])/also pr. [zhi1dao5]/")
        self.assertEqual(got["defs"], [
            {"parts": ["to listen (Taiwan reading ", {"pinyin": "ting4", "zhuyin": "ㄊㄧㄥˋ"}, ")"]},
            {"parts": ["also pronounced ", {"pinyin": "zhi1 dao5", "zhuyin": "ㄓ ˙ㄉㄠ"}]}])

    def test_leading_tag_spelled_out(self):  # #sense-tag
        got = self.senses("根 根 [gen1] /(bound form) root; stem/(coll.) a lot/(Tw) here/(of a person) tall/")
        self.assertEqual(got["defs"], [
            {"tag": "bound form", "parts": ["root; stem"]},
            {"tag": "colloquial", "parts": ["a lot"]},
            {"tag": "Taiwan", "parts": ["here"]},
            {"parts": ["(of a person) tall"]}])

    def test_abbreviations_spelled_out(self):  # #sense-abbr
        got = self.senses("送 送 [song4] /to see (sb) off/to give sth to sb, esp. a gift/")
        self.assertEqual(got["defs"], [{"parts": ["to see (someone) off"]},
                                       {"parts": ["to give something to someone, especially a gift"]}])

    def test_unclean_sense_fails_naming_it(self):  # #sense-fail
        for bad in ("a [T xu4] shirt", "a|b", "stray bracket]", "pinyin ma3 left", "simplified 们"):
            with self.subTest(bad=bad), self.assertRaisesRegex(ValueError, "unclean sense"):
                build_data.senses([bad], simp_only={"们"})

    def test_build_fails_naming_the_entry(self):  # #sense-fail
        entries, _ = build_data.parse_cedict(["學生 学生 [xue2 sheng5] /student [T xu4]/",
                                              "學 学 [xue2] /to learn/", "生 生 [sheng1] /to be born/"])
        hsk = [{"id": "1-1", "level": 1, "simp": "学生", "pinyin": "xué sheng"}]
        with self.assertRaisesRegex(build_data.BuildError, r"1-1 学生 .*unclean sense"):
            build_data.build(entries, RELEASE, hsk, {}, NO_CHARS)

    def test_words_and_readings_alike_with_char_simp(self):  # #sense-scope, #stack-script
        entries, _ = build_data.parse_cedict([
            "個 个 [ge4] /individual; CL:個|个[ge4]/(coll.) sth/",
            "書 书 [shu1] /book; CL:本[ben3]/", "本 本 [ben3] /root/"])
        hsk = [{"id": "1-1", "level": 1, "simp": "个", "pinyin": "gè"},
               {"id": "1-2", "level": 1, "simp": "书本", "pinyin": "shū běn"}]
        entries += build_data.parse_cedict(["書本 书本 [shu1 ben3] /book; CL:本[ben3]/"])[0]
        graph = build_data.build(entries, RELEASE, hsk, {}, NO_CHARS)
        self.assertEqual(graph["chars"]["個"], {"simp": "个", "readings": [
            {"pinyin": "ge4", "zhuyin": "ㄍㄜˋ", "mw": [GE],
             "defs": [{"parts": ["individual"]}, {"tag": "colloquial", "parts": ["something"]}]}]})
        self.assertEqual(graph["words"][0], {"id": "1-1", "level": 1, "trad": "個", "simp": "个",
                                             "pinyin": "ge4", "reading": 0})
        self.assertEqual(graph["words"][1]["mw"], [ref("本", "本", "ben3", "ㄅㄣˇ")])
        self.assertEqual(graph["chars"]["書"]["simp"], "书")


def all_senses():
    for w in GRAPH["words"]:
        yield w["id"], w.get("defs", []), w.get("mw", [])
    for ch, e in CHARS.items():
        for r in e.get("readings", []):
            yield ch, r["defs"], r.get("mw", [])


class Committed(unittest.TestCase):
    """#sense-fail, #schema-sense on the committed graph data file."""

    def test_plain_text_clean_and_references_whole(self):
        simp_only = {ch for w in GRAPH["words"] for t, s in zip(w["trad"], w["simp"]) if t != s for ch in s}
        for key, defs, mw in all_senses():
            with self.subTest(key=key):
                for r in mw:
                    self.assertEqual(set(r), {"trad", "simp", "pinyin", "zhuyin"})
                for d in defs:
                    self.assertLessEqual(set(d), {"tag", "parts"})
                    self.assertTrue(d["parts"])
                    for p in d["parts"]:
                        if isinstance(p, str):
                            self.assertNotRegex(p, r"CL:|\||\[|\]|\bsb\b|\bsth\b|[A-Za-z:]+[1-5]\b")
                            self.assertFalse(set(p) & simp_only, p)
                        else:
                            self.assertIn(set(p), ({"trad", "simp", "pinyin", "zhuyin"}, {"pinyin", "zhuyin"}))
                            self.assertEqual(p["zhuyin"], build_data.to_zhuyin(
                                build_data.normalize_numbered(p["pinyin"].split())))


if __name__ == "__main__":
    unittest.main()
