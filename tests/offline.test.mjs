// Offline worker tests (docs/specs/hsk-app.spec.html #test-worker, #acceptance-update-quiet,
// #acceptance-offline-fail): site/sw.js run with a stubbed cache, fetch, and clients.
// Run: node --test tests/offline.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const site = (p) => new URL("../site/" + p, import.meta.url);
const SOURCE = readFileSync(site("sw.js"), "utf8");
const FILES = JSON.parse(/const FILES = (\[.*?\]);/s.exec(SOURCE)[1].replace(",\n]", "\n]"));
const ROOT = "https://owner.github.io/repo/";

// One browser: shared caches and network, many worker versions over time.
function browser() {
  const stores = new Map();
  const net = { online: true, fail: new Set(), log: [] };
  class Cache {
    constructor() { this.m = new Map(); }
    async match(key) { const r = this.m.get(typeof key === "string" ? key : key.url); return r && r.clone(); }
    async addAll(reqs) {
      // Spec semantics: every response must arrive and be ok, or nothing is stored.
      const got = await Promise.all(reqs.map(async (r) => {
        const res = await fetch(r);
        if (!res.ok) throw new TypeError("bad response");
        return [r.url, res];
      }));
      for (const [u, res] of got) this.m.set(u, res);
    }
  }
  const caches = {
    async open(name) { if (!stores.has(name)) stores.set(name, new Cache()); return stores.get(name); },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  async function fetch(r) {
    const url = typeof r === "string" ? r : r.url;
    net.log.push({ url, cache: r.cache });
    if (!net.online || net.fail.has(url)) throw new TypeError("Failed to fetch");
    return new Response(`net:${net.version}:${url}`, { headers: { "Content-Type": "text/plain" } });
  }
  const clients = { claimed: 0, touched: 0 };
  return { stores, net, caches, fetch, clients };
}

function worker(b, version) {
  const on = {};
  const self = {
    location: new URL(ROOT + "sw.js"),
    addEventListener: (type, fn) => { on[type] = fn; },
    skipWaiting: async () => { self.skipped = true; },
    clients: {
      claim: async () => { b.clients.claimed++; },
      matchAll: async () => { b.clients.touched++; return []; },
    },
    skipped: false,
  };
  const src = SOURCE.replace(/const VERSION = "[^"]*";/, `const VERSION = "${version}";`);
  vm.runInNewContext(src, { self, caches: b.caches, fetch: b.fetch, Request, Response, Headers, URL, Promise });
  b.net.version = version;
  const run = (type, extra) => { const e = { ...extra, waitUntil(p) { this.p = p; }, respondWith(p) { this.r = p; } }; on[type](e); return e; };
  return {
    self,
    install: () => run("install").p,
    activate: () => run("activate").p,
    fetch: (url, { mode = "no-cors", method = "GET", range } = {}) =>
      run("fetch", { request: { url, mode, method, headers: new Headers(range ? { range } : {}) } }).r,
  };
}

async function installed(b, version) {
  const w = worker(b, version);
  await w.install();
  await w.activate();
  return w;
}

const text = (r) => r.then((res) => res.text());

test("a complete install saves every listed file past the HTTP cache, then takes over", async () => {
  const b = browser();
  const w = worker(b, "v1");
  await w.install();
  const saved = b.stores.get("hsk-v1").m;
  assert.deepEqual([...saved.keys()], FILES.map((f) => ROOT + f));
  assert.ok(b.net.log.every((r) => r.cache === "reload"));
  assert.ok(w.self.skipped);
});

test("an interrupted install leaves the old copy serving and does not take over", async () => {
  const b = browser();
  await installed(b, "v1");
  const old = worker(b, "v1");
  const w = worker(b, "v2");
  b.net.fail.add(ROOT + FILES[FILES.length - 1]);
  await assert.rejects(w.install());
  assert.equal(w.self.skipped, false);
  assert.equal(b.stores.get("hsk-v2").m.size, 0);
  b.net.online = false;
  assert.equal(await text(old.fetch(ROOT + "audio/1-1.mp3")), `net:v1:${ROOT}audio/1-1.mp3`);
});

test("with no saved copy an interrupted install leaves the network serving, and the next visit saves again", async () => {
  const b = browser();
  b.net.fail.add(ROOT + "data/graph.json");
  await assert.rejects(worker(b, "v1").install());
  b.net.fail.clear();
  const again = worker(b, "v1");
  await again.install();
  assert.equal(b.stores.get("hsk-v1").m.size, FILES.length);
});

test("activation deletes older copies and reloads no page", async () => {
  const b = browser();
  await installed(b, "v1");
  b.stores.set("other-app", {});
  await installed(b, "v2");
  assert.deepEqual([...b.stores.keys()].sort(), ["hsk-v2", "other-app"]);
  assert.equal(b.clients.claimed, 2);
  assert.equal(b.clients.touched, 0, "no client is listed, navigated, or messaged");
});

test("listed files answer from the saved copy offline, ignoring query and hash", async () => {
  const b = browser();
  const w = await installed(b, "v1");
  b.net.online = false;
  b.net.log.length = 0;
  assert.equal(await text(w.fetch(ROOT + "data/graph.json?x=1#y")), `net:v1:${ROOT}data/graph.json`);
  assert.equal(await text(w.fetch(ROOT, { mode: "navigate" })), `net:v1:${ROOT}index.html`);
  assert.equal(await text(w.fetch(ROOT + "bubbles/", { mode: "navigate" })), `net:v1:${ROOT}bubbles/index.html`);
  assert.equal(await text(w.fetch(ROOT + "?q=1#w=學", { mode: "navigate" })), `net:v1:${ROOT}index.html`);
  assert.equal(b.net.log.length, 0);
});

test("unlisted files, other sites, and non-GET requests are left to the browser's network", async () => {
  const b = browser();
  const w = await installed(b, "v1");
  b.net.log.length = 0;
  assert.equal(w.fetch(ROOT + "nope.js"), undefined);
  assert.equal(w.fetch("https://cdn.example/x.js"), undefined);
  assert.equal(w.fetch("https://cdn.example/", { mode: "navigate" }), undefined);
  assert.equal(w.fetch(ROOT + "app.js", { method: "POST" }), undefined);
  assert.deepEqual(b.net.log, [], "the worker itself fetches nothing outside its list");
});

test("an unknown page address offline shows the network", async () => {
  const b = browser();
  const w = await installed(b, "v1");
  b.net.online = false;
  assert.equal(await text(w.fetch(ROOT + "gone/", { mode: "navigate" })), `net:v1:${ROOT}index.html`);
});

test("a recording asked for by byte range gets a 206 slice", async () => {
  const b = browser();
  const w = await installed(b, "v1");
  b.net.online = false;
  const whole = `net:v1:${ROOT}audio/1-1.mp3`;
  for (const [range, start, end] of [["bytes=0-1", 0, 1], ["bytes=4-", 4, whole.length - 1], ["bytes=-3", whole.length - 3, whole.length - 1]]) {
    const res = await w.fetch(ROOT + "audio/1-1.mp3", { range });
    assert.equal(res.status, 206, range);
    assert.equal(res.headers.get("Content-Range"), `bytes ${start}-${end}/${whole.length}`);
    assert.equal(await res.text(), whole.slice(start, end + 1));
  }
  assert.equal((await w.fetch(ROOT + "audio/1-1.mp3", { range: `bytes=${whole.length}-` })).status, 416);
});

test("both pages register the worker and never reload when a new version arrives", () => {
  for (const [page, url] of [["app.js", '"sw.js"'], ["bubbles/game.js", '"../sw.js"']]) {
    const src = readFileSync(site(page), "utf8");
    assert.ok(src.includes(`navigator.serviceWorker?.register(${url})`), page);
    assert.ok(!/controllerchange|location\.reload|\.reload\(/.test(src), page);
  }
});
