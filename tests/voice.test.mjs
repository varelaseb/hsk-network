// Tests for site/voice.js (docs/specs/hsk-network.spec.html #test-voice,
// #acceptance-speak-choice, #acceptance-speak-choice-unrecorded,
// #acceptance-symbol-names; hsk-bubbles.spec.html
// #acceptance-say-source). Run: node --test tests/voice.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { SYMBOL_NAMES, syllableKey, localVoice, choose, readVoice, VOICE_KEY } from "../site/voice.js";

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
