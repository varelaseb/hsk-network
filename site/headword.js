// Reading and headword DOM, shared by the network page and the bubbles game
// (docs/specs/hsk-network.spec.html #zhuyin-layout-heading). Builds nodes from the
// plain data senses.js returns; every text is set with textContent. Styled by the
// shared classes in site/style.css; size a headword with --head on .hw or an ancestor.
//
// Exports:
//   pieceNode(piece) -> Node
//       one senses.js piece: text node; span.han[lang]; span.zy[lang=zh-Hant] holding
//       one span per syllable (spaced 0.3em, #zhuyin-line); span.py (pinyin).
//   appendPieces(parent, pieces) -> parent
//   headwordNode(word, mode) -> div.hw
//       word { trad, simp, pinyin, zhuyin }; mode "zhuyin" | "pinyin".
//       .hw-columns: span.hw-cell > span.hw-char + span.zy-col > [span.zy-dot]
//           span.zy-sym.. (last holds span.zy-tone) (#zhuyin-columns)
//       .hw-ruby: ruby > char + rt.py (#pinyin-ruby)
//       .hw-line: span.han.hw-char + div.hw-reading > reading piece (#zhuyin-fallback)

import { headword } from "./senses.js";

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function pieceNode(p) {
  if (p.kind === "text") return document.createTextNode(p.text);
  if (p.kind === "han") {
    const s = el("span", "han", p.text);
    s.lang = p.lang;
    return s;
  }
  if (p.kind === "zhuyin") {
    const s = el("span", "zy");
    s.lang = "zh-Hant";
    p.syllables.forEach((y) => s.appendChild(el("span", null, y)));
    return s;
  }
  const s = el("span", "py", p.text);
  s.lang = "zh-Latn-pinyin";
  return s;
}

export function appendPieces(parent, pieces) {
  pieces.forEach((p) => parent.appendChild(pieceNode(p)));
  return parent;
}

export function headwordNode(word, mode) {
  const h = headword(word, mode);
  const box = el("div", "hw hw-" + h.kind);
  if (h.kind === "line") {
    box.appendChild(pieceNode(h.han)).classList.add("hw-char");
    box.appendChild(el("div", "hw-reading")).appendChild(pieceNode(h.reading));
    return box;
  }
  box.lang = h.lang;
  for (const c of h.cells) {
    if (h.kind === "ruby") {
      const r = box.appendChild(el("ruby"));
      r.appendChild(document.createTextNode(c.char));
      r.appendChild(el("rt", "py", c.pinyin)).lang = "zh-Latn-pinyin";
      continue;
    }
    const cell = box.appendChild(el("span", "hw-cell"));
    cell.appendChild(el("span", "hw-char", c.char));
    const col = cell.appendChild(el("span", "zy-col"));
    if (c.neutral) col.appendChild(el("span", "zy-dot", "˙"));
    c.symbols.forEach((sym, i) => {
      const s = col.appendChild(el("span", "zy-sym", sym));
      if (c.tone && i === c.symbols.length - 1) s.appendChild(el("span", "zy-tone", c.tone));
    });
  }
  return box;
}
