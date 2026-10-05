"""#tests-list test-zhuyin, #zhuyin-tones: numbered pinyin to Zhuyin."""

import unittest

from graph_data import build_data

CASES = {
    # the five tones, from the spec table
    "sheng1": "ㄕㄥ",
    "xue2": "ㄒㄩㄝˊ",
    "xi3": "ㄒㄧˇ",
    "shi4": "ㄕˋ",
    "men5": "˙ㄇㄣ",
    # erhua: ㄦ with no mark; standalone er keeps its tone
    "dian3 r5": "ㄉㄧㄢˇ ㄦ",
    "er2": "ㄦˊ",
    # ü syllables, written u: after n/l and u after j/q/x/y
    "nu:3": "ㄋㄩˇ",
    "lu:4": "ㄌㄩˋ",
    "lu:e4": "ㄌㄩㄝˋ",
    "ju4": "ㄐㄩˋ",
    "qu4": "ㄑㄩˋ",
    "xuan3": "ㄒㄩㄢˇ",
    "jun1": "ㄐㄩㄣ",
    # zero-initial syllables
    "yi1": "ㄧ",
    "wu3": "ㄨˇ",
    "yu2": "ㄩˊ",
    "ya1": "ㄧㄚ",
    "ye3": "ㄧㄝˇ",
    "you3": "ㄧㄡˇ",
    "yan2": "ㄧㄢˊ",
    "yin1": "ㄧㄣ",
    "ying1": "ㄧㄥ",
    "yong4": "ㄩㄥˋ",
    "yue4": "ㄩㄝˋ",
    "yuan2": "ㄩㄢˊ",
    "yun4": "ㄩㄣˋ",
    "wei4": "ㄨㄟˋ",
    "wen4": "ㄨㄣˋ",
    "wo3": "ㄨㄛˇ",
    "ai4": "ㄞˋ",
    "e4": "ㄜˋ",
    # syllables whose final is only the initial
    "zhi1": "ㄓ",
    "chi1": "ㄔ",
    "ri4": "ㄖˋ",
    "zi4": "ㄗˋ",
    "ci4": "ㄘˋ",
    "si4": "ㄙˋ",
    # compound finals and abbreviated spellings
    "dui4": "ㄉㄨㄟˋ",
    "jiu3": "ㄐㄧㄡˇ",
    "lun4": "ㄌㄨㄣˋ",
    "zhong1 guo2": "ㄓㄨㄥ ㄍㄨㄛˊ",
    "xiong2": "ㄒㄩㄥˊ",
    "bo2": "ㄅㄛˊ",
    "Zhong1": "ㄓㄨㄥ",
}


class Zhuyin(unittest.TestCase):
    def test_cases(self):
        for pinyin, zhuyin in CASES.items():
            with self.subTest(pinyin=pinyin):
                self.assertEqual(build_data.to_zhuyin(pinyin), zhuyin)

    def test_no_tone_sandhi(self):
        # 你好 keeps dictionary tones 3 3; 不客氣 keeps bu4
        self.assertEqual(build_data.to_zhuyin("ni3 hao3"), "ㄋㄧˇ ㄏㄠˇ")
        self.assertEqual(build_data.to_zhuyin("bu4 ke4 qi5"), "ㄅㄨˋ ㄎㄜˋ ˙ㄑㄧ")

    def test_unknown_syllable_fails(self):
        with self.assertRaises(ValueError):
            build_data.to_zhuyin("xyz1")

    def test_toned_to_numbered(self):
        self.assertEqual(build_data.normalize_toned("xué sheng"), "xue2 sheng5")
        self.assertEqual(build_data.normalize_toned("nǚ ér"), "nu:3 er2")
        self.assertEqual(build_data.normalize_toned("Zhōng guó"), "zhong1 guo2")


if __name__ == "__main__":
    unittest.main()
