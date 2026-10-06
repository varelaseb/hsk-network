"""#test-breakdown-known, #test-breakdown-rules: hub radical and parts (#breakdown-rules)."""

import unittest

from graph_data import CHARS, GRAPH, build_data

HUBS = {h["char"]: h for h in GRAPH["hubs"]}


class KnownBreakdowns(unittest.TestCase):
    """#acceptance-breakdown-known."""

    KNOWN = {
        "學": ("子", 39, [("𦥯", "learn"), ("子", "offspring")]),
        "好": ("女", 38, [("女", "woman"), ("子", "offspring")]),
        "時": ("日", 72, [("日", "sun"), ("寺", "court")]),
    }

    def test_known(self):
        for char, (rad, num, parts) in self.KNOWN.items():
            with self.subTest(char=char):
                hub = HUBS[char]
                self.assertEqual((hub["radical"]["char"], hub["radical"]["number"]), (rad, num))
                self.assertEqual(hub["parts"], [p for p, _ in parts])
                for part, (_, word) in zip(hub["parts"], parts):
                    self.assertIn(word, CHARS[part]["meaning"])

    def test_readings_only_on_characters(self):
        self.assertEqual(CHARS[HUBS["學"]["radical"]["char"]]["readings"][0]["zhuyin"], "ㄗˇ")
        self.assertNotIn("readings", CHARS[HUBS["沒"]["parts"][0]])  # 氵, a radical form


class EveryHub(unittest.TestCase):
    """#acceptance-breakdown-complete."""

    def test_every_hub_broken_down(self):
        for hub in GRAPH["hubs"]:
            with self.subTest(char=hub["char"]):
                rad = hub["radical"]
                self.assertTrue(CHARS[rad["char"]]["meaning"])
                self.assertIsInstance(rad["number"], int)
                for part in hub["parts"]:
                    self.assertTrue(CHARS[part]["meaning"])

    def test_meta(self):
        self.assertRegex(GRAPH["meta"]["unihanVersion"], r"^\d+\.\d+\.\d+$")
        self.assertRegex(GRAPH["meta"]["idsDate"], r"^\d{4}-\d{2}-\d{2}$")

    def test_hub_overrides_name_their_char(self):
        for o in build_data.load_overrides().values():
            if o["id"].startswith("c-"):
                with self.subTest(id=o["id"]):
                    self.assertEqual(o["id"], f"c-{o['char']}")
                    self.assertTrue(o["reason"].strip())


UNIHAN = """\
U+65E5\tkRSUnicode\t72.0
U+65E5\tkDefinition\tsun; day; daytime
U+6708\tkDefinition\tmoon; month; Kangxi radical 74
U+660E\tkRSUnicode\t72.4
U+660E\tkDefinition\tbright, light, brilliant; clear
U+8D77\tkRSUnicode\t156.3
U+8D70\tkDefinition\twalk, go on foot; run; leave
U+5DF1\tkDefinition\toneself, personal, private
U+5DF3\tkDefinition\tsixth earthly branch
U+5973\tkRSUnicode\t38.0
U+5973\tkDefinition\twoman, girl; feminine; rad. 38
U+6CB3\tkRSUnicode\t85.5
U+6C35\tkDefinition\twater; radical number 85
U+53EF\tkDefinition\t(verb) may, can, -able; possibly
U+6C34\tkDefinition\twater, liquid, lotion, juice
U+96FB\tkRSUnicode\t173.5
U+96E8\tkDefinition\train; rainy; Kangxi radical 173
U+7533\tkDefinition\tto state to a superior, report
U+591A\tkRSUnicode\t36.3
U+5915\tkDefinition\tevening, night, dusk
""".splitlines()
RADICALS = """\
# CJKRadicals fixture
36; 2F23; 5915
38; 2F25; 5973
72; 2F47; 65E5
85; 2F54; 6C34
156; 2FAA; 8D70
173; 2FAC; 96E8
""".splitlines()
IDS = """\
﻿# IDS fixture
# File Date: 2025-06-27
U+660E\t明\t^⿰日月$(GHTJKPV)
U+8D77\t起\t^⿺走己$(GJKPV)\t^⿺走巳$(HT)
U+5973\t女\t^女$(GHTJKPV)
U+6CB3\t河\t^⿰氵可$(GHTJKPV)
U+96FB\t電\t^⿱雨{46}$(GTJKP)\t^⿱雨电$(HV)
U+591A\t多\t^⿱夕夕$(GHTJKPV)
""".splitlines()
CEDICT = build_data.parse_cedict("""\
日 日 [ri4] /sun/day/
月 月 [yue4] /moon/month/
女 女 [nu:3] /woman/
女 女 [ru3] /old variant of 汝[ru3]/
氵 氵 [shui3] /"water" radical in Chinese characters (Kangxi radical 85)/see also 三點水|三点水[san1 dian3 shui3]/
水 水 [shui3] /water/
可 可 [ke3] /can/may/
電 电 [dian4] /electricity/
電話 电话 [dian4 hua4] /telephone/
話 话 [hua4] /speech/
""".splitlines())[0]


def fixture_chars():
    rs, kdef, _ = build_data.parse_unihan(UNIHAN)
    ids, date = build_data.parse_ids(IDS)
    return {"rs": rs, "kdef": kdef, "radicals": build_data.parse_radicals(RADICALS),
            "ids": ids, "unihanVersion": "18.0.0", "idsDate": date}


class Rules(unittest.TestCase):
    """#breakdown-rules against fixture Unihan, CJKRadicals, and IDS lines."""

    def setUp(self):
        self.chars = fixture_chars()
        self.single = build_data.single_char_index(CEDICT)

    def breakdown(self, char, override=None):
        return build_data.hub_breakdown(char, self.chars, override)

    def test_ming_is_sun_and_moon(self):
        radical, parts, meanings = self.breakdown("明")
        self.assertEqual(radical, {"char": "日", "number": 72})
        self.assertEqual(parts, ["日", "月"])
        self.assertEqual(meanings, [("日", "sun"), ("日", "sun"), ("月", "moon")])

    def test_t_tagged_sequence_chosen_over_first(self):
        self.assertEqual(self.breakdown("起")[1], ["走", "巳"])

    def test_single_part_character_has_no_parts(self):
        radical, parts, meanings = self.breakdown("女")
        self.assertEqual(parts, [])
        self.assertEqual(meanings, [("女", "woman")])

    def test_repeated_parts_listed_once(self):
        self.assertEqual(self.breakdown("多")[1], ["夕"])

    def test_radical_form_is_not_a_character(self):
        self.assertEqual(self.breakdown("河")[1:], (["氵", "可"], [("水", "water"), ("氵", "water"), ("可", "may")]))
        self.assertFalse(build_data.is_character("氵", self.single))
        self.assertTrue(build_data.is_character("可", self.single))

    def test_meaning_rule(self):
        self.assertEqual(build_data.meaning("hand; radical number 64"), "hand")
        self.assertEqual(build_data.meaning("Kangxi radical 149; words, speech"), "words")
        self.assertEqual(build_data.meaning("(verb) may, can"), "may")
        self.assertIsNone(build_data.meaning("Kangxi radical 149"))
        self.assertIsNone(build_data.meaning(None))

    def test_unresolved_part_fails(self):
        with self.assertRaisesRegex(ValueError, r"part \{46\} has no meaning"):
            self.breakdown("電")

    def test_build_fails_naming_hub_then_override_resolves(self):
        """#acceptance-breakdown-fail."""
        hsk = [{"id": "1-1", "level": 1, "simp": "电", "pinyin": "diàn"},
               {"id": "1-2", "level": 1, "simp": "电话", "pinyin": "diàn huà"}]
        with self.assertRaises(build_data.BuildError) as err:
            build_data.build(CEDICT, None, hsk, {}, self.chars)
        self.assertEqual(err.exception.problems, ["c-電 電: part {46} has no meaning"])
        override = {"id": "c-電", "char": "電", "reason": "bottom is unencoded",
                    "parts": [{"char": "雨", "meaning": "rain"},
                              {"char": "申", "meaning": "lightning"}]}
        graph = build_data.build(CEDICT, None, hsk, {"c-電": override}, self.chars)
        [hub] = graph["hubs"]
        self.assertEqual(hub, {"id": "c-電", "char": "電", "radical": {"char": "雨", "number": 173},
                               "parts": ["雨", "申"]})
        self.assertEqual(graph["chars"]["雨"], {"simp": "雨", "meaning": "rain"})
        self.assertEqual(graph["chars"]["申"], {"simp": "申", "meaning": "lightning"})
        self.assertEqual(graph["chars"]["電"]["readings"][0]["zhuyin"], "ㄉㄧㄢˋ")
        self.assertEqual(graph["meta"]["idsDate"], "2025-06-27")

    def test_override_replaces_misleading_radical_meaning(self):
        radical, parts, meanings = self.breakdown("明", {"radicalMeaning": "day"})
        self.assertEqual(dict(meanings)["日"], "day")
        self.assertEqual(parts, ["日", "月"])

    def test_override_for_no_hub_fails(self):
        hsk = [{"id": "1-1", "level": 1, "simp": "电", "pinyin": "diàn"}]
        with self.assertRaisesRegex(build_data.BuildError, "c-明: override names no hub"):
            build_data.build(CEDICT, None, hsk, {"c-明": {"id": "c-明", "char": "明", "parts": []}},
                             self.chars)


if __name__ == "__main__":
    unittest.main()
