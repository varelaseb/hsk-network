// Touch inspect (docs/specs/hsk-bubbles.spec.html #input-inspect, #acceptance-inspect-touch-slide):
// a held thumb's small drift still holds, the hold ring fills over HOLD_MS, and when the hold timer
// runs out the card shows and that pointer's aim and swap are dropped, so its slide and lift do
// nothing. Runs the real helpers from site/bubbles/game.js, extracted, against stubs.
// Run: node --test tests/bubbles/hold.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extract } from "../extract.mjs";

const GAME = readFileSync(new URL("../../site/bubbles/game.js", import.meta.url), "utf8");

function load(inspectOk = true) {
  const log = { inspected: [] };
  const src = [
    /^const HOLD_MS = .*$/m.exec(GAME)[0],
    /^const HOLD_SLOP_PX = .*$/m.exec(GAME)[0],
    "let press = null;",
    "const aimer = { on: false, id: null, cancelled: false, swapTap: null };",
    extract(GAME, "stillHolding"),
    extract(GAME, "holdProgress"),
    extract(GAME, "holdInspect"),
    extract(GAME, "endPress"),
    "return { HOLD_MS, HOLD_SLOP_PX, stillHolding, holdProgress, holdInspect, endPress, aimer, get press() { return press; }, set press(v) { press = v; } };",
  ].join("\n");
  const inspect = (p) => { log.inspected.push(p); return inspectOk; };
  const g = new Function("inspect", "clearTimeout", src)(inspect, () => {});
  return { g, log };
}

test("a resting thumb's drift still holds; a thumb-sized slop, not a fraction of a bubble", () => {
  const { g } = load();
  const press = { x: 2, y: 3 };
  const s = 46; // bubble px on a 375 px wide phone
  assert.ok(g.HOLD_SLOP_PX >= 12, "slop sized to a thumb");
  assert.equal(g.stillHolding(press, { x: 2 + 10 / s, y: 3 }, s), true);
  assert.equal(g.stillHolding(press, { x: 2, y: 3 + g.HOLD_SLOP_PX / s }, s), true);
  assert.equal(g.stillHolding(press, { x: 2 + 40 / s, y: 3 }, s), false, "moving further aims instead");
});

test("the hold ring fills from empty to full over HOLD_MS", () => {
  const { g } = load();
  const press = { at: 1000 };
  assert.equal(g.holdProgress(press, 1000), 0);
  assert.equal(g.holdProgress(press, 1000 + g.HOLD_MS / 2), 0.5);
  assert.equal(g.holdProgress(press, 1000 + g.HOLD_MS * 3), 1);
  assert.equal(g.HOLD_MS, 500, "half a second");
});

test("hold timer: card shows while the thumb is down, then that pointer's aim and swap are dropped", () => {
  const { g, log } = load();
  g.press = { id: 7, x: 2, y: 3, held: false, timer: 1 };
  Object.assign(g.aimer, { on: true, id: 7, cancelled: true, swapTap: null });
  g.holdInspect();
  assert.equal(log.inspected.length, 1);
  assert.equal(g.press.held, true, "later move and lift of pointer 7 do nothing");
  assert.equal(g.aimer.id, null);
  assert.equal(g.aimer.on, false);
  assert.equal(g.aimer.cancelled, false);
  g.holdInspect();
  assert.equal(log.inspected.length, 1, "inspects once per hold");
});

test("hold on the launcher drops the swap tap of that pointer only", () => {
  const { g } = load();
  g.press = { id: 3, x: 4, y: 11, held: false, timer: 1 };
  Object.assign(g.aimer, { on: true, id: 9, swapTap: { id: 3, x: 4, y: 11 } });
  g.holdInspect();
  assert.equal(g.aimer.swapTap, null);
  assert.equal(g.aimer.id, 9, "another pointer keeps aiming");
});

test("a hold that cannot inspect leaves aim alone and ends the press", () => {
  const { g } = load(false);
  g.press = { id: 7, x: 2, y: 3, held: false, timer: 1 };
  Object.assign(g.aimer, { on: true, id: 7, swapTap: null });
  g.holdInspect();
  assert.equal(g.press, null);
  assert.equal(g.aimer.id, 7);
  assert.equal(g.aimer.on, true);
});
