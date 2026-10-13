// Tests for site/voice.js (docs/specs/hsk-network.spec.html #test-voice,
// #acceptance-speak-choice, #acceptance-speak-choice-unrecorded,
// #acceptance-built-rule, #acceptance-symbol-names; hsk-bubbles.spec.html
// #acceptance-say-source). Run: node --test tests/voice.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { SYMBOL_NAMES, syllableKey, localVoice, choose, builtWord, readVoice, VOICE_KEY, BUILT_PAUSE_MS } from "../site/voice.js";

const tw = { name: "Mei-Jia", lang: "zh-TW", localService: true };
const twAndroid = { name: "zh_TW local", lang: "zh_TW", localService: true };
const twHant = { name: "Hant", lang: "zh-Hant-TW", localService: true };
const twCloud = { name: "Google TW", lang: "zh-TW", localService: false };
const cn = { name: "Tingting", lang: "zh-CN", localService: true };
const en = { name: "Samantha", lang: "en-US", localService: true };
const SYL = new Set(["xue2", "sheng1", "ge4", "lv4", "er1", "bo1", "a1", "zhi1"]);

// One case per row of the speak table that plays (#speak-inside plays nothing
// by never asking): [row, sound with recording, sound without, device text].
const ROWS = [
  ["speak-word", { word: "學生", audio: "audio/1-128.mp3" }, { word: "喜歡" }, "audio/1-128.mp3", "喜歡"],
  ["speak-reading", { syllable: "xue2", char: "學" }, { syllable: "xue4", char: "學" }, "audio/s/xue2.mp3", "學"],
  ["speak-char", { syllable: "sheng1", char: "生" }, { syllable: "sheng5", char: "生" }, "audio/s/sheng1.mp3", "生"],
  ["speak-symbol", { symbol: "ㄅ" }, { symbol: "ㄝ" }, "audio/s/bo1.mp3", "ㄝ"],
  ["speak-line", { syllable: "ge4", char: "個" }, { syllable: "ming2", char: "名" }, "audio/s/ge4.mp3", "名"],
];

for (const [row, rec, bare, src, text] of ROWS) {
  test(`acceptance-speak-choice: ${row} with a recording plays it; off says nothing`, () => {
    assert.deepEqual(choose(rec, true, SYL, [tw]), { src });
    assert.deepEqual(choose(rec, true, SYL, []), { src });
    assert.equal(choose(rec, false, SYL, [tw]), null);
  });

  test(`acceptance-speak-choice-unrecorded: ${row} without a recording: on-device Taiwan voice, else nothing; never a network voice; off says nothing`, () => {
    // A Taiwan Mandarin voice on the device says it.
    assert.deepEqual(choose(bare, true, SYL, [en, cn, twCloud, tw]), { voice: tw, text });
    assert.equal(choose(bare, true, SYL, [twAndroid]).voice, twAndroid);
    assert.equal(choose(bare, true, SYL, [twHant]).voice, twHant);
    // No such voice: nothing (no speaker button, silent tap). Off-device voices never used.
    assert.equal(choose(bare, true, SYL, [en, cn]), null);
    assert.equal(choose(bare, true, SYL, [twCloud]), null);
    assert.equal(choose(bare, true, SYL, [{ lang: "zh-TW" }]), null);
    assert.equal(choose(bare, true, SYL, []), null);
    assert.equal(choose(bare, true, SYL, undefined), null);
    // Voice off: nothing.
    assert.equal(choose(bare, false, SYL, [tw]), null);
  });
}

test("syllables read only through the graph list; missing list means no syllable recordings", () => {
  assert.equal(choose({ syllable: "xue2", char: "學" }, true, undefined, []), null);
  assert.equal(choose({ syllable: "xue2", char: "學" }, true, new Set(), []), null);
});

test("syllable key: lowercase numbered pinyin, ü as v, missing tone neutral, erhua as ㄦ", () => {
  assert.equal(syllableKey("xue2"), "xue2");
  assert.equal(syllableKey("Zhong1"), "zhong1");
  assert.equal(syllableKey("lu:4"), "lv4");
  assert.equal(syllableKey("lü4"), "lv4");
  assert.equal(syllableKey("men"), "men5");
  assert.equal(syllableKey("r5"), "er1");
  assert.deepEqual(choose({ syllable: "lu:4", char: "綠" }, true, SYL, []), { src: "audio/s/lv4.mp3" });
  assert.deepEqual(choose({ syllable: "r5", char: "兒" }, true, SYL, []), { src: "audio/s/er1.mp3" });
});

test("acceptance-symbol-names: all 37 symbols by the symbol table, first tone; ㄝ only by device voice", () => {
  const table = "ㄅ bo ㄆ po ㄇ mo ㄈ fo ㄉ de ㄊ te ㄋ ne ㄌ le ㄍ ge ㄎ ke ㄏ he ㄐ ji ㄑ qi ㄒ xi ㄓ zhi ㄔ chi ㄕ shi ㄖ ri ㄗ zi ㄘ ci ㄙ si "
    + "ㄧ yi ㄨ wu ㄩ yu ㄚ a ㄛ o ㄜ e ㄝ ê ㄞ ai ㄟ ei ㄠ ao ㄡ ou ㄢ an ㄣ en ㄤ ang ㄥ eng ㄦ er";
  const pairs = table.split(" ");
  const want = {};
  for (let i = 0; i < pairs.length; i += 2) want[pairs[i]] = pairs[i + 1] + "1";
  assert.equal(Object.keys(want).length, 37);
  assert.deepEqual({ ...SYMBOL_NAMES }, want);
  // Every name but ê, given its recording, plays it; ê has none in any set.
  const all = new Set(Object.values(want).filter((k) => k !== "ê1"));
  for (const [sym, key] of Object.entries(want)) {
    if (sym === "ㄝ") continue;
    assert.deepEqual(choose({ symbol: sym }, true, all, [tw]), { src: `audio/s/${key}.mp3` }, sym);
  }
  assert.deepEqual(choose({ symbol: "ㄝ" }, true, all, [tw]), { voice: tw, text: "ㄝ" });
  assert.equal(choose({ symbol: "ㄝ" }, true, all, [cn]), null);
});

test("localVoice: Taiwan Mandarin on the device only", () => {
  assert.equal(localVoice([en, twCloud, cn]), null);
  assert.equal(localVoice([en, twCloud, tw]), tw);
  assert.equal(localVoice(undefined), null);
});

test("Voice setting: on at first; stored value wins; the game's earlier choice is kept", () => {
  const store = (o) => ({ getItem: (k) => (k in o ? o[k] : null) });
  assert.equal(readVoice(store({})), true);
  assert.equal(readVoice(store({ [VOICE_KEY]: "off" })), false);
  assert.equal(readVoice(store({ [VOICE_KEY]: "on", hskBubbles: '{"say":false}' })), true);
  assert.equal(readVoice(store({ hskBubbles: '{"say":false,"best":9}' })), false);
  assert.equal(readVoice(store({ hskBubbles: '{"best":9}' })), true);
  assert.equal(readVoice(store({ hskBubbles: "{bad" })), true);
  assert.equal(readVoice({ getItem() { throw new Error("denied"); } }), true);
});

// Built word rule (#built-heading). Fixtures: themed words without recordings
// (the graph has none yet), a syllable set with tones 1 to 4 and a few neutral
// ones, and a character table with first readings.
const BSYL = new Set(["hu2", "die2", "lan2", "ju2", "zi3", "mu4", "mei2", "gui4", "hua1", "ba5", "ma1", "le4", "xue2", "sheng1"]);
const CHARS = {
  子: { readings: [{ pinyin: "zi3" }, { pinyin: "zi5" }] },
  了: { readings: [{ pinyin: "le5" }, { pinyin: "liao3" }] },
  吧: { readings: [{ pinyin: "ba5" }] },
  麼: { readings: [{ pinyin: "me5" }, { pinyin: "mo2" }] },
  生: { readings: [{ pinyin: "sheng1" }] },
};
const s = (k) => `audio/s/${k}.mp3`;

test("acceptance-built-rule: every syllable recorded plays them in order, dictionary tones, no sandhi", () => {
  const w = { word: "蝴蝶蘭", pinyin: "hu2 die2 lan2" };
  assert.deepEqual(choose(w, true, BSYL, [tw], CHARS), { srcs: [s("hu2"), s("die2"), s("lan2")] });
  assert.deepEqual(choose(w, true, BSYL, [], CHARS), { srcs: [s("hu2"), s("die2"), s("lan2")] });
  assert.deepEqual(builtWord({ word: "木蘭", pinyin: "mu4 lan2" }, BSYL, CHARS), [s("mu4"), s("lan2")]);
  // Two third tones stay third (no sandhi); a neutral one with its own recording plays it.
  assert.deepEqual(builtWord({ word: "子子", pinyin: "zi3 zi3" }, BSYL, CHARS), [s("zi3"), s("zi3")]);
  assert.deepEqual(builtWord({ word: "花吧", pinyin: "hua1 ba5" }, BSYL, CHARS), [s("hua1"), s("ba5")]);
  // Voice off: nothing.
  assert.equal(choose(w, false, BSYL, [tw], CHARS), null);
  // A short pause sits between syllables.
  assert.ok(BUILT_PAUSE_MS > 0 && BUILT_PAUSE_MS < 1000);
});

test("acceptance-built-rule: a neutral syllable with no neutral recording takes its character's first reading tone", () => {
  assert.deepEqual(choose({ word: "橘子", pinyin: "ju2 zi5" }, true, BSYL, [], CHARS), { srcs: [s("ju2"), s("zi3")] });
  // The character table is needed for it: without it the syllable is a gap.
  assert.equal(choose({ word: "橘子", pinyin: "ju2 zi5" }, true, BSYL, [], undefined), null);
  // The first reading neutral too (了 le5): not covered.
  assert.equal(builtWord({ word: "樂了", pinyin: "le4 le5" }, BSYL, CHARS), null);
});

test("acceptance-built-rule: a syllable no recording covers says the whole word by the device voice, else nothing", () => {
  const gap = { word: "玫瑰花", pinyin: "mei2 gui4 hua4" };  // hua4 not in the set
  assert.equal(builtWord(gap, BSYL, CHARS), null);
  assert.deepEqual(choose(gap, true, BSYL, [en, twCloud, tw], CHARS), { voice: tw, text: "玫瑰花" });
  assert.equal(choose(gap, true, BSYL, [twCloud, cn], CHARS), null);
  assert.equal(choose(gap, true, BSYL, [], CHARS), null);
  // A neutral syllable whose character is not in the table, or whose
  // characters do not line up with its syllables, is a gap too.
  assert.equal(builtWord({ word: "什麼", pinyin: "shen2 me5" }, BSYL, CHARS), null);
  assert.equal(builtWord({ word: "哪兒", pinyin: "ma1 zi5 r5" }, BSYL, CHARS), null);
});

test("built word rule only for words without their own recording, and only with pinyin", () => {
  assert.deepEqual(choose({ word: "學生", audio: "audio/1-128.mp3", pinyin: "xue2 sheng1" }, true, BSYL, [tw], CHARS), { src: "audio/1-128.mp3" });
  assert.deepEqual(choose({ word: "學生", pinyin: "xue2 sheng5" }, true, BSYL, [tw], CHARS), { srcs: [s("xue2"), s("sheng1")] });
  assert.deepEqual(choose({ word: "喜歡" }, true, BSYL, [tw], CHARS), { voice: tw, text: "喜歡" });
  // Readings and characters are never built: one syllable plays its own recording.
  assert.deepEqual(choose({ syllable: "zi5", char: "子" }, true, BSYL, [], CHARS), null);
});
