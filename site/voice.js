// Shared voice module, used by the network page and the bubbles game
// (docs/specs/hsk-network.spec.html #boundary-voice, #speak-table,
// #symbols-table; hsk-bubbles.spec.html #feel-say). Owns the Voice setting and
// its storage, the Zhuyin symbol name table, choosing a sound's source, and
// playing one sound at a time. Knows nothing of cards, bubbles, or the pipeline.
//
// A sound is one of:
//   { word, audio? }     a word: its Traditional form and graph.json `audio`
//                        path (site-relative), if it has a recording
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
//   choose(sound, on, syllables, voices) -> { src } | { voice, text } | null
//       on = Voice setting, syllables = Set of graph.json `syllables`,
//       voices = speechSynthesis.getVoices(). src is site-relative; null says
//       nothing (and a speaker button for it is not shown).
//   readVoice(store) -> boolean       the stored Voice setting; store is
//                                     localStorage-like ({ getItem })
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

export function choose(sound, on, syllables, voices) {
  if (!on) return null;
  const src = recordingOf(sound, syllables || new Set());
  if (src) return { src };
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
let unlockSrc = null;
let player = null;
const listeners = new Set();

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
    on = readVoice(g.localStorage);
    if (!on) stop();
    notify();
  });
  speech()?.addEventListener?.("voiceschanged", notify);
}

export function useGraph(graph) {
  syllables = new Set(graph.syllables || []);
  unlockSrc = (graph.words || []).find((w) => w.audio)?.audio || null;
  watch();
  notify();
}

export function voiceOn() {
  if (on === null) {
    on = g.localStorage ? readVoice(g.localStorage) : true;
    watch();
  }
  return on;
}

export function setVoice(value) {
  on = Boolean(value);
  try { g.localStorage.setItem(VOICE_KEY, on ? "on" : "off"); } catch { /* storage off: lasts this visit */ }
  if (!on) stop();
  notify();
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function canSay(sound) {
  return choose(sound, voiceOn(), syllables, voices()) !== null;
}

export function say(sound) {
  stop();
  const how = choose(sound, voiceOn(), syllables, voices());
  if (!how) return;
  if (how.src) {
    player = player || new Audio();
    player.src = url(how.src);
    player.muted = false;
    player.play().catch(() => { /* blocked or missing: stay silent */ });
    return;
  }
  const u = new SpeechSynthesisUtterance(how.text);
  u.voice = how.voice;
  u.lang = how.voice.lang;
  speech().speak(u);
}

export function stop() {
  if (player) player.pause();
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
