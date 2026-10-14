// Card sounds on the network page (docs/specs/hsk-network.spec.html #speak-table,
// #built-heading, #ix-voice; #acceptance-speak-word-sound, #acceptance-speak-reading-sound,
// #acceptance-speak-syllable, #acceptance-speak-symbol, #acceptance-speak-line,
// #acceptance-speak-pinyin, #acceptance-speak-phone-sound, #acceptance-hear-built-sound,
// #acceptance-voice-off-silent). Each tap's sound is built as site/app.js builds it (its real
// syllableSounds, extracted), then played by the real site/voice.js page side against the built
// graph.json, with the browser's Audio, speech, storage, and timers stubbed.
// Run: node --test tests/speak.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extract } from "./extract.mjs";
import * as voice from "../site/voice.js";
import { headword } from "../site/senses.js";

const site = (p) => new URL("../site/" + p, import.meta.url);
const GRAPH = JSON.parse(readFileSync(site("data/graph.json"), "utf8"));
const WORDS = new Map(GRAPH.words.map((w) => [w.id, w]));
const CHARS = GRAPH.chars;

// The real app.js function a card uses for each syllable's sound.
const APP = readFileSync(site("app.js"), "utf8");
const syllableSounds = new Function(extract(APP, "syllableSounds") + "; return syllableSounds;")();

// Browser stubs: one recording player, the device voice, storage, a timer.
const SITE = site("").href; // recording srcs resolve under site/, wherever the checkout is
const played = [];      // every recording src a player started, in order
const spoken = [];      // every device voice utterance
let player = null;
globalThis.Audio = class {
  constructor() { player = this; this.onended = null; }
  play() { played.push(this.src.startsWith(SITE) ? this.src.slice(SITE.length) : this.src); return Promise.resolve(); }
  pause() {}
};
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
const tw = { name: "Mei-Jia", lang: "zh-TW", localService: true };
globalThis.speechSynthesis = {
  getVoices: () => [tw],
  speak: (u) => { if (u.text) spoken.push(u.text); },
  cancel() {},
};
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
mock.timers.enable({ apis: ["setTimeout"] });
voice.useGraph(GRAPH);

function tap(sound) {
  played.length = 0;
  spoken.length = 0;
  voice.say(sound);
}

// What a card asks for (app.js showCard, speakingHeadword, appendRef).
const speaker = (w) => ({ word: w.trad, audio: w.audio, pinyin: w.pinyin });
const TONE = { "": "1", "ˊ": "2", "ˇ": "3", "ˋ": "4" };
const columnTone = (cell) => (cell.neutral ? "5" : TONE[cell.tone]);
const DIANNAO = WORDS.get("1-17");  // 電腦 dian4 nao3, recorded, measure word 臺 tai2

test("acceptance-speak-word-sound: the card's speaker button plays the word's recording once", () => {
  voice.setVoice(true);
  tap(speaker(DIANNAO));
  assert.deepEqual(played, [DIANNAO.audio]);
  assert.equal(player.onended, null, "nothing follows: it plays once");
  assert.deepEqual(spoken, []);
});

test("acceptance-speak-phone-sound: the bottom sheet's speaker button (the same card) plays the word", () => {
  voice.setVoice(true);
  const w = WORDS.get("1-76");  // 朋友
  assert.ok(voice.canSay(speaker(w)), "the button shows");
  tap(speaker(w));
  assert.deepEqual(played, [w.audio]);
  assert.equal(player.onended, null);
});

test("acceptance-speak-reading-sound: the reading that is not the standard one plays its syllable in its tone", () => {
  voice.setVoice(true);
  const [standard, other] = CHARS["長"].readings;  // #hub-reading: standard first
  assert.equal(standard.pinyin, "zhang3");
  assert.equal(other.pinyin, "chang2");
  tap({ syllable: other.pinyin, char: "長" });
  assert.deepEqual(played, ["audio/s/chang2.mp3"]);
  const [cell] = headword({ trad: "長", pinyin: other.pinyin, zhuyin: other.zhuyin }, "zhuyin").cells;
  assert.equal(columnTone(cell), "2", "the tone its Zhuyin shows");
});

test("acceptance-speak-syllable: one headword character plays only its syllable, in its column's tone", () => {
  voice.setVoice(true);
  const sounds = syllableSounds(DIANNAO);
  const { cells } = headword(DIANNAO, "zhuyin");
  assert.deepEqual(sounds, [{ syllable: "dian4", char: "電" }, { syllable: "nao3", char: "腦" }]);
  cells.forEach((cell, i) => {
    tap(sounds[i]);
    assert.deepEqual(played, [`audio/s/${sounds[i].syllable}.mp3`], cell.char);
    assert.equal(played[0].slice(-5, -4), columnTone(cell), cell.char);
  });
});

test("acceptance-speak-symbol: one Zhuyin symbol plays its own name syllable", () => {
  voice.setVoice(true);
  const { cells } = headword(DIANNAO, "zhuyin");
  assert.deepEqual(cells.map((c) => c.symbols.join("")), ["ㄉㄧㄢ", "ㄋㄠ"]);
  // Names from the spec (#default-symbol-sound, #symbols-initials, #symbols-finals), first tone:
  // the spec's example ㄅ bo, then each symbol beside 電腦.
  const SPEC_NAMES = { ㄅ: "bo1", ㄉ: "de1", ㄧ: "yi1", ㄢ: "an1", ㄋ: "ne1", ㄠ: "ao1" };
  for (const sym of ["ㄅ", ...cells.flatMap((c) => c.symbols)]) {
    tap({ symbol: sym });
    assert.deepEqual(played, [`audio/s/${SPEC_NAMES[sym]}.mp3`], sym);
  }
});

test("acceptance-speak-line: a measure word's Zhuyin plays its syllable in its tone", () => {
  voice.setVoice(true);
  const [mw] = DIANNAO.mw;
  const sounds = syllableSounds(mw);
  assert.deepEqual(sounds, [{ syllable: "tai2", char: "臺" }]);
  tap(sounds[0]);
  assert.deepEqual(played, ["audio/s/tai2.mp3"]);
  assert.equal(columnTone(headword(mw, "zhuyin").cells[0]), "2");
});

test("acceptance-speak-pinyin: pinyin mode plays the same syllables and the same word recording as Zhuyin mode", () => {
  voice.setVoice(true);
  const ruby = headword(DIANNAO, "pinyin");
  const columns = headword(DIANNAO, "zhuyin");
  assert.equal(ruby.kind, "ruby");
  assert.equal(ruby.cells.length, columns.cells.length, "one pinyin per headword character, as Zhuyin columns");
  // app.js gives ruby i and Zhuyin column i the one syllableSounds(word)[i], and the speaker
  // button the one word sound: the script never enters a sound.
  const wiring = extract(APP, "speakingHeadword");
  assert.match(wiring, /speaks\(r, ss\[i\]\)/);
  assert.match(wiring, /speaks\(n, ss\[i\]\)/);
  assert.doesNotMatch(extract(APP, "syllableSounds"), /script/);
  syllableSounds(DIANNAO).forEach((sound, i) => {
    tap(sound);
    assert.deepEqual(played, [`audio/s/${sound.syllable}.mp3`], ruby.cells[i].char);
  });
  tap(speaker(DIANNAO));
  assert.deepEqual(played, [DIANNAO.audio]);
});

test("acceptance-hear-built-sound: 蝴蝶蘭 is said one recorded syllable at a time, in its Zhuyin tones, paused apart", () => {
  voice.setVoice(true);
  const w = GRAPH.words.find((x) => x.trad === "蝴蝶蘭");
  assert.ok(w && !w.audio && w.collections.includes("flora"), "a Flowers and trees word with no recording");
  const tones = headword(w, "zhuyin").cells.map(columnTone);
  tap(speaker(w));
  const want = w.pinyin.split(" ").map((y) => `audio/s/${y}.mp3`);
  assert.deepEqual(played, want.slice(0, 1));
  for (let i = 1; i < want.length; i++) {
    player.onended();
    mock.timers.tick(voice.BUILT_PAUSE_MS - 1);
    assert.equal(played.length, i, "a short pause before the next syllable");
    mock.timers.tick(1);
    assert.deepEqual(played, want.slice(0, i + 1));
  }
  assert.equal(player.onended, null);
  assert.deepEqual(played.map((s) => s.slice(-5, -4)), tones);
  // Slower than a recorded word: (n - 1) pauses on top of n syllables, against one file.
  assert.ok(voice.BUILT_PAUSE_MS > 0);
  assert.deepEqual(spoken, [], "the recorded voice, not the device voice");
});

test("acceptance-voice-off-silent: with Voice off a word and a headword character play nothing", () => {
  voice.setVoice(false);
  assert.equal(store.get(voice.VOICE_KEY), "off");
  const sounds = [speaker(DIANNAO), syllableSounds(DIANNAO)[0], { symbol: "ㄉ" }, speaker(GRAPH.words.find((x) => x.trad === "蝴蝶蘭"))];
  for (const s of sounds) {
    tap(s);
    assert.deepEqual(played, [], JSON.stringify(s));
    assert.deepEqual(spoken, [], JSON.stringify(s));
    assert.equal(voice.canSay(s), false, "no speaker button");
  }
  voice.setVoice(true);
});
