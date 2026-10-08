"""Static: the published site loads only its own files (spec #test-static)."""

import hashlib
import json
import re
import sys
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
sys.path.insert(0, str(ROOT / "scripts"))

import build_offline as bo  # noqa: E402

WORKER = SITE / bo.WORKER
# Data files are content, not loads; app.js only turns meta.hskSource into a clicked link.
TEXT_SUFFIXES = {".html", ".js", ".css", ".txt", ".svg", ".webmanifest"}
URL_RE = re.compile(r"""(?:[a-z][a-z0-9+.-]*:)?//[^\s"'`)<>\\]+""", re.I)

# The vendored D3 build, pinned (npm d3@7.9.0 dist/d3.min.js).
D3_FILE = SITE / "vendor" / "d3.v7.min.js"
D3_SHA256 = "f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539"
# Addresses inside D3 that are XML namespace names or its banner comment, never fetched.
D3_ALLOWED = {
    "https://d3js.org",
    "http://www.w3.org/1999/xhtml",
    "http://www.w3.org/2000/svg",
    "http://www.w3.org/1999/xlink",
    "http://www.w3.org/XML/1998/namespace",
    "http://www.w3.org/2000/xmlns/",
}
# Attributes that make the browser load something; <a href> is navigation and is allowed out.
LOADING_ATTRS = {"src", "srcset", "data", "poster", "action", "formaction", "background"}


def is_local(ref):
    ref = ref.strip()
    return bool(ref) and not URL_RE.match(ref) and not re.match(r"^[a-z][a-z0-9+.-]*:", ref, re.I)


class Refs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.loads, self.anchors = [], []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        for name, value in attrs:
            if value is None:
                continue
            if name in LOADING_ATTRS:
                self.loads.append((tag, name, value))
            elif name == "href":
                (self.anchors if tag == "a" else self.loads).append((tag, name, value))
            elif name == "style":
                self.loads += [(tag, "style", u) for u in css_urls(value)]
        if tag == "meta" and a.get("http-equiv", "").lower() == "refresh":
            self.loads.append((tag, "content", a.get("content", "")))


def css_urls(text):
    return re.findall(r"""url\(\s*['"]?([^'")]+)""", text) + re.findall(r"""@import\s+['"]([^'"]+)""", text)


class StaticSiteTest(unittest.TestCase):
    def site_files(self):
        return [p for p in SITE.rglob("*") if p.is_file()]

    def test_required_files_exist(self):
        for rel in ("index.html", "app.js", "style.css", "vendor/d3.v7.min.js"):
            self.assertTrue((SITE / rel).is_file(), rel)

    def test_d3_is_the_pinned_build(self):
        self.assertEqual(hashlib.sha256(D3_FILE.read_bytes()).hexdigest(), D3_SHA256)

    def test_html_loads_only_site_files(self):
        """#acceptance-static, #acceptance-game-static: every site page, the game included."""
        for page in SITE.rglob("*.html"):
            refs = Refs()
            refs.feed(page.read_text(encoding="utf-8"))
            self.assertTrue(refs.loads, page)
            for tag, attr, value in refs.loads:
                with self.subTest(page=page.name, tag=tag, attr=attr, value=value):
                    self.assertTrue(is_local(value), "loads outside the site")
                    if not value.startswith("#"):
                        target = (page.parent / value.split("#")[0].split("?")[0]).resolve()
                        self.assertTrue(target.is_relative_to(SITE.resolve()), "escapes the site")
                        self.assertTrue(target.is_file(), "missing site file")
            for _, _, value in refs.anchors:
                if is_local(value) and not value.startswith("#"):
                    # A directory link ("../") opens that directory's index.html.
                    target = page.parent / value.split("#")[0]
                    if value.split("#")[0].endswith("/"):
                        target = target / "index.html"
                    self.assertTrue(target.is_file(), value)

    def test_css_loads_only_site_files(self):
        for sheet in SITE.rglob("*.css"):
            for ref in css_urls(sheet.read_text(encoding="utf-8")):
                with self.subTest(sheet=sheet.name, ref=ref):
                    self.assertTrue(ref.startswith("data:") or is_local(ref))

    def test_scripts_fetch_only_site_files(self):
        for script in SITE.rglob("*.js"):
            # The worker forwards the page's own requests; test_worker_fetches_only_site_files covers it.
            if script in (D3_FILE, WORKER):
                continue
            text = script.read_text(encoding="utf-8")
            for call in re.findall(r"""\b(?:fetch|import|importScripts|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(\s*(['"`][^'"`]*['"`])?""", text):
                with self.subTest(script=script.name, call=call):
                    self.assertTrue(call and is_local(call.strip("'\"`")), "non-literal or external request")

    def test_worker_fetches_only_site_files(self):
        """The worker saves only listed site files; tests/offline.test.mjs proves it fetches nothing else."""
        files, _ = bo.read_block(WORKER.read_text(encoding="utf-8"))
        for f in files:
            with self.subTest(file=f):
                self.assertTrue(is_local(f))
                self.assertTrue((SITE / f).resolve().is_relative_to(SITE.resolve()))
                self.assertTrue((SITE / f).is_file())

    def test_manifest_loads_only_site_files(self):
        m = json.loads((SITE / "manifest.webmanifest").read_text(encoding="utf-8"))
        for ref in [m["id"], m["start_url"], m["scope"]] + [i["src"] for i in m["icons"]]:
            with self.subTest(ref=ref):
                self.assertTrue(is_local(ref))
                self.assertTrue((SITE / ref).resolve().is_relative_to(SITE.resolve()))

    def test_no_external_address_outside_anchors(self):
        """No site file names an outside address except page links a learner clicks."""
        anchor_urls = set()
        for page in SITE.rglob("*.html"):
            refs = Refs()
            refs.feed(page.read_text(encoding="utf-8"))
            anchor_urls |= {v for _, _, v in refs.anchors}
        for path in self.site_files():
            if path.suffix not in TEXT_SUFFIXES:
                continue
            text = path.read_text(encoding="utf-8")
            # Text files (licenses, credits) may name only addresses the pages link.
            allowed = D3_ALLOWED if path == D3_FILE else anchor_urls if path.suffix in {".html", ".txt"} else set()
            for url in set(URL_RE.findall(text)):
                with self.subTest(file=str(path.relative_to(SITE)), url=url):
                    self.assertIn(url, allowed)

    def test_no_api_key_or_endpoint(self):
        for path in self.site_files():
            if path.suffix not in TEXT_SUFFIXES or path == D3_FILE:
                continue
            text = path.read_text(encoding="utf-8")
            with self.subTest(file=path.name):
                self.assertNotRegex(text, r"(?i)api[_-]?key|access[_-]?token|bearer\s|/api/")


class Switches(HTMLParser):
    def __init__(self):
        super().__init__()
        self.switches = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get("role") == "switch":
            self.switches.append((tag, a))


class LevelPanelTest(unittest.TestCase):
    """Level panel markup (spec #page-levels, #ix-levels)."""

    def test_one_switch_per_level_on_at_load(self):
        page = Switches()
        page.feed((SITE / "index.html").read_text(encoding="utf-8"))
        levels = [(t, a) for t, a in page.switches if "level" in a.get("class", "").split()]
        self.assertEqual([a.get("data-level") for _, a in levels], ["1", "2"])
        for tag, a in levels:
            with self.subTest(level=a.get("data-level")):
                self.assertEqual(tag, "button")
                self.assertEqual(a.get("aria-checked"), "true")

    def test_switch_is_at_least_44px_tall(self):
        css = (SITE / "style.css").read_text(encoding="utf-8")
        rule = re.search(r"(?m)^\.level\s*\{([^}]*)\}", css)
        self.assertIsNotNone(rule)
        height = re.search(r"min-height:\s*(\d+)px", rule.group(1))
        self.assertIsNotNone(height)
        self.assertGreaterEqual(int(height.group(1)), 44)


class ScriptControlTest(unittest.TestCase):
    """Script setting (#default-script-setting, #acceptance-script-default): one control reading
    "Zhuyin" by default, stored on the device under the key both pages read."""

    def test_control_reads_zhuyin_and_setting_is_shared(self):
        html = (SITE / "index.html").read_text(encoding="utf-8")
        self.assertRegex(html, r'<button type="button" id="script" class="script">Zhuyin</button>')
        app = (SITE / "app.js").read_text(encoding="utf-8")
        self.assertIn('const SCRIPT_KEY = "hskScript";', app)
        self.assertIn('SCRIPT_LABEL = { zhuyin: "Zhuyin", pinyin: "Pinyin" }', app)

    def test_control_is_at_least_44px_tall(self):
        css = (SITE / "style.css").read_text(encoding="utf-8")
        rule = re.search(r"(?m)^\.script\s*\{([^}]*)\}", css)
        self.assertGreaterEqual(int(re.search(r"min-height:\s*(\d+)px", rule.group(1)).group(1)), 44)


class VoiceControlTest(unittest.TestCase):
    """Voice control and card sounds (#page-voice, #page-touch, #page-card-content,
    #boundary-voice, #acceptance-voice-network): a switch beside the script control reading
    "Voice on", full-size speaker buttons, every sound and the setting through voice.js."""

    def test_control_beside_script_reads_voice_on(self):
        html = (SITE / "index.html").read_text(encoding="utf-8")
        self.assertRegex(html, r'id="script"[^\n]*\n\s*<button type="button" id="voice" class="voice" role="switch" aria-checked="true"')
        self.assertRegex(html, r'<span class="voice-state">Voice on</span>')

    def test_control_and_speaker_button_are_at_least_44px(self):
        css = (SITE / "style.css").read_text(encoding="utf-8")
        voice = re.search(r"(?m)^\.voice\s*\{([^}]*)\}", css).group(1)
        self.assertGreaterEqual(int(re.search(r"min-height:\s*(\d+)px", voice).group(1)), 44)
        say = re.search(r"(?m)^\.c-say\s*\{([^}]*)\}", css).group(1)
        self.assertGreaterEqual(int(re.search(r"(?m)^\s*width:\s*(\d+)px", say).group(1)), 44)
        self.assertGreaterEqual(int(re.search(r"(?m)^\s*height:\s*(\d+)px", say).group(1)), 44)

    def test_one_voice_module(self):
        app = (SITE / "app.js").read_text(encoding="utf-8")
        self.assertIn('import * as voice from "./voice.js";', app)
        for second in ("new Audio", "speechSynthesis", "hskVoice"):
            with self.subTest(second=second):
                self.assertNotIn(second, app)

    def test_game_cards_carry_no_speaker(self):
        # The shared headword builder stays silent; only the network card adds sounds.
        hw = (SITE / "headword.js").read_text(encoding="utf-8")
        for name in ("voice", "c-say", "addEventListener"):
            with self.subTest(name=name):
                self.assertNotIn(name, hw)


class BreakdownSourcesTest(unittest.TestCase):
    """#acceptance-sources-breakdown: the Sources footer credits BabelStone IDS and Unihan."""

    def test_sources_credit_ids_and_unihan(self):
        refs = Refs()
        html = (SITE / "index.html").read_text(encoding="utf-8")
        refs.feed(html)
        links = {v for _, _, v in refs.anchors}
        for url in ("https://babelstone.co.uk/CJK/IDS.TXT",
                    "https://www.unicode.org/charts/unihan.html",
                    "https://www.unicode.org/license.txt"):
            self.assertIn(url, links)
        self.assertIn("Andrew West", html)
        # app.js fills these from the graph data meta.
        for slot in ('id="ids-date"', 'id="unihan-version"'):
            self.assertIn(slot, html)
        app = (SITE / "app.js").read_text(encoding="utf-8")
        for key in ("meta.idsDate", "meta.unihanVersion"):
            self.assertIn(key, app)

    def test_sources_credit_glyphwiki(self):
        refs = Refs()
        html = (SITE / "index.html").read_text(encoding="utf-8")
        refs.feed(html)
        links = {v for _, _, v in refs.anchors}
        self.assertIn("https://glyphwiki.org/", links)
        self.assertIn("data/glyphwiki-LICENSE.txt", links)
        self.assertTrue((SITE / "data" / "glyphwiki-LICENSE.txt").is_file())
        self.assertIn('id="glyphwiki-date"', html)
        self.assertIn("meta.glyphwikiDate", (SITE / "app.js").read_text(encoding="utf-8"))


# Okabe-Ito palette (Okabe and Ito 2008), designed to stay apart under common color blindness.
OKABE_ITO = {"#e69f00", "#56b4e9", "#009e73", "#f0e442", "#0072b2", "#d55e00", "#cc79a7", "#000000"}


def luminance(hex_color):
    rgb = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def contrast(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def look_tokens():
    """Light tokens from :root and the dark appearance's swap, each resolved to a hex color."""
    css = (SITE / "style.css").read_text(encoding="utf-8")
    root = re.search(r":root\s*\{(.*?)\}", css, re.S).group(1)
    tok = {k: v.lower() for k, v in re.findall(r"--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;", root)}
    block = re.search(r"@media \(prefers-color-scheme: dark\)\s*\{.*?\bbody\s*\{(.*?)\}", css, re.S).group(1)
    dark = dict(tok)
    dark.update({k: tok[v] for k, v in re.findall(r"--([\w-]+):\s*var\(--([\w-]+)\)\s*;", block) if v in tok})
    return css, tok, dark


class DarkColorsTest(unittest.TestCase):
    """#acceptance-dark-colors, #test-dark: on the night page and the dark surface, ink and muted
    reach 4.5:1, level and hub colors 3:1, where each is used."""

    def setUp(self):
        _, self.tok, self.dark = look_tokens()

    def test_dark_takes_the_table_column(self):
        d = self.dark
        self.assertEqual((d["paper"], d["surface"], d["ink"], d["muted"]),
                         ("#0f1424", "#181e31", "#f6f4ef", "#a9b0c2"))

    def test_text_reaches_4_5_to_1(self):
        for bg in (self.dark["paper"], self.dark["surface"]):
            for fg in (self.dark["ink"], self.dark["muted"]):
                self.assertGreaterEqual(contrast(fg, bg), 4.5, (fg, bg))

    def test_levels_and_hub_reach_3_to_1_where_used(self):
        # Levels: graph nodes on the night page, swatches and card marks on the dark surface.
        for bg in (self.dark["paper"], self.dark["surface"]):
            for fg in (self.dark["hsk1"], self.dark["hsk2"]):
                self.assertGreaterEqual(contrast(fg, bg), 3, (fg, bg))
        # Hub: graph nodes on the night page only.
        self.assertGreaterEqual(contrast(self.dark["hub"], self.dark["paper"]), 3)


class StrokeColorsTest(unittest.TestCase):
    """#acceptance-strokes-colors: part colors and radical outline at 3:1 or more on both cards."""

    def setUp(self):
        css, self.tok, dark = look_tokens()
        self.parts = [self.tok["part-%d" % i] for i in (1, 2, 3)]
        # The dark card is the dark surface with the dark ink.
        self.light = {"bg": self.tok["surface"], "ink": self.tok["ink"]}
        self.dark = {"bg": dark["surface"], "ink": dark["ink"]}
        # The outline is drawn in the card's ink.
        self.assertRegex(css, r"\.s-ink, \.s-out \{ stroke: var\(--ink\); \}")

    def test_part_colors_reach_3_to_1_on_both_cards(self):
        for card in (self.light, self.dark):
            for c in self.parts:
                self.assertGreaterEqual(contrast(c, card["bg"]), 3, (c, card["bg"]))

    def test_radical_outline_reaches_15_to_1_on_both_cards(self):
        for card in (self.light, self.dark):
            self.assertGreaterEqual(contrast(card["ink"], card["bg"]), 15, card)

    def test_part_colors_are_okabe_ito_apart_from_levels(self):
        levels = {self.tok["hsk1"], self.tok["hsk2"]}
        self.assertEqual(len(set(self.parts)), 3)
        for c in self.parts:
            self.assertIn(c, OKABE_ITO)
            self.assertNotIn(c, levels)

    def test_contrast_matches_spec_table(self):
        self.assertEqual([round(contrast(c, self.light["bg"]), 1) for c in self.parts], [3.9, 3.4, 3.1])
        self.assertEqual([round(contrast(c, self.dark["bg"]), 1) for c in self.parts], [4.3, 4.8, 5.4])


if __name__ == "__main__":
    unittest.main()
