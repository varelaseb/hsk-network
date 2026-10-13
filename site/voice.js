// Shared voice module, used by the network page and the bubbles game
// (docs/specs/hsk-network.spec.html #boundary-voice, #speak-table,
// #built-heading, #symbols-table; hsk-bubbles.spec.html #feel-say). Owns the Voice setting and
// its storage, the Zhuyin symbol name table, choosing a sound's source, and
// playing one sound at a time. Knows nothing of cards, bubbles, or the pipeline.
//
// A sound is one of:
//   { word, audio?, pinyin? }
//                        a word: its Traditional form, graph.json `audio` path
//                        (site-relative) if it has a recording, and its
//                        graph.json `pinyin`, which lets a word without one be
//                        built from its syllables (#built-heading)
//   { syllable, char }   a reading, a headword character, or one syllable of a
//                        measure word or reference: numbered pinyin as in
//                        graph.json (xue2, lu:4, men5) and its character
//   { symbol }           one Zhuyin symbol, said by its name syllable
//
// Pure exports (no DOM, timer, or storage; Node-tested):
//   SYMBOL_NAMES                      symbol -> name syllable (37 entries)
//   syllableKey(pinyin) -> key        lowercase numbered pinyin, ü as v, a
//                                     missing tone as 5, erhua r as er1
//   localVoice(voices) -> voice|null  a Taiwan Mandarin voice that runs on the
//                                     device (localService); never a network one
//   builtWord(sound, syllables, chars) -> [src] | null
//                                     the built word rule: one syllable
//                                     recording per syllable in order, or null
//                                     when a syllable has none (#built-gap)
//   choose(sound, on, syllables, voices, chars)
//       -> { src } | { srcs } | { voice, text } | null
//       on = Voice setting, syllables = Set of graph.json `syllables`,
//       voices = speechSynthesis.getVoices(), chars = graph.json `chars`.
//       src is site-relative; srcs (a built word) play in order with
//       BUILT_PAUSE_MS between; null says nothing (and a speaker button for it
//       is not shown).
//   readVoice(store) -> boolean       the stored Voice setting; store is
//                                     localStorage-like ({ getItem }) or null
//                                     (storage off: on)
//
// Page exports (browser only; nothing runs at import):
//   useGraph(graph)        the graph data the page loaded (syllables, words)
//   voiceOn() -> boolean   the Voice setting
//   setVoice(on)           stores it, stops a sound when off, notifies
//   onChange(fn)           fn() after the setting changes (here or in another
//                          tab) or the device voice list loads; re-check canSay
//   canSay(sound) -> boolean   show its speaker button, or let a tap play
//   say(sound)             stops the sound playing, then says this one
//   stop()                 stops the sound playing (closing a card, pausing)
//   unlock()               call from a tap before sounds that play later
//                          without one (the game's popped words)

export const VOICE_KEY = "hskVoice";
const GAME_KEY = "hskBubbles"; // the game's own store, which held the choice first

// ---- Symbol names (#symbols-table): said in the first tone.

const NAMES = {
  ㄅ: "bo", ㄆ: "po", ㄇ: "mo", ㄈ: "fo", ㄉ: "de", ㄊ: "te", ㄋ: "ne", ㄌ: "le",
  ㄍ: "ge", ㄎ: "ke", ㄏ: "he", ㄐ: "ji", ㄑ: "qi", ㄒ: "xi", ㄓ: "zhi", ㄔ: "chi",
  ㄕ: "shi", ㄖ: "ri", ㄗ: "zi", ㄘ: "ci", ㄙ: "si",
  ㄧ: "yi", ㄨ: "wu", ㄩ: "yu",
  ㄚ: "a", ㄛ: "o", ㄜ: "e", ㄝ: "ê", ㄞ: "ai", ㄟ: "ei", ㄠ: "ao", ㄡ: "ou",
  ㄢ: "an", ㄣ: "en", ㄤ: "ang", ㄥ: "eng", ㄦ: "er",
};
export const SYMBOL_NAMES = Object.freeze(Object.fromEntries(Object.entries(NAMES).map(([s, n]) => [s, n + "1"])));

// ---- Syllable names (#syllable-key, #syllable-erhua).

export function syllableKey(pinyin) {
  const s = String(pinyin).toLowerCase().replace(/u:|ü/g, "v");
  const key = /[1-5]$/.test(s) ? s : s + "5";
  return /^r[1-5]$/.test(key) ? SYMBOL_NAMES.ㄦ : key;
}

// ---- Source choice (#speak-table, #speak-device, #speak-off).

const TAIWAN = /^zh[-_](hant[-_])?tw$/i;

export function localVoice(voices) {
  return (voices || []).find((v) => v.localService === true && TAIWAN.test(v.lang || "")) || null;
}

// ---- Built word rule (#built-heading): a word without its own recording
// plays its syllables' recordings in order, each in its dictionary tone with
// no sandhi; a neutral syllable with no neutral recording takes the tone of
// its character's first reading (#built-neutral).

export const BUILT_PAUSE_MS = 250;

function syllableSrc(key, syllables) {
  return syllables.has(key) ? `audio/s/${key}.mp3` : null;
}

function neutralSrc(key, char, syllables, chars) {
  const first = chars && char && chars[char]?.readings?.[0];
  if (!first) return null;
  const tone = syllableKey(first.pinyin).slice(-1);
  return tone === "5" ? null : syllableSrc(key.slice(0, -1) + tone, syllables);
}

export function builtWord(sound, syllables, chars) {
  if (!sound.pinyin) return null;
  const ys = String(sound.pinyin).split(" ").filter(Boolean);
  const cs = Array.from(sound.word || "");
  const srcs = [];
  for (let i = 0; i < ys.length; i++) {
    const key = syllableKey(ys[i]);
    const src = syllableSrc(key, syllables)
      || (key.endsWith("5") && cs.length === ys.length ? neutralSrc(key, cs[i], syllables, chars) : null);
    if (!src) return null;
    srcs.push(src);
  }
  return srcs.length ? srcs : null;
}

function recordingOf(sound, syllables) {
  if ("word" in sound) return sound.audio || null;
  const key = "symbol" in sound ? SYMBOL_NAMES[sound.symbol] : syllableKey(sound.syllable);
  return key && syllables.has(key) ? `audio/s/${key}.mp3` : null;
}

function textOf(sound) {
  if ("word" in sound) return sound.word;
  if ("symbol" in sound) return sound.symbol;
  return sound.char;
}

export function choose(sound, on, syllables, voices, chars) {
  if (!on) return null;
  const set = syllables || new Set();
  const src = recordingOf(sound, set);
  if (src) return { src };
  const srcs = "word" in sound ? builtWord(sound, set, chars) : null;
  if (srcs) return { srcs };
  const voice = localVoice(voices);
  const text = textOf(sound);
  return voice && text ? { voice, text } : null;
}

// ---- Voice setting (#default-voice-setting): on at first; a learner's
// earlier choice in the game is kept.

export function readVoice(store) {
  try {
    const v = store.getItem(VOICE_KEY);
    if (v === "on" || v === "off") return v === "on";
    const game = JSON.parse(store.getItem(GAME_KEY));
    if (game && typeof game.say === "boolean") return game.say;
  } catch { /* storage off or unreadable: default */ }
  return true;
}

// ---- Page side.

const g = globalThis;
let on = null;
let syllables = new Set();
let chars = {};
let unlockSrc = null;
let player = null;
let sequence = 0;   // bumped by stop(), ending a built word mid-way
let pause = null;   // the timer between a built word's syllables
const listeners = new Set();

// The page's store, or null with storage off (the localStorage getter itself
// throws then). Every Voice read and write goes through it, so the setting
// falls back to on and a change lasts this visit (hsk-bubbles #feel-store).
function store() {
  try { return g.localStorage || null; } catch { return null; }
}

const speech = () => g.speechSynthesis || null;
const voices = () => (speech() ? speech().getVoices() : []);
const url = (src) => new URL(src, import.meta.url).href;
const notify = () => listeners.forEach((fn) => fn());

let watching = false;
function watch() {
  if (watching || !g.addEventListener) return;
  watching = true;
  // A change on the other page in another tab follows here.
  g.addEventListener("storage", (e) => {
    if (e.key !== VOICE_KEY) return;
    on = readVoice(store());
    if (!on) stop();
    notify();
  });
  speech()?.addEventListener?.("voiceschanged", notify);
}

export function useGraph(graph) {
  syllables = new Set(graph.syllables || []);
  chars = graph.chars || {};
  unlockSrc = (graph.words || []).find((w) => w.audio)?.audio || null;
  watch();
  notify();
}

export function voiceOn() {
  if (on === null) {
    on = readVoice(store());
    watch();
  }
  return on;
}

export function setVoice(value) {
  on = Boolean(value);
  try { store()?.setItem(VOICE_KEY, on ? "on" : "off"); } catch { /* storage off: lasts this visit */ }
  if (!on) stop();
  notify();
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function canSay(sound) {
  return choose(sound, voiceOn(), syllables, voices(), chars) !== null;
}

export function say(sound) {
  stop();
  const how = choose(sound, voiceOn(), syllables, voices(), chars);
  if (!how) return;
  if (how.src || how.srcs) {
    playList(how.srcs || [how.src]);
    return;
  }
  const u = new SpeechSynthesisUtterance(how.text);
  u.voice = how.voice;
  u.lang = how.voice.lang;
  speech().speak(u);
}

// Plays recordings in order on the one player, BUILT_PAUSE_MS apart; stop()
// or a new sound ends the list.
function playList(srcs) {
  const run = sequence;
  player = player || new Audio();
  const next = (i) => {
    if (run !== sequence || i >= srcs.length) return;
    player.src = url(srcs[i]);
    player.muted = false;
    player.onended = i + 1 < srcs.length
      ? () => { if (run === sequence) pause = setTimeout(() => next(i + 1), BUILT_PAUSE_MS); }
      : null;
    player.play().catch(() => { /* blocked or missing: stay silent */ });
  };
  next(0);
}

export function stop() {
  sequence++;
  clearTimeout(pause);
  if (player) { player.onended = null; player.pause(); }
  speech()?.cancel();
}

// Phone browsers play later sound only from a player a tap has started, so a
// tap starts the recording player muted and wakes the device voice.
let unlocked = false;
export function unlock() {
  if (unlocked || !voiceOn()) return;
  unlocked = true;
  player = player || new Audio();
  if (unlockSrc) {
    player.src = url(unlockSrc);
    player.muted = true;
    player.play().then(() => { if (player.muted) player.pause(); }, () => {}).finally(() => { player.muted = false; });
  }
  speech()?.speak(new SpeechSynthesisUtterance(""));
}
