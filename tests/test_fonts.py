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
        for key in (bf.KAISHU, bf.LATIN):
            with self.subTest(font=key):
                data = (bf.FONTS / COVERAGE[key]["file"]).read_bytes()
                self.assertEqual(data[:4], b"wOF2")
                self.assertEqual(hashlib.sha256(data).hexdigest(), COVERAGE[key]["sha256"])

    def test_kaishu_covers_every_shown_character(self):
        """Every graph and page character, all Zhuyin and tone marks; only the listed ones may be missing."""
        kaishu = COVERAGE[bf.KAISHU]
        graph = json.loads(bf.GRAPH.read_text(encoding="utf-8"))
        shown = bf.shown_chars(graph, bf.page_texts())
        missing = set(kaishu["missing"])
        self.assertEqual(sorted(shown - set(kaishu["chars"])), sorted(missing))
        self.assertIn("學", shown)
        self.assertIn("学", shown)  # Simplified forms too, for the script setting
        self.assertTrue(set(bf.ZHUYIN) <= set(kaishu["chars"]))
        self.assertEqual(len(bf.ZHUYIN), 37)
        self.assertTrue(set(bf.TONE_MARKS) <= set(kaishu["chars"]))
        self.assertFalse(missing & (set(bf.ZHUYIN) | set(bf.TONE_MARKS)))

    def test_geist_covers_latin_and_pinyin_marks(self):
        chars = set(COVERAGE[bf.LATIN]["chars"])
        for ch in "AZaz09.,ü" + bf.COMBINING_TONES + "āáàēéěèīíìōóòūúù–’…":
            with self.subTest(ch=ch):
                self.assertIn(ch, chars)
        self.assertFalse(chars & set(bf.ZHUYIN), "Zhuyin never renders in the Latin face")

    def test_license_beside_each_font(self):
        for key in (bf.KAISHU, bf.LATIN):
            with self.subTest(font=key):
                text = (bf.FONTS / f"{key}.OFL.txt").read_text(encoding="utf-8")
                self.assertIn("SIL Open Font License", text)
                self.assertIn(SOURCE[key]["url"], text)
                self.assertTrue(SOURCE[key]["release"])

    def test_within_budget(self):
        sizes = {key: (bf.FONTS / COVERAGE[key]["file"]).stat().st_size for key in (bf.KAISHU, bf.LATIN)}
        for key, size in sizes.items():
            self.assertLessEqual(size, bf.BUDGET[key], key)
        self.assertLessEqual(sum(sizes.values()), bf.BUDGET["total"])

    def test_both_pages_preload_and_credit_both_faces(self):
        """#face-budget preload; #acceptance-sources typeface credits on both pages."""
        for page, pre in (("index.html", ""), ("bubbles/index.html", "../")):
            html = (bf.SITE / page).read_text(encoding="utf-8")
            for key in (bf.KAISHU, bf.LATIN):
                with self.subTest(page=page, font=key):
                    self.assertRegex(html, rf'<link rel="preload" href="{pre}fonts/{key}\.woff2" as="font"[^>]*crossorigin')
                    self.assertIn(SOURCE[key]["url"], html)
                    self.assertIn(SOURCE[key]["family"], html)
                    self.assertIn(f'{pre}fonts/{key}.OFL.txt', html)
            self.assertIn("https://openfontlicense.org", html)

    def test_stylesheet_declares_both_faces(self):
        css = (bf.SITE / "style.css").read_text(encoding="utf-8")
        for key in (bf.KAISHU, bf.LATIN):
            self.assertIn(f'url("fonts/{key}.woff2") format("woff2")', css)
        self.assertIn('--font: "Geist", "LXGW WenKai TC"', css)


if __name__ == "__main__":
    unittest.main()
