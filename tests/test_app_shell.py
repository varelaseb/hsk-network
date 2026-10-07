"""App shell: manifest and page heads (hsk-app spec #test-manifest, #test-heads, #acceptance-manifest)."""

import json
import re
import sys
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import build_icons as bi  # noqa: E402  (sizes and color rules only; stdlib at import)

SITE = ROOT / "site"
MANIFEST = SITE / "manifest.webmanifest"
LOOK = bi.look_colors()
# Any GitHub Pages project path: the site root is the directory holding the manifest.
BASE = "https://owner.github.io/repo/"
PAGES = {"index.html": LOOK["paper"], "bubbles/index.html": LOOK["night"]}
SCHEMES = ("light", "dark")


class Head(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links, self.metas, self.styles, self._in_head, self._style = [], {}, [], True, False
        self.themes = []  # (media or None, color) of every theme-color line

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "body":
            self._in_head = False
        if not self._in_head:
            return
        if tag == "link":
            self.links.append(a)
        elif tag == "meta" and "name" in a:
            self.metas[a["name"]] = a.get("content")
            if a["name"] == "theme-color":
                self.themes.append((a.get("media"), a.get("content", "").lower()))
        elif tag == "style":
            self._style = True

    def handle_endtag(self, tag):
        if tag == "style":
            self._style = False

    def handle_data(self, data):
        if self._style:
            self.styles.append(data)

    def theme(self, scheme):
        """The theme colors that apply in an appearance."""
        return [c for m, c in self.themes if m is None or m == f"(prefers-color-scheme: {scheme})"]

    def background(self, scheme):
        """The inline html background in an appearance; a dark block overrides the plain one."""
        css = "".join(self.styles)
        dark = re.search(r"@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*html\s*\{[^}]*background(?:-color)?:\s*(#[0-9a-fA-F]{6})", css)
        plain = re.match(r"\s*html\s*\{[^}]*background(?:-color)?:\s*(#[0-9a-fA-F]{6})", css)
        if scheme == "dark" and dark:
            return dark.group(1).lower()
        return plain.group(1).lower() if plain else None

    def rel(self, rel):
        return [link for link in self.links if link.get("rel") == rel]


def head(page):
    h = Head()
    h.feed((SITE / page).read_text(encoding="utf-8"))
    return h


def inside(url, base=BASE):
    return url.startswith(base)


class ManifestTest(unittest.TestCase):
    """#test-manifest: parses; id, start, scope inside the site path; standalone; names; colors; icons."""

    @classmethod
    def setUpClass(cls):
        cls.m = json.loads(MANIFEST.read_text(encoding="utf-8"))

    def test_start_scope_and_id_resolve_inside_site_path(self):
        here = urljoin(BASE, "manifest.webmanifest")
        start = urljoin(here, self.m["start_url"])
        scope = urljoin(here, self.m["scope"])
        self.assertEqual(start, BASE)
        self.assertEqual(scope, BASE)
        self.assertTrue(inside(urljoin(start, self.m["id"])))
        for page in PAGES:  # both pages lie inside the scope
            self.assertTrue(inside(urljoin(BASE, page), scope), page)
        # Local preview at the server root resolves to "/".
        self.assertEqual(urljoin("http://localhost:8000/manifest.webmanifest", self.m["start_url"]),
                         "http://localhost:8000/")

    def test_standalone_and_names(self):
        """#manifest-names, #default-name, #default-identity."""
        self.assertEqual(self.m["display"], "standalone")
        self.assertEqual(self.m["short_name"], "字串")
        self.assertEqual(self.m["name"], "字串 · Traditional words with Zhuyin")
        self.assertLessEqual(len(self.m["short_name"]), 12)
        for name in (self.m["name"], self.m["short_name"]):
            self.assertNotIn("HSK", name)
            self.assertNotRegex(name, r"[串-串]{0}汉|学|拼音|pinyin")  # no Simplified form or pinyin

    def test_colors_are_the_look(self):
        """#manifest-colors: paper; the look's paper and ink-blue night, no red (#default-identity)."""
        self.assertEqual(self.m["background_color"].lower(), LOOK["paper"])
        self.assertEqual(self.m["theme_color"].lower(), LOOK["paper"])
        self.assertEqual(LOOK, {"paper": "#f6f4ef", "night": "#0f1424"})

    def test_every_icon_exists_at_its_stated_size(self):
        """#manifest-icons: 192 and 512 for any shape, one 512 maskable; sizes read from each PNG header."""
        icons = self.m["icons"]
        self.assertEqual(sorted((i["sizes"], i.get("purpose", "any")) for i in icons),
                         [("192x192", "any"), ("512x512", "any"), ("512x512", "maskable")])
        for icon in icons:
            with self.subTest(icon=icon["src"]):
                path = (MANIFEST.parent / icon["src"]).resolve()
                self.assertTrue(path.is_relative_to(SITE.resolve()))
                self.assertEqual(icon["type"], "image/png")
                w, h = bi.png_size(path.read_bytes())
                self.assertEqual(f"{w}x{h}", icon["sizes"])
                self.assertEqual(bi.MANIFEST_ICONS[path.name], (w, icon["purpose"]))


class HeadsTest(unittest.TestCase):
    """#test-heads: same manifest and 180px icon, app-capable and title lines, viewport-fit cover,
    and each page's theme color and inline background in its own look color."""

    def test_both_pages_join_the_same_app(self):
        targets = set()
        for page in PAGES:
            h = head(page)
            with self.subTest(page=page):
                manifests = h.rel("manifest")
                self.assertEqual(len(manifests), 1)
                targets.add((SITE / page).parent.joinpath(manifests[0]["href"]).resolve())
                icons = h.rel("apple-touch-icon")
                self.assertEqual(len(icons), 1)
                icon = (SITE / page).parent / icons[0]["href"]
                self.assertEqual(icon.resolve(), (SITE / "icons" / bi.HOME_ICON[0]).resolve())
                self.assertEqual(bi.png_size(icon.read_bytes()), (180, 180))
                self.assertEqual(icons[0].get("sizes"), "180x180")
                self.assertEqual(h.metas.get("apple-mobile-web-app-capable"), "yes")
                self.assertEqual(h.metas.get("mobile-web-app-capable"), "yes")
                self.assertEqual(h.metas.get("apple-mobile-web-app-title"), "字串")
                # Status bar keeps its own area; iOS draws dark text on paper, light on night.
                self.assertEqual(h.metas.get("apple-mobile-web-app-status-bar-style"), "default")
                viewport = [p.strip() for p in h.metas["viewport"].split(",")]
                self.assertIn("width=device-width", viewport)
                self.assertIn("viewport-fit=cover", viewport)
        self.assertEqual(targets, {MANIFEST.resolve()})

    def test_theme_and_inline_background_are_the_page_color(self):
        """#head-color: paper for the network, night for the game, night for both in the dark
        appearance, set in the head before any sheet."""
        for page, color in PAGES.items():
            h = head(page)
            for scheme in SCHEMES:
                want = color if scheme == "light" else LOOK["night"]
                with self.subTest(page=page, scheme=scheme):
                    self.assertEqual(h.theme(scheme), [want])
                    self.assertEqual(h.background(scheme), want)
            text = (SITE / page).read_text(encoding="utf-8")
            self.assertLess(text.index("<style>"), text.index('rel="stylesheet"'))

    def test_launch_images_on_network_only_a_pair_per_screen(self):
        """#head-launch: per iPhone screen a plain paper image for the light appearance and a
        plain night one for the dark, chosen by prefers-color-scheme, linked from the network only."""
        self.assertEqual(head("bubbles/index.html").rel("apple-touch-startup-image"), [])
        links = head("index.html").rel("apple-touch-startup-image")
        want = {bi.launch_media(*s, scheme): "icons/" + bi.launch_name(*s, scheme)
                for s in bi.LAUNCH for scheme in SCHEMES}
        self.assertEqual({link["media"]: link["href"] for link in links}, want)
        self.assertEqual(len(links), 2 * len(bi.LAUNCH))
        for scheme, color in (("light", LOOK["paper"]), ("dark", LOOK["night"])):
            for w, h, r in bi.LAUNCH:
                with self.subTest(screen=(w, h, r), scheme=scheme):
                    media = bi.launch_media(w, h, r, scheme)
                    self.assertTrue(media.endswith(f"(prefers-color-scheme: {scheme})"))
                    data = (SITE / "icons" / bi.launch_name(w, h, r, scheme)).read_bytes()
                    self.assertEqual(bi.png_size(data), (w * r, h * r))
                    self.assertEqual(plain_png_color(data), color)


def plain_png_color(data):
    """The one color of a single-color palette PNG, as the icon command writes the launch images."""
    pos, palette, color_type = 8, None, None
    while pos < len(data):
        length = int.from_bytes(data[pos:pos + 4], "big")
        kind, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            color_type = body[9]
        elif kind == b"PLTE":
            palette = body
        pos += 12 + length
    if color_type != 3 or palette is None or len(palette) != 3:
        return None
    return "#" + palette.hex()


if __name__ == "__main__":
    unittest.main()
