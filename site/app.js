/* HSK network site: renders site/data/graph.json with the vendored D3 v7.
   Holds no dictionary logic; everything shown comes from the data file. */
(function () {
  "use strict";

  const MAX_RESULTS = 20;
  const FOCUS_SCALE = 2.4;
  const WORD_FONT = 14;
  const WORD_H = 22;
  const HUB_R = 9;

  const svg = d3.select("#graph");
  const stage = document.getElementById("stage");
  const statusEl = document.getElementById("status");
  const card = document.getElementById("card");
  const input = document.getElementById("search");
  const resultsEl = document.getElementById("results");
  const levelBtns = Array.from(document.querySelectorAll(".level"));
  const sheetQuery = window.matchMedia("(hover: none), (max-width: 600px)");

  let words = [], hubs = [], nodes = [], links = [];
  let byId = new Map();
  let wordHubs = new Map();   // word id -> [hub]
  let hubWords = new Map();   // hub id -> [word]
  let root, linkSel, nodeSel, zoom, sim;
  let pinned = null;          // node whose card is pinned (click, tap, or search)
  let hovered = null;         // word node under the mouse
  const levelOn = { 1: true, 2: true };
  let shown = new Set();      // ids of visible nodes

  fetch("data/graph.json")
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(init)
    .catch(function (err) {
      statusEl.textContent = "Could not load the word data (" + err.message + ").";
    });

  function init(data) {
    fillSources(data.meta || {});
    words = data.words.map(function (w) {
      return Object.assign({}, w, {
        kind: "word",
        defs: w.defs || [],
        width: textWidth(w.trad) + 14,
        key: searchKey(w),
      });
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
    // Text typed while the data loaded gets its results now.
    if (document.activeElement === input) refreshResults();
    openWordLink();
    window.addEventListener("hashchange", openWordLink);
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
    root = svg.append("g");
    linkSel = root.append("g").attr("class", "links")
      .selectAll("line").data(links).join("line").attr("class", "link");

    nodeSel = root.append("g").attr("class", "nodes")
      .selectAll("g").data(hubs.concat(words), function (d) { return d.id; }).join("g")
      .attr("class", function (d) { return d.kind === "hub" ? "node hub" : "node word l" + d.level; });

    nodeSel.filter(function (d) { return d.kind === "hub"; })
      .call(function (g) {
        g.append("circle").attr("r", HUB_R);
        g.append("text").text(function (d) { return d.char; });
        g.append("title").text(function (d) { return d.char; });
      });
    nodeSel.filter(function (d) { return d.kind === "word"; })
      .call(function (g) {
        g.append("rect")
          .attr("x", function (d) { return -d.width / 2; })
          .attr("y", -WORD_H / 2)
          .attr("width", function (d) { return d.width; })
          .attr("height", WORD_H)
          .attr("rx", WORD_H / 2);
        g.append("text").text(function (d) { return d.trad; });
      });

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
        if (pinned || hovered) placeCard(pinned || hovered);
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
    if (pinned || hovered) placeCard(pinned || hovered);
  }

  function stageSize() {
    return { w: stage.clientWidth || 1, h: stage.clientHeight || 1 };
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
    const s = stageSize(), b = bounds(), pad = 16;
    const k = Math.min((s.w - 2 * pad) / (b.x1 - b.x0), (s.h - 2 * pad) / (b.y1 - b.y0));
    zoom.scaleExtent([Math.min(k, 1) * 0.5, 8]);
    const t = d3.zoomIdentity
      .translate(s.w / 2, s.h / 2)
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

  function focusWord(d) {
    const s = stageSize();
    const k = Math.max(FOCUS_SCALE, d3.zoomTransform(svg.node()).k);
    // On phones the bottom sheet covers the lower part, so center in the upper part.
    const cy = sheetQuery.matches ? s.h * 0.3 : s.h / 2;
    const t = d3.zoomIdentity.translate(s.w / 2, cy).scale(k).translate(-d.x, -d.y);
    select(d);
    svg.transition().duration(600).call(zoom.transform, t);
  }

  // ---------- Card ----------

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function levelTag(level) {
    const p = el("div", "c-level");
    p.appendChild(el("span", "swatch l" + level));
    p.appendChild(document.createTextNode("HSK " + level));
    return p;
  }

  function showCard(d, pin) {
    card.replaceChildren();
    card.classList.toggle("pinned", pin);
    if (pin) {
      const close = el("button", "c-close", "×");
      close.type = "button";
      close.setAttribute("aria-label", "Close");
      close.addEventListener("click", clearSelection);
      card.appendChild(close);
    }
    if (d.kind === "word") {
      card.appendChild(el("div", "c-trad", d.trad)).lang = "zh-Hant";
      card.appendChild(el("div", "c-zhuyin", d.zhuyin)).lang = "zh-Hant";
      card.appendChild(el("p", "c-defs", d.defs.join("; ")));
      card.appendChild(levelTag(d.level));
    } else {
      card.appendChild(el("div", "c-trad", d.char)).lang = "zh-Hant";
      d.readings.forEach(function (r) {
        const div = card.appendChild(el("div", "c-reading"));
        div.appendChild(el("div", "c-zhuyin", r.zhuyin)).lang = "zh-Hant";
        div.appendChild(el("p", "c-defs", r.defs.join("; ")));
      });
      const ws = (hubWords.get(d.id) || []).filter(function (w) { return shown.has(w.id); });
      card.appendChild(el("p", "c-defs", ws.length + " words contain this character"));
      const ul = el("ul", "c-words");
      ws.forEach(function (w) {
        const b = el("button");
        b.type = "button";
        b.appendChild(el("span", "w-trad", w.trad));
        b.appendChild(el("span", "w-zy", w.zhuyin));
        b.appendChild(el("span", "w-gloss", w.defs[0] || ""));
        b.appendChild(el("span", "swatch l" + w.level));
        b.addEventListener("click", function () { focusWord(w); });
        ul.appendChild(el("li")).appendChild(b);
      });
      card.appendChild(ul);
    }
    card.hidden = false;
    card.scrollTop = 0;
    placeCard(d);
  }

  function hideCard() {
    card.hidden = true;
    card.replaceChildren();
  }

  function placeCard(d) {
    if (card.hidden || sheetQuery.matches) return;
    const t = d3.zoomTransform(svg.node());
    const s = stageSize();
    const half = (d.kind === "hub" ? HUB_R : d.width / 2) * t.k;
    const px = t.applyX(d.x), py = t.applyY(d.y);
    const cw = card.offsetWidth, ch = card.offsetHeight, gap = 12;
    let left = px + half + gap;
    if (left + cw > s.w - 8) left = px - half - gap - cw;
    left = Math.max(8, Math.min(left, s.w - cw - 8));
    const top = Math.max(8, Math.min(py - ch / 2, s.h - ch - 8));
    card.style.left = left + "px";
    card.style.top = top + "px";
  }

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

  // English-only search text: drops "CL:" classifier lists, [pinyin] refs, and Han forms
  // ("CL:個|个[ge4]", "variant of 爲|为[wei4]") so they never match Latin queries.
  function englishText(d) {
    return d.replace(/\bCL:.*$/, "")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/[\p{Script=Han}|]+/gu, " ")
      .replace(/\s+/g, " ").trim().toLowerCase();
  }

  function searchKey(w) {
    return {
      zy: zhuyinKey(w.zhuyin || ""),
      defs: (w.defs || []).map(englishText).filter(Boolean),
    };
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function search(q) {
    q = q.trim();
    if (!q) return [];
    const scored = [];
    const hasHan = /\p{Script=Han}/u.test(q);
    const hasZy = /\p{Script=Bopomofo}/u.test(q);
    const zq = zhuyinKey(q);
    const eq = q.toLowerCase();
    const wordRe = /^[a-z][a-z\s'-]*$/i.test(q) ? new RegExp("(^|[^a-z])" + escapeRe(eq) + "($|[^a-z])") : null;
    words.forEach(function (w) {
      if (!levelOn[w.level]) return;
      let score = 0;
      if (hasHan) {
        if (w.trad === q || w.simp === q) score = 100;
        else if (w.trad.indexOf(q) >= 0 || w.simp.indexOf(q) >= 0) score = 80;
      } else if (hasZy) {
        const k = w.key.zy;
        if (k === zq) score = 100;
        else if (k.indexOf(zq) === 0) score = 80;
        else if (zq.length >= 2 && k.indexOf(zq) >= 0) score = 60;
      } else if (wordRe) {
        if (w.key.defs.some(function (d) { return d === eq; })) score = 95;
        else if (w.key.defs.some(function (d) { return wordRe.test(d); })) score = 90;
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
    current = search(input.value);
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
      li.appendChild(el("span", "r-trad", w.trad)).lang = "zh-Hant";
      li.appendChild(el("span", "r-def", w.defs[0] || ""));
      li.appendChild(el("span", "r-lvl", "HSK " + w.level));
      li.addEventListener("pointerdown", function (e) { e.preventDefault(); });
      li.addEventListener("click", function () { pick(w); });
      resultsEl.appendChild(li);
    });
    resultsEl.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function pick(w) {
    input.value = w.trad;
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
    if (meta.cedictRelease) document.getElementById("cedict-release").textContent = meta.cedictRelease;
    const src = meta.hskSource;
    if (src) {
      const a = document.getElementById("hsk-source");
      const at = src.lastIndexOf("@");
      a.href = at > 0 ? src.slice(0, at) + "/tree/" + src.slice(at + 1) : src;
      a.title = src;
    }
  }

  function debounce(fn, ms) {
    let t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }
})();
