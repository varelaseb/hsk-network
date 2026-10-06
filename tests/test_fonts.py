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
        for key in (bf.HAN, bf.LATIN):
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

    def test_geist_covers_latin_and_pinyin_marks(self):
        chars = set(COVERAGE[bf.LATIN]["chars"])
        for ch in "AZaz09.,ü" + bf.COMBINING_TONES + "āáàēéěèīíìōóòūúù–’…":
            with self.subTest(ch=ch):
                self.assertIn(ch, chars)
        self.assertFalse(chars & set(bf.ZHUYIN), "Zhuyin never renders in the Latin face")

    def test_license_beside_each_font(self):
        for key in (bf.HAN, bf.LATIN):
            with self.subTest(font=key):
                text = (bf.FONTS / f"{key}.OFL.txt").read_text(encoding="utf-8")
                self.assertIn("SIL Open Font License", text)
                self.assertTrue(SOURCE[key]["release"])
                self.assertIn(f"/{SOURCE[key]['release']}/", SOURCE[key]["licenseUrl"])  # copied from the pinned tag

    def test_budget_and_weights_match_spec(self):
        """#face-budget caps; #scale-weights ranges; #face-lang keeps mainland and Taiwan forms only."""
        self.assertEqual(bf.BUDGET, {bf.HAN: 232_000, bf.LATIN: 23_000, "total": 255_000})
        self.assertEqual(bf.WEIGHTS, {bf.HAN: (400, 500), bf.LATIN: (400, 600)})
        self.assertEqual(bf.HAN_LANGS, {"ZHS ", "ZHT "})

    def test_within_budget(self):
        sizes = {key: (bf.FONTS / COVERAGE[key]["file"]).stat().st_size for key in (bf.HAN, bf.LATIN)}
        for key, size in sizes.items():
            self.assertLessEqual(size, bf.BUDGET[key], key)
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

    def test_stylesheet_declares_both_faces(self):
        css = (bf.SITE / "style.css").read_text(encoding="utf-8")
        for key in (bf.HAN, bf.LATIN):
            self.assertIn(f'url("fonts/{key}.woff2") format("woff2")', css)
        self.assertIn('--font: "Geist", "Noto Sans CJK TC"', css)
        self.assertRegex(css, r'font-family: "Noto Sans CJK TC";\s*src: url\("fonts/noto-sans-cjk-tc\.woff2"\) format\("woff2"\);\s*font-weight: 400 500;')
        self.assertRegex(css, r'font-family: "Geist";\s*src: url\("fonts/geist\.woff2"\) format\("woff2"\);\s*font-weight: 400 600;')
        self.assertIn("font-synthesis: none", css)


if __name__ == "__main__":
    unittest.main()
