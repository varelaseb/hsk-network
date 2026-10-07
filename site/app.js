/* HSK network site: renders site/data/graph.json with the vendored D3 v7 (global d3).
   Holds no dictionary logic; everything shown comes from the data file, and every
   sense, reading, and headword is rendered by the shared senses.js module
   (spec hsk-network #sense-render). Loaded as a module, after d3. */
import {
  MODES, DEFAULT_MODE, renderSense, renderMeasureWords, renderReading,
  wordLabel, charLabel, textOf, hanLang,
} from "./senses.js";
import { pieceNode, appendPieces, headwordNode } from "./headword.js";

const MAX_RESULTS = 20;
const FOCUS_SCALE = 2.4;
const WORD_FONT = 14;
const WORD_H = 22;
const HUB_R = 9;
// Script setting, shared with the game (#default-script-setting).
const SCRIPT_KEY = "hskScript";
const SCRIPT_LABEL = { zhuyin: "Zhuyin", pinyin: "Pinyin" };
// Part colors by place in the Parts row, named for assistive technology; the colors
// themselves are style.css --part-1.. (#strokes-colors).
const PART_NAMES = ["vermillion", "bluish green", "reddish purple"];
const PLACEHOLDER = { zhuyin: "Search character, Zhuyin, English", pinyin: "Search character, pinyin, English" };

const svg = d3.select("#graph");
const stage = document.getElementById("stage");
const controls = document.getElementById("controls");
const statusEl = document.getElementById("status");
const card = document.getElementById("card");
const input = document.getElementById("search");
const resultsEl = document.getElementById("results");
const scriptBtn = document.getElementById("script");
const levelBtns = Array.from(document.querySelectorAll(".level"));
const sheetQuery = window.matchMedia("(hover: none), (max-width: 600px)");
const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

let words = [], hubs = [], nodes = [], links = [];
let chars = {};             // character table (spec #chars-table)
let drawings = {};          // hub character -> { strokes, parts, radical } (spec #drawing-schema)
const byId = new Map();
const wordHubs = new Map(); // word id -> [hub]
const hubWords = new Map(); // hub id -> [word]
let root, linkSel, nodeSel, zoom, sim;
let pinned = null;          // node whose card is pinned (click, tap, or search)
let hovered = null;         // word node under the mouse
let cardFor = null;         // node the card shows
const levelOn = { 1: true, 2: true };
let shown = new Set();      // ids of visible nodes
let script = readScript();

syncScript();

// The graph data and the drawing data load together (#drawing-file).
Promise.all([fetch("data/graph.json"), fetch("data/drawing.json")].map(function (req) {
  return req.then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  });
}))
  .then(function (files) {
    drawings = files[1].hubs;
    init(files[0], files[1].meta);
  })
  .catch(function (err) {
    statusEl.textContent = "Could not load the word data (" + err.message + ").";
  });

function init(data, drawingMeta) {
  fillSources(Object.assign({}, data.meta, drawingMeta));
  chars = data.chars;
  words = data.words.map(function (w) {
    const n = Object.assign({}, w, wordReading(w, chars), { kind: "word" });
    // Traditional and Simplified forms have equal length, so the pill fits both scripts.
    n.width = textWidth(w.trad) + 14;
    n.key = searchKey(n);
    return n;
  });
  hubs = data.hubs.map(function (h) { return Object.assign({}, h, { kind: "hub" }); });
  nodes = words.concat(hubs);
  nodes.forEach(function (n) { byId.set(n.id, n); });
  links = data.links.map(function (l) {
    const w = byId.get(l.word), h = byId.get(l.hub);
    push(wordHubs, w.id, h);
    push(hubWords, h.id, w);
    return { source: w, target: h };
  });
  hubWords.forEach(function (ws) {
    ws.sort(function (a, b) { return a.level - b.level || cmpId(a.id, b.id); });
  });

  computeShown();
  build();
  statusEl.textContent = "";
  fit();
  // The settled graph fades in (#motion-load).
  requestAnimationFrame(function () { root.classed("in", true); });
  // Text typed while the data loaded gets its results now.
  if (document.activeElement === input) refreshResults();
  openWordLink();
  window.addEventListener("hashchange", openWordLink);
}

// A word's Zhuyin, definitions, and measure words: its own, or for a one-character word,
// those of the reading it names in its character's table entry (spec #chars-words).
function wordReading(w, chars) {
  const r = "reading" in w ? chars[w.trad].readings[w.reading] : w;
  return { zhuyin: r.zhuyin, defs: r.defs, mw: r.mw };
}

// A #word=<id> address focuses that word as picking it in search does (spec #page-word-link).
function openWordLink() {
  const w = linkedWord(location.hash);
  if (w) pick(w);
}

function linkedWord(hash) {
  const m = /^#word=(.+)$/.exec(hash);
  let id = null;
  try { id = m && decodeURIComponent(m[1]); } catch (e) { return null; }
  const d = id && byId.get(id);
  return d && d.kind === "word" ? d : null;
}

function push(map, k, v) {
  if (!map.has(k)) map.set(k, []);
  map.get(k).push(v);
}

function cmpId(a, b) {
  return +a.split("-")[1] - +b.split("-")[1];
}

function textWidth(s) {
  return Array.from(s).length * WORD_FONT;
}

function reduced() {
  return reducedQuery.matches;
}

// ---------- Script setting ----------

// Stored on the device; absent or unknown reads as Zhuyin (#default-script-setting).
function readScript() {
  try {
    const v = localStorage.getItem(SCRIPT_KEY);
    return MODES.includes(v) ? v : DEFAULT_MODE;
  } catch (e) {
    return DEFAULT_MODE;
  }
}

function syncScript() {
  scriptBtn.textContent = SCRIPT_LABEL[script];
  scriptBtn.setAttribute("aria-label", "Script: " + SCRIPT_LABEL[script]);
  scriptBtn.title = "Switch to " + SCRIPT_LABEL[script === "pinyin" ? "zhuyin" : "pinyin"];
  input.placeholder = PLACEHOLDER[script];
}

// Relabels only: nodes, links, and layout stay as they are (#default-script-keys).
function setScript(mode) {
  script = mode;
  try { localStorage.setItem(SCRIPT_KEY, mode); } catch (e) { /* private mode: this visit only */ }
  syncScript();
  if (!nodeSel) return;
  labelNodes();
  if (cardFor && !card.hidden) showCard(cardFor, card.classList.contains("pinned"));
  if (!resultsEl.hidden) refreshResults();
}

scriptBtn.addEventListener("click", function () {
  setScript(script === "pinyin" ? "zhuyin" : "pinyin");
});

function nodeLabel(d) {
  return d.kind === "hub" ? charLabel(d.char, script, chars) : wordLabel(d, script);
}

function labelNodes() {
  root.attr("lang", hanLang(script));
  nodeSel.select("text").text(nodeLabel);
  nodeSel.select("title").text(nodeLabel);
}

// ---------- Graph ----------

function build() {
  const size = stageSize();
  const radius = Math.sqrt(nodes.length) * 18;
  nodes.forEach(function (n, i) {
    // Deterministic phyllotaxis start keeps the layout stable between loads.
    const r = radius * Math.sqrt((i + 0.5) / nodes.length);
    const a = i * Math.PI * (3 - Math.sqrt(5));
    n.x = r * Math.cos(a);
    n.y = r * Math.sin(a);
  });

  sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).distance(function (l) { return 18 + l.source.width / 2; }).strength(0.6))
    .force("charge", d3.forceManyBody().strength(function (n) { return n.kind === "hub" ? -70 : -45; }).distanceMax(400))
    .force("collide", d3.forceCollide(function (n) { return n.kind === "hub" ? HUB_R + 3 : n.width / 2 + 3; }).iterations(2))
    .force("x", d3.forceX(0).strength(0.04))
    .force("y", d3.forceY(0).strength(0.04))
    .stop();
  // Settle before first paint so the initial fit frames the final layout.
  const n = Math.ceil(Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay()));
  for (let i = 0; i < n; i++) sim.tick();

  svg.attr("viewBox", [0, 0, size.w, size.h]);
  root = svg.append("g").attr("class", "graph");
  linkSel = root.append("g").attr("class", "links")
    .selectAll("line").data(links).join("line").attr("class", "link");

  nodeSel = root.append("g").attr("class", "nodes")
    .selectAll("g").data(hubs.concat(words), function (d) { return d.id; }).join("g")
    .attr("class", function (d) { return d.kind === "hub" ? "node hub" : "node word l" + d.level; });

  nodeSel.filter(function (d) { return d.kind === "hub"; })
    .call(function (g) {
      g.append("circle").attr("r", HUB_R);
      g.append("text");
      g.append("title");
    });
  nodeSel.filter(function (d) { return d.kind === "word"; })
    .call(function (g) {
      g.append("rect")
        .attr("x", function (d) { return -d.width / 2; })
        .attr("y", -WORD_H / 2)
        .attr("width", function (d) { return d.width; })
        .attr("height", WORD_H)
        .attr("rx", WORD_H / 2);
      g.append("text");
    });
  labelNodes();

  nodeSel
    .on("pointerenter", function (e, d) {
      if (e.pointerType !== "mouse" || d.kind !== "word") return;
      hovered = d;
      if (!pinned) showCard(d, false);
    })
    .on("pointerleave", function (e, d) {
      if (e.pointerType !== "mouse" || hovered !== d) return;
      hovered = null;
      if (!pinned) hideCard();
    })
    .on("click", function (e, d) {
      e.stopPropagation();
      select(d);
    })
    // Mouse drags nodes through d3-drag. Touch drags are handled in bindTouch so a
    // pinch that starts on a node still reaches d3-zoom with both fingers.
    .call(d3.drag()
      .filter(function (e) { return e.type === "mousedown" && !e.button && !e.ctrlKey; })
      .on("start", function (e) { grab(e.subject); })
      .on("drag", function (e) { moveTo(e.subject, e.x, e.y); })
      .on("end", function (e) { release(e.subject); }));

  applyShown();
  sim.on("tick", draw);
  draw();

  zoom = d3.zoom()
    .filter(function (e) {
      // One finger on a node drags that node instead of panning.
      if (e.type === "touchstart" && e.touches.length === 1 && nodeAt(e.target)) return false;
      return (!e.ctrlKey || e.type === "wheel") && !e.button;
    })
    .on("zoom", function (e) {
      root.attr("transform", e.transform);
      if (cardFor) placeCard(cardFor);
    });
  svg.call(zoom).on("dblclick.zoom", null);
  bindTouch();
  svg.on("click", function (e) {
    if (e.defaultPrevented) return;
    clearSelection();
  });

  window.addEventListener("resize", debounce(function () {
    const s = stageSize();
    svg.attr("viewBox", [0, 0, s.w, s.h]);
    fit();
  }, 150));
}

function nodeAt(target) {
  const g = target && target.closest ? target.closest(".node") : null;
  return g ? d3.select(g).datum() : null;
}

function grab(d) {
  sim.alphaTarget(0.2).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function moveTo(d, x, y) {
  d.fx = x;
  d.fy = y;
}

function release(d) {
  sim.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}

function bindTouch() {
  const el = svg.node();
  const zoomTouchStart = svg.on("touchstart.zoom");
  let drag = null;  // { d, id, x, y, moved } for a one-finger touch that began on a node

  function end() {
    if (drag && drag.moved) release(drag.d);
    drag = null;
  }

  el.addEventListener("touchstart", function (e) {
    if (e.touches.length === 1) {
      const d = nodeAt(e.target), t = e.changedTouches[0];
      drag = d ? { d: d, id: t.identifier, x: t.clientX, y: t.clientY, moved: false } : null;
      return;
    }
    if (!drag) return;
    // Second finger after one landed on a node: drop the node and start the pinch with both
    // fingers, since d3-zoom only reads changedTouches and never saw the first one.
    end();
    e.stopPropagation();
    zoomTouchStart.call(el, {
      type: "touchstart", target: e.target, view: e.view, ctrlKey: false, button: 0,
      touches: e.touches, changedTouches: e.touches,
      preventDefault: function () { e.preventDefault(); },
      stopImmediatePropagation: function () {},
    });
  }, { capture: true, passive: false });

  el.addEventListener("touchmove", function (e) {
    if (!drag) return;
    const t = Array.from(e.changedTouches).find(function (t) { return t.identifier === drag.id; });
    if (!t) return;
    e.preventDefault();
    if (!drag.moved) {
      if (Math.hypot(t.clientX - drag.x, t.clientY - drag.y) < 6) return;
      drag.moved = true;
      grab(drag.d);
    }
    const p = d3.zoomTransform(el).invert(d3.pointer(t, el));
    moveTo(drag.d, p[0], p[1]);
  }, { capture: true, passive: false });

  function lift(e) {
    if (!drag) return;
    // A moved drag is not a tap: cancel the click the browser would synthesize.
    if (drag.moved && e.cancelable) e.preventDefault();
    end();
  }
  el.addEventListener("touchend", lift, { capture: true, passive: false });
  el.addEventListener("touchcancel", lift, { capture: true });
}

function draw() {
  linkSel
    .attr("x1", function (l) { return l.source.x; })
    .attr("y1", function (l) { return l.source.y; })
    .attr("x2", function (l) { return l.target.x; })
    .attr("y2", function (l) { return l.target.y; });
  nodeSel.attr("transform", function (d) { return "translate(" + d.x + "," + d.y + ")"; });
  if (cardFor) placeCard(cardFor);
}

function stageSize() {
  return { w: stage.clientWidth || 1, h: stage.clientHeight || 1 };
}

// The part of the stage the floating controls and the Sources link leave clear.
function clearArea() {
  const s = stageSize();
  const top = Math.min(controls.getBoundingClientRect().bottom, s.h / 3);
  return { top: top, bottom: s.h - 52, w: s.w, h: s.h };
}

function bounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  nodes.forEach(function (n) {
    if (!shown.has(n.id)) return;
    const hw = n.kind === "hub" ? HUB_R : n.width / 2;
    const hh = n.kind === "hub" ? HUB_R : WORD_H / 2;
    x0 = Math.min(x0, n.x - hw); x1 = Math.max(x1, n.x + hw);
    y0 = Math.min(y0, n.y - hh); y1 = Math.max(y1, n.y + hh);
  });
  return { x0: x0, y0: y0, x1: x1, y1: y1 };
}

function fit() {
  if (!nodes.length) return;
  const a = clearArea(), b = bounds(), pad = 12;
  const k = Math.min((a.w - 2 * pad) / (b.x1 - b.x0), (a.bottom - a.top - 2 * pad) / (b.y1 - b.y0));
  zoom.scaleExtent([Math.min(k, 1) * 0.5, 8]);
  const t = d3.zoomIdentity
    .translate(a.w / 2, (a.top + a.bottom) / 2)
    .scale(k)
    .translate(-(b.x0 + b.x1) / 2, -(b.y0 + b.y1) / 2);
  svg.call(zoom.transform, t);
}

// ---------- Selection and highlight ----------

function select(d) {
  pinned = d;
  showCard(d, true);
  highlight(d);
}

function clearSelection() {
  pinned = null;
  hideCard();
  highlight(null);
}

function highlight(d) {
  // One pass sets every class, so no clearing pass is needed first.
  const lit = new Set(), litHubs = new Set();
  if (d && d.kind === "word") {
    lit.add(d.id);
    (wordHubs.get(d.id) || []).forEach(function (h) {
      litHubs.add(h);
      lit.add(h.id);
      hubWords.get(h.id).forEach(function (w) { lit.add(w.id); });
    });
  } else if (d) {
    litHubs.add(d);
    lit.add(d.id);
    (hubWords.get(d.id) || []).forEach(function (w) { lit.add(w.id); });
  }
  root.classed("dimmed", !!d);
  nodeSel.classed("lit", function (n) { return lit.has(n.id); })
    .classed("focus", function (n) { return n === d; });
  // Every link into a lit hub: the word's own links plus its neighbors' links to shared hubs.
  linkSel.classed("lit", function (l) { return litHubs.has(l.target); });
}

// The view glides to the word while the rest fades back; the card follows once the
// view arrives (#motion-focus). With reduced motion the view jumps at once.
function focusWord(d) {
  const a = clearArea();
  const k = Math.max(FOCUS_SCALE, d3.zoomTransform(svg.node()).k);
  // On phones the bottom sheet covers the lower half, so center above it.
  const cy = sheetQuery.matches ? (a.top + a.h * 0.5) / 2 : (a.top + a.bottom) / 2;
  const t = d3.zoomIdentity.translate(a.w / 2, cy).scale(k).translate(-d.x, -d.y);
  pinned = d;
  highlight(d);
  if (cardFor !== d) hideCard();
  const arrive = function () { if (pinned === d) showCard(d, true); };
  if (reduced()) {
    svg.interrupt().call(zoom.transform, t);
    arrive();
    return;
  }
  svg.transition().duration(550).ease(d3.easeCubicInOut).call(zoom.transform, t)
    .on("end", arrive).on("interrupt", arrive);
}

// ---------- Rendering helpers ----------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function han(text, cls) {
  const s = el("span", cls || "han", text);
  s.lang = hanLang(script);
  return s;
}

// Senses one per line, a tag set apart before its sense, then the measure words line.
function sensesNode(defs, mw) {
  const frag = document.createDocumentFragment();
  const ul = frag.appendChild(el("ul", "c-senses"));
  (defs || []).forEach(function (sense) {
    const r = renderSense(sense, script);
    const li = ul.appendChild(el("li"));
    if (r.tag) li.appendChild(el("span", "c-tag", r.tag));
    appendPieces(li, r.pieces);
  });
  const m = renderMeasureWords(mw, script);
  if (m.length) {
    const p = frag.appendChild(el("p", "c-mw"));
    p.appendChild(el("span", "c-cap", "Measure words"));
    appendPieces(p.appendChild(el("span", "c-mw-list")), m);
  }
  return frag;
}

function firstGloss(defs) {
  return defs && defs.length ? textOf(renderSense(defs[0], script).pieces) : "";
}

function levelTag(level) {
  const p = el("div", "c-level");
  p.appendChild(el("span", "swatch l" + level));
  p.appendChild(document.createTextNode("HSK " + level));
  return p;
}

// ---------- Card ----------

let leaveTimer = 0;

function showCard(d, pin) {
  clearTimeout(leaveTimer);
  cardFor = d;
  card.replaceChildren();
  card.classList.toggle("pinned", pin);
  if (pin) {
    const close = el("button", "c-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", clearSelection);
    card.appendChild(close);
  }
  card.appendChild(el("div", "c-grip")).setAttribute("aria-hidden", "true");
  if (d.kind === "word") {
    card.appendChild(headwordNode(d, script));
    card.appendChild(sensesNode(d.defs, d.mw));
    card.appendChild(levelTag(d.level));
  } else {
    const entry = chars[d.char];
    entry.readings.forEach(function (r) {
      const div = card.appendChild(el("div", "c-reading"));
      div.appendChild(headwordNode({ trad: d.char, simp: entry.simp, pinyin: r.pinyin, zhuyin: r.zhuyin }, script));
      div.appendChild(sensesNode(r.defs, r.mw));
    });
    if (d.radical || d.parts) card.appendChild(breakdown(d));
    const ws = (hubWords.get(d.id) || []).filter(function (w) { return shown.has(w.id); });
    card.appendChild(el("p", "c-cap c-count", ws.length + " words contain this character"));
    const ul = el("ul", "c-words");
    ws.forEach(function (w) {
      const b = el("button");
      b.type = "button";
      b.appendChild(han(wordLabel(w, script), "w-han"));
      b.appendChild(pieceNode(renderReading(w, script))).classList.add("w-reading");
      b.appendChild(el("span", "w-gloss", firstGloss(w.defs)));
      b.appendChild(el("span", "swatch l" + w.level));
      b.addEventListener("click", function () { focusWord(w); });
      ul.appendChild(el("li")).appendChild(b);
    });
    card.appendChild(ul);
  }
  card.scrollTop = 0;
  if (card.hidden) {
    card.hidden = false;
    placeCard(d);
    void card.offsetWidth;  // start the rise from its resting place below
  } else {
    placeCard(d);
  }
  card.classList.add("in");
}

// Radical and Parts rows (spec #page-breakdown), opened by the hub's drawn character
// (#page-strokes). Meaning and reading (of the first reading, when the part is a
// character) come from chars; strokes from the drawing data, always the Traditional form.
function breakdown(d) {
  const dr = drawings[d.char];
  const parts = d.parts || [];
  const color = strokeColors(parts, dr);
  const wrap = el("div", "c-breakdown");
  const draw = wrap.appendChild(drawingNode(d, dr, color));
  const dl = wrap.appendChild(el("dl", "b-rows"));
  let pressed = null;
  // Pressing keeps the button's strokes colored and pales the rest; again clears (#page-strokes-light).
  function press(b, strokes) {
    if (pressed) pressed.setAttribute("aria-pressed", "false");
    pressed = pressed === b ? null : b;
    if (pressed) pressed.setAttribute("aria-pressed", "true");
    const keep = pressed ? new Set(strokes) : null;
    draw.querySelectorAll("path").forEach(function (path) {
      path.classList.toggle("pale", !!keep && !keep.has(+path.dataset.s));
    });
  }
  function button(parent, strokes, colors, radical) {
    const b = parent.appendChild(el("button", "b-btn"));
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    b.appendChild(swatch(colors, radical));
    b.addEventListener("click", function () { press(b, strokes); });
    return b;
  }
  if (d.radical) {
    const r = d.radical, c = chars[r.char];
    dl.appendChild(el("dt", "c-cap", "Radical"));
    const colors = uniq(dr.radical.map(function (s) { return color[s]; }));
    const b = button(dl.appendChild(el("dd")), dr.radical, colors, true);
    b.appendChild(han(charLabel(r.char, script, chars), "b-char"));
    b.appendChild(el("span", "b-num", "#" + r.number));
    if (c.readings) b.appendChild(pieceNode(renderReading(c.readings[0], script)));
    b.appendChild(el("span", "b-mean", c.meaning));
  }
  dl.appendChild(el("dt", "c-cap", "Parts"));
  if (!parts.length) {
    dl.appendChild(el("dd", "b-none", "Not split further"));
    return wrap;
  }
  const ul = dl.appendChild(el("dd")).appendChild(el("ul", "b-parts"));
  parts.forEach(function (p, i) {
    const c = chars[p];
    const b = button(ul.appendChild(el("li")), dr.parts[p], [i], false);
    b.appendChild(han(charLabel(p, script, chars), "b-char"));
    if (c.readings) b.appendChild(pieceNode(renderReading(c.readings[0], script)));
    b.appendChild(el("span", "b-mean", c.meaning));
  });
  return wrap;
}

// Color of each stroke: its part's place in the Parts row, or with no parts the first
// color for the radical's strokes; -1 is the card's ink (#page-strokes-color, #page-strokes-radical).
function strokeColors(parts, dr) {
  const color = dr.strokes.map(function () { return -1; });
  if (parts.length) {
    parts.forEach(function (p, i) { dr.parts[p].forEach(function (s) { color[s] = i; }); });
  } else {
    dr.radical.forEach(function (s) { color[s] = 0; });
  }
  return color;
}

function uniq(xs) {
  return xs.filter(function (x, i) { return xs.indexOf(x) === i; });
}

function svgEl(tag, cls) {
  const e = document.createElementNS(d3.namespaces.svg, tag);
  if (cls) e.setAttribute("class", cls);
  return e;
}

function strokeClass(k) {
  return k < 0 ? "s-ink" : "s-p" + (k + 1);
}

// Every stroke an even round-ended line on the 200-unit grid; the radical's outline band
// sits under all colored strokes (#page-strokes, #page-strokes-radical).
function drawingNode(d, dr, color) {
  const svg = svgEl("svg", "b-draw");
  svg.setAttribute("viewBox", "0 0 200 200");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", drawingName(d, color));
  dr.radical.forEach(function (s) { svg.appendChild(strokePath(dr.strokes[s], s, "s-out")); });
  dr.strokes.forEach(function (path, s) { svg.appendChild(strokePath(path, s, strokeClass(color[s]))); });
  return svg;
}

function strokePath(dAttr, s, cls) {
  const p = svgEl("path", cls);
  p.setAttribute("d", dAttr);
  p.dataset.s = s;
  return p;
}

// Named by its character and its parts in order with their color names (#page-strokes-name).
function drawingName(d, color) {
  const parts = d.parts || [];
  const named = parts.length
    ? parts.map(function (p, i) { return charLabel(p, script, chars) + " " + PART_NAMES[i]; }).join(", ")
    : "not split further";
  const rad = d.radical ? "; radical " + charLabel(d.radical.char, script, chars) + " outlined" +
    (parts.length ? "" : " in " + PART_NAMES[0]) : "";
  return d.char + " drawn: " + named + rad;
}

// A short line drawn like a stroke: one segment per color, outlined for the radical
// (#page-strokes-swatch). The label beside it names the part.
function swatch(colors, radical) {
  const svg = svgEl("svg", "b-sw");
  svg.setAttribute("viewBox", "0 0 28 14");
  svg.setAttribute("aria-hidden", "true");
  const step = 18 / colors.length;
  const seg = colors.map(function (k, i) {
    return "M" + (5 + i * step) + " 7 L" + (5 + (i + 1) * step) + " 7";
  });
  if (radical) seg.forEach(function (p) { svg.appendChild(strokePath(p, -1, "s-out")); });
  seg.forEach(function (p, i) { svg.appendChild(strokePath(p, -1, strokeClass(colors[i]))); });
  return svg;
}

// Fades and sinks away, then empties (#motion-card, #motion-sheet).
function hideCard() {
  if (card.hidden) return;
  cardFor = null;
  card.classList.remove("in");
  clearTimeout(leaveTimer);
  const ms = reduced() ? 120 : sheetQuery.matches ? 260 : 150;
  leaveTimer = setTimeout(function () {
    card.hidden = true;
    card.replaceChildren();
  }, ms);
}

function placeCard(d) {
  if (card.hidden || sheetQuery.matches) return;
  const t = d3.zoomTransform(svg.node());
  const s = stageSize();
  const top0 = clearArea().top + 8;
  const half = (d.kind === "hub" ? HUB_R : d.width / 2) * t.k;
  const px = t.applyX(d.x), py = t.applyY(d.y);
  const cw = card.offsetWidth, ch = card.offsetHeight, gap = 12;
  let left = px + half + gap;
  if (left + cw > s.w - 12) left = px - half - gap - cw;
  left = Math.max(12, Math.min(left, s.w - cw - 12));
  const top = Math.max(top0, Math.min(py - ch / 2, s.h - ch - 12));
  card.style.left = left + "px";
  card.style.top = top + "px";
}

sheetQuery.addEventListener("change", function () {
  card.style.left = card.style.top = "";
  if (cardFor) placeCard(cardFor);
});

// ---------- Level panel ----------

function computeShown() {
  shown = new Set();
  words.forEach(function (w) { if (levelOn[w.level]) shown.add(w.id); });
  // A hub shows only while two or more of its words show.
  hubs.forEach(function (h) {
    const n = (hubWords.get(h.id) || []).filter(function (w) { return shown.has(w.id); }).length;
    if (n >= 2) shown.add(h.id);
  });
}

// Hides nodes in place without touching the simulation, so visible nodes do not jump.
function applyShown() {
  nodeSel.classed("off", function (n) { return !shown.has(n.id); });
  linkSel.classed("off", function (l) { return !shown.has(l.source.id) || !shown.has(l.target.id); });
}

function syncLevels() {
  const on = levelBtns.filter(function (b) { return levelOn[b.dataset.level]; });
  levelBtns.forEach(function (b) {
    b.setAttribute("aria-checked", levelOn[b.dataset.level] ? "true" : "false");
    // The last level that is on cannot be switched off.
    if (on.length === 1 && on[0] === b) b.setAttribute("aria-disabled", "true");
    else b.removeAttribute("aria-disabled");
  });
}

function toggleLevel(level) {
  if (levelOn[level] && levelBtns.filter(function (b) { return levelOn[b.dataset.level]; }).length === 1) return;
  levelOn[level] = !levelOn[level];
  syncLevels();
  computeShown();
  if (!nodeSel) return;
  applyShown();
  if (pinned) {
    if (shown.has(pinned.id)) select(pinned);  // a hub card relists its visible words
    else clearSelection();
  }
  if (hovered && !shown.has(hovered.id)) {
    hovered = null;
    if (!pinned) hideCard();
  }
  if (!resultsEl.hidden) refreshResults();
}

levelBtns.forEach(function (b) {
  b.addEventListener("click", function () { toggleLevel(b.dataset.level); });
});
syncLevels();

// ---------- Search ----------

// Zhuyin match key: tone marks (ˉ ˊ ˇ ˋ ˙) and spaces dropped from query and word alike.
const ZY_TONES = /[ˉˊˇˋ˙\s]/g;
function zhuyinKey(s) {
  return s.replace(ZY_TONES, "");
}

// Pinyin match key: lowercase letters only, so tone marks, tone numbers, spaces, and
// apostrophes drop away and ü (also written u: or v) reads as u.
function pinyinKey(s) {
  return s.normalize("NFD").toLowerCase().replace(/v/g, "u").replace(/[^a-z]/g, "");
}

// English-only search text of a sense (#schema-sense): its plain text parts, so
// references (Han forms, readings) never match Latin queries.
function englishText(d) {
  return d.parts.filter(function (p) { return typeof p === "string"; }).join(" ")
    .replace(/\s+/g, " ").trim().toLowerCase();
}

function searchKey(w) {
  return {
    zy: zhuyinKey(w.zhuyin || ""),
    py: pinyinKey(w.pinyin || ""),
    defs: (w.defs || []).map(englishText).filter(Boolean),
  };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Matches the shown reading only: Zhuyin in Zhuyin mode, pinyin in pinyin mode (#default-reading).
function search(q, mode) {
  q = q.trim();
  if (!q) return [];
  const scored = [];
  const hasHan = /\p{Script=Han}/u.test(q);
  const hasZy = /\p{Script=Bopomofo}/u.test(q);
  const zq = zhuyinKey(q);
  const pq = mode === "pinyin" && /^[\p{Script=Latin}\p{M}\d\s:'-]+$/u.test(q) ? pinyinKey(q) : "";
  const eq = q.toLowerCase();
  const wordRe = /^[a-z][a-z\s'-]*$/i.test(q) ? new RegExp("(^|[^a-z])" + escapeRe(eq) + "($|[^a-z])") : null;
  words.forEach(function (w) {
    if (!levelOn[w.level]) return;
    let score = 0;
    if (hasHan) {
      if (w.trad === q || w.simp === q) score = 100;
      else if (w.trad.indexOf(q) >= 0 || w.simp.indexOf(q) >= 0) score = 80;
    } else if (hasZy) {
      if (mode === "pinyin") return;
      const k = w.key.zy;
      if (k === zq) score = 100;
      else if (k.indexOf(zq) === 0) score = 80;
      else if (zq.length >= 2 && k.indexOf(zq) >= 0) score = 60;
    } else {
      if (pq) {
        const k = w.key.py;
        if (k === pq) score = 100;
        else if (k.indexOf(pq) === 0) score = 80;
        else if (pq.length >= 3 && k.indexOf(pq) >= 0) score = 60;
      }
      if (wordRe) {
        if (w.key.defs.some(function (d) { return d === eq; })) score = Math.max(score, 95);
        else if (w.key.defs.some(function (d) { return wordRe.test(d); })) score = Math.max(score, 90);
      }
    }
    if (score) scored.push({ w: w, score: score });
  });
  scored.sort(function (a, b) {
    return b.score - a.score || a.w.level - b.w.level || cmpId(a.w.id, b.w.id);
  });
  return scored.slice(0, MAX_RESULTS).map(function (s) { return s.w; });
}

let current = [], active = -1, blurTimer;

function refreshResults() {
  current = search(input.value, script);
  active = -1;
  renderResults();
}

function renderResults() {
  resultsEl.replaceChildren();
  input.removeAttribute("aria-activedescendant");
  const q = input.value.trim();
  if (!q) {
    resultsEl.hidden = true;
    input.setAttribute("aria-expanded", "false");
    return;
  }
  if (!current.length) {
    resultsEl.appendChild(el("li", "empty", "No matching word"));
  }
  current.forEach(function (w, i) {
    const li = el("li");
    li.id = "result-" + i;
    li.setAttribute("role", "option");
    if (i === active) input.setAttribute("aria-activedescendant", li.id);
    li.setAttribute("aria-selected", i === active ? "true" : "false");
    li.appendChild(han(wordLabel(w, script), "r-han"));
    li.appendChild(el("span", "r-def", firstGloss(w.defs)));
    li.appendChild(el("span", "r-lvl", "HSK " + w.level));
    li.addEventListener("pointerdown", function (e) { e.preventDefault(); });
    li.addEventListener("click", function () { pick(w); });
    resultsEl.appendChild(li);
  });
  resultsEl.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function pick(w) {
  input.value = wordLabel(w, script);
  input.lang = hanLang(script);
  current = [];
  renderResults();
  resultsEl.hidden = true;
  input.blur();
  focusWord(w);
}

input.addEventListener("input", refreshResults);
input.addEventListener("focus", function () {
  clearTimeout(blurTimer);
  if (input.value.trim()) refreshResults();
});
input.addEventListener("blur", function () {
  blurTimer = setTimeout(function () { resultsEl.hidden = true; input.setAttribute("aria-expanded", "false"); }, 150);
});
input.addEventListener("keydown", function (e) {
  // Keys during IME composition belong to the input method, not the results list.
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!current.length) return;
    e.preventDefault();
    active = (active + (e.key === "ArrowDown" ? 1 : -1) + current.length) % current.length;
    renderResults();
  } else if (e.key === "Enter") {
    if (current.length) pick(current[Math.max(active, 0)]);
  } else if (e.key === "Escape") {
    input.value = "";
    current = [];
    renderResults();
  }
});

// ---------- Sources ----------

function fillSources(meta) {
  [["cedict-release", meta.cedictRelease], ["unihan-version", meta.unihanVersion], ["ids-date", meta.idsDate], ["glyphwiki-date", meta.glyphwikiDate]].forEach(([id, v]) => {
    if (v) document.getElementById(id).textContent = v;
  });
  // A source "url@commit" links to that commit's tree.
  [["hsk-source", meta.hskSource], ["audio-source", meta.audioSource]].forEach(([id, src]) => {
    if (!src) return;
    const a = document.getElementById(id);
    const at = src.lastIndexOf("@");
    a.href = at > 0 ? src.slice(0, at) + "/tree/" + src.slice(at + 1) : src;
    a.title = src;
  });
}

function debounce(fn, ms) {
  let t;
  return function () { clearTimeout(t); t = setTimeout(fn, ms); };
}
