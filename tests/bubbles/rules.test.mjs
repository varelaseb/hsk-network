// Rule tests for site/bubbles/rules.js (docs/specs/hsk-bubbles.spec.html #tests-list).
// Run: node --test tests/bubbles/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COLS, LINE_ROW, LAUNCHER, ROW_H, MIN_ANGLE,
  makeLexicon, parseBoard, findWords, fallen, trace, aim, center,
  createGame, shoot, resolveShot, swap, completingChars, boardChars,
  roundRows, roundShots, lowestRow, pronunciation,
} from "../../site/bubbles/rules.js";

const W = (id, level, trad) => ({ id, level, trad, zhuyin: "", pinyin: "", simp: trad, defs: [trad + " def"] });
const WORDS = [
  W("a", 1, "學生"), W("b", 1, "學校"), W("c", 2, "喜歡"), W("d", 1, "中國"),
  W("e", 1, "火車站"), W("f", 2, "公共汽車"), W("g", 1, "你"), W("h", 1, "謝謝"), W("i", 2, "車站"),
];
const LEX = makeLexicon(WORDS, [1, 2]);
const keys = (cells) => [...new Set(cells.map(({ r, c }) => `${r},${c}`))].sort();
const popped = (board, cell, lex = LEX) => keys(findWords(board, cell, lex).flatMap((w) => w.cells));
const GRAPH = JSON.parse(readFileSync(new URL("../../site/data/graph.json", import.meta.url), "utf8"));

// test-detect
test("detect: straight chain through the shot bubble pops", () => {
  const b = parseBoard(["學生......"]);
  assert.deepEqual(findWords(b, { r: 0, c: 1 }, LEX).map((w) => w.word), ["學生"]);
  assert.deepEqual(popped(b, { r: 0, c: 1 }), ["0,0", "0,1"]);
});

test("detect: reversed chain (word read right to left) pops", () => {
  const b = parseBoard(["生學......"]);
  assert.deepEqual(popped(b, { r: 0, c: 0 }), ["0,0", "0,1"]);
});

test("detect: bent chain pops", () => {
  // row 1 is offset: (1,1) touches (0,1) and (0,2), not in line with (0,0)-(0,1).
  const b = parseBoard(["火車......", ".站....."]);
  assert.deepEqual(popped(b, { r: 1, c: 1 }), ["0,0", "0,1", "1,1"]);
});

test("detect: middle character dropped into a gap and four-character words", () => {
  assert.deepEqual(popped(parseBoard(["火車站....."]), { r: 0, c: 1 }), ["0,0", "0,1", "0,2"]);
  const b = parseBoard(["公共汽車...."]);
  assert.deepEqual(findWords(b, { r: 0, c: 3 }, LEX).map((w) => w.word), ["公共汽車"]);
});

test("detect: one shot completing two words pops both, longest first", () => {
  // 學 at (0,1) completes 學生 and 學校.
  assert.deepEqual(popped(parseBoard(["生學校....."]), { r: 0, c: 1 }), ["0,0", "0,1", "0,2"]);
  // 車 dropped between 火 and 站 completes 火車站 and 車站.
  const words = findWords(parseBoard(["火車站....."]), { r: 0, c: 1 }, LEX).map((w) => w.word);
  assert.deepEqual(words, ["火車站", "車站"]);
  // 火 completes 火車站; 學生 beside it does not run through the shot.
  assert.deepEqual(findWords(parseBoard(["學生火車站..."]), { r: 0, c: 2 }, LEX).map((w) => w.word), ["火車站"]);
});

test("detect: single-character word never pops, and no bubble is used twice", () => {
  assert.deepEqual(popped(parseBoard(["你......."]), { r: 0, c: 0 }), []);
  assert.deepEqual(popped(parseBoard(["謝......."]), { r: 0, c: 0 }), []);
  assert.deepEqual(popped(parseBoard(["謝謝......"]), { r: 0, c: 1 }), ["0,0", "0,1"]);
});

test("detect: a word not through the shot bubble does not pop", () => {
  const b = parseBoard(["學生中....."]);
  assert.deepEqual(popped(b, { r: 0, c: 2 }), []);
});

test("detect: words of levels switched off do not pop", () => {
  const b = parseBoard(["喜歡......"]);
  assert.deepEqual(popped(b, { r: 0, c: 1 }), ["0,0", "0,1"]);
  assert.deepEqual(popped(b, { r: 0, c: 1 }, makeLexicon(WORDS, [1])), []);
});

test("detect: word entries come from the data for the card", () => {
  const [w] = findWords(parseBoard(["學生......"]), { r: 0, c: 1 }, LEX);
  assert.equal(w.entries[0].id, "a");
});

// test-fall
test("fall: a hanging cluster falls, a cluster touching the ceiling through one bubble stays", () => {
  assert.deepEqual(keys(fallen(parseBoard(["中.......", ".......", "學校......"]))), ["2,0", "2,1"]);
  assert.deepEqual(fallen(parseBoard(["中.......", "國......", "學校......"])), []);
});

test("fall: popping a word drops what hung only from it; a miss drops nothing", () => {
  // 學 at (1,0) holds 校 at (2,0); shot 生 at (1,1) pops 學生; 中國 stays on the ceiling.
  const board = parseBoard(["中國......", "學......", "校......."]);
  let game = createGame({ words: WORDS, seed: 1, board, current: "生", next: "中" });
  const { events } = resolveShot(game, { r: 1, c: 1 });
  assert.deepEqual(keys(events.popped), ["1,0", "1,1"]);
  assert.deepEqual(keys(events.fallen), ["2,0"]);
  game = createGame({ words: WORDS, seed: 1, board, current: "你", next: "中" });
  assert.deepEqual(resolveShot(game, { r: 1, c: 1 }).events.fallen, []);
});

// test-flight
test("flight: straight up hits the ceiling and settles in row 0", () => {
  const empty = parseBoard([]);
  const t = aim({ board: empty }, 90);
  assert.equal(t.path.length, 2);
  assert.equal(t.hit, null);
  assert.equal(t.cell.r, 0);
  assert.ok(Math.abs(center(empty, t.cell).x - LAUNCHER.x) <= 0.5);
});

test("flight: wall bounces reflect, one or many times", () => {
  const empty = parseBoard([]);
  const once = trace(empty, 60);
  assert.equal(once.path.length, 3);
  assert.ok(Math.abs(once.path[1].x - (COLS - 0.5)) < 1e-9);
  assert.ok(once.path[2].x < once.path[1].x);
  const many = trace(empty, 12);
  assert.ok(many.path.length > 4);
  for (const p of many.path.slice(1, -1)) assert.ok(Math.abs(p.x - 0.5) < 1e-9 || Math.abs(p.x - (COLS - 0.5)) < 1e-9);
  const left = trace(empty, 120);
  assert.ok(Math.abs(left.path[1].x - 0.5) < 1e-9);
});

test("flight: aim is limited to 10..170 degrees", () => {
  const empty = parseBoard([]);
  assert.deepEqual(trace(empty, 0).path, trace(empty, MIN_ANGLE).path);
  assert.deepEqual(trace(empty, 180).path, trace(empty, 170).path);
});

test("flight: stops at a bubble and settles in the nearest free cell touching it", () => {
  const b = parseBoard(["...中...."]); // (0,3) at x=3.5
  const t = aim({ board: b }, 90);
  assert.deepEqual(t.hit, { r: 0, c: 3 });
  assert.ok(Math.abs(Math.hypot(t.end.x - 3.5, t.end.y - 0.5) - 1) < 1e-9);
  assert.deepEqual(t.cell, { r: 1, c: 3 }); // offset row 1: x = 4
});

test("flight: offset top row settles on offset centers", () => {
  const b = parseBoard([], 1);
  const t = aim({ board: b }, 90);
  assert.deepEqual(t.cell, { r: 0, c: 3 });
  assert.equal(center(b, t.cell).x, 4);
  assert.equal(center(b, { r: 1, c: 0 }).y, 0.5 + ROW_H);
});

test("flight: a shot settles into the cell its guide predicts", () => {
  const game = createGame({ words: WORDS, seed: 3, board: parseBoard(["學.......", ".中....."]), current: "生", next: "中" });
  const a = aim(game, 100);
  const { events } = shoot(game, 100);
  assert.deepEqual({ r: events.settled.r, c: events.settled.c }, a.cell);
  assert.deepEqual(events.path, a.path);
});

// test-spawn
function playRandom(seed, shots, levels, check) {
  let game = createGame({ words: GRAPH.words, levels, seed });
  let s = seed * 7919 + 13;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < shots && !game.over; i++) {
    check(game);
    ({ game } = shoot(game, 10 + rnd() * 160));
  }
}

test("spawn: launcher bubbles come from the board and keep the game playable", () => {
  let checked = 0;
  for (let seed = 1; seed <= 30; seed++) {
    playRandom(seed, 25, seed % 3 === 0 ? [1] : [1, 2], (game) => {
      const chars = new Set(boardChars(game.board));
      const done = completingChars(game.board, game.lexicon);
      if (done.size) {
        assert.ok(done.has(game.current) || done.has(game.next), `seed ${seed}: neither ${game.current} nor ${game.next} completes`);
        checked++;
      }
      if (!game.drawn) return;
      for (const ch of game.drawn) assert.ok(chars.has(ch), `seed ${seed}: drew ${ch} not on board`);
    });
  }
  assert.ok(checked > 100);
});

test("spawn: one level gives only that level's characters", () => {
  const level1 = new Set(GRAPH.words.filter((w) => w.level === 1 && [...w.trad].length > 1).flatMap((w) => [...w.trad]));
  for (let seed = 1; seed <= 10; seed++) {
    const game = createGame({ words: GRAPH.words, levels: [1], seed });
    for (const ch of boardChars(game.board)) assert.ok(level1.has(ch), ch);
  }
});

test("spawn: same seed, levels, and shots replay the same game", () => {
  const run = () => {
    let game = createGame({ words: GRAPH.words, levels: [1, 2], seed: 42 });
    const log = [];
    for (const a of [80, 100, 45, 135, 90, 60, 120, 30]) {
      const r = shoot(game, a);
      game = r.game;
      log.push([r.events.score, game.current, game.next, JSON.stringify(game.board)]);
    }
    return log;
  };
  assert.deepEqual(run(), run());
});

test("spawn: new boards are whole words, every bubble hangs from the ceiling", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const game = createGame({ words: GRAPH.words, levels: [1, 2], seed });
    assert.deepEqual(fallen(game.board), []);
    assert.equal(lowestRow(game.board), roundRows(1) - 1);
    assert.ok(boardChars(game.board).length >= 20);
  }
});

// test-progress
const fixture = (rows, extra = {}) =>
  createGame({ words: WORDS, seed: 5, board: parseBoard(rows), current: "生", next: "中", ...extra });

test("progress: popped characters score 100 times word length", () => {
  const { events, game } = resolveShot(fixture(["學.中國....", "......."]), { r: 0, c: 1 });
  assert.deepEqual(events.words.map((w) => w.word), ["學生"]);
  assert.equal(events.points, 400);
  assert.equal(game.score, 400);
  const three = resolveShot(fixture(["火.站中....", "......."], { current: "車" }), { r: 0, c: 1 });
  assert.equal(three.events.points, 900);
});

test("progress: fallen bubbles score 50 each, doubling for every 5 in one drop", () => {
  // 國 at (1,0) hangs from (0,0) and (0,1) only; row 2 hangs from 國. 學生 pops, 6 fall.
  const g = fixture(["學.......", "國......", "中國中國中..."]);
  const r = resolveShot(g, { r: 0, c: 1 });
  assert.equal(r.events.fallen.length, 6);
  assert.equal(r.events.points, 400 + 6 * 100);
});

test("progress: combo multiplies consecutive popping shots, a miss resets", () => {
  let game = fixture(["學.國學.國中."]);
  const mults = [];
  let r;
  for (const [ch, c] of [["生", 1], ["生", 4], ["國", 7], ["中", 1]]) {
    r = resolveShot({ ...game, current: ch }, { r: 0, c });
    game = r.game;
    mults.push(r.events.combo);
  }
  assert.deepEqual(mults, [1, 2, 3, 4]);
  assert.equal(r.events.points, 400 * 4);
  assert.equal(game.score, 400 * (1 + 2 + 3 + 4));
  const miss = resolveShot({ ...game, current: "你" }, { r: 0, c: 0 });
  assert.equal(miss.events.points, 0);
  assert.equal(miss.game.combo, 1);
});

test("progress: combo caps at 5", () => {
  const game = { ...fixture(["學.......", "......."]), streak: 9 };
  const { events } = resolveShot(game, { r: 0, c: 1 });
  assert.equal(events.combo, 5);
});

test("progress: rounds start one row taller and allow one shot fewer, within limits", () => {
  assert.deepEqual([1, 2, 5, 6, 9].map(roundRows), [5, 6, 9, 9, 9]);
  assert.deepEqual([1, 2, 5, 6, 9].map(roundShots), [8, 7, 4, 4, 4]);
});

test("progress: ceiling drops one row after the round's shots in a row without a pop", () => {
  let game = fixture(["中國中國中國中國", "......."], { current: "你" });
  for (let i = 0; i < roundShots(1) - 1; i++) {
    const r = resolveShot({ ...game, current: "你" }, { r: 1, c: i % 7 });
    assert.equal(r.events.ceilingDrop, false);
    game = r.game;
  }
  const r = resolveShot({ ...game, current: "你" }, { r: 2, c: 0 });
  assert.equal(r.events.ceilingDrop, true);
  assert.equal(r.game.board.shift, 1);
  assert.equal(r.game.board.rows[1][0], "中");
  assert.ok(r.game.board.rows[0].some(Boolean));
  assert.deepEqual(fallen(r.game.board), []);
  assert.equal(r.game.misses, 0);
});

test("progress: a pop resets the ceiling count", () => {
  let game = fixture(["中國中國中國中國", "......."]);
  ({ game } = resolveShot({ ...game, current: "你" }, { r: 1, c: 0 }));
  assert.equal(game.misses, 1);
  ({ game } = resolveShot({ ...game, current: "國" }, { r: 1, c: 1 }));
  assert.equal(game.misses, 0);
});

test("progress: clearing the board scores the round bonus and starts the next round", () => {
  const { events, game } = resolveShot(fixture(["學......."]), { r: 0, c: 1 });
  assert.deepEqual(events.roundClear, { round: 1, bonus: 1000 });
  assert.equal(events.score, 1400);
  assert.equal(game.round, 2);
  assert.equal(lowestRow(game.board), roundRows(2) - 1);
  assert.ok(new Set(boardChars(game.board)).has(game.current));
  assert.equal(game.over, false);
});

test("progress: a bubble settling below the line ends the game", () => {
  const rows = ["中國中國中國中國"];
  for (let r = 1; r < LINE_ROW; r++) rows.push(r % 2 ? "國......" : "中.......");
  const game = fixture(rows, { current: "你" });
  assert.equal(lowestRow(game.board), LINE_ROW - 1);
  const { events, game: after } = resolveShot(game, { r: LINE_ROW, c: 0 });
  assert.equal(events.gameOver, true);
  assert.equal(after.over, true);
  assert.equal(shoot(after, 90).events, null);
});

test("progress: a ceiling drop that pushes a bubble below the line ends the game", () => {
  const rows = ["中國中國中國中國"];
  for (let r = 1; r < LINE_ROW; r++) rows.push(r % 2 ? "國......" : "中.......");
  const game = { ...fixture(rows), misses: roundShots(1) - 1 };
  const { events } = resolveShot({ ...game, current: "你" }, { r: 1, c: 3 });
  assert.equal(events.ceilingDrop, true);
  assert.equal(events.gameOver, true);
});

test("progress: popped words are kept newest first, each once", () => {
  let game = fixture(["學.學.學中..", "......."]);
  ({ game } = resolveShot({ ...game, current: "生" }, { r: 0, c: 1 }));
  ({ game } = resolveShot({ ...game, current: "國" }, { r: 0, c: 6 }));
  ({ game } = resolveShot({ ...game, current: "生" }, { r: 0, c: 3 }));
  assert.deepEqual(game.history, ["學生", "中國"]);
});

test("swap trades current and next", () => {
  const g = swap(fixture(["學......."]));
  assert.equal(g.current, "中");
  assert.equal(g.next, "生");
});

// acceptance-say-source
test("acceptance-say-source: recording, else on-device Taiwan Mandarin voice, else silent; never a network voice", () => {
  const rec = { word: "學生", entries: [{ ...W("1-128", 1, "學生"), audio: "audio/1-128.mp3" }] };
  const bare = { word: "喜歡", entries: [W("c", 2, "喜歡")] };
  const tw = { name: "Mei-Jia", lang: "zh-TW", localService: true };
  const twAndroid = { name: "zh_TW local", lang: "zh_TW", localService: true };
  const twCloud = { name: "Google 國語（臺灣）", lang: "zh-TW", localService: false };
  const cn = { name: "Tingting", lang: "zh-CN", localService: true };
  const en = { name: "Samantha", lang: "en-US", localService: true };

  // A word with a recording plays it, from the site, whatever voices exist.
  assert.deepEqual(pronunciation(rec, true, [tw]), { src: "../audio/1-128.mp3" });
  assert.deepEqual(pronunciation(rec, true, []), { src: "../audio/1-128.mp3" });
  // Without one: a Taiwan Mandarin voice on the device says the Traditional form.
  assert.deepEqual(pronunciation(bare, true, [en, cn, twCloud, tw]), { voice: tw, text: "喜歡" });
  assert.equal(pronunciation(bare, true, [twAndroid]).voice, twAndroid);
  // No such device voice: silent. Off-device voices are never used.
  assert.equal(pronunciation(bare, true, [en, cn]), null);
  assert.equal(pronunciation(bare, true, [twCloud]), null);
  assert.equal(pronunciation(bare, true, [{ lang: "zh-TW" }]), null);
  assert.equal(pronunciation(bare, true, []), null);
  assert.equal(pronunciation(bare, true, undefined), null);
  // Pronunciation off: nothing is said.
  assert.equal(pronunciation(rec, false, [tw]), null);
  assert.equal(pronunciation(bare, false, [tw]), null);
});
