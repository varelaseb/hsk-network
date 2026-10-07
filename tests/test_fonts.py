"""Fonts: vendored subsets, licenses, coverage, and budget (spec #test-fonts, #acceptance-fonts-files)."""

import hashlib
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import build_fonts as bf  # noqa: E402  (character rules only; stdlib at import)

COVERAGE = json.loads(bf.COVERAGE.read_text(encoding="utf-8"))
SOURCE = json.loads(bf.SOURCE.read_text(encoding="utf-8"))["fonts"]


class FontFilesTest(unittest.TestCase):
    def test_hash_matches_committed_fonts(self):
        for key in (bf.HAN, bf.MAINLAND, bf.LATIN):
            with self.subTest(font=key):
                data = (bf.FONTS / COVERAGE[key]["file"]).read_bytes()
                self.assertEqual(data[:4], b"wOF2")
                self.assertEqual(hashlib.sha256(data).hexdigest(), COVERAGE[key]["sha256"])

    def test_chinese_face_covers_every_shown_character(self):
        """Every graph and page character, all Zhuyin and tone marks; only the listed ones may be missing."""
        han = COVERAGE[bf.HAN]
        graph = json.loads(bf.GRAPH.read_text(encoding="utf-8"))
        shown = bf.shown_chars(graph, bf.page_texts())
        missing = set(han["missing"])
        self.assertEqual(sorted(shown - set(han["chars"])), sorted(missing))
        self.assertIn("學", shown)
        self.assertIn("学", shown)  # Simplified forms too, for the script setting
        self.assertTrue(set(bf.ZHUYIN) <= set(han["chars"]))
        self.assertEqual(len(bf.ZHUYIN), 37)
        self.assertTrue(set(bf.TONE_MARKS) <= set(han["chars"]))
        self.assertFalse(missing & (set(bf.ZHUYIN) | set(bf.TONE_MARKS)))

    def test_mainland_face_holds_only_pinyin_mode_characters(self):
        """#face-forms: only characters the graph shows in pinyin mode, each with a mainland shape."""
        graph = json.loads(bf.GRAPH.read_text(encoding="utf-8"))
        shown = bf.pinyin_chars(graph)
        forms = set(COVERAGE[bf.MAINLAND]["chars"])
        self.assertTrue(forms)
        self.assertLessEqual(forms, shown)
        self.assertLessEqual(forms, set(COVERAGE[bf.HAN]["chars"]))
        self.assertIn("学", shown)
        self.assertNotIn("學", shown)  # Traditional words show their Simplified form
        self.assertFalse(forms & (set(bf.ZHUYIN) | set(bf.TONE_MARKS)))

    def test_pinyin_chars_follow_labels(self):
        """Simplified when given, else Traditional; single characters through their entry."""
        graph = {"words": [{"trad": "愛", "simp": "爱"}, {"trad": "書包"}],
                 "chars": {"愛": {"simp": "爱", "readings": [{"defs": [{"parts": [{"trad": "見", "simp": "见"}]}]}]},
                           "書": {"simp": "书"}},
                 "hubs": [{"char": "書", "radical": {"char": "曰"}, "parts": ["聿", "愛"]}]}
        self.assertEqual(bf.pinyin_chars(graph), set("爱書包见书曰聿"))

    def test_geist_covers_latin_and_pinyin_marks(self):
        chars = set(COVERAGE[bf.LATIN]["chars"])
        for ch in "AZaz09.,ü" + bf.COMBINING_TONES + "āáàēéěèīíìōóòūúù–’…":
            with self.subTest(ch=ch):
                self.assertIn(ch, chars)
        self.assertFalse(chars & set(bf.ZHUYIN), "Zhuyin never renders in the Latin face")

    def test_license_beside_each_font(self):
        for key in (bf.HAN, bf.LATIN):  # the mainland forms face is the Chinese typeface: same license
            with self.subTest(font=key):
                text = (bf.FONTS / f"{key}.OFL.txt").read_text(encoding="utf-8")
                self.assertIn("SIL Open Font License", text)
                self.assertTrue(SOURCE[key]["release"])
                self.assertIn(f"/{SOURCE[key]['release']}/", SOURCE[key]["licenseUrl"])  # copied from the pinned tag

    def test_budget_and_weights_match_spec(self):
        """#face-budget caps; #scale-weights ranges; Taiwan forms in the Chinese face, mainland in the forms face."""
        self.assertEqual(bf.BUDGET, {bf.HAN: 232_000, bf.LATIN: 23_000, "total": 255_000})
        self.assertEqual(bf.WEIGHTS, {bf.HAN: (400, 500), bf.LATIN: (400, 600)})
        self.assertEqual(bf.HAN_LANGS, {"ZHT "})
        self.assertEqual(bf.MAINLAND_LANG, "ZHS ")

    def test_within_budget(self):
        sizes = {key: (bf.FONTS / COVERAGE[key]["file"]).stat().st_size for key in (bf.HAN, bf.MAINLAND, bf.LATIN)}
        self.assertLessEqual(sizes[bf.HAN] + sizes[bf.MAINLAND], bf.BUDGET[bf.HAN])  # Chinese faces together
        self.assertLessEqual(sizes[bf.LATIN], bf.BUDGET[bf.LATIN])
        self.assertLessEqual(sum(sizes.values()), bf.BUDGET["total"])

    def test_both_pages_preload_and_credit_both_faces(self):
        """#face-budget preload; #acceptance-sources typeface credits on both pages."""
        for page, pre in (("index.html", ""), ("bubbles/index.html", "../")):
            html = (bf.SITE / page).read_text(encoding="utf-8")
            for key in (bf.HAN, bf.LATIN):
                with self.subTest(page=page, font=key):
                    self.assertRegex(html, rf'<link rel="preload" href="{pre}fonts/{key}\.woff2" as="font"[^>]*crossorigin')
                    self.assertIn(SOURCE[key]["url"], html)
                    self.assertIn(SOURCE[key]["family"], html)
                    self.assertIn(f'{pre}fonts/{key}.OFL.txt', html)
            self.assertIn("https://openfontlicense.org", html)
            self.assertNotIn(f"{bf.MAINLAND}.woff2", html)  # fetched only once pinyin mode is used

    def test_stylesheet_declares_both_faces(self):
        css = (bf.SITE / "style.css").read_text(encoding="utf-8")
        for key in (bf.HAN, bf.LATIN):
            self.assertIn(f'url("fonts/{key}.woff2") format("woff2")', css)
        self.assertIn('--font: "Geist", "Noto Sans CJK TC"', css)
        self.assertRegex(css, r'font-family: "Noto Sans CJK TC";\s*src: url\("fonts/noto-sans-cjk-tc\.woff2"\) format\("woff2"\);\s*font-weight: 400 500;')
        self.assertRegex(css, r'font-family: "Geist";\s*src: url\("fonts/geist\.woff2"\) format\("woff2"\);\s*font-weight: 400 600;')
        self.assertIn("font-synthesis: none", css)

    def test_pinyin_mode_names_mainland_face_first(self):
        """#face-forms: pinyin mode names the mainland forms face before the Chinese face; Zhuyin never."""
        css = (bf.SITE / "style.css").read_text(encoding="utf-8")
        self.assertRegex(css, r'font-family: "Noto Sans CJK TC Mainland";\s*src: url\("fonts/noto-sans-cjk-tc-mainland\.woff2"\) format\("woff2"\);\s*font-weight: 400 500;')
        self.assertRegex(css, r':root\[data-script="pinyin"\] \{\s*--font: "Geist", "Noto Sans CJK TC Mainland", "Noto Sans CJK TC",')
        self.assertEqual(css.count('"Noto Sans CJK TC Mainland"'), 2)  # its face and the pinyin stack only
        for page in ("app.js", "bubbles/game.js"):
            self.assertIn("document.documentElement.dataset.script = script", (bf.SITE / page).read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
