"""qa.toml starts every user-facing story where its criteria's Givens put the learner.

Capture opens each story at its entry.stories start (else [entry]) and narrows a criterion whose
Given names a phone to phone width, but never widens one or changes touch. So every user-facing
story names its own start, at its spec's page, with the device its browser criteria's Givens name.
"""

import html
import re
import tomllib
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = {"hsk-network": "{site}/", "hsk-bubbles": "{site}/bubbles/", "hsk-app": "{site}/"}
DESKTOP, PHONE = {"width": 1280, "height": 800}, {"width": 390, "height": 844}
# Bubbles stories holding desktop criteria too: the game is phone-first, so they stay on a phone.
PHONE_ANYWAY = {"story-play", "story-inspect-char"}


def stories(spec):
    """{user-facing story: [Given of each browser criterion that runs in it]} for one spec."""
    text = (ROOT / "docs/specs" / f"{spec}.spec.html").read_text(encoding="utf-8")
    facing = {
        a: 'data-user-facing="true"' in attrs
        for attrs, a in re.findall(r'<p data-user-story([^>]*)data-anchor="(story-[^"]+)"', text)
    }
    out = {s: [] for s, f in facing.items() if f}
    for attrs, body in re.findall(r"<tr data-acceptance-criterion([^>]*)>(.*?)</tr>", text, re.S):
        listed = re.search(r'data-story="([^"]+)"', attrs).group(1).split()
        story = next((s for s in listed if facing.get(s)), None)  # runs in its first user-facing story
        words = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html.unescape(body)))
        if story and "no screen shows it" not in words:
            out[story].append(words.split("Given", 1)[1].split(". When")[0])
    return out


class QaTargetTest(unittest.TestCase):
    def setUp(self):
        self.entry = tomllib.loads((ROOT / "qa.toml").read_text(encoding="utf-8"))["entry"]["stories"]

    def test_every_story_names_its_start(self):
        named = set()
        for spec, page in PAGES.items():
            for story, givens in stories(spec).items():
                named.add(story)
                with self.subTest(story=story):
                    start = self.entry.get(story)
                    self.assertIsNotNone(start, "falls back to [entry]")
                    self.assertEqual(start.get("url"), page)
                    desktop = any("desktop" in g for g in givens)
                    phone = any(re.search(r"\b(phone|iPhone)\b", g) for g in givens)
                    want_phone = spec != "hsk-network" or (phone and not desktop)
                    if desktop and spec == "hsk-bubbles":
                        self.assertIn(story, PHONE_ANYWAY, "desktop criteria in a phone story")
                    self.assertEqual(start.get("viewport"), PHONE if want_phone else DESKTOP)
                    self.assertEqual(bool(start.get("touch")), want_phone)
        self.assertEqual(set(self.entry) - named, set(), "entry.stories names no user-facing story")


if __name__ == "__main__":
    unittest.main()
