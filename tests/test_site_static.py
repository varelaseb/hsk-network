"""Static: the published site loads only its own files (spec #acceptance-static, #test-static)."""

import hashlib
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
# Data files are content, not loads; app.js only turns meta.hskSource into a clicked link.
TEXT_SUFFIXES = {".html", ".js", ".css", ".txt", ".svg"}
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
                    self.assertTrue((page.parent / value).is_file(), value)

    def test_css_loads_only_site_files(self):
        for sheet in SITE.rglob("*.css"):
            for ref in css_urls(sheet.read_text(encoding="utf-8")):
                with self.subTest(sheet=sheet.name, ref=ref):
                    self.assertTrue(ref.startswith("data:") or is_local(ref))

    def test_scripts_fetch_only_site_files(self):
        for script in SITE.rglob("*.js"):
            if script == D3_FILE:
                continue
            text = script.read_text(encoding="utf-8")
            for call in re.findall(r"""\b(?:fetch|import|importScripts|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(\s*(['"`][^'"`]*['"`])?""", text):
                with self.subTest(script=script.name, call=call):
                    self.assertTrue(call and is_local(call.strip("'\"`")), "non-literal or external request")

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
            allowed = D3_ALLOWED if path == D3_FILE else anchor_urls if path.suffix == ".html" else set()
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


if __name__ == "__main__":
    unittest.main()
