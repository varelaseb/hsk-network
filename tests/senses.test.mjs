// Tests for site/senses.js (docs/specs/hsk-network.spec.html #test-pinyin, #test-clean).
// Run: node --test tests/senses.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MODES, DEFAULT_MODE, toneMarks, pinyinWord, renderReading, renderRef, renderSense,
  renderMeasureWords, textOf, wordLabel, charLabel, headword,
} from "../site/senses.js";

const graph = JSON.parse(readFileSync(new URL("../site/data/graph.json", import.meta.url), "utf8"));
const NFD = (s) => s.normalize("NFD");

// ---- #test-pinyin

test("every tone on a, e, o, i, u", () => {
  assert.equal(toneMarks("ma1 ma2 ma3 ma4 ma5"), "mā má mǎ mà ma");
  assert.equal(toneMarks("de1 de2 de3 de4"), "dē dé dě dè");
  assert.equal(toneMarks("bo1 bo2 bo3 bo4"), "bō bó bǒ bò");
  assert.equal(toneMarks("bi1 bi2 bi3 bi4"), "bī bí bǐ bì");
  assert.equal(toneMarks("bu1 bu2 bu3 bu4"), "bū bú bǔ bù");
});

test("ü takes a combining mark, never a precomposed glyph", () => {
  const U = "ü";
  assert.equal(toneMarks("lu:1 lu:2 lu:3 lu:4 lu:5"), ["\u0304", "\u0301", "\u030C", "\u0300", ""].map((m) => "l" + U + m).join(" "));
  assert.equal(toneMarks("nv3"), "n" + U + "\u030C");
  assert.equal(toneMarks("lu:e4"), "l" + U + "e\u0300".normalize("NFC"));
  for (const glyph of "ǖǘǚǜ") assert.ok(!toneMarks("lu:1 lu:2 lu:3 lu:4").includes(glyph));
});

test("mark placement: a or e first, then the o of ou, else the last vowel", () => {
  assert.equal(toneMarks("hao3"), "hǎo");
  assert.equal(toneMarks("xie4"), "xiè");
  assert.equal(toneMarks("lou2"), "lóu");
  assert.equal(toneMarks("liu4"), "liù");
  assert.equal(toneMarks("gui4"), "guì");
  assert.equal(toneMarks("huo3"), "huǒ");
  assert.equal(toneMarks("Jing1"), "Jīng");
  assert.equal(toneMarks("Ai4"), "Ài");
});

test("neutral tone unmarked; erhua", () => {
  assert.equal(toneMarks("ba4 ba5"), "bà ba");
  assert.equal(toneMarks("men"), "men");
  assert.equal(toneMarks("er2"), "ér");
  assert.equal(toneMarks("yi1 dian3 r5"), "yī diǎn r");
  assert.equal(pinyinWord("yi1 dian3 r5"), "yīdiǎnr");
  assert.equal(pinyinWord("xue2 sheng5"), "xuésheng");
});

// ---- Rendering by mode (#sense-ref, #sense-pr, #senses-mode)

const DAIFU = { trad: "大夫", simp: "大夫", pinyin: "dai4 fu5", zhuyin: "ㄉㄞˋ ˙ㄈㄨ" };
const MW = [
  { trad: "塊", simp: "块", pinyin: "kuai4", zhuyin: "ㄎㄨㄞˋ" },
  { trad: "隻", simp: "只", pinyin: "zhi1", zhuyin: "ㄓ" },
  { trad: "個", simp: "个", pinyin: "ge4", zhuyin: "ㄍㄜˋ" },
];

test("default mode is zhuyin", () => {
  assert.deepEqual(MODES, ["zhuyin", "pinyin"]);
  assert.equal(DEFAULT_MODE, "zhuyin");
  assert.equal(textOf(renderRef(MW[0])), "塊 ㄎㄨㄞˋ");
});

test("a sense with a tag and a word reference", () => {
  const sense = { tag: "colloquial", parts: ["see ", DAIFU] };
  const zh = renderSense(sense, "zhuyin");
  assert.equal(zh.tag, "colloquial");
  assert.equal(textOf(zh.pieces), "see 大夫 ㄉㄞˋ ˙ㄈㄨ");
  assert.deepEqual(zh.pieces[1], { kind: "han", text: "大夫", lang: "zh-Hant" });
  assert.deepEqual(zh.pieces[3].syllables, ["ㄉㄞˋ", "˙ㄈㄨ"]);
  const py = renderSense(sense, "pinyin");
  assert.equal(textOf(py.pieces), "see 大夫 dàifu");
  assert.equal(py.pieces[1].lang, "zh-Hans");
  assert.equal(renderSense({ parts: ["cup"] }, "zhuyin").tag, null);
});

test("a reading reference shows only the reading", () => {
  const sense = { parts: ["Taiwan reading ", { pinyin: "ting4", zhuyin: "ㄊㄧㄥˋ" }] };
  assert.equal(textOf(renderSense(sense, "zhuyin").pieces), "Taiwan reading ㄊㄧㄥˋ");
  assert.equal(textOf(renderSense(sense, "pinyin").pieces), "Taiwan reading tìng");
});

test("measure words joined by dots", () => {
  assert.equal(textOf(renderMeasureWords(MW, "zhuyin")), "塊 ㄎㄨㄞˋ · 隻 ㄓ · 個 ㄍㄜˋ");
  assert.equal(textOf(renderMeasureWords(MW, "pinyin")), "块 kuài · 只 zhī · 个 gè");
  assert.deepEqual(renderMeasureWords(undefined, "pinyin"), []);
});

test("reading aid alone", () => {
  const r = { pinyin: "xue2 sheng5", zhuyin: "ㄒㄩㄝˊ ˙ㄕㄥ" };
  assert.deepEqual(renderReading(r, "zhuyin"), { kind: "zhuyin", text: "ㄒㄩㄝˊ ˙ㄕㄥ", syllables: ["ㄒㄩㄝˊ", "˙ㄕㄥ"] });
  assert.deepEqual(renderReading(r, "pinyin"), { kind: "pinyin", text: "xuésheng" });
});

// ---- Labels (#default-script)

test("labels: Traditional in zhuyin mode, Simplified in pinyin mode", () => {
  const w = { trad: "學生", simp: "学生" };
  assert.equal(wordLabel(w, "zhuyin"), "學生");
  assert.equal(wordLabel(w, "pinyin"), "学生");
  const chars = { 學: { simp: "学" }, 子: { simp: "子" } };
  assert.equal(charLabel("學", "zhuyin", chars), "學");
  assert.equal(charLabel("學", "pinyin", chars), "学");
  assert.equal(charLabel("𦥯", "pinyin", chars), "𦥯");
});

// ---- Headword layout (#zhuyin-columns, #pinyin-ruby, #zhuyin-fallback)

test("headword: zhuyin columns with tone right and neutral dot above", () => {
  const w = { trad: "學生", simp: "学生", pinyin: "xue2 sheng5", zhuyin: "ㄒㄩㄝˊ ˙ㄕㄥ" };
  assert.deepEqual(headword(w, "zhuyin"), {
    kind: "columns", lang: "zh-Hant", cells: [
      { char: "學", symbols: ["ㄒ", "ㄩ", "ㄝ"], tone: "ˊ", neutral: false },
      { char: "生", symbols: ["ㄕ", "ㄥ"], tone: "", neutral: true },
    ],
  });
  assert.deepEqual(headword(w, "pinyin"), {
    kind: "ruby", lang: "zh-Hans", cells: [{ char: "学", pinyin: "xué" }, { char: "生", pinyin: "sheng" }],
  });
});

test("headword: one line when syllables and characters differ", () => {
  const w = { trad: "點兒", simp: "点儿", pinyin: "dian3", zhuyin: "ㄉㄧㄢˇ" };
  const zh = headword(w, "zhuyin");
  assert.equal(zh.kind, "line");
  assert.deepEqual(zh.han, { kind: "han", text: "點兒", lang: "zh-Hant" });
  assert.equal(zh.reading.text, "ㄉㄧㄢˇ");
  const py = headword(w, "pinyin");
  assert.equal(py.kind, "line");
  assert.equal(py.han.text, "点儿");
  assert.equal(py.reading.text, "diǎn");
});

// ---- #test-clean / #acceptance-clean-data: every sense, measure word, and reading in the data.

function* items() {
  const readings = [];
  for (const w of graph.words) if (!("reading" in w)) readings.push(w);
  for (const c of Object.values(graph.chars)) readings.push(...(c.readings || []));
  for (const r of readings) {
    for (const sense of r.defs || []) yield { sense, refs: sense.parts.filter((p) => typeof p !== "string") };
    if (r.mw) yield { mw: r.mw, refs: r.mw };
    yield { reading: r, refs: [] };
  }
}

function render(item, mode) {
  if (item.sense) {
    const { tag, pieces } = renderSense(item.sense, mode);
    return (tag ? tag + " " : "") + textOf(pieces);
  }
  if (item.mw) return textOf(renderMeasureWords(item.mw, mode));
  const r = item.reading;
  return renderReading(r, mode).text;
}

// Characters the HSK lists write differently in Simplified (from the matched words).
const SIMP_ONLY = new Set();
const TRAD = new Set(graph.words.flatMap((w) => [...w.trad]));
for (const w of graph.words) {
  const t = [...w.trad], s = [...w.simp];
  s.forEach((ch, i) => { if (ch !== t[i] && !TRAD.has(ch)) SIMP_ONLY.add(ch); });
}
const ZHUYIN = /[\u3100-\u312F\u31A0-\u31BF\u02CA\u02C7\u02CB\u02D9]/u;
const MARKUP = /CL:|\||\[|\]|\bsb\b|\bsth\b/;
const NUMBERED = /\b[a-zü:]+[1-5]\b/i;
// Every tone-marked syllable the data can render, so English "café" is not one.
const MARKED = new Set();
const addMarked = (pinyin) => {
  for (const s of toneMarks(pinyin).split(" ").map(NFD)) if (/[\u0300-\u030C]/.test(s)) MARKED.add(s.toLowerCase());
};
for (const w of graph.words) addMarked(w.pinyin);
for (const item of items()) {
  if (item.reading) addMarked(item.reading.pinyin);
  item.refs.forEach((r) => addMarked(r.pinyin));
}
const hasMarked = (text) => (NFD(text).toLowerCase().match(/[\p{L}\p{M}]+/gu) || []).some((t) => MARKED.has(t));

test("clean rendering of every sense, measure word, and reading in both modes", () => {
  const bad = [];
  let n = 0;
  for (const item of items()) {
    n++;
    const py = render(item, "pinyin");
    const zh = render(item, "zhuyin");
    if (ZHUYIN.test(py) || MARKUP.test(py)) bad.push(["pinyin", py]);
    if (MARKUP.test(zh) || NUMBERED.test(zh) || hasMarked(zh) || [...zh].some((ch) => SIMP_ONLY.has(ch))) bad.push(["zhuyin", zh]);
    for (const ref of item.refs) {
      if (!ref.pinyin || ("trad" in ref && !ref.simp)) bad.push(["ref", JSON.stringify(ref)]);
    }
  }
  assert.ok(n > 1000, `rendered ${n} items`);
  assert.ok(MARKED.size > 300 && hasMarked("see xué sheng"), `marked syllables ${MARKED.size}`);
  assert.ok(SIMP_ONLY.size > 50, `simplified-only set has ${SIMP_ONLY.size}`);
  assert.deepEqual(bad, []);
});

test("every headword lays out in both modes", () => {
  for (const w of graph.words) {
    const r = "reading" in w ? graph.chars[w.trad].readings[w.reading] : w;
    const entry = { trad: w.trad, simp: w.simp, pinyin: w.pinyin, zhuyin: r.zhuyin };
    const zh = headword(entry, "zhuyin");
    const py = headword(entry, "pinyin");
    assert.equal(zh.kind, "columns", w.trad);
    assert.ok(zh.cells.every((c) => c.symbols.length > 0), w.trad);
    assert.equal(py.kind, "ruby", w.trad);
    assert.ok(!py.cells.some((c) => ZHUYIN.test(c.pinyin)), w.trad);
  }
});
