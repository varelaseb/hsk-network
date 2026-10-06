"""Word link and Play link (spec #page-word-link, #acceptance-word-link, #acceptance-word-link-unknown, #ix-play).

Runs the real linkedWord from app.js under Node against the built graph.json.
"""

import json
import re
import subprocess
import unittest
from html.parser import HTMLParser

from test_search import APP, GRAPH, NODE, extract

SITE = APP.parent


def run_linked(hashes):
    script = "\n".join([
        "const fs = require('fs');",
        "const data = JSON.parse(fs.readFileSync(%s, 'utf8'));" % json.dumps(str(GRAPH)),
        "const byId = new Map();",
        "data.words.forEach(w => byId.set(w.id, Object.assign({}, w, { kind: 'word' })));",
        "data.hubs.forEach(h => byId.set(h.id, Object.assign({}, h, { kind: 'hub' })));",
        extract(APP.read_text(encoding="utf-8"), "linkedWord"),
        "const out = {};",
        "for (const h of %s) { const d = linkedWord(h); out[h] = d ? d.id : null; }" % json.dumps(hashes),
        "console.log(JSON.stringify(out));",
    ])
    res = subprocess.run([NODE, "-e", script], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


@unittest.skipUnless(NODE, "node not installed")
class WordLinkTest(unittest.TestCase):
    def test_known_word_id_is_focused(self):
        self.assertEqual(run_linked(["#word=1-1"])["#word=1-1"], "1-1")

    def test_unknown_or_other_address_loads_as_usual(self):
        cases = ["", "#", "#word=", "#word=9-999", "#word=c-學", "#word=%E0%A4%A", "#1-1", "#words=1-1"]
        self.assertEqual(set(run_linked(cases).values()), {None})


class Anchors(HTMLParser):
    def __init__(self):
        super().__init__()
        self.anchors = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.anchors.append(dict(attrs))


class PlayLinkTest(unittest.TestCase):
    def test_play_link_opens_bubbles_game(self):
        page = Anchors()
        page.feed((SITE / "index.html").read_text(encoding="utf-8"))
        self.assertIn({"class": "play", "href": "bubbles/"}, page.anchors)

    def test_play_link_is_at_least_44px_tall(self):
        css = (SITE / "style.css").read_text(encoding="utf-8")
        rule = re.search(r"(?m)^\.play\s*\{([^}]*)\}", css)
        self.assertIsNotNone(rule)
        self.assertGreaterEqual(int(re.search(r"min-height:\s*(\d+)px", rule.group(1)).group(1)), 44)


if __name__ == "__main__":
    unittest.main()
