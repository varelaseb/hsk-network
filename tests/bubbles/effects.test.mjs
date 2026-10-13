// Game effects (docs/specs/hsk-bubbles.spec.html #acceptance-muted-silent): on a first visit a
// pop plays no effect sound and fires no vibration. Runs the real settings, sfx, and vibrate code
// from site/bubbles/game.js, extracted, against stubbed storage, AudioContext, and vibration.
// Run: node --test tests/bubbles/effects.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const GAME = readFileSync(new URL("../../site/bubbles/game.js", import.meta.url), "utf8");

function extract(src, name) {
  const start = src.search(new RegExp("^function " + name + "\\(", "m"));
  let depth = 0;
  let i = src.indexOf("{", start);
  do { depth += { "{": 1, "}": -1 }[src[i]] || 0; i++; } while (depth);
  return src.slice(start, i);
}

// A page with the given stored settings: returns the game's effects and what reached the device.
function page(stored) {
  const log = { contexts: 0, tones: 0, vibrations: [] };
  class AudioContext {
    constructor() { log.contexts++; this.currentTime = 0; this.state = "running"; this.destination = {}; }
    createOscillator() {
      log.tones++;
      return { frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (g) => g, start() {}, stop() {} };
    }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (d) => d }; }
  }
  const localStorage = { getItem: (k) => (k === "hskBubbles" && stored ? JSON.stringify(stored) : null) };
  const navigator = { vibrate: (p) => { log.vibrations.push(p); return true; } };
  const src = [
    /^const STORE = .*$/m.exec(GAME)[0],
    /^const settings = .*$/m.exec(GAME)[0],
    extract(GAME, "readStore"),
    "let audio = null;",
    extract(GAME, "sfx"),
    extract(GAME, "vibrate"),
    "return { settings, sfx, vibrate };",
  ].join("\n");
  const game = new Function("window", "localStorage", "navigator", src)({ AudioContext }, localStorage, navigator);
  return { ...game, log };
}

// What a pop sets off in game.js: the pop sound, a fall, and its vibration.
function pop(g) {
  g.sfx("pop", 1);
  g.sfx("fall");
  g.vibrate([18, 40, 28]);
}

test("acceptance-muted-silent: first visit, a pop plays no effect sound and fires no vibration", () => {
  const g = page(null);
  assert.equal(g.settings.sound, false, "effects off at first");
  pop(g);
  assert.deepEqual(g.log, { contexts: 0, tones: 0, vibrations: [] });
});

test("acceptance-muted-silent: the same pop with effects on sounds and vibrates (the stubs see it)", () => {
  const g = page({ sound: true });
  pop(g);
  assert.equal(g.log.contexts, 1);
  assert.ok(g.log.tones > 0);
  assert.deepEqual(g.log.vibrations, [[18, 40, 28]]);
});

test("acceptance-muted-silent: every effect sound and vibration in the game goes through sfx and vibrate", () => {
  const rest = GAME.replace(extract(GAME, "sfx"), "").replace(extract(GAME, "vibrate"), "");
  assert.doesNotMatch(rest, /AudioContext|navigator\.vibrate|createOscillator/);
});
