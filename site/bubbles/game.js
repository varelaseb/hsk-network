// HSK bubbles game page (docs/specs/hsk-bubbles.spec.html, Screens and feel).
// Owns screens, aiming, drawing and animation, word cards, pronunciation
// playback, effect sounds and vibration, settings, and best score. All game rules come from rules.js.
// Address options: ?fixture=pop|fall|clear|over starts Play on a fixed board,
// ?seed=N fixes the seed.

import {
  COLS, ROW_H, LINE_ROW, LINE_Y, LAUNCHER, HEIGHT, MIN_ANGLE, MAX_ANGLE,
  createGame, aim, shoot, swap, center, cells, lowestRow, roundShots, parseBoard, pronunciation,
} from "./rules.js";

// ---- Fixtures for acceptance checks (HSK 1 and 2 words from graph.json).

const FILLER = ["杯北不出打腦視影", "出打腦視影東多", "視影東多杯北不出", "多杯北不出打腦", "不出打腦視影東多", "腦視影東多杯北",
  "東多杯北不出打腦", "北不出打腦視影", "打腦視影東多杯北", "影東多杯北不出", "杯北不出打腦視影", "出打腦學影東多"];
const FIXTURES = {
  pop: { rows: ["中國喜歡火車站.", "..學...."], current: "生", next: "中" },
  fall: { rows: ["中國喜歡火車站.", "..學....", "...校....", "...杯子.."], current: "生", next: "中" },
  clear: { rows: ["...學...."], current: "生", next: "學" },
  over: { rows: FILLER, current: "生", next: "兒" },
};

// ---- Settings, remembered on this device only.

const STORE = "hskBubbles";
const settings = Object.assign({ best: 0, levels: [1, 2], say: true, sound: false, hinted: false }, readStore());
function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
function saveStore() {
  try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch { /* storage off: settings last this visit */ }
}

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const app = $("app");
const canvas = $("board");
const ctx = canvas.getContext("2d");
const screens = { start: $("start"), paused: $("paused"), over: $("over") };
const hud = $("hud");
const scoreEl = $("score");
const roundEl = $("round");
const comboEl = $("combo");
const hintEl = $("hint");
const cardEl = $("wcard");
const bannerEl = $("banner");
const playBtn = $("play");
const levelBtns = [...document.querySelectorAll(".level")];
const soundBtns = [...document.querySelectorAll("[data-sound]")];
const sayBtns = [...document.querySelectorAll("[data-say]")];

const params = new URLSearchParams(location.search);
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const coarse = matchMedia("(pointer: coarse)");
const FONT = '"PingFang TC", "Heiti TC", "Noto Sans CJK TC", "Noto Sans TC", "Microsoft JhengHei", "Source Han Sans TC", sans-serif';
const LEVEL_COLOR = { 1: "#0072b2", 2: "#e69f00" };

let words = [];
let demoBoard = null; // still board behind the start screen
let screen = "start";
let game = null;       // rules state after the last shot
let view = null;       // board drawn now: { board, dropFrom, dropAt, dropDur }
let flight = null;     // shot in the air
let busy = false;      // no shooting or swapping while true
let clock = 0;         // game clock in ms, frozen while paused
let shownScore = 0;
let timers = [];
let fx = { pops: [], falls: [], parts: [], popups: [], settle: null, shake: null, swapAt: -1e9 };
const aimer = { on: false, angle: 90, id: null, below: false, mouseDown: false, cancelled: false, swapTap: null };

// ---- Layout: bubble size is the play width divided by COLS.

const L = { w: 0, h: 0, s: 40, ox: 0, oy: 0, dpr: 1 };
let sprites = new Map();
let backdrop = null;

function layout() {
  const r = app.getBoundingClientRect();
  const cs = getComputedStyle(document.documentElement);
  const sat = parseFloat(cs.getPropertyValue("--sat")) || 0;
  const sab = parseFloat(cs.getPropertyValue("--sab")) || 0;
  L.w = r.width;
  L.h = r.height;
  L.dpr = Math.min(window.devicePixelRatio || 1, 3);
  const top = sat + 56;
  const bottom = L.h - sab - 10;
  L.s = Math.max(16, Math.min(L.w / COLS, (bottom - top) / HEIGHT));
  L.ox = (L.w - COLS * L.s) / 2;
  L.oy = Math.max(top, bottom - HEIGHT * L.s - Math.max(0, (bottom - top - HEIGHT * L.s) * 0.7));
  canvas.width = Math.round(L.w * L.dpr);
  canvas.height = Math.round(L.h * L.dpr);
  sprites = new Map();
  backdrop = null;
  cardEl.style.bottom = `${L.h - Y(LINE_Y) + 10}px`;
  hintEl.style.top = `${Y(LAUNCHER.y + 0.75)}px`;
  draw();
}

const X = (x) => L.ox + x * L.s;
const Y = (y) => L.oy + y * L.s;

// One sprite per character, drawn once at device resolution and reused.
function sprite(ch) {
  let img = sprites.get(ch);
  if (img) return img;
  const size = Math.ceil(L.s * L.dpr);
  img = document.createElement("canvas");
  img.width = img.height = size;
  const g = img.getContext("2d");
  const c = size / 2;
  const rad = c * 0.94;
  const body = g.createRadialGradient(c * 0.72, c * 0.6, rad * 0.05, c, c, rad);
  body.addColorStop(0, "#ffffff");
  body.addColorStop(0.45, "#f4efe6");
  body.addColorStop(1, "#c8baa2");
  g.fillStyle = body;
  g.beginPath();
  g.arc(c, c, rad, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = Math.max(1, size * 0.02);
  g.strokeStyle = "rgba(60, 45, 20, .28)";
  g.stroke();
  const shine = g.createRadialGradient(c * 0.68, c * 0.5, 0, c * 0.68, c * 0.5, rad * 0.5);
  shine.addColorStop(0, "rgba(255,255,255,.95)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = shine;
  g.beginPath();
  g.ellipse(c * 0.7, c * 0.52, rad * 0.5, rad * 0.32, -0.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#1c2233";
  g.font = `500 ${Math.round(size * 0.54)}px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(ch, c, c + size * 0.03);
  sprites.set(ch, img);
  return img;
}

function drawBackdrop() {
  const img = document.createElement("canvas");
  img.width = canvas.width;
  img.height = canvas.height;
  const g = img.getContext("2d");
  g.scale(L.dpr, L.dpr);
  // Ceiling slab above row 0.
  const ceil = g.createLinearGradient(0, 0, 0, L.oy);
  ceil.addColorStop(0, "rgba(255,255,255,.02)");
  ceil.addColorStop(1, "rgba(255,255,255,.07)");
  g.fillStyle = ceil;
  g.fillRect(L.ox, 0, COLS * L.s, L.oy);
  g.fillStyle = "rgba(255,255,255,.16)";
  g.fillRect(L.ox, L.oy - 1.5, COLS * L.s, 1.5);
  // Side walls.
  const wall = g.createLinearGradient(0, 0, 0, L.h);
  wall.addColorStop(0, "rgba(140,190,255,.0)");
  wall.addColorStop(0.5, "rgba(140,190,255,.22)");
  wall.addColorStop(1, "rgba(140,190,255,.0)");
  g.fillStyle = wall;
  g.fillRect(L.ox - 1, 0, 1, L.h);
  g.fillRect(L.ox + COLS * L.s, 0, 1, L.h);
  // Launcher pad.
  const pad = g.createRadialGradient(X(LAUNCHER.x), Y(LAUNCHER.y), L.s * 0.3, X(LAUNCHER.x), Y(LAUNCHER.y), L.s * 1.3);
  pad.addColorStop(0, "rgba(120,180,255,.22)");
  pad.addColorStop(1, "rgba(120,180,255,0)");
  g.fillStyle = pad;
  g.fillRect(X(LAUNCHER.x) - L.s * 1.4, Y(LAUNCHER.y) - L.s * 1.4, L.s * 2.8, L.s * 2.8);
  backdrop = img;
}

// ---- Drawing, once per display frame.

const ease = (t) => 1 - (1 - t) ** 3;
const clamp01 = (t) => Math.max(0, Math.min(1, t));

function bubble(ch, x, y, scale = 1, alpha = 1, rot = 0) {
  if (!ch || alpha <= 0) return;
  const d = L.s * scale;
  ctx.globalAlpha = alpha;
  if (rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.drawImage(sprite(ch), -d / 2, -d / 2, d, d);
    ctx.restore();
  } else if (scale === 1) {
    const px = Math.round((x - d / 2) * L.dpr) / L.dpr;
    const py = Math.round((y - d / 2) * L.dpr) / L.dpr;
    ctx.drawImage(sprite(ch), px, py, d, d);
  } else {
    ctx.drawImage(sprite(ch), x - d / 2, y - d / 2, d, d);
  }
  ctx.globalAlpha = 1;
}

function draw() {
  if (!L.w) return;
  if (!backdrop) drawBackdrop();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(backdrop, 0, 0);
  ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  if (!view) return;

  if (fx.shake) {
    const t = (clock - fx.shake.at) / 260;
    if (t >= 1) fx.shake = null;
    else ctx.translate(Math.sin(clock * 0.09) * L.s * 0.08 * (1 - t), Math.cos(clock * 0.11) * L.s * 0.06 * (1 - t));
  }

  drawLine();

  // Board, sliding down after a ceiling drop or in at a new round.
  let dy = 0;
  if (view.dropAt != null) {
    const t = clamp01((clock - view.dropAt) / view.dropDur);
    dy = view.dropFrom * (1 - ease(t)) * L.s;
    if (t >= 1) view.dropAt = null;
  }
  for (const b of cells(view.board)) {
    const p = center(view.board, b);
    let scale = 1;
    if (fx.settle && fx.settle.r === b.r && fx.settle.c === b.c) {
      const t = (clock - fx.settle.at) / 320;
      if (t >= 1) fx.settle = null;
      else scale = 1 + 0.1 * Math.sin(t * Math.PI * 2.2) * (1 - t);
    }
    bubble(b.ch, X(p.x), Y(p.y) + dy, scale);
  }

  drawPops();
  if (game && !flight && aimer.on && !aimer.below && !aimer.cancelled && screen === "playing" && !busy) drawGuide();
  drawLauncher();
  if (flight) drawFlight();
  drawFalls();
  drawParticles();
  drawPopups();
}

function drawLine() {
  const y = Y(LINE_Y);
  const danger = view && lowestRow(view.board) === LINE_ROW - 1;
  ctx.save();
  ctx.setLineDash([L.s * 0.18, L.s * 0.14]);
  ctx.lineWidth = 2;
  if (danger) {
    const pulse = reduced.matches ? 1 : 0.65 + 0.35 * Math.sin(clock / 160);
    ctx.strokeStyle = `rgba(255, 93, 93, ${0.6 + 0.4 * pulse})`;
    ctx.shadowColor = "rgba(255, 70, 70, .9)";
    ctx.shadowBlur = 14 * pulse;
    ctx.lineWidth = 3;
  } else {
    ctx.strokeStyle = "rgba(255,255,255,.22)";
  }
  ctx.beginPath();
  ctx.moveTo(X(0), y);
  ctx.lineTo(X(COLS), y);
  ctx.stroke();
  ctx.restore();
}

function drawGuide() {
  const g = aim({ board: game.board }, aimer.angle);
  const step = 0.42;
  const phase = reduced.matches ? 0 : (clock / 1000) * 1.6 % step;
  let along = 0;
  let total = 0;
  for (let i = 1; i < g.path.length; i++) total += Math.hypot(g.path[i].x - g.path[i - 1].x, g.path[i].y - g.path[i - 1].y);
  ctx.fillStyle = "#fff";
  for (let i = 1; i < g.path.length; i++) {
    const a = g.path[i - 1];
    const b = g.path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let d = (step - ((along - phase) % step + step) % step) % step;
    for (; d <= len; d += step) {
      const k = d / len;
      const at = along + d;
      if (at < 0.75) continue;
      ctx.globalAlpha = 0.95 - 0.6 * (at / total);
      ctx.beginPath();
      ctx.arc(X(a.x + (b.x - a.x) * k), Y(a.y + (b.y - a.y) * k), L.s * 0.065, 0, Math.PI * 2);
      ctx.fill();
    }
    along += len;
  }
  ctx.globalAlpha = 1;
  if (g.cell) {
    const p = center(game.board, g.cell);
    ctx.save();
    ctx.setLineDash([L.s * 0.1, L.s * 0.08]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,255,255,.55)";
    ctx.beginPath();
    ctx.arc(X(p.x), Y(p.y), L.s * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

const NEXT = { x: LAUNCHER.x + 1.5, y: LAUNCHER.y + 0.3, scale: 0.68 };

function drawLauncher() {
  if (!game) return;
  const lx = X(LAUNCHER.x);
  const ly = Y(LAUNCHER.y);
  // Ring.
  ctx.save();
  ctx.strokeStyle = "rgba(160, 205, 255, .45)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(lx, ly, L.s * 0.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  // Shots left before the ceiling drops.
  const left = roundShots(game.round) - game.misses;
  const total = roundShots(game.round);
  for (let i = 0; i < total; i++) {
    const x = X(LAUNCHER.x - 1.35 - i * 0.24);
    ctx.fillStyle = i < left ? (left <= 1 ? "#ff7a59" : "rgba(255,255,255,.75)") : "rgba(255,255,255,.16)";
    ctx.beginPath();
    ctx.arc(x, Y(LAUNCHER.y + 0.3), L.s * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  // Swap: current and next trade places.
  const t = reduced.matches ? 1 : ease(clamp01((clock - fx.swapAt) / 200));
  const nx = X(NEXT.x);
  const ny = Y(NEXT.y);
  const lerp = (a, b) => a + (b - a) * t;
  const arc = Math.sin(t * Math.PI) * L.s * 0.5;
  if (game.next) bubble(game.next, lerp(lx, nx), lerp(ly, ny) + arc, lerp(1, NEXT.scale), 0.92);
  if (game.current) bubble(game.current, lerp(nx, lx), lerp(ny, ly) - arc, lerp(NEXT.scale, 1));
}

function drawFlight() {
  const t = clamp01((clock - flight.at) / flight.dur);
  let d = flight.total * t;
  const pts = flight.path;
  let x = pts[pts.length - 1].x;
  let y = pts[pts.length - 1].y;
  for (let i = 1; i < pts.length; i++) {
    const len = flight.lens[i - 1];
    if (d <= len) {
      const k = len ? d / len : 1;
      x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k;
      y = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k;
      break;
    }
    d -= len;
  }
  if (!reduced.matches) {
    ctx.fillStyle = "rgba(160, 210, 255, .25)";
    ctx.beginPath();
    ctx.arc(X(x), Y(y), L.s * 0.56, 0, Math.PI * 2);
    ctx.fill();
  }
  bubble(flight.ch, X(x), Y(y));
}

function drawPops() {
  fx.pops = fx.pops.filter((p) => clock - p.at < 260);
  for (const p of fx.pops) {
    const t = (clock - p.at) / 240;
    if (t < 0) { bubble(p.ch, X(p.x), Y(p.y)); continue; }
    if (reduced.matches) { bubble(p.ch, X(p.x), Y(p.y), 1, 1 - clamp01(t)); continue; }
    bubble(p.ch, X(p.x), Y(p.y), 1 + 0.3 * ease(clamp01(t)), 1 - clamp01(t));
    ctx.save();
    ctx.globalAlpha = 1 - clamp01(t);
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 3 * (1 - clamp01(t)) + 0.5;
    ctx.beginPath();
    ctx.arc(X(p.x), Y(p.y), L.s * (0.45 + 0.5 * ease(clamp01(t))), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawFalls() {
  const dt = frameDt / 1000;
  const floor = (L.h - L.oy) / L.s + 1;
  fx.falls = fx.falls.filter((f) => (reduced.matches ? clock - f.at < 320 : f.y < floor));
  for (const f of fx.falls) {
    if (clock < f.at) { bubble(f.ch, X(f.x), Y(f.y)); continue; }
    if (reduced.matches) { bubble(f.ch, X(f.x), Y(f.y), 1, 1 - clamp01((clock - f.at) / 300)); continue; }
    f.vy += 40 * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.rot += f.vr * dt;
    bubble(f.ch, X(f.x), Y(f.y), 1, 1, f.rot);
  }
}

function drawParticles() {
  const dt = frameDt / 1000;
  fx.parts = fx.parts.filter((p) => clock - p.at < p.life);
  for (const p of fx.parts) {
    if (clock < p.at) continue;
    const t = (clock - p.at) / p.life;
    p.vy += 9 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(X(p.x), Y(p.y), L.s * p.size * (1 - t * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPopups() {
  fx.popups = fx.popups.filter((p) => clock - p.at < 900);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const p of fx.popups) {
    const t = clamp01((clock - p.at) / 900);
    const rise = reduced.matches ? 0 : ease(t) * 1.1;
    ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    ctx.font = `800 ${Math.round(L.s * 0.48)}px system-ui, sans-serif`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(13,21,38,.7)";
    ctx.strokeText(p.text, X(p.x), Y(p.y - rise));
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, X(p.x), Y(p.y - rise));
  }
  ctx.restore();
}

// ---- Loop: one draw per display frame while playing.

let last = 0;
let frameDt = 16;
let looping = false;

function frame(now) {
  frameDt = Math.min(50, now - (last || now));
  last = now;
  if (screen === "playing") {
    clock += frameDt;
    runTimers();
    tickScore();
    draw();
  }
  if (screen === "playing") requestAnimationFrame(frame);
  else looping = false;
}

function startLoop() {
  if (looping) return;
  looping = true;
  last = 0;
  requestAnimationFrame(frame);
}

function after(ms, fn) {
  timers.push({ at: clock + ms, fn });
}
function runTimers() {
  const due = timers.filter((t) => t.at <= clock);
  if (!due.length) return;
  timers = timers.filter((t) => t.at > clock);
  due.forEach((t) => t.fn());
}

function tickScore() {
  if (!game) return;
  const target = game.score;
  if (shownScore === target) return;
  const diff = target - shownScore;
  shownScore = reduced.matches ? target : shownScore + Math.sign(diff) * Math.max(1, Math.ceil(Math.abs(diff) * Math.min(1, frameDt / 90)));
  if ((diff > 0 && shownScore > target) || (diff < 0 && shownScore < target)) shownScore = target;
  scoreEl.textContent = shownScore.toLocaleString("en-US");
}

function renderHud() {
  roundEl.textContent = `Round ${game.round}`;
  comboEl.hidden = game.combo <= 1;
  comboEl.textContent = `×${game.combo}`;
}

// ---- Screens

function show(name) {
  screen = name;
  for (const [k, node] of Object.entries(screens)) node.hidden = k !== name;
  hud.hidden = !(name === "playing" || name === "paused");
  if (name === "playing") startLoop();
  else draw();
}

function newGame() {
  const name = params.get("fixture");
  const f = FIXTURES[name];
  const seed = Number(params.get("seed")) || (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  game = createGame({
    words,
    levels: settings.levels,
    seed,
    ...(f && { board: parseBoard(f.rows), current: f.current, next: f.next }),
  });
  view = { board: game.board, dropFrom: -(lowestRow(game.board) + 2) * ROW_H, dropAt: reduced.matches ? null : 0, dropDur: 520 };
  flight = null;
  busy = false;
  clock = 0;
  timers = [];
  fx = { pops: [], falls: [], parts: [], popups: [], settle: null, shake: null, swapAt: -1e9 };
  shownScore = 0;
  scoreEl.textContent = "0";
  cards.length = 0;
  hideCard(true);
  bannerEl.hidden = true;
  Object.assign(aimer, { on: false, below: false, mouseDown: false, cancelled: false, swapTap: null });
  hintEl.textContent = coarse.matches ? "Drag to aim, lift to shoot" : "Move to aim, click to shoot";
  hintEl.hidden = settings.hinted;
  renderHud();
  show("playing");
}

function pause() {
  if (screen !== "playing") return;
  aimer.on = false;
  stopSaying();
  show("paused");
  $("resume").focus();
}

function resume() {
  if (screen !== "paused") return;
  show("playing");
}

function recordBest() {
  const beaten = game && game.score > settings.best;
  if (beaten) {
    settings.best = game.score;
    saveStore();
  }
  document.querySelectorAll(".best-score").forEach((n) => (n.textContent = settings.best.toLocaleString("en-US")));
  return beaten;
}

function quit() {
  stopSaying();
  recordBest();
  game = null;
  view = demoBoard && { board: demoBoard, dropAt: null };
  show("start");
  playBtn.focus();
}

function gameOver() {
  const beaten = recordBest();
  $("final-score").textContent = game.score.toLocaleString("en-US");
  $("new-best").hidden = !beaten;
  const list = $("popped-list");
  list.replaceChildren();
  for (const word of game.history) {
    const entries = game.lexicon.entries.get(word) || [];
    const first = entries[0];
    const li = el("li");
    // Opens the network page focused on the word (hsk-network spec #page-word-link).
    const row = el("a", `pw l${first ? first.level : 1}`);
    if (first) row.href = `../#word=${encodeURIComponent(first.id)}`;
    row.lang = "zh-Hant";
    row.append(el("span", "p-trad", word));
    row.append(el("span", "p-zy", entries.map((e) => e.zhuyin).filter(uniq).join(" / ")));
    const def = el("span", "p-def", first ? first.defs[0] || "" : "");
    def.lang = "en";
    row.append(def);
    li.append(row);
    list.append(li);
  }
  if (!game.history.length) list.append(el("li", "empty", "No words this time."));
  show("over");
  $("again").focus();
}

function uniq(v, i, a) {
  return a.indexOf(v) === i;
}

// ---- Word cards: one after another, longest word first; the last one
// stays until the learner's next shot.

const cards = [];
let cardShowing = false;
let cardResting = false; // latest card shown, waiting for the next shot
let cardGen = 0;

function queueCards(found) {
  cards.push(...found);
  if (!cardShowing || cardResting) nextCard();
}

function nextCard() {
  const w = cards.shift();
  if (!w) { hideCard(); return; }
  cardShowing = true;
  cardResting = false;
  cardGen++;
  const levels = w.entries.map((e) => e.level).filter(uniq);
  cardEl.className = `wcard l${levels[0]}`;
  cardEl.replaceChildren();
  const head = el("div", "k-head");
  const trad = el("span", "k-trad", w.word);
  trad.lang = "zh-Hant";
  head.append(trad);
  for (const lv of levels) {
    const tag = el("span", "c-level");
    tag.append(el("span", `swatch l${lv}`), `HSK ${lv}`);
    head.append(tag);
  }
  cardEl.append(head);
  // One reading per entry sharing this Traditional form.
  for (const e of w.entries) {
    const line = el("div", "k-reading");
    const zy = el("span", "k-zy", e.zhuyin);
    zy.lang = "zh-Hant";
    line.append(zy, el("span", "k-def", e.defs[0] || ""));
    cardEl.append(line);
  }
  cardEl.hidden = false;
  say(w);
  if (!cards.length) { cardResting = true; return; }
  after(1300, () => {
    cardEl.classList.add("out");
    after(220, nextCard);
  });
}

function hideCard(now) {
  cardShowing = false;
  cardResting = false;
  if (now || !cards.length) cardEl.hidden = true;
}

// The next shot fades out a resting card; a card sequence still running plays on.
function dismissCard() {
  if (!cardResting) return;
  cardShowing = false;
  cardResting = false;
  cardEl.classList.add("out");
  const gen = ++cardGen;
  after(220, () => { if (gen === cardGen) cardEl.hidden = true; });
}

// ---- Shooting

function fire(angle) {
  if (busy || !game || game.over || screen !== "playing") return;
  const before = game;
  const { game: next, events } = shoot(game, angle);
  if (!events) return;
  if (!settings.hinted) {
    settings.hinted = true;
    saveStore();
    hintEl.hidden = true;
  }
  const lens = [];
  for (let i = 1; i < events.path.length; i++) {
    lens.push(Math.hypot(events.path[i].x - events.path[i - 1].x, events.path[i].y - events.path[i - 1].y));
  }
  const total = lens.reduce((a, b) => a + b, 0);
  flight = { path: events.path, lens, total, ch: before.current, at: clock, dur: Math.max(120, (total / 30) * 1000), before, events };
  game = next;
  fx.swapAt = -1e9;
  busy = true;
  dismissCard();
  aimer.on = aimer.on && !coarse.matches;
  sfx("shoot");
  after(flight.dur, land);
}

function land() {
  const { before, events } = flight;
  flight = null;
  const removed = new Set([...events.popped, ...events.fallen].map((c) => `${c.r},${c.c}`));
  const landed = putCell(before.board, events.settled);
  const settledAt = center(landed, events.settled);

  if (!events.popped.length) {
    fx.settle = reduced.matches ? null : { r: events.settled.r + (events.ceilingDrop ? 1 : 0), c: events.settled.c, at: clock };
    sfx("land");
  }

  // Pops: each word's bubbles in reading order, a beat apart.
  const popColor = new Map();
  let delay = 0;
  const seen = new Set();
  for (const w of events.words) {
    const color = LEVEL_COLOR[w.entries[0].level] || LEVEL_COLOR[1];
    for (const cell of w.cells) {
      const k = `${cell.r},${cell.c}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const p = center(landed, cell);
      fx.pops.push({ ch: landed.rows[cell.r][cell.c], x: p.x, y: p.y, at: clock + delay, color });
      popColor.set(k, color);
      if (!reduced.matches) {
        for (let i = 0; i < 7; i++) {
          const a = Math.random() * Math.PI * 2;
          const v = 2.5 + Math.random() * 3.5;
          fx.parts.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, at: clock + delay, life: 420 + Math.random() * 200,
            size: 0.05 + Math.random() * 0.07, color: i % 2 ? color : "#fff4dc" });
        }
      }
      const d = delay;
      after(d, () => sfx("pop", seen.size, d));
      delay += 70;
    }
  }
  const popEnd = delay + 120;

  // Falls: dropped once the pops finish.
  for (const cell of events.fallen) {
    const p = center(landed, cell);
    fx.falls.push({ ch: cell.ch, x: p.x, y: p.y, vx: (Math.random() - 0.5) * 2.4, vy: -1 - Math.random() * 1.5, rot: 0, vr: (Math.random() - 0.5) * 7, at: clock + popEnd });
  }
  if (events.fallen.length) after(popEnd, () => sfx("fall"));

  if (events.popped.length) {
    if (!reduced.matches) fx.shake = { at: clock };
    vibrate(events.fallen.length ? [18, 40, 28] : 18);
    fx.popups.push({ text: `+${events.points.toLocaleString("en-US")}${events.combo > 1 ? ` ×${events.combo}` : ""}`, x: settledAt.x, y: settledAt.y, at: clock + 60,
      color: events.combo > 1 ? "#ffd166" : "#ffffff" });
    queueCards(events.words);
  }

  renderHud();
  if (events.roundClear) {
    view = { board: removeAll(landed, removed), dropAt: null };
    after(popEnd + 260, () => {
      bannerEl.replaceChildren(el("div", "b-title", `Round ${events.roundClear.round} clear`), el("div", "b-bonus", `+${events.roundClear.bonus.toLocaleString("en-US")}`));
      bannerEl.hidden = false;
      sfx("clear");
      vibrate([30, 60, 30]);
      after(1500, () => {
        bannerEl.hidden = true;
        view = { board: game.board, dropFrom: -(lowestRow(game.board) + 2) * ROW_H, dropAt: reduced.matches ? null : clock, dropDur: 520 };
        busy = false;
      });
    });
    return;
  }
  view = events.ceilingDrop
    ? { board: game.board, dropFrom: -ROW_H, dropAt: reduced.matches ? null : clock, dropDur: 360 }
    : { board: game.board, dropAt: null };
  if (events.ceilingDrop) sfx("drop");
  if (events.gameOver) {
    sfx("over");
    vibrate([60, 80, 120]);
    after(Math.max(popEnd, 400) + 600, gameOver);
    return;
  }
  busy = false;
}

function putCell(board, { r, c, ch }) {
  const rows = board.rows.map((row) => [...row]);
  const width = (r2) => ((r2 + board.shift) & 1 ? COLS - 1 : COLS);
  while (rows.length <= r) rows.push(new Array(width(rows.length)).fill(null));
  rows[r][c] = ch;
  return { shift: board.shift, rows };
}

function removeAll(board, keys) {
  return { shift: board.shift, rows: board.rows.map((row, r) => row.map((ch, c) => (keys.has(`${r},${c}`) ? null : ch))) };
}

function doSwap() {
  if (!game || flight || busy || screen !== "playing" || !game.next) return;
  game = swap(game);
  fx.swapAt = clock;
  sfx("swap");
}

// ---- Input: press and drag to aim, lift to shoot; mouse hovers to aim.

function toUnits(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left - L.ox) / L.s, y: (e.clientY - r.top - L.oy) / L.s };
}

function setAngle(p) {
  const dx = p.x - LAUNCHER.x;
  const dy = LAUNCHER.y - p.y;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  aimer.angle = Math.min(MAX_ANGLE, Math.max(MIN_ANGLE, deg));
  aimer.below = p.y > LAUNCHER.y;
}

const onLauncher = (p) => Math.hypot(p.x - LAUNCHER.x, p.y - LAUNCHER.y) < 0.75 || Math.hypot(p.x - NEXT.x, p.y - NEXT.y) < 0.6;

canvas.addEventListener("pointerdown", (e) => {
  if (screen !== "playing") return;
  e.preventDefault();
  const p = toUnits(e);
  aimer.cancelled = false;
  if (onLauncher(p)) {
    aimer.swapTap = { id: e.pointerId, x: p.x, y: p.y };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (p.y > LAUNCHER.y) return;
  if (e.pointerType === "mouse") {
    if (e.button !== 0) return;
    aimer.mouseDown = true;
    aimer.on = true;
    setAngle(p);
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  aimer.id = e.pointerId;
  aimer.on = true;
  setAngle(p);
});

canvas.addEventListener("pointermove", (e) => {
  if (screen !== "playing") return;
  const p = toUnits(e);
  const tap = aimer.swapTap;
  if (tap && tap.id === e.pointerId) {
    // Dragging up off the launcher turns the press into aiming.
    if (tap.y - p.y > 0.6 && e.pointerType !== "mouse") {
      aimer.swapTap = null;
      aimer.id = e.pointerId;
      aimer.on = true;
      setAngle(p);
    }
    return;
  }
  if (e.pointerType === "mouse") {
    if (!e.buttons) aimer.cancelled = false;
    aimer.on = p.y <= LAUNCHER.y && !onLauncher(p);
    if (aimer.on) setAngle(p);
    return;
  }
  if (aimer.id === e.pointerId) setAngle(p);
});

canvas.addEventListener("pointerup", (e) => {
  if (screen !== "playing") return;
  const p = toUnits(e);
  const tap = aimer.swapTap;
  if (tap && tap.id === e.pointerId) {
    aimer.swapTap = null;
    if (Math.hypot(p.x - tap.x, p.y - tap.y) < 0.6) doSwap();
    return;
  }
  if (e.pointerType === "mouse") {
    const shot = aimer.mouseDown && !aimer.cancelled && p.y <= LAUNCHER.y;
    aimer.mouseDown = false;
    aimer.cancelled = false;
    if (shot) {
      setAngle(p);
      fire(aimer.angle);
    }
    return;
  }
  if (aimer.id !== e.pointerId) return;
  aimer.id = null;
  aimer.on = false;
  setAngle(p);
  // Lifting below the launcher line cancels the shot.
  if (!aimer.below && !aimer.cancelled) fire(aimer.angle);
  aimer.cancelled = false;
});

canvas.addEventListener("pointercancel", (e) => {
  if (aimer.id === e.pointerId) aimer.id = null;
  aimer.on = false;
  aimer.swapTap = null;
  aimer.mouseDown = false;
});
canvas.addEventListener("pointerleave", (e) => {
  if (e.pointerType === "mouse") aimer.on = false;
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

document.addEventListener("keydown", (e) => {
  if (screen === "playing") {
    if (e.key === "Escape") {
      aimer.cancelled = true;
      aimer.on = false;
    } else if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      doSwap();
    } else if (e.key === "p" || e.key === "P") {
      pause();
    }
  } else if (screen === "paused" && (e.key === "p" || e.key === "P" || e.key === "Escape")) {
    resume();
  }
});

// Leaving the app or tab pauses.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});
window.addEventListener("pagehide", pause);

// Double-tap zoom and pinch: blocked across the game.
document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("touchmove", (e) => {
  if (!e.target.closest(".sheet")) e.preventDefault();
}, { passive: false });

// ---- Pronunciation: on at first; each popped word is said as its card shows.

const voiceEl = new Audio();
const speech = window.speechSynthesis || null;

function say(found) {
  const how = pronunciation(found, settings.say, speech ? speech.getVoices() : []);
  if (!how) return;
  if (how.src) {
    voiceEl.src = how.src;
    voiceEl.muted = false;
    voiceEl.play().catch(() => { /* blocked or missing: stay silent */ });
    return;
  }
  const u = new SpeechSynthesisUtterance(how.text);
  u.voice = how.voice;
  u.lang = how.voice.lang;
  speech.speak(u);
}

function stopSaying() {
  voiceEl.pause();
  if (speech) speech.cancel();
}

// Phone browsers play later sound only from a player a tap has started, so
// the Play tap starts the recording player muted and wakes the device voice.
let unlocked = false;
function unlockSay() {
  if (unlocked || !settings.say) return;
  unlocked = true;
  const any = words.find((w) => w.audio);
  if (any) {
    voiceEl.src = `../${any.audio}`;
    voiceEl.muted = true;
    voiceEl.play().then(() => { if (voiceEl.muted) voiceEl.pause(); }, () => {}).finally(() => { voiceEl.muted = false; });
  }
  if (speech) speech.speak(new SpeechSynthesisUtterance(""));
}

function renderSay() {
  for (const b of sayBtns) {
    b.setAttribute("aria-checked", settings.say ? "true" : "false");
    b.querySelector(".sound-state").textContent = settings.say ? "Voice on" : "Voice off";
    b.title = settings.say ? "Pronunciation on" : "Pronunciation off";
  }
}

sayBtns.forEach((b) => b.addEventListener("click", () => {
  settings.say = !settings.say;
  saveStore();
  renderSay();
  if (settings.say) unlockSay();
  else stopSaying();
}));

// ---- Effects (sounds and vibration): off until the learner turns them on.

let audio = null;

function sfx(kind, n = 1) {
  if (!settings.sound) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
  } catch { return; }
  const t = audio.currentTime + 0.005;
  const tone = (freq, dur, type = "sine", gain = 0.12, to = null, start = t) => {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (to) o.frequency.exponentialRampToValueAtTime(to, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(audio.destination);
    o.start(start);
    o.stop(start + dur + 0.02);
  };
  const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];
  switch (kind) {
    case "shoot": tone(380, 0.12, "triangle", 0.08, 760); break;
    case "land": tone(180, 0.08, "sine", 0.1, 120); break;
    case "swap": tone(600, 0.06, "sine", 0.06, 900); break;
    case "pop": tone(scale[Math.min(n - 1, scale.length - 1)], 0.16, "sine", 0.14); tone(scale[Math.min(n - 1, scale.length - 1)] * 2, 0.08, "triangle", 0.04); break;
    case "fall": tone(700, 0.35, "sine", 0.07, 220); break;
    case "drop": tone(140, 0.25, "square", 0.04, 90); break;
    case "clear": [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.22, "triangle", 0.1, null, t + i * 0.09)); break;
    case "over": [392, 329.63, 261.63].forEach((f, i) => tone(f, 0.32, "triangle", 0.1, null, t + i * 0.16)); break;
    default: break;
  }
}

function vibrate(pattern) {
  if (settings.sound && navigator.vibrate) navigator.vibrate(pattern);
}

function renderSound() {
  for (const b of soundBtns) {
    b.setAttribute("aria-checked", settings.sound ? "true" : "false");
    b.querySelector(".sound-state").textContent = settings.sound ? "Effects on" : "Effects off";
    b.title = settings.sound ? "Effects on: sounds and vibration" : "Effects off: sounds and vibration";
  }
}

soundBtns.forEach((b) => b.addEventListener("click", () => {
  settings.sound = !settings.sound;
  saveStore();
  renderSound();
  sfx("swap");
}));

// ---- Level switches: the last one on cannot switch off.

function renderLevels() {
  for (const b of levelBtns) {
    const on = settings.levels.includes(Number(b.dataset.level));
    b.setAttribute("aria-checked", on ? "true" : "false");
    b.setAttribute("aria-disabled", on && settings.levels.length === 1 ? "true" : "false");
  }
}

levelBtns.forEach((b) => b.addEventListener("click", () => {
  const lv = Number(b.dataset.level);
  if (settings.levels.includes(lv)) {
    if (settings.levels.length === 1) return;
    settings.levels = settings.levels.filter((x) => x !== lv);
  } else {
    settings.levels = [...settings.levels, lv].sort();
  }
  saveStore();
  renderLevels();
}));

// ---- Buttons

playBtn.addEventListener("click", () => { unlockSay(); newGame(); });
$("again").addEventListener("click", () => { unlockSay(); newGame(); });
$("pause").addEventListener("click", pause);
$("resume").addEventListener("click", resume);
$("quit").addEventListener("click", quit);

// ---- Start

settings.levels = [1, 2].filter((x) => settings.levels.includes(x));
if (!settings.levels.length) settings.levels = [1, 2];
renderLevels();
renderSound();
renderSay();
recordBest();
new ResizeObserver(layout).observe(app);
if (window.visualViewport) visualViewport.addEventListener("resize", layout);

fetch("../data/graph.json")
  .then((r) => r.json())
  .then((data) => {
    words = data.words;
    $("cedict-release").textContent = data.meta?.cedictRelease || "(unknown)";
    playBtn.disabled = false;
    playBtn.textContent = "Play";
    // A still board behind the start screen.
    demoBoard = createGame({ words, levels: [1, 2], seed: 20261006 }).board;
    view = { board: demoBoard, dropAt: null };
    draw();
  })
  .catch(() => {
    playBtn.textContent = "Could not load words";
  });
