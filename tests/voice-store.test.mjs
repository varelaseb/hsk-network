// site/voice.js page side with storage off: the localStorage getter throws
// (docs/specs/hsk-network.spec.html #default-voice-setting; hsk-bubbles.spec.html
// #feel-store). Voice is on, and a change lasts this visit. Own file: the
// module's setting is per page load. Run: node --test tests/voice-store.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  get() { throw new DOMException("The operation is insecure.", "SecurityError"); },
});
const voice = await import("../site/voice.js");

test("storage off: Voice reads on, setVoice lasts this visit, nothing throws", () => {
  assert.equal(voice.voiceOn(), true);
  assert.equal(voice.canSay({ symbol: "ㄅ" }), false); // no graph, no device voice
  voice.setVoice(false);
  assert.equal(voice.voiceOn(), false);
  voice.setVoice(true);
  assert.equal(voice.voiceOn(), true);
});

test("readVoice with no store: on", () => {
  assert.equal(voice.readVoice(null), true);
});
