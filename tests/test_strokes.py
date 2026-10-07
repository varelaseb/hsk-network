"""#test-strokes, data side: the drawing data (#drawing-rules, #drawing-file, #drawing-schema)."""

import json
import re
import unittest

from graph_data import GRAPH, ROOT, build_data

DRAWING = json.loads((ROOT / "site" / "data" / "drawing.json").read_text(encoding="utf-8"))
HUBS = {h["char"]: h for h in GRAPH["hubs"]}
# Hubs whose IDS (Taiwan sequence) sets their parts side by side (⿰, ⿲) or stacked (⿱, ⿳).
SIDE = "吃打話飯機好沒時歡姐服得快"
STACKED = "出電少兒高家天見字去是覺學下醫再怎公"


def points(paths):
    return [(float(x), float(y)) for p in paths
            for x, y in re.findall(r"(-?[\d.]+) (-?[\d.]+)", p)]


def centroid(char, part):
    d = DRAWING["hubs"][char]
    pts = points([d["strokes"][i] for i in d["parts"][part]])
    return sum(x for x, _ in pts) / len(pts), sum(y for _, y in pts) / len(pts)


def box(char, positions):
    pts = points([DRAWING["hubs"][char]["strokes"][i] for i in positions])
    xs, ys = [x for x, _ in pts], [y for _, y in pts]
    return min(xs), min(ys), max(xs), max(ys)


class EveryHub(unittest.TestCase):
    """#acceptance-strokes-complete."""

    def test_every_hub_drawn(self):
        self.assertEqual(list(DRAWING["hubs"]), list(HUBS))
        for char, d in DRAWING["hubs"].items():
            with self.subTest(char=char):
                n = len(d["strokes"])
                self.assertTrue(n)
                for s in d["strokes"]:
                    self.assertRegex(s, r"^M-?[\d.]+ -?[\d.]+( [LQC]?-?[\d.]+ -?[\d.]+)+$")
                self.assertEqual(list(d["parts"]), HUBS[char]["parts"])
                self.assertTrue(d["radical"])
                self.assertTrue(set(d["radical"]) <= set(range(n)))
                for ix in d["parts"].values():
                    self.assertTrue(ix)
                if d["parts"]:
                    named = sorted(i for ix in d["parts"].values() for i in ix)
                    self.assertEqual(named, list(range(n)))

    def test_meta_and_license(self):
        self.assertEqual(list(DRAWING["meta"]), ["glyphwikiDate"])
        self.assertRegex(DRAWING["meta"]["glyphwikiDate"], r"^\d{4}-\d{2}-\d{2}$")
        lic = (ROOT / "site" / "data" / "glyphwiki-LICENSE.txt").read_text(encoding="utf-8-sig")
        self.assertIn("Unlimited permission", lic)
        self.assertIn("GlyphWiki", lic)


class Known(unittest.TestCase):
    """#acceptance-strokes-known."""

    def test_hua(self):
        d = DRAWING["hubs"]["話"]
        self.assertEqual(d["glyph"], "u8a71-t")
        self.assertEqual(d["radical"], d["parts"]["訁"])
        self.assertLess(box("話", d["parts"]["訁"])[2], box("話", d["parts"]["舌"])[0] + 5)

    def test_xue(self):
        d = DRAWING["hubs"]["學"]
        self.assertEqual(d["radical"], d["parts"]["子"])
        self.assertLess(centroid("學", "𦥯")[1], centroid("學", "子")[1])
        self.assertGreater(box("學", d["parts"]["子"])[3], box("學", d["parts"]["𦥯"])[3])

    def test_huan_walk_along_bottom_left(self):
        d = DRAWING["hubs"]["還"]
        walk, rest = box("還", d["parts"]["辶"]), box("還", d["parts"]["睘"])
        self.assertLess(walk[0], rest[0])  # reaches further left
        self.assertGreater(walk[3], rest[3])  # and further down
        self.assertGreater(walk[2], (rest[0] + rest[2]) / 2)  # runs along under it
        self.assertEqual(d["radical"], d["parts"]["辶"])

    def test_duo_one_part_twice(self):
        d = DRAWING["hubs"]["多"]
        self.assertEqual(d["parts"]["夕"], list(range(len(d["strokes"]))))
        top, bottom = box("多", d["parts"]["夕"])[1::2]
        self.assertLess(top, 40)
        self.assertGreater(bottom, 160)


class Layout(unittest.TestCase):
    """#acceptance-strokes-layout."""

    def test_side_by_side_and_stacked(self):
        for chars, axis in ((SIDE, 0), (STACKED, 1)):
            for char in chars:
                parts = HUBS[char]["parts"]
                with self.subTest(char=char):
                    self.assertGreater(len(parts), 1)
                    for a, b in zip(parts, parts[1:]):
                        self.assertLess(centroid(char, a)[axis], centroid(char, b)[axis], (a, b))


class Apart(unittest.TestCase):
    """#acceptance-strokes-apart."""

    def keys(self, value):
        if isinstance(value, dict):
            for k, v in value.items():
                yield k
                yield from self.keys(v)
        elif isinstance(value, list):
            for v in value:
                yield from self.keys(v)

    def test_graph_holds_no_stroke(self):
        self.assertFalse({"strokes", "glyph", "glyphwikiDate"} & set(self.keys(GRAPH)))
        self.assertNotRegex(json.dumps(GRAPH), r'"M-?[\d.]+ -?[\d.]+ [LQC]')

    def test_drawing_holds_only_strokes_and_positions(self):
        for char, d in DRAWING["hubs"].items():
            with self.subTest(char=char):
                self.assertEqual(set(d), {"glyph", "strokes", "parts", "radical"})
                self.assertTrue(all(isinstance(i, int) for ix in [d["radical"], *d["parts"].values()]
                                    for i in ix))
                self.assertTrue(all(isinstance(ix, list) for ix in d["parts"].values()))


GLYPHS = build_data.parse_glyphwiki("""\
                name                | related | data
------------------------------------+---------+------
 u660e                              | u660e   | 1:0:0:10:10:190:190
 u660e-t                            | u660e   | 99:0:0:0:0:200:200:u660e-j@2
 u660e-j                            | u660e   | 0:0:0:0$99:0:0:0:0:90:200:u65e5-01$99:0:0:100:0:200:200:u6708-02
 u65e5                              | u65e5   | 99:0:0:0:0:200:200:u65e5-01$1:0:0:20:100:180:100
 u65e5-01                           | u65e5   | 1:0:0:20:20:20:180$1:0:0:20:20:180:20$1:0:0:20:180:180:180
 u6708-02                           | u6708   | 2:0:0:20:20:20:100:10:190$1:0:0:20:20:180:20
 u6cb3                              | u6cb3   | 99:0:0:0:0:60:200:u6c35-01$1:0:0:80:30:190:30$99:0:0:90:60:180:180:u53e3-01
 u6c35-01                           | u6c35   | 1:0:0:50:30:150:60$1:0:0:50:90:150:120$1:0:0:50:180:150:130
 u53e3-01                           | u53e3   | 1:0:0:20:20:20:180$1:0:0:20:20:180:20$1:0:0:180:20:180:180$1:0:0:20:180:180:180
 u591a-t                            | u591a   | 99:0:0:0:0:200:100:u5915-01$99:0:0:0:100:200:200:u5915-01
 u5915-01                           | u5915   | 2:0:0:100:20:60:80:20:120$1:0:0:60:60:180:60
 u597d-t                            | u597d   | 1:0:0:20:20:80:180$1:0:0:20:100:100:100$1:0:0:120:20:180:20$1:0:0:150:20:150:180
(15 rows)
""".splitlines())
RS = {"明": "72.4", "日": "72.0", "河": "85.5", "氵": "85.0", "多": "36.3", "夕": "36.0", "好": "38.3",
      "女": "38.0"}


def hub(char, rad, number, parts):
    return {"id": f"c-{char}", "char": char, "radical": {"char": rad, "number": number}, "parts": parts}


MING = hub("明", "日", 72, ["日", "月"])
HE = hub("河", "水", 85, ["氵", "可"])
DUO = hub("多", "夕", 36, ["夕"])
HAO = hub("好", "女", 38, ["女", "子"])


class Rules(unittest.TestCase):
    """#drawing-rules against fixture GlyphWiki lines."""

    def draw(self, h, override=None):
        return build_data.hub_drawing(h, GLYPHS, RS, override)

    def test_taiwan_glyph_chosen_and_pointer_followed(self):
        d = self.draw(MING)
        self.assertEqual(d["glyph"], "u660e-t")
        self.assertEqual(len(d["strokes"]), 5)  # u660e-j's, not plain u660e's one stroke
        self.assertEqual(d["parts"], {"日": [0, 1, 2], "月": [3, 4]})
        self.assertEqual(d["radical"], [0, 1, 2])

    def test_component_placed_in_its_box(self):
        d = self.draw(MING)
        self.assertEqual(d["strokes"][0], "M9 20 L9 180")
        self.assertEqual(d["strokes"][3], "M110 20 Q110 100 105 190")

    def test_one_unnamed_part_takes_the_rest(self):
        d = self.draw(HE)
        self.assertEqual(d["glyph"], "u6cb3")  # no Taiwan glyph: the plain one
        self.assertEqual(d["parts"], {"氵": [0, 1, 2], "可": [3, 4, 5, 6, 7]})
        self.assertEqual(d["radical"], [0, 1, 2])  # 氵 is radical 85 itself, so counts for 水

    def test_part_used_twice_takes_both(self):
        d = self.draw(DUO)
        self.assertEqual(d["parts"], {"夕": [0, 1, 2, 3]})
        self.assertEqual(d["radical"], [0, 1, 2, 3])

    def test_hub_that_is_its_radical_takes_every_stroke(self):
        d = self.draw(hub("日", "日", 72, []))
        self.assertEqual((d["parts"], d["radical"]), ({}, [0, 1, 2, 3]))

    def test_two_unnamed_parts_fail_the_build_naming_the_character(self):
        """#acceptance-strokes-fail."""
        with self.assertRaises(build_data.BuildError) as err:
            build_data.build_drawing([MING, HAO], GLYPHS, RS, {}, "2026-10-06")
        self.assertEqual(err.exception.problems, ["c-好 好: parts 女, 子 are not components of u597d-t"])

    def test_override_names_the_strokes(self):
        override = {"strokes": {"parts": {"女": [0, 1], "子": [2, 3]}, "radical": [0, 1]}}
        drawing = build_data.build_drawing([HAO], GLYPHS, RS, {"c-好": override}, "2026-10-06")
        self.assertEqual(drawing["meta"], {"glyphwikiDate": "2026-10-06"})
        d = drawing["hubs"]["好"]
        self.assertEqual((d["parts"], d["radical"]), ({"女": [0, 1], "子": [2, 3]}, [0, 1]))

    def test_bad_overrides_fail(self):
        for parts, radical, message in (
                ({"女": [0, 1], "子": [1, 2, 3]}, [0], "overlap"),
                ({"女": [0], "子": [2, 3]}, [0], r"leaves strokes \[1\] out"),
                ({"女": [0, 1], "子": [2, 3, 4]}, [0], "fall outside"),
                ({"女": [0, 1, 2, 3]}, [0], "hub has 女, 子"),
                ({"女": [0, 1], "子": [2, 3]}, [], "女 names no stroke")):
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                self.draw(HAO, {"strokes": {"parts": parts, "radical": radical}})

    def test_radical_not_found_fails(self):
        with self.assertRaisesRegex(ValueError, "水 names no stroke"):
            self.draw(hub("河", "水", 85, ["可"]))  # 可 takes every stroke; no part is the radical

    def test_no_glyph_fails(self):
        with self.assertRaisesRegex(ValueError, "no GlyphWiki glyph u6c34"):
            self.draw(hub("水", "水", 85, []))


if __name__ == "__main__":
    unittest.main()
