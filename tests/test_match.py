"""#tests-list test-match, #match-rules: matching against fixture lines."""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from graph_data import build_data

FIXTURE = """\
# CC-CEDICT fixture
#! date=2026-10-01T06:00:00Z
學生 学生 [xue2 sheng5] /student/schoolchild/
學生 学生 [xue2 sheng5] /schoolchild/pupil/
女兒 女儿 [nu:3 er2] /daughter/
中國 中国 [Zhong1 guo2] /China/
王 王 [Wang2] /surname Wang/
王 王 [wang2] /king/
們 们 [men5] /plural marker/
個 个 [ge4] /classifier/
箇 个 [ge4] /variant of 個|个[ge4]/
從 从 [cong2] /from/
从 从 [cong2] /variant of 從|从[cong2]/
着 着 [zhe5] /variant of 著|着[zhe5]/
""".splitlines()

ENTRIES, RELEASE = build_data.parse_cedict(FIXTURE)
INDEX = build_data.index_by_simp(ENTRIES)
NO_CHARS = {"rs": {}, "kdef": {}, "radicals": {}, "ids": {}}  # fixtures here build no hubs


def match(simp, pinyin, override=None):
    return build_data.match_entry({"simp": simp, "pinyin": pinyin}, INDEX, override)


class Match(unittest.TestCase):
    def test_release_date(self):
        self.assertEqual(RELEASE, "2026-10-01")

    def test_same_trad_merges_defs_in_order_deduplicated(self):
        self.assertEqual(match("学生", "xué sheng"),
                         ("學生", "xue2 sheng5", ["student", "schoolchild", "pupil"]))

    def test_missing_tone_is_neutral(self):
        self.assertEqual(match("们", "men")[1], "men5")

    def test_u_umlaut_matches_u_colon(self):
        self.assertEqual(match("女儿", "nǚ ér")[0], "女兒")

    def test_capitalization_prefers_matching_case(self):
        self.assertEqual(match("王", "wáng")[2], ["king"])
        self.assertEqual(match("王", "Wáng")[2], ["surname Wang"])

    def test_capitalized_only_candidate_still_matches(self):
        self.assertEqual(match("中国", "zhōng guó")[0], "中國")

    def test_pointer_only_kept_when_nothing_else(self):
        self.assertEqual(match("王", "Wáng")[2], ["surname Wang"])
        self.assertEqual(match("着", "zhe")[2], ["variant of 著|着[zhe5]"])

    def test_no_candidate_fails(self):
        with self.assertRaisesRegex(ValueError, "no CC-CEDICT candidate"):
            match("学生", "xué shēng")

    def test_differing_trad_fails(self):
        with self.assertRaisesRegex(ValueError, "個, 箇"):
            match("个", "gè")

    def test_override_picks_named_entry(self):
        self.assertEqual(match("个", "gè", {"trad": "個", "pinyin": "ge4"}),
                         ("個", "ge4", ["classifier"]))
        self.assertEqual(match("从", "cóng", {"trad": "從", "pinyin": "cong2"})[2], ["from"])

    def test_override_naming_no_entry_fails(self):
        with self.assertRaisesRegex(ValueError, "matches no CC-CEDICT entry"):
            match("个", "gè", {"trad": "个", "pinyin": "ge4"})

    def test_override_with_defs_for_absent_word(self):
        self.assertEqual(
            match("打篮球", "dá lán qiú",
                  {"trad": "打籃球", "pinyin": "da3 lan2 qiu2", "defs": ["to play basketball"]}),
            ("打籃球", "da3 lan2 qiu2", ["to play basketball"]))

    def test_build_names_each_failing_entry(self):
        hsk = [{"id": "1-1", "level": 1, "simp": "个", "pinyin": "gè"},
               {"id": "1-2", "level": 1, "simp": "从", "pinyin": "cóng"},
               {"id": "1-3", "level": 1, "simp": "们", "pinyin": "men"},
               {"id": "1-4", "level": 1, "simp": "无", "pinyin": "wú"}]
        with self.assertRaises(build_data.BuildError) as err:
            build_data.build(ENTRIES, RELEASE, hsk, {}, NO_CHARS)
        failed = [p.split()[0] for p in err.exception.problems]
        self.assertEqual(failed, ["1-1", "1-2", "1-4"])

    def test_build_with_overrides_passes(self):
        hsk = [{"id": "1-1", "level": 1, "simp": "个", "pinyin": "gè"},
               {"id": "1-2", "level": 1, "simp": "学生", "pinyin": "xué sheng"}]
        overrides = {"1-1": {"id": "1-1", "simp": "个", "trad": "個", "pinyin": "ge4",
                             "reason": "箇 is a variant"}}
        graph = build_data.build(ENTRIES, RELEASE, hsk, overrides, NO_CHARS)
        self.assertEqual([w["trad"] for w in graph["words"]], ["個", "學生"])
        self.assertEqual(graph["meta"]["cedictRelease"], "2026-10-01")

    def test_build_with_absent_word_override(self):
        hsk = [{"id": "2-16", "level": 2, "simp": "打篮球", "pinyin": "dá lán qiú"}]
        overrides = {"2-16": {"id": "2-16", "simp": "打篮球", "trad": "打籃球",
                              "pinyin": "da3 lan2 qiu2", "defs": ["to play basketball"],
                              "reason": "absent from CC-CEDICT; definition not from CC-CEDICT"}}
        with self.assertRaisesRegex(build_data.BuildError, "2-16 .*no CC-CEDICT candidate"):
            build_data.build(ENTRIES, RELEASE, hsk, {}, NO_CHARS)
        [word] = build_data.build(ENTRIES, RELEASE, hsk, overrides, NO_CHARS)["words"]
        self.assertEqual(word, {"id": "2-16", "level": 2, "trad": "打籃球", "simp": "打篮球",
                                "pinyin": "da3 lan2 qiu2", "zhuyin": "ㄉㄚˇ ㄌㄢˊ ㄑㄧㄡˊ",
                                "defs": ["to play basketball"]})

    def test_duplicate_override_id_fails_naming_it(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "overrides.json"
            path.write_text('[{"id": "1-1"}, {"id": "1-2"}, {"id": "1-1"}, {"id": "1-1"}]')
            with self.assertRaises(build_data.BuildError) as err:
                build_data.load_overrides(path)
        self.assertEqual(err.exception.problems, ["1-1: duplicate override id"])

    def test_committed_absent_word_overrides_say_defs_not_from_cedict(self):
        for o in build_data.load_overrides().values():
            if "defs" in o:
                with self.subTest(id=o["id"]):
                    self.assertIn("not from CC-CEDICT", o["reason"])

    def test_committed_overrides_each_have_a_reason(self):
        for o in build_data.load_overrides().values():
            with self.subTest(id=o["id"]):
                self.assertTrue(o["reason"].strip())


HUB_FIXTURE = """\
王 王 [Wang2] /surname Wang/
王 王 [wang2] /king/
王 王 [wang4] /to rule/
王 王 [wang2] /monarch/king/
李 李 [Li3] /surname Li/
得 得 [de2] /to obtain/
得 得 [de5] /see 得[de2]/
得 得 [dei3] /must/
""".splitlines()
BY_TRAD = {}
for _e in build_data.parse_cedict(HUB_FIXTURE)[0]:
    BY_TRAD.setdefault(_e["trad"], []).append(_e)


class HubReading(unittest.TestCase):
    """#hub-reading."""

    def test_lowercase_readings_per_pinyin_in_dictionary_order_merged(self):
        self.assertEqual(build_data.hub_readings("王", BY_TRAD), [
            {"pinyin": "wang2", "zhuyin": "ㄨㄤˊ", "defs": ["king", "monarch"]},
            {"pinyin": "wang4", "zhuyin": "ㄨㄤˋ", "defs": ["to rule"]},
        ])

    def test_pointer_only_reading_keeps_pointer(self):
        readings = build_data.hub_readings("得", BY_TRAD)
        self.assertEqual([r["zhuyin"] for r in readings], ["ㄉㄜˊ", "˙ㄉㄜ", "ㄉㄟˇ"])
        self.assertEqual(readings[1]["defs"], ["see 得[de2]"])

    def test_capitalized_counts_only_without_lowercase(self):
        self.assertEqual(build_data.hub_readings("李", BY_TRAD),
                         [{"pinyin": "li3", "zhuyin": "ㄌㄧˇ", "defs": ["surname Li"]}])

    def test_build_names_hub_char_without_entry(self):
        entries = build_data.parse_cedict(["學生 学生 [xue2 sheng5] /student/",
                                           "學校 学校 [xue2 xiao4] /school/"])[0]
        hsk = [{"id": "1-1", "level": 1, "simp": "学生", "pinyin": "xué sheng"},
               {"id": "1-2", "level": 1, "simp": "学校", "pinyin": "xué xiào"}]
        with self.assertRaises(build_data.BuildError) as err:
            build_data.build(entries, RELEASE, hsk, {}, NO_CHARS)
        self.assertEqual(err.exception.problems, ["c-學 學: no CC-CEDICT entry"])


class Download(unittest.TestCase):
    def fetch(self, read):
        """Run download with urlopen().read() mocked; return (files left, urlopen kwargs)."""
        with tempfile.TemporaryDirectory() as d, \
                mock.patch.object(build_data, "CACHE_DIR", Path(d)), \
                mock.patch.object(build_data.urllib.request, "urlopen") as urlopen:
            urlopen.return_value.__enter__.return_value.read.side_effect = read
            path = Path(d) / "cedict.txt.gz"
            try:
                build_data.download("https://example.invalid/x", path)
                self.assertEqual(path.read_bytes(), b"data")
            finally:
                self.left = sorted(p.name for p in Path(d).iterdir())
            return urlopen.call_args.kwargs

    def test_writes_file_with_timeout(self):
        kwargs = self.fetch([b"data"])
        self.assertEqual(kwargs["timeout"], build_data.DOWNLOAD_TIMEOUT)
        self.assertEqual(self.left, [".gitignore", "cedict.txt.gz"])

    def test_failed_fetch_leaves_no_partial_file(self):
        with self.assertRaises(TimeoutError):
            self.fetch(TimeoutError)
        self.assertEqual(self.left, [".gitignore"])


if __name__ == "__main__":
    unittest.main()
