// HSK bubbles game rules (docs/specs/hsk-bubbles.spec.html, Board and rules).
// Pure browser ES module: no DOM, timer, Math.random, or storage. The same
// words, levels, seed, and shots always replay the same game.
//
// Units: bubble diameter 1, play width COLS (8). x grows right, y grows down,
// y 0 is the ceiling. Every other row is offset half a bubble right and holds
// COLS - 1 bubbles; board.shift (0 or 1) says whether row 0 is offset, and
// flips on each ceiling drop. Cells are { r, c }.
//
// Seam for the game page:
//   createGame({ words, levels, seed, board?, current?, next?, round? }) -> game
//       words: graph.json `words`; levels: e.g. [1, 2]; seed: integer.
//       board/current/next/round: optional fixture start.
//   aim(game, angleDeg) -> { path, hit, end, cell }
//       guide: path points from LAUNCHER (bends at walls), hit = bubble cell
//       or null for the ceiling, cell = where the shot would settle.
//   shoot(game, angleDeg) -> { game, events }   events null once game.over
//       events: { path, settled {r,c,ch}, words [{word, cells, entries}]
//       (longest first; entries are graph.json word objects), popped, fallen
//       (cells with ch, as on the board before removal), points, combo,
//       score, roundClear null | {round, bonus}, ceilingDrop, gameOver }
//       When roundClear, game.board is already the next round's board.
//   swap(game) -> game                current and next trade places
//   game: { board {shift, rows}, current, next, score, round, combo,
//           misses, history (popped words, newest first, each once), over }
//   Geometry: COLS, ROW_H, LINE_ROW (a bubble at row >= LINE_ROW is below the
//   bottom line), LINE_Y, LAUNCHER {x, y}, HEIGHT, MIN_ANGLE, MAX_ANGLE,
//   center(board, cell) -> {x, y}, lowestRow(board) (danger glow when
//   lowestRow === LINE_ROW - 1), roundShots(round).
//   pronunciation(found, on, voices) -> { src } | { voice, text } | null
//       how a popped word is said: found = shoot's events.words item, on =
//       the pronunciation choice, voices = speechSynthesis.getVoices().
//       src is the game-relative recording path; voice is a Taiwan Mandarin
//       voice that runs on the device (localService); null says nothing.
//   wordReading(entry, chars) -> { zhuyin, defs }
//       a word entry's Zhuyin and definitions: its own, or for a one-character
//       word, those of the reading it names in chars (graph.json `chars`).
//   charReadings(ch, chars) -> [{ zhuyin, defs }]
//       character card (spec #rule-inspect): every reading of ch's chars entry,
//       read through wordReading; never pinyin. The build gives every word
//       character an entry (hsk-network #char-coverage).

export const COLS = 8;
export const ROW_H = Math.sqrt(3) / 2;
export const LINE_ROW = 12;
export const LINE_Y = 0.5 + (LINE_ROW - 1) * ROW_H + 0.5;
export const LAUNCHER = Object.freeze({ x: COLS / 2, y: LINE_Y + 2 * ROW_H });
export const HEIGHT = LAUNCHER.y + 1;
export const MIN_ANGLE = 10;
export const MAX_ANGLE = 170;
const MAX_ROW = LINE_ROW + 1;
const AIM_STEP = 1;

// ---- Seeded randomness (mulberry32); state is a uint32 kept in game.seed.

function makeRng(seed) {
  const rng = {
    state: seed >>> 0,
    next() {
      rng.state = (rng.state + 0x6d2b79f5) >>> 0;
      let t = rng.state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    pick: (list) => list[Math.floor(rng.next() * list.length)],
    shuffle(list) {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
  return rng;
}

// ---- Words

// hsk-network spec #chars-words: a one-character word names a reading of its
// character's table entry instead of carrying Zhuyin and definitions.
export function wordReading(entry, chars) {
  const r = "reading" in entry ? chars[entry.trad].readings[entry.reading] : entry;
  return { zhuyin: r.zhuyin, defs: r.defs };
}

export function makeLexicon(words, levels) {
  const on = new Set(levels.map(Number));
  const entries = new Map();
  for (const w of words) {
    const n = [...w.trad].length;
    if (!on.has(w.level) || n < 2 || n > 4) continue;
    if (!entries.has(w.trad)) entries.set(w.trad, []);
    entries.get(w.trad).push(w);
  }
  const byChar = new Map();
  const byLen = { 2: [], 3: [], 4: [] };
  for (const word of entries.keys()) {
    const chars = [...word];
    byLen[chars.length].push(word);
    chars.forEach((ch, index) => {
      if (!byChar.has(ch)) byChar.set(ch, []);
      byChar.get(ch).push({ word, chars, index });
    });
  }
  return { entries, list: [...entries.keys()], byChar, byLen };
}

// ---- Board grid

const offset = (board, r) => (r + board.shift) & 1;
export const rowWidth = (board, r) => (offset(board, r) ? COLS - 1 : COLS);
const valid = (board, r, c) => r >= 0 && r <= MAX_ROW && c >= 0 && c < rowWidth(board, r);
const key = ({ r, c }) => `${r},${c}`;
export const at = (board, { r, c }) => board.rows[r]?.[c] ?? null;

export function center(board, { r, c }) {
  return { x: 0.5 + c + 0.5 * offset(board, r), y: 0.5 + r * ROW_H };
}

export function neighbors(board, { r, c }) {
  const side = offset(board, r) ? [c, c + 1] : [c - 1, c];
  const out = [[r, c - 1], [r, c + 1], [r - 1, side[0]], [r - 1, side[1]], [r + 1, side[0]], [r + 1, side[1]]];
  return out.filter(([rr, cc]) => valid(board, rr, cc)).map(([rr, cc]) => ({ r: rr, c: cc }));
}

export function cells(board) {
  const out = [];
  board.rows.forEach((row, r) => row.forEach((ch, c) => ch && out.push({ r, c, ch })));
  return out;
}

export const boardChars = (board) => [...new Set(cells(board).map((x) => x.ch))].sort();

export function lowestRow(board) {
  for (let r = board.rows.length - 1; r >= 0; r--) if (board.rows[r].some(Boolean)) return r;
  return -1;
}

function emptyRow(board, r) {
  return new Array(rowWidth(board, r)).fill(null);
}

function put(board, cell, ch) {
  const rows = board.rows.map((row) => [...row]);
  while (rows.length <= cell.r) rows.push(emptyRow(board, rows.length));
  rows[cell.r][cell.c] = ch;
  return { shift: board.shift, rows };
}

function removeCells(board, list) {
  const rows = board.rows.map((row) => [...row]);
  for (const { r, c } of list) rows[r][c] = null;
  return { shift: board.shift, rows };
}

// Fixture boards: one string per row, "." for empty; offset rows hold COLS - 1.
export function parseBoard(lines, shift = 0) {
  const board = { shift, rows: [] };
  lines.forEach((line, r) => {
    const chars = [...line];
    const width = rowWidth(board, r);
    if (chars.length > width) throw new Error(`row ${r} is wider than ${width}: ${line}`);
    board.rows.push(Array.from({ length: width }, (_, c) => (chars[c] && chars[c] !== "." ? chars[c] : null)));
  });
  return board;
}

// ---- Word rule: chains of touching bubbles through the shot bubble.

export function findWords(board, cell, lex) {
  const found = new Map();
  for (const { word, chars, index } of lex.byChar.get(at(board, cell)) ?? []) {
    const used = new Set([key(cell)]);
    const walk = (pos, i, step, chain) => {
      if (i < 0 || i === chars.length) {
        if (step > 0) return walk(cell, index - 1, -1, chain);
        const set = found.get(word) ?? new Map();
        for (const x of chain) set.set(key(x), x);
        found.set(word, set);
        return;
      }
      for (const n of neighbors(board, pos)) {
        if (used.has(key(n)) || at(board, n) !== chars[i]) continue;
        used.add(key(n));
        walk(n, i + step, step, [...chain, n]);
        used.delete(key(n));
      }
    };
    walk(cell, index + 1, 1, [cell]);
  }
  return [...found]
    .map(([word, set]) => ({ word, cells: [...set.values()], entries: lex.entries.get(word) }))
    .sort((a, b) => [...b.word].length - [...a.word].length || (a.word < b.word ? -1 : 1));
}

// ---- Falling: bubbles no longer connected to the ceiling.

export function fallen(board) {
  const seen = new Set();
  const queue = cells(board).filter((x) => x.r === 0);
  queue.forEach((x) => seen.add(key(x)));
  while (queue.length) {
    for (const n of neighbors(board, queue.pop())) {
      if (at(board, n) && !seen.has(key(n))) {
        seen.add(key(n));
        queue.push(n);
      }
    }
  }
  return cells(board).filter((x) => !seen.has(key(x)));
}

// ---- Flight: straight line from the launcher, reflecting off side walls,
// stopping on touching a bubble or the ceiling.

export const clampAngle = (deg) => Math.min(MAX_ANGLE, Math.max(MIN_ANGLE, deg));

export function trace(board, angleDeg) {
  const a = (clampAngle(angleDeg) * Math.PI) / 180;
  let x = LAUNCHER.x;
  let y = LAUNCHER.y;
  let dx = Math.cos(a);
  const dy = -Math.sin(a);
  const bubbles = cells(board).map((b) => ({ r: b.r, c: b.c, ...center(board, b) }));
  const path = [{ x, y }];
  for (let bounce = 0; bounce < 100; bounce++) {
    let t = (0.5 - y) / dy;
    let hit = null;
    for (const b of bubbles) {
      const fx = x - b.x;
      const fy = y - b.y;
      const B = fx * dx + fy * dy;
      const C = fx * fx + fy * fy - 1;
      const disc = B * B - C;
      if (disc < 0) continue;
      const tb = C <= 0 ? 0 : -B - Math.sqrt(disc);
      if (tb >= 0 && tb < t) {
        t = tb;
        hit = { r: b.r, c: b.c };
      }
    }
    const wall = dx > 1e-12 ? COLS - 0.5 : dx < -1e-12 ? 0.5 : null;
    const tw = wall === null ? Infinity : (wall - x) / dx;
    if (tw < t) {
      x = wall;
      y += tw * dy;
      dx = -dx;
      path.push({ x, y });
      continue;
    }
    x += t * dx;
    y += t * dy;
    path.push({ x, y });
    return { path, hit, end: { x, y } };
  }
  return { path, hit: null, end: { x, y } };
}

function settleCell(board, end, hit) {
  const free = (n) => !at(board, n);
  let cands = hit
    ? neighbors(board, hit).filter(free)
    : emptyRow(board, 0).map((_, c) => ({ r: 0, c })).filter(free);
  if (!cands.length) {
    cands = [];
    for (let r = 0; r <= MAX_ROW; r++) {
      for (let c = 0; c < rowWidth(board, r); c++) {
        const n = { r, c };
        if (free(n) && (r === 0 || neighbors(board, n).some((m) => at(board, m)))) cands.push(n);
      }
    }
  }
  let best = null;
  let bestD = Infinity;
  for (const n of cands) {
    const p = center(board, n);
    const d = Math.hypot(p.x - end.x, p.y - end.y);
    if (d < bestD - 1e-9) [best, bestD] = [n, d];
  }
  return best;
}

export function aim(game, angleDeg) {
  const t = trace(game.board, angleDeg);
  return { ...t, cell: settleCell(game.board, t.end, t.hit) };
}

function reachableCells(board) {
  const seen = new Map();
  for (let a = MIN_ANGLE; a <= MAX_ANGLE; a += AIM_STEP) {
    const { cell } = aim({ board }, a);
    if (cell) seen.set(key(cell), cell);
  }
  return [...seen.values()];
}

// Board characters that complete a word when shot into a reachable cell.
export function completingChars(board, lex) {
  const out = new Set();
  const spots = reachableCells(board);
  for (const ch of boardChars(board)) {
    if (spots.some((cell) => findWords(put(board, cell, ch), cell, lex).length)) out.add(ch);
  }
  return out;
}

// ---- Launcher choice: 3 in 4 a completing character, else any board
// character; forced completing when the partner bubble completes nothing.

function drawLauncher(board, lex, rng, partner) {
  const chars = boardChars(board);
  if (!chars.length) return null;
  const completing = [...completingChars(board, lex)].sort();
  if (!completing.length) return rng.pick(chars);
  if (partner !== undefined && !completing.includes(partner)) return rng.pick(completing);
  return rng.next() < 0.75 ? rng.pick(completing) : rng.pick(chars);
}

// ---- Boards: whole words laid along chains of touching cells.

export const roundRows = (round) => Math.min(4 + round, 9);
export const roundShots = (round) => Math.max(9 - round, 4);

function chainFrom(board, start, length, rows, rng) {
  const used = new Set([key(start)]);
  const grow = (chain) => {
    if (chain.length === length) return chain;
    for (const n of rng.shuffle(neighbors(board, chain[chain.length - 1]))) {
      if (n.r >= rows || at(board, n) || used.has(key(n))) continue;
      used.add(key(n));
      const done = grow([...chain, n]);
      if (done) return done;
      used.delete(key(n));
    }
    return null;
  };
  return grow([start]);
}

function buildBoard(lex, rows, rng) {
  let board = { shift: 0, rows: [] };
  for (let r = 0; r < rows; r++) board.rows.push(emptyRow(board, r));
  const groups = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < rowWidth(board, r); c++) {
      if (at(board, { r, c }) || !lex.list.length) continue;
      for (let attempt = 0; attempt < 8; attempt++) {
        const chars = [...rng.pick(lex.list)];
        const chain = chainFrom(board, { r, c }, chars.length, rows, rng);
        if (!chain) continue;
        chain.forEach((cell, i) => (board.rows[cell.r][cell.c] = chars[i]));
        groups.push(chain);
        break;
      }
    }
  }
  // Drop whole words that would hang free, so every bubble keeps its partner.
  for (;;) {
    const loose = new Set(fallen(board).map(key));
    if (!loose.size) return board;
    const drop = groups.filter((g) => g.some((cell) => loose.has(key(cell))));
    board = removeCells(board, drop.flat());
    for (const g of drop) groups.splice(groups.indexOf(g), 1);
  }
}

function newTopRow(board, lex, rng) {
  const width = rowWidth(board, 0);
  const row = new Array(width).fill(null);
  for (let c = 0; c < width; ) {
    const left = width - c;
    const fits = [2, 3, 4].filter((n) => n <= left && lex.byLen[n].length);
    const clean = fits.filter((n) => left - n !== 1);
    if (!fits.length) break;
    const chars = [...rng.pick(lex.byLen[rng.pick(clean.length ? clean : fits)])];
    if (rng.next() < 0.5) chars.reverse();
    for (const ch of chars) row[c++] = ch;
  }
  return row;
}

function ceilingDrop(board, lex, rng) {
  const next = { shift: board.shift ^ 1, rows: [] };
  next.rows = [newTopRow(next, lex, rng), ...board.rows.map((row) => [...row])];
  return next;
}

// ---- Game

export function createGame({ words, levels = [1, 2], seed = 1, board, current, next, round = 1, score = 0 }) {
  const lexicon = makeLexicon(words, levels);
  const rng = makeRng(seed);
  const b = board ?? buildBoard(lexicon, roundRows(round), rng);
  const cur = current ?? drawLauncher(b, lexicon, rng);
  const nxt = next ?? drawLauncher(b, lexicon, rng, cur);
  return {
    lexicon,
    levels: [...levels],
    seed: rng.state,
    board: b,
    current: cur,
    next: nxt,
    drawn: [current == null && cur, next == null && nxt].filter(Boolean),
    score,
    round,
    streak: 0,
    combo: 1,
    misses: 0,
    history: [],
    over: false,
  };
}

export const swap = (game) => ({ ...game, current: game.next, next: game.current, drawn: [] });

export function shoot(game, angleDeg) {
  if (game.over) return { game, events: null };
  const { path, cell } = aim(game, angleDeg);
  const result = resolveShot(game, cell);
  result.events.path = path;
  return result;
}

// Everything after the current bubble settles into `cell`, in spec order:
// words, pop, fall, score, round clear, ceiling, game over.
export function resolveShot(game, cell) {
  if (game.over) return { game, events: null };
  const lex = game.lexicon;
  const rng = makeRng(game.seed);
  let board = put(game.board, cell, game.current);
  const words = findWords(board, cell, lex);

  const length = new Map();
  for (const w of words) {
    for (const x of w.cells) length.set(key(x), Math.max(length.get(key(x)) ?? 0, [...w.word].length));
  }
  const popped = [...length.keys()].map((k) => {
    const [r, c] = k.split(",").map(Number);
    return { r, c, ch: at(board, { r, c }) };
  });
  board = removeCells(board, popped);
  const drop = popped.length ? fallen(board) : [];
  board = removeCells(board, drop);

  const streak = popped.length ? game.streak + 1 : 0;
  const combo = Math.min(Math.max(streak, 1), 5);
  const popPoints = [...length.values()].reduce((sum, n) => sum + 100 * n, 0);
  const fallPoints = drop.length * 50 * 2 ** Math.floor(drop.length / 5);
  const points = (popPoints + fallPoints) * combo;
  let score = game.score + points;
  let misses = popped.length ? 0 : game.misses + 1;
  let round = game.round;
  let roundClear = null;
  let ceiling = false;

  if (!cells(board).length) {
    roundClear = { round, bonus: 1000 * round };
    score += roundClear.bonus;
    round += 1;
    misses = 0;
    board = buildBoard(lex, roundRows(round), rng);
  } else if (misses >= roundShots(round)) {
    board = ceilingDrop(board, lex, rng);
    ceiling = true;
    misses = 0;
  }
  const over = lowestRow(board) >= LINE_ROW;

  let current = game.next;
  let next;
  let drawn;
  if (roundClear) {
    current = drawLauncher(board, lex, rng);
    next = drawLauncher(board, lex, rng, current);
    drawn = [current, next];
  } else {
    next = over ? null : drawLauncher(board, lex, rng, current);
    drawn = [next];
  }

  const names = words.map((w) => w.word);
  const history = [...names, ...game.history.filter((w) => !names.includes(w))];
  const after = {
    ...game,
    seed: rng.state,
    board,
    current,
    next,
    drawn,
    score,
    round,
    streak,
    combo: popped.length ? combo : 1,
    misses,
    history,
    over,
  };
  return {
    game: after,
    events: {
      path: null,
      settled: { ...cell, ch: game.current },
      words,
      popped,
      fallen: drop,
      points,
      combo,
      score,
      roundClear,
      ceilingDrop: ceiling,
      gameOver: over,
    },
  };
}

// ---- Pronunciation (spec #feel-say): a recording from the site, else a
// Taiwan Mandarin voice on the device, else silence. Voices that send text off
// the device (localService false) are never chosen.

const TAIWAN = /^zh[-_](hant[-_])?tw$/i;

export function pronunciation(found, on, voices) {
  if (!on) return null;
  const rec = found.entries.find((e) => e.audio)?.audio;
  if (rec) return { src: `../${rec}` };
  const voice = (voices || []).find((v) => v.localService === true && TAIWAN.test(v.lang || ""));
  return voice ? { voice, text: found.word } : null;
}

// ---- Character lookup (spec #rule-inspect): the shared character table, one
// read path with words.

export function charReadings(ch, chars) {
  return chars[ch].readings.map((_, reading) => wordReading({ trad: ch, reading }, chars));
}
