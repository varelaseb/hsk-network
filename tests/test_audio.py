"""#test-audio: word recordings."""

import re
import unittest

from graph_data import GRAPH, ROOT, build_data

SITE = ROOT / "site"


def word(id_, simp):
    return {"id": id_, "simp": simp}


class AttachAudio(unittest.TestCase):
    """#audio-match, #audio-polyphone, #audio-field."""

    def test_rules(self):
        words = [word("1-1", "学生"), word("1-2", "长"), word("2-1", "长"), word("1-3", "北京")]
        missing = build_data.attach_audio(words, {"学生": "cmn-学生.mp3", "长": "cmn-长.mp3"})
        self.assertEqual(words[0]["audio"], "audio/1-1.mp3")
        self.assertNotIn("audio", words[1])
        self.assertNotIn("audio", words[2])
        self.assertNotIn("audio", words[3])
        self.assertEqual([w["id"] for w in missing], ["1-3"])


class CommittedAudio(unittest.TestCase):
    def test_every_entry_names_an_existing_recording(self):
        """#acceptance-audio-files: every audio entry names a recording in the site."""
        for w in GRAPH["words"]:
            if "audio" in w:
                with self.subTest(id=w["id"]):
                    self.assertEqual(w["audio"], f"audio/{w['id']}.mp3")
                    path = SITE / w["audio"]
                    self.assertTrue(path.is_file())
                    head = path.read_bytes()[:3]
                    self.assertTrue(head == b"ID3" or head[0] == 0xFF, "not an MP3")

    def test_every_recording_belongs_to_a_word(self):
        """#acceptance-audio-files: every recording in the site belongs to a word."""
        named = {w["audio"] for w in GRAPH["words"] if "audio" in w}
        on_disk = {f"audio/{p.name}" for p in (SITE / "audio").glob("*.mp3")}
        self.assertTrue(named)
        self.assertEqual(on_disk, named)

    def test_shared_simplified_form_has_none(self):
        """#acceptance-audio-files: no word with a shared Simplified form has a recording."""
        count = {}
        for w in GRAPH["words"]:
            count[w["simp"]] = count.get(w["simp"], 0) + 1
        shared = [w for w in GRAPH["words"] if count[w["simp"]] > 1]
        self.assertTrue(shared)
        for w in shared:
            with self.subTest(id=w["id"]):
                self.assertNotIn("audio", w)

    def test_meta_pins_the_noted_commit(self):
        note = build_data.audio_note()
        self.assertRegex(note["commit"], r"^[0-9a-f]{40}$")
        self.assertEqual(GRAPH["meta"]["audioSource"], f"{note['url']}@{note['commit']}")


class Credits(unittest.TestCase):
    """Credits file beside the recordings and the Sources footer name the note's source."""

    def test_credits_file_and_footer(self):
        """#acceptance-sources."""
        note = build_data.audio_note()
        credits = (SITE / "audio" / "CREDITS.txt").read_text(encoding="utf-8")
        footer = re.search(r'<details id="sources">.*?</details>',
                           (SITE / "index.html").read_text(encoding="utf-8"), re.S).group(0)
        for text, name in ((credits, "credits"), (footer, "footer")):
            for key in ("speaker", "url", "license", "licenseUrl"):
                with self.subTest(file=name, key=key):
                    self.assertIn(note[key], text)


if __name__ == "__main__":
    unittest.main()
