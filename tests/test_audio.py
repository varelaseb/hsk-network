"""#test-audio: word and syllable recordings."""

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


SYMBOLS = {x: f"cmn-{x}.mp3" for x in build_data.SYMBOL_NAME_SYLLABLES}


def fixture_graph():
    return {"meta": {}, "words": [
        {"id": "1-1", "pinyin": "xue2 sheng5", "mw": [{"pinyin": "nu:3"}]},
        {"id": "1-2", "pinyin": "yi1 dian3 r5", "defs": [{"parts": ["see ", {"pinyin": "Ri4 ben3"}]}]}],
        "chars": {"吧": {"readings": [{"pinyin": "ba5"}, {"pinyin": "bia1"}]},
                  "句": {"readings": [{"pinyin": "ju4"}]}}}


class AttachSyllables(unittest.TestCase):
    """#syllable-key, #syllable-which, #syllable-erhua, #syllable-fail, #syllable-override, #syllable-field."""

    INDEX = {**SYMBOLS, **{x: f"cmn-{x}.mp3" for x in
                           ("xue2", "nv3", "dian3", "ri4", "ben3", "ba5", "jv4")}}
    OVERRIDES = {"s-ju4": {"id": "s-ju4", "spelling": "jv4"},
                 "s-bia1": {"id": "s-bia1", "none": True}}

    def test_rules(self):
        graph = fixture_graph()
        files, silent = build_data.attach_syllables(graph, self.INDEX, self.OVERRIDES)
        self.assertEqual(list(graph), ["meta", "words", "syllables", "chars"])
        expected = sorted({"xue2", "nv3", "dian3", "ri4", "ben3", "ba5", "ju4", *SYMBOLS})
        self.assertEqual(graph["syllables"], expected)
        self.assertEqual(sorted(files), expected)
        self.assertEqual(files["ju4"], "cmn-jv4.mp3")
        self.assertEqual(silent, ["sheng5"])
        self.assertNotIn("r5", graph["syllables"])
        self.assertNotIn("bia1", graph["syllables"])

    def fails(self, index, overrides):
        with self.assertRaises(build_data.BuildError) as err:
            build_data.attach_syllables(fixture_graph(), index, overrides)
        return err.exception.problems

    def test_missing_tone_fails(self):
        index = {k: v for k, v in self.INDEX.items() if k != "dian3"}
        self.assertEqual(self.fails(index, self.OVERRIDES),
                         ["syllable dian3: no recording in the syllable set"])
        self.assertEqual(self.fails(self.INDEX, {"s-ju4": self.OVERRIDES["s-ju4"]}),
                         ["syllable bia1: no recording in the syllable set"])

    def test_bad_override_fails(self):
        bad = {**self.OVERRIDES, "s-ju4": {"id": "s-ju4", "spelling": "ju9"}, "s-zzz1": {"none": True}}
        self.assertEqual(self.fails(self.INDEX, bad),
                         ["syllable ju4: override spelling ju9 has no recording",
                          "s-zzz1: override names no needed syllable"])

    def test_symbol_names_match_voice_module(self):
        """#symbols-table: the build needs the name syllables the voice module says; ê has none."""
        js = (SITE / "voice.js").read_text(encoding="utf-8")
        table = re.search(r"const NAMES = \{(.*?)\};", js, re.S).group(1)
        names = [n + "1" for n in re.findall(r'"([^"]+)"', table)]
        self.assertEqual(len(names), 37)
        self.assertEqual(sorted(build_data.SYMBOL_NAME_SYLLABLES), sorted(n for n in names if n != "ê1"))


class CommittedSyllables(unittest.TestCase):
    """#acceptance-syllable-files."""

    def test_needed_syllables_have_recordings(self):
        overrides = build_data.load_overrides()
        listed = set(GRAPH["syllables"])
        for x in sorted(build_data.needed_syllables(GRAPH)):
            if x.endswith("5"):
                continue
            o = overrides.get(f"s-{x}")
            with self.subTest(syllable=x):
                if o and o.get("none"):
                    self.assertNotIn(x, listed)
                else:
                    self.assertIn(x, listed)

    def test_overrides_are_needed_and_resolve(self):
        needed = build_data.needed_syllables(GRAPH)
        for i, o in build_data.load_overrides().items():
            if not i.startswith("s-"):
                continue
            with self.subTest(override=i):
                self.assertIn(i[2:], needed)
                self.assertTrue(o["reason"])
                self.assertTrue(o.get("none") or o.get("spelling"))
                if "spelling" in o:
                    self.assertTrue((SITE / "audio" / "s" / f"{i[2:]}.mp3").is_file())

    def test_list_is_sorted_and_needed(self):
        self.assertEqual(GRAPH["syllables"], sorted(set(GRAPH["syllables"])))
        self.assertLessEqual(set(GRAPH["syllables"]), build_data.needed_syllables(GRAPH))

    def test_list_matches_folder(self):
        on_disk = {p.stem for p in (SITE / "audio" / "s").iterdir()}
        self.assertEqual(on_disk, set(GRAPH["syllables"]))
        for p in (SITE / "audio" / "s").iterdir():
            with self.subTest(file=p.name):
                self.assertEqual(p.suffix, ".mp3")
                self.assertGreater(p.stat().st_size, 0)


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
    def test_credits_file_names_both_speakers(self):
        """#test-audio, #source-syllables."""
        syl = build_data.audio_note()["syllables"]
        credits = (SITE / "audio" / "CREDITS.txt").read_text(encoding="utf-8")
        for key in ("speaker", "folder", "license"):
            with self.subTest(key=key):
                self.assertIn(syl[key], credits)

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

    def test_footer_credits_syllables(self):
        """#acceptance-sources, #source-syllables: speaker, source link, and license of the syllables."""
        note = build_data.audio_note()
        footer = re.search(r'<details id="sources">.*?</details>',
                           (SITE / "index.html").read_text(encoding="utf-8"), re.S).group(0)
        line = re.search(r"<p>Syllable recordings.*?</p>", footer, re.S).group(0)
        self.assertIn(note["syllables"]["speaker"], line)
        self.assertIn(note["syllables"]["license"].split(" (")[0] + " (version not stated by the source", line)
        self.assertIn(f'id="syllable-source" href="{note["url"]}"', line)
        self.assertIn('href="audio/CREDITS.txt"', line)

    def test_bubbles_sources_credit_word_recordings(self):
        """#acceptance-sources, bubbles #screen-start: the game plays word recordings, so its Sources credit them."""
        note = build_data.audio_note()
        sources = re.search(r'<details class="sources">.*?</details>',
                            (SITE / "bubbles" / "index.html").read_text(encoding="utf-8"), re.S).group(0)
        line = re.search(r"<p>Pronunciation: word recordings.*?</p>", sources, re.S).group(0)
        for key in ("speaker", "license", "licenseUrl"):
            with self.subTest(key=key):
                self.assertIn(note[key], line)
        self.assertIn(f'id="audio-source" href="{note["url"]}"', line)
        self.assertIn('href="../audio/CREDITS.txt"', line)
        self.assertTrue((SITE / "audio" / "CREDITS.txt").is_file())


if __name__ == "__main__":
    unittest.main()
