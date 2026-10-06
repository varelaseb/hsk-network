// Sense rendering, shared by the network page and the bubbles game
// (docs/specs/hsk-network.spec.html #sense-render, #senses-mode, #zhuyin-layout-heading).
// Pure browser ES module: no DOM, timer, or storage. It returns plain data;
// pages set every text with textContent, so nothing here is HTML.
//
// mode is "zhuyin" (default: Traditional + Zhuyin) or "pinyin" (Simplified +
// pinyin with tone marks). Any other value reads as "zhuyin".
//
// A piece is one run of shown text, styled by kind:
//   { kind: "text", text }              English sense text (or a separator)
//   { kind: "han", text, lang }         Chinese characters, lang zh-Hant | zh-Hans
//   { kind: "zhuyin", text, syllables } one-line Zhuyin: page spaces syllables
//                                       0.3em apart (#zhuyin-line); text joins
//                                       them with one space
//   { kind: "pinyin", text }            tone-marked pinyin, one word's
//                                       syllables joined without spaces
//
// Exports:
//   MODES, DEFAULT_MODE                 ["zhuyin", "pinyin"], "zhuyin"
//   renderSense(sense, mode) -> { tag, pieces }
//       sense: graph.json sense { tag?, parts }; tag is the spelled-out tag or
//       null (page shows it smaller and muted before the sense).
//   renderRef(ref, mode) -> [piece]
//       a reference: word ref { trad, simp, pinyin, zhuyin } shows characters,
//       a space, and the reading; reading ref { pinyin, zhuyin } the reading.
//   renderMeasureWords(mw, mode) -> [piece]
//       refs joined by " · " text pieces; [] when mw is missing or empty.
//   renderReading({ pinyin, zhuyin }, mode) -> piece   the reading aid alone.
//   headword({ trad, simp, pinyin, zhuyin }, mode) -> layout
//       zhuyin, counts match: { kind: "columns", lang, cells: [{ char,
//           symbols [..], tone "" | "ˊ" | "ˇ" | "ˋ", neutral bool }] }
//           (#zhuyin-columns: tone right of the last symbol, dot above first)
//       pinyin, counts match: { kind: "ruby", lang, cells: [{ char, pinyin }] }
//           (#pinyin-ruby: marked syllable centered above its character)
//       counts differ: { kind: "line", han: piece, reading: piece }
//           (#zhuyin-fallback: the reading on one line under the characters)
//   wordLabel(word, mode) -> string     word.trad or word.simp
//   charLabel(ch, mode, chars) -> string
//       ch, or in pinyin mode its Simplified form from chars (graph.json
//       `chars`), ch itself when it has none.
//   toneMarks(pinyin) -> string
//       "lu:3 nu:3" -> "lǚ nǚ" per syllable (#test-pinyin): mark on a or e,
//       else the o of ou, else the last vowel; tone 5 unmarked; "r5" -> "r";
//       ü is written u: or v; ǐ ǒ ǔ and ü with a tone take a combining
//       mark, as Geist has no precomposed glyph (#pinyin-glyphs).
//   pinyinWord(pinyin) -> string        toneMarks with the spaces removed.
//   textOf(pieces) -> string            the pieces' text, concatenated.

export const MODES = Object.freeze(["zhuyin", "pinyin"]);
export const DEFAULT_MODE = "zhuyin";

const isPinyin = (mode) => mode === "pinyin";
const langOf = (mode) => (isPinyin(mode) ? "zh-Hans" : "zh-Hant");

// ---- Pinyin tone marks.

const COMBINING = ["", "\u0304", "\u0301", "\u030C", "\u0300", ""];
const VOWELS = "aeiouü";
// Precomposed tone letters Geist draws (site/fonts/coverage.json); any other
// tone letter (ǐ ǒ ǔ, ü with a tone) stays base letter + combining mark.
const GEIST_PRECOMPOSED = "āáǎàēéěèīíìōóòūúùĀÁǍÀĒÉĚÈĪÍÌŌÓÒŪÚÙ";

function markSyllable(syl) {
  const m = /^(.*?)([1-5])?$/.exec(syl);
  const tone = m[2] ? Number(m[2]) : 5;
  const base = m[1].replace(/u:|v/g, "ü").replace(/U:|V/g, "Ü");
  if (!COMBINING[tone]) return base;
  const low = base.toLowerCase();
  let at = low.search(/[ae]/);
  if (at < 0) at = low.indexOf("ou");
  if (at < 0) {
    for (let i = low.length - 1; i >= 0; i--) if (VOWELS.includes(low[i])) { at = i; break; }
  }
  if (at < 0) return base;
  const marked = base[at] + COMBINING[tone];
  const nfc = marked.normalize("NFC");
  const glyph = GEIST_PRECOMPOSED.includes(nfc) ? nfc : marked;
  return base.slice(0, at) + glyph + base.slice(at + 1);
}

export function toneMarks(pinyin) {
  return String(pinyin).split(" ").filter(Boolean).map(markSyllable).join(" ");
}

export function pinyinWord(pinyin) {
  return toneMarks(pinyin).replace(/ /g, "");
}

// ---- Readings and references.

const zhuyinSyllables = (zhuyin) => String(zhuyin).split(" ").filter(Boolean);

export function renderReading(r, mode) {
  if (isPinyin(mode)) return { kind: "pinyin", text: pinyinWord(r.pinyin) };
  const syllables = zhuyinSyllables(r.zhuyin);
  return { kind: "zhuyin", text: syllables.join(" "), syllables };
}

export function renderRef(ref, mode) {
  const reading = renderReading(ref, mode);
  if (!("trad" in ref)) return [reading];
  const text = isPinyin(mode) ? ref.simp || ref.trad : ref.trad;
  return [{ kind: "han", text, lang: langOf(mode) }, { kind: "text", text: " " }, reading];
}

export function renderSense(sense, mode) {
  const pieces = [];
  for (const part of sense.parts) {
    if (typeof part === "string") pieces.push({ kind: "text", text: part });
    else pieces.push(...renderRef(part, mode));
  }
  return { tag: sense.tag || null, pieces };
}

export function renderMeasureWords(mw, mode) {
  const pieces = [];
  (mw || []).forEach((ref, i) => {
    if (i) pieces.push({ kind: "text", text: " · " });
    pieces.push(...renderRef(ref, mode));
  });
  return pieces;
}

export function textOf(pieces) {
  return pieces.map((p) => p.text).join("");
}

// ---- Labels.

export function wordLabel(word, mode) {
  return isPinyin(mode) ? word.simp || word.trad : word.trad;
}

export function charLabel(ch, mode, chars) {
  if (!isPinyin(mode)) return ch;
  const entry = chars && chars[ch];
  return (entry && entry.simp) || ch;
}

// ---- Headword layout.

const ZHUYIN_TONES = "ˊˇˋ";
const NEUTRAL = "˙";

function zhuyinCell(char, syl) {
  let s = [...syl];
  const neutral = s[0] === NEUTRAL;
  if (neutral) s = s.slice(1);
  const tone = ZHUYIN_TONES.includes(s[s.length - 1]) ? s.pop() : "";
  return { char, symbols: s, tone, neutral };
}

export function headword(word, mode) {
  const pinyin = isPinyin(mode);
  const lang = langOf(mode);
  const chars = [...(pinyin ? word.simp || word.trad : word.trad)];
  const syllables = pinyin
    ? String(word.pinyin).split(" ").filter(Boolean)
    : zhuyinSyllables(word.zhuyin);
  if (syllables.length !== chars.length) {
    return { kind: "line", han: { kind: "han", text: chars.join(""), lang }, reading: renderReading(word, mode) };
  }
  if (pinyin) {
    return { kind: "ruby", lang, cells: chars.map((char, i) => ({ char, pinyin: markSyllable(syllables[i]) })) };
  }
  return { kind: "columns", lang, cells: chars.map((char, i) => zhuyinCell(char, syllables[i])) };
}
