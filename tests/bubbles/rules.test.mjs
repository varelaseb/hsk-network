// Rule tests for site/bubbles/rules.js (docs/specs/hsk-bubbles.spec.html #tests-list).
// Run: node --test tests/bubbles/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COLS, LINE_ROW, LAUNCHER, ROW_H, MIN_ANGLE,
  makeLexicon, parseBoard, findWords, fallen, trace, aim, center, neighbors, at,
  createGame, shoot, resolveShot, swap, completingChars, extendingChars, boardChars, cells, deckLexicon,
  roundRows, roundShots, roundDeck, lowestRow, wordReading, charReadings, readingOf,
} from "../../site/bubbles/rules.js";

const W = (id, level, trad) => ({ id, level, trad, zhuyin: "", pinyin: "", simp: trad, defs: [trad + " def"] });
const WORDS = [
  W("a", 1, "學生"), W("b", 1, "學校"), W("c", 2, "喜歡"), W("d", 1, "中國"),
  W("e", 1, "火車站"), W("f", 2, "公共汽車"), W("g", 1, "你"), W("h", 1, "謝謝"), W("i", 2, "車站"),
];
const LEX = makeLexicon(WORDS, [1, 2]);
const keys = (cells) => [...new Set(cells.map(({ r, c }) => `${r},${c}`))].sort();
const popped = (board, cell, lex = LEX) => keys(findWords(board, cell, lex).flatMap((w) => w.cells));
const fixture = (rows, extra = {}) =>
  createGame({ words: WORDS, seed: 5, board: parseBoard(rows), current: "生", next: "中", ...extra });
const GRAPH = JSON.parse(readFileSync(new URL("../../site/data/graph.json", import.meta.url), "utf8"));

// test-detect
test("detect: straight chain through the shot bubble pops (acceptance-detect)", () => {
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
test("fall: a hanging cluster falls, a cluster touching the ceiling through one bubble stays (acceptance-fall-rules)", () => {
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
  game = createGame({ words: WORDS, seed: 1, board, current: "國", next: "中" });
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

// test-spawn, test-decks
const LEVELS = [[1], [2], [1, 2]];
const needed = (game) => new Set(game.left.flatMap((w) => [...w]));
const assertNoOrphan = (game, tag) => {
  const need = needed(game);
  for (const x of cells(game.board)) assert.ok(need.has(x.ch), `${tag}: orphan ${x.ch} at ${x.r},${x.c}`);
};
// spec #decision-spawn on the launcher pair: both needed; the current or next
// completes a word, or, when none can be completed by one shot, both extend one.
const assertLauncher = (game, tag) => {
  const need = needed(game);
  const pair = [game.current, game.next];
  for (const ch of pair) assert.ok(need.has(ch), `${tag}: launcher ${ch}, needed by no unfinished deck word`);
  const lex = deckLexicon(game.lexicon, game.left);
  const done = completingChars(game.board, lex);
  if (done.size) {
    assert.ok(pair.some((ch) => done.has(ch)), `${tag}: neither ${pair} completes`);
  } else {
    const ext = extendingChars(game.board, lex);
    for (const ch of pair) assert.ok(ext.has(ch), `${tag}: ${ch} extends no word (${[...ext]})`);
  }
};

function playRandom(seed, shots, levels, check) {
  let game = createGame({ words: GRAPH.words, levels, seed });
  let s = seed * 7919 + 13;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  check(game, null);
  for (let i = 0; i < shots && !game.over; i++) {
    let events;
    ({ game, events } = shoot(game, 10 + rnd() * 160));
    check(game, events);
  }
}

// Test player helpers: the first angle where ch pops a word, or where it lands
// touching a bubble it reads with as two neighboring characters of a word.
function shotWith(game, cell, ch) {
  const rows = game.board.rows.map((row) => [...row]);
  while (rows.length <= cell.r) rows.push(new Array((rows.length + game.board.shift) & 1 ? COLS - 1 : COLS).fill(null));
  rows[cell.r][cell.c] = ch;
  return { shift: game.board.shift, rows };
}
function popAngle(game, ch) {
  const lex = deckLexicon(game.lexicon, game.left);
  for (let a = MIN_ANGLE; a <= 170; a++) {
    const { cell } = aim(game, a);
    if (cell && findWords(shotWith(game, cell, ch), cell, lex).length) return a;
  }
  return null;
}
// Longest in-order run of chars through cell, as chars[index].
function runLen(board, cell, chars, index) {
  const k = ({ r, c }) => `${r},${c}`;
  const used = new Set([k(cell)]);
  const go = (pos, i, step) => {
    if (i < 0 || i >= chars.length) return 0;
    let best = 0;
    for (const n of neighbors(board, pos)) {
      if (used.has(k(n)) || at(board, n) !== chars[i]) continue;
      used.add(k(n));
      best = Math.max(best, 1 + go(n, i + step, step));
      used.delete(k(n));
    }
    return best;
  };
  return 1 + go(cell, index + 1, 1) + go(cell, index - 1, -1);
}
// Where ch extends a word: reads two or more of its characters in order; the
// longest such run wins. Returns { a, n } or null.
function extendShot(game, ch) {
  const lex = deckLexicon(game.lexicon, game.left);
  let best = null;
  for (let a = MIN_ANGLE; a <= 170; a++) {
    const { cell } = aim(game, a);
    if (!cell) continue;
    const board = shotWith(game, cell, ch);
    for (const { chars, index } of lex.byChar.get(ch) ?? []) {
      const n = runLen(board, cell, chars, index);
      if (n >= 2 && (!best || n > best.n)) best = { a, n };
    }
  }
  return best;
}
const extendAngle = (game, ch) => extendShot(game, ch)?.a ?? null;

test("spawn: a word too short for one shot is rebuilt by extension; only the full word pops (acceptance-spawn)", () => {
  const words = [...WORDS, W("j", 1, "打電話"), W("k", 1, "電話")];
  for (let seed = 1; seed <= 20; seed++) {
    let game = createGame({ words, seed, board: parseBoard(["電......."]), deck: ["打電話"] });
    assert.deepEqual(completingChars(game.board, deckLexicon(game.lexicon, game.left)), new Set());
    assertLauncher(game, `seed ${seed}`);
    for (const ch of [game.current, game.next]) assert.ok(["打", "話"].includes(ch), ch);
    // Extend once: 電話 is an HSK word but not in the deck, so nothing pops.
    let r = shoot(game, extendAngle(game, game.current));
    assert.deepEqual(r.events.words, [], `seed ${seed}`);
    game = r.game;
    assertLauncher(game, `seed ${seed} after extend`);
    let a = popAngle(game, game.current);
    if (a === null) {
      game = swap(game);
      a = popAngle(game, game.current);
    }
    assert.notEqual(a, null, `seed ${seed}: no completing shot after extension`);
    r = shoot(game, a);
    assert.deepEqual(r.events.words.map((w) => w.word), ["打電話"]);
    assert.ok(r.events.roundClear);
  }
});

test("spawn: the held next is redrawn when a pop leaves it needed by no word (acceptance-spawn)", () => {
  // Next 國 is needed only by 中國. Popping 學生 drops 中, its last bubble, so
  // 中國 finishes and 國 must not become current.
  const board = parseBoard(["學.校.....", "中......"]);
  const game = createGame({ words: WORDS, seed: 2, board, deck: ["學生", "學校", "中國"], current: "生", next: "國" });
  const { game: after } = resolveShot(game, { r: 0, c: 1 });
  assert.deepEqual(after.left, ["學校"]);
  assert.notEqual(after.current, "國");
  assertLauncher(after, "after pop");
});

test("decks: no board bubble is an orphan after any shot or ceiling drop (acceptance-no-orphan)", () => {
  let drops = 0;
  let shots = 0;
  for (const levels of LEVELS) {
    for (let seed = 1; seed <= 20; seed++) {
      playRandom(seed, 30, levels, (game, events) => {
        assertNoOrphan(game, `levels ${levels} seed ${seed}`);
        assert.deepEqual(fallen(game.board), []);
        if (events?.ceilingDrop) drops++;
        shots++;
      });
    }
  }
  assert.ok(drops > 10, `ceiling drops seen: ${drops}`);
  assert.ok(shots > 500);
});

test("decks: launcher bubbles are needed characters and the current or next completes (acceptance-spawn)", () => {
  let checked = 0;
  for (const levels of LEVELS) {
    for (let seed = 1; seed <= 15; seed++) {
      playRandom(seed, 25, levels, (game) => {
        if (game.over) return;
        assertLauncher(game, `levels ${levels} seed ${seed}`);
        checked++;
      });
    }
  }
  assert.ok(checked > 300);
});

test("decks: a test player who pops or extends every shot clears rounds 1 to 7 with no ceiling drop (acceptance-round-completes)", () => {
  let rounds = 0;
  let extends_ = 0;
  const SEEDS = 8;
  for (const levels of LEVELS) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      let game = createGame({ words: GRAPH.words, levels, seed });
      const tag = () => `levels ${levels} seed ${seed} round ${game.round}`;
      while (game.round <= 7) {
        assertNoOrphan(game, tag());
        assertLauncher(game, tag());
        let a = popAngle(game, game.current);
        if (a === null) {
          a = popAngle(game, game.next);
          if (a !== null) game = swap(game);
        }
        const pops = a !== null;
        if (!pops) {
          const [cur, nxt] = [extendShot(game, game.current), extendShot(game, game.next)];
          const useNext = nxt && (!cur || nxt.n > cur.n);
          if (useNext) game = swap(game);
          a = (useNext ? nxt : cur)?.a ?? null;
          extends_++;
        }
        assert.notEqual(a, null, `${tag()}: no pop or extend shot for ${game.current} or ${game.next}`);
        const before = game.left.length;
        const { game: after, events } = shoot(game, a);
        assert.equal(events.words.length > 0, pops, `${tag()}: pop expected ${pops}`);
        assert.equal(events.ceilingDrop, false, tag());
        assert.equal(events.gameOver, false, tag());
        if (events.roundClear) {
          assert.equal(after.round, game.round + 1);
          assert.equal(after.left.length, roundDeck(after.round));
          rounds++;
        } else {
          if (pops) assert.ok(events.wordsLeft < before, `${tag()}: words left did not drop`);
          assert.equal(events.wordsLeft, after.left.length);
        }
        game = after;
      }
    }
  }
  assert.equal(rounds, LEVELS.length * SEEDS * 7);
  assert.ok(extends_ > 0, "no round needed an extension");
});

test("decks: deck size per round, distinct words, each laid on the new board", () => {
  assert.deepEqual([1, 2, 3, 5, 6, 9].map(roundDeck), [8, 9, 10, 12, 12, 12]);
  for (const levels of LEVELS) {
    for (let seed = 1; seed <= 20; seed++) {
      for (const round of [1, 4]) {
        const game = createGame({ words: GRAPH.words, levels, seed, round });
        assert.equal(game.deck.length, roundDeck(round));
        assert.equal(new Set(game.deck).size, game.deck.length);
        assert.deepEqual(game.left, game.deck);
        for (const w of game.deck) {
          assert.ok([...w].length >= 2 && [...w].length <= 4, w);
          assert.ok(game.lexicon.entries.get(w).every((e) => levels.includes(e.level)), w);
          assert.ok([...w].every((ch) => boardChars(game.board).includes(ch)), `seed ${seed}: ${w} not laid`);
        }
      }
    }
  }
});

test("decks: a finished word's left-over bubbles drop and score as fallen; shared characters stay", () => {
  // 學生 pops; the other 生 is left over; 學 stays for 學校.
  const game = createGame({ words: WORDS, seed: 5, board: parseBoard(["學.中國生學校."]), deck: ["學生", "中國", "學校"], current: "生", next: "中" });
  assert.deepEqual(game.left, ["學生", "中國", "學校"]);
  const { events, game: after } = resolveShot(game, { r: 0, c: 1 });
  assert.deepEqual(events.words.map((w) => w.word), ["學生"]);
  assert.deepEqual(keys(events.fallen), ["0,4"]);
  assert.equal(events.points, 400 + 50);
  assert.equal(events.wordsLeft, 2);
  assert.deepEqual(after.left, ["中國", "學校"]);
  assert.deepEqual(boardChars(after.board), ["中", "國", "學", "校"].sort());
});

test("decks: only unfinished deck words pop (acceptance-detect)", () => {
  // 學生 is an HSK word but not in this deck; a finished word never pops again.
  const g = createGame({ words: WORDS, seed: 5, board: parseBoard(["學.中國學..."]), deck: ["中國", "學校"], current: "生", next: "中" });
  const miss = resolveShot(g, { r: 0, c: 1 });
  assert.deepEqual(miss.events.words, []);
  assert.equal(miss.game.misses, 1);
  const done = createGame({ words: WORDS, seed: 5, board: parseBoard(["學.中國學生.."]), deck: ["學生", "中國"], current: "生", next: "學" });
  let { game } = resolveShot(done, { r: 0, c: 1 });
  assert.deepEqual(game.left, ["中國"]);
  assert.deepEqual(boardChars(game.board), ["中", "國"].sort());
});

test("decks: popping a deck word drops words left by one (acceptance-words-left)", () => {
  const game = fixture(["學.中國.校..", "......."], { deck: ["學生", "中國", "學校"] });
  assert.equal(game.left.length, 3);
  const { events, game: after } = resolveShot(game, { r: 0, c: 1 });
  assert.equal(events.wordsLeft, 2);
  assert.equal(after.left.length, 2);
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

test("spawn: new boards are whole deck words, every bubble hangs from the ceiling", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const game = createGame({ words: GRAPH.words, levels: [1, 2], seed });
    assert.deepEqual(fallen(game.board), []);
    assert.equal(lowestRow(game.board), roundRows(1) - 1);
    assertNoOrphan(game, `seed ${seed}`);
  }
});

// test-progress

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
  let game = { ...fixture(["學.中.喜.謝謝"], { deck: ["學生", "中國", "喜歡", "謝謝"] }), streak: 0 };
  const mults = [];
  let r;
  for (const [ch, c] of [["生", 1], ["國", 3], ["歡", 5]]) {
    r = resolveShot({ ...game, current: ch }, { r: 0, c });
    game = r.game;
    mults.push(r.events.combo);
  }
  assert.deepEqual(mults, [1, 2, 3]);
  assert.equal(r.events.points, 400 * 3);
  assert.equal(game.score, 400 * (1 + 2 + 3));
  const miss = resolveShot({ ...game, current: "謝" }, { r: 1, c: 0 });
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
  assert.ok(needed(game).has(game.current));
  assert.equal(game.over, false);
});

test("progress: popping the last deck word clears the round (acceptance-round)", () => {
  const { events, game } = resolveShot(fixture(["學.中國....", "......."], { words: GRAPH.words, deck: ["學生"] }), { r: 0, c: 1 });
  assert.deepEqual(events.roundClear, { round: 1, bonus: 1000 });
  assert.equal(events.fallen.length, 2); // 中國 was left over
  assert.equal(game.round, 2);
  assert.equal(game.deck.length, roundDeck(2));
  assert.deepEqual(game.left, game.deck);
});

test("progress: a bubble settling below the line ends the game", () => {
  const rows = ["中國中國中國中國"];
  for (let r = 1; r < LINE_ROW; r++) rows.push(r % 2 ? "國......" : "中.......");
  const game = fixture(rows, { current: "學", deck: ["中國", "學生"] });
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
  let game = fixture(["學.學.學中..", "......."], { deck: ["學生", "中國", "學校"] });
  ({ game } = resolveShot({ ...game, current: "生" }, { r: 0, c: 1 }));
  ({ game } = resolveShot({ ...game, current: "國" }, { r: 0, c: 6 }));
  ({ game } = resolveShot({ ...game, current: "校" }, { r: 0, c: 3 }));
  assert.deepEqual(game.history, ["學校", "中國", "學生"]);
});

test("swap trades current and next", () => {
  const g = swap(fixture(["學......."]));
  assert.equal(g.current, "中");
  assert.equal(g.next, "生");
});

// test-inspect
const CHARS = {
  // shared by several words, two readings
  子: { readings: [{ pinyin: "zi3", zhuyin: "ㄗˇ", defs: ["son", "child"] }, { pinyin: "zi5", zhuyin: "˙ㄗ", defs: ["noun suffix"] }] },
  學: { readings: [{ pinyin: "xue2", zhuyin: "ㄒㄩㄝˊ", defs: ["to learn", "to study"] }], meaning: "learn" },
  // in only one word
  杯: { readings: [{ pinyin: "bei1", zhuyin: "ㄅㄟ", defs: ["cup"] }] },
};

test("inspect: each character gives its own readings as Zhuyin and definitions (acceptance-inspect-rules)", () => {
  assert.deepEqual(charReadings("子", CHARS), [{ zhuyin: "ㄗˇ", defs: ["son", "child"] }, { zhuyin: "˙ㄗ", defs: ["noun suffix"] }]);
  assert.deepEqual(charReadings("學", CHARS), [{ zhuyin: "ㄒㄩㄝˊ", defs: ["to learn", "to study"] }]);
  assert.deepEqual(charReadings("杯", CHARS), [{ zhuyin: "ㄅㄟ", defs: ["cup"] }]);
});

test("inspect: never pinyin", () => {
  for (const ch of Object.keys(CHARS)) {
    const text = JSON.stringify(charReadings(ch, CHARS));
    assert.ok(!/pinyin|[a-z]+[1-5]/.test(text), text);
  }
});

test("inspect: every character of every word has readings with English in the built table (hsk-network #char-coverage)", () => {
  for (const w of GRAPH.words) for (const ch of w.trad) {
    const rs = charReadings(ch, GRAPH.chars);
    assert.ok(rs.length && rs[0].zhuyin && rs[0].defs[0], ch);
  }
});

test("shoot events carry word entries with English definitions for the card", () => {
  const game = createGame({ words: GRAPH.words, levels: [1, 2], seed: 1, board: parseBoard(["..學...."]), current: "生", next: "學" });
  const { events } = resolveShot(game, { r: 0, c: 3 });
  assert.equal(events.words[0].word, "學生");
  for (const e of events.words[0].entries) assert.ok(wordReading(e, GRAPH.chars).defs[0], "defs[0]");
});

// hsk-network #chars-words: cards read a one-character word through chars.
test("wordReading: own Zhuyin and defs, or the named reading of its character", () => {
  const chars = { 好: { readings: [{ pinyin: "hao3", zhuyin: "ㄏㄠˇ", defs: ["good"] },
    { pinyin: "hao4", zhuyin: "ㄏㄠˋ", defs: ["to be fond of"] }] } };
  assert.deepEqual(wordReading({ trad: "好", reading: 1 }, chars), { zhuyin: "ㄏㄠˋ", defs: ["to be fond of"] });
  assert.deepEqual(wordReading({ trad: "學生", zhuyin: "ㄒㄩㄝˊ ˙ㄕㄥ", defs: ["student"] }, chars),
    { zhuyin: "ㄒㄩㄝˊ ˙ㄕㄥ", defs: ["student"] });
  const hao = GRAPH.words.find((w) => w.trad === "好");
  assert.equal(wordReading(hao, GRAPH.chars).zhuyin, "ㄏㄠˇ");
});

// feel-script: the page renders either script from one reading object.
test("readingOf: a word's full reading, both scripts, from one read path", () => {
  const xs = GRAPH.words.find((w) => w.trad === "學生");
  assert.equal(readingOf(xs, GRAPH.chars), xs);
  const hao = GRAPH.words.find((w) => w.trad === "好");
  const r = readingOf(hao, GRAPH.chars);
  assert.equal(r, GRAPH.chars["好"].readings[hao.reading]);
  assert.ok(r.pinyin && r.zhuyin && r.defs[0].parts, "pinyin, zhuyin, sense objects");
});
