#!/usr/bin/env node
"use strict";
// Deterministic contract tests of the unmodified runtime, not a renderer or a
// browser performance benchmark. Canvas pixels/PNG encoding are fixture stubs.
// Run: node tests/optics-lifecycle-regressions.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { makeEl, queryAll } = require("./dom-fixture");
const sourcePath = path.join(__dirname, "../src/glass/glass-optics.js");
const source = fs.readFileSync(sourcePath, "utf8");
const DEFAULTS = { aberrationPx: 1.6, magnifyScale: 18, lensPx: 26, lensAberration: 0.18 };
const FLAGS = ["data-ylg-optics", "data-ylg-optics-aberration", "data-ylg-optics-magnify",
  "data-ylg-lens", "data-ylg-lens-hover", "data-ylg-lens-split", "data-ylg-chrome-lens", "data-ylg-control-lens"];

function world({ boxes = true, resizeObserver = true, chromeBox = false, controlBox = false, interfaceBox = false } = {}) {
  const counts = { nodes: 0, canvases: 0, imageData: 0, png: 0, mutations: 0,
    queries: 0, measurements: 0, timers: 0, observers: 0, observe: 0, unobserve: 0, disconnect: 0 };
  function element(tag) {
    counts.nodes++;
    const el = makeEl(tag);
    for (const method of ["setAttribute", "removeAttribute", "appendChild", "removeChild"]) {
      const original = el[method];
      el[method] = function (...args) { counts.mutations++; return original.apply(this, args); };
    }
    for (const method of ["setProperty", "removeProperty"]) {
      const original = el.style[method];
      el.style[method] = function (...args) { counts.mutations++; return original.apply(this, args); };
    }
    const rect = el.getBoundingClientRect;
    el.getBoundingClientRect = function () { counts.measurements++; return rect.call(this); };
    if (tag === "canvas") {
      counts.canvases++;
      el.getContext = () => ({
        createImageData(w, h) { counts.imageData++; return { data: new Uint8ClampedArray(w * h * 4) }; },
        putImageData() {}
      });
      el.toDataURL = () => { counts.png++; return "data:image/png;base64,FIXTURE"; };
    }
    return el;
  }
  const html = element("html"), body = element("body"), chrome = element("div");
  chrome.className = "ytp-chrome-bottom";
  html.appendChild(body); body.appendChild(chrome);
  const targets = {};
  function addBoxes() {
    for (const [name, cls, width] of [["rail", "ytp-right-controls", 374],
      ["capsule", "ytp-time-display", 135], ["well", "ytp-volume-area", 40]]) {
      const el = element("div");
      el.className = cls; el.rect = { left: 0, top: 0, width, height: 40 };
      chrome.appendChild(el); targets[name] = el;
    }
  }
  if (boxes) addBoxes();
  if (controlBox) {
    const left = element("div"); left.className = "ytp-left-controls"; chrome.appendChild(left);
    const button = element("button"); button.className = "ytp-button ytp-play-button";
    button.rect = { left: 0, top: 0, width: 40, height: 40 };
    left.appendChild(button); targets.control = button;
  }
  if (chromeBox) {
    const sheet = element("div"); sheet.id = "frosted-glass";
    sheet.rect = { left: 0, top: 0, width: 1280, height: 56 };
    body.appendChild(sheet); targets.chrome = sheet;
  }
  const document = {
    documentElement: html, body,
    createElement: element, createElementNS: (_, tag) => element(tag),
    querySelector(sel) {
      counts.queries++;
      // The tiny selector fixture does not parse child combinators.
      if (sel === ".ytp-chrome-bottom .ytp-left-controls > .ytp-button") return targets.control || null;
      return queryAll({ children: [html] }, sel)[0] || null;
    }
  };
  if (interfaceBox) {
    targets.interfaces = [];
    for (const [cls, width] of [["ytSearchboxComponentInputBox", 600], ["ylg-glass", 100], ["ylg-glass", 100]]) {
      const node = element("div"); node.className = cls;
      node.rect = { left: 0, top: 0, width, height: 40 };
      body.appendChild(node); targets.interfaces.push(node);
    }
    document.querySelectorAll = () => targets.interfaces;
  }
  let now = 0, serial = 0;
  const active = new Map(), history = [];
  function schedule(kind, fn, delay) {
    counts.timers++;
    const task = { id: ++serial, kind, fn, delay, due: now + delay, calls: 0 };
    active.set(task.id, task); history.push(task); return task.id;
  }
  function advance(ms) {
    const end = now + ms;
    let budget = 10000;
    while (true) {
      const next = [...active.values()].filter(t => t.due <= end)
        .sort((a, b) => a.due - b.due || a.id - b.id)[0];
      if (!next) break;
      assert.ok(--budget > 0, "fake clock runaway");
      now = next.due;
      if (next.kind === "timeout") active.delete(next.id);
      else next.due += next.delay;
      next.calls++; next.fn();
    }
    now = end;
  }
  const observers = [];
  class MockRO {
    constructor(fn) { counts.observers++; this.fn = fn; this.targets = new Set(); observers.push(this); }
    observe(el) { counts.observe++; this.targets.add(el); }
    unobserve(el) { counts.unobserve++; this.targets.delete(el); }
    disconnect() { counts.disconnect++; this.targets.clear(); }
    // Deliberately callable after disconnect: models a callback already queued.
    deliver() { this.fn([...this.targets].map(target => ({ target })), this); }
  }
  const context = { document, CSS: { supports: () => true },
    setInterval: (fn, ms) => schedule("interval", fn, ms),
    setTimeout: (fn, ms) => schedule("timeout", fn, ms),
    clearInterval: id => active.delete(id), clearTimeout: id => active.delete(id) };
  if (resizeObserver) context.ResizeObserver = MockRO;
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: sourcePath });
  return { api: context.YLG_OPTICS, html, body, targets, counts, active, history, observers,
    addBoxes, advance, filter: id => html.querySelector("#" + id),
    snapshot: () => ({ ...counts }) };
}
function assertClean(w) {
  assert.equal(w.active.size, 0, "no scheduled work after teardown");
  assert.equal(w.html.querySelectorAll("svg").length, 0, "SVG removed");
  assert.equal(w.html.querySelectorAll("filter").length, 0, "filters removed");
  for (const name of FLAGS) assert.equal(w.html.hasAttribute(name), false, name + " removed");
  assert.equal(w.html.style.getPropertyValue("--ylg-lens-ab"), "");
  assert.ok(w.observers.every(o => o.targets.size === 0), "all RO targets disconnected");
  assert.deepEqual({ ...w.api.supported() }, { aberration: false, magnify: false });
}
function assertInstalled(w) {
  assert.equal(w.html.querySelectorAll("svg").length, 1);
  assert.equal(w.html.querySelectorAll("filter").length, 5);
  assert.equal(w.html.getAttribute("data-ylg-lens-split"), "1");
  assert.equal(w.active.size, 1);
  assert.equal([...w.active.values()][0].kind, "interval");
  assert.equal(w.observers.filter(o => o.targets.size).length, 2);
  assert.equal(w.observers.reduce((n, o) => n + o.targets.size, 0), 2);
}
const cases = [];
function test(name, fn) { cases.push([name, fn]); }

test("15 install/resize/teardown cycles release SVG, flags, timers and RO targets", () => {
  const w = world();
  for (let cycle = 0; cycle < 15; cycle++) {
    assert.deepEqual({ ...w.api.install(DEFAULTS) }, { aberration: true, magnify: true, lens: true });
    assertInstalled(w);
    const current = w.observers.slice(-2);
    current.forEach(o => o.deliver());
    assert.equal(w.active.size, 3, "one interval and two debounces");
    if (cycle % 2) w.advance(220);
    w.api.teardown(); assertClean(w);
  }
  assert.equal(w.observers.length, 30);
  assert.equal(w.counts.disconnect, 30);
});

test("queued interval, debounce and RO callbacks cannot resurrect torn-down state", () => {
  const w = world(); w.api.install(DEFAULTS);
  w.observers.forEach(o => o.deliver());
  const queued = [...w.active.values()];
  assert.equal(queued.filter(t => t.kind === "timeout").length, 2);
  const retainedFilter = w.filter("ylg-lens-player");
  w.api.teardown(); assertClean(w);
  w.targets.rail.rect.width = 450; w.targets.capsule.rect.width = 176;
  const before = w.snapshot();
  queued.forEach(t => t.fn());
  w.observers.forEach(o => o.deliver());
  w.advance(20000);
  assert.deepEqual(w.snapshot(), before, "stale callbacks perform no DOM work or allocation");
  assert.equal(retainedFilter.getAttribute("data-ylg-lens-w"), "374");
  assertClean(w);
});

test("identical installs are allocation-free and preserve scheduler/filter identity", () => {
  const w = world(); const first = w.api.install(DEFAULTS);
  const filter = w.filter("ylg-lens-player"), timer = [...w.active.keys()][0];
  const before = w.snapshot();
  for (let i = 0; i < 25; i++) {
    const result = w.api.install({ ...DEFAULTS });
    assert.deepEqual({ ...result }, { ...first });
    assert.notEqual(result, first, "returned flags are not a shared mutable object");
  }
  assert.deepEqual(w.snapshot(), before);
  assert.equal(w.filter("ylg-lens-player"), filter);
  assert.deepEqual([...w.active.keys()], [timer]);
  w.advance(10000);
  assert.equal(w.active.size, 0);
  const expired = w.snapshot(); w.api.install(DEFAULTS);
  assert.deepEqual(w.snapshot(), expired, "identical install does not restart expired polling");
  w.api.teardown(); assertClean(w);
});

test("unrelated option changes allocate no canvas, maps, filters, timers or observers", () => {
  const w = world(); w.api.install(DEFAULTS);
  const before = w.snapshot();
  for (let i = 0; i < 20; i++) w.api.install({ ...DEFAULTS, theme: i % 2 ? "dark" : "light",
    ambientIntensity: i, glassBlur: i });
  assert.deepEqual(w.snapshot(), before);
  w.api.teardown(); assertClean(w);
});

test("updated optical options reach existing primitives and all three lens families", () => {
  const w = world(); w.api.install(DEFAULTS);
  const oldObservers = w.observers.slice(), oldInterval = w.history[0];
  oldObservers.forEach(o => o.deliver());
  const oldDebounces = w.history.filter(t => t.kind === "timeout");
  const oldNodes = ["player", "capsule"].map(n => w.filter("ylg-lens-" + n));
  w.api.install({ aberrationPx: 2.4, magnifyScale: 31, lensPx: 80, lensAberration: 0.7 });
  assert.equal(w.filter("ylg-lens-hover").querySelector("feDisplacementMap").getAttribute("scale"), "31");
  w.api.install({ aberrationPx: 2.4, magnifyScale: 0, lensPx: 80, lensAberration: 0.7 });
  assert.equal(w.html.getAttribute("data-ylg-lens-hover"), "0");
  w.api.install({ aberrationPx: 2.4, magnifyScale: 31, lensPx: 80, lensAberration: 0.7 });
  assertInstalled(w);
  assert.ok(oldObservers.every(o => o.targets.size === 0));
  assert.equal(w.active.has(oldInterval.id), false);
  assert.ok(oldDebounces.every(t => !w.active.has(t.id)));
  const offsets = w.filter("ylg-optics-aberration").querySelectorAll("feOffset");
  assert.equal(offsets[0].getAttribute("dx"), "-2.4");
  assert.equal(offsets[1].getAttribute("dx"), "2.4");
  assert.equal(w.filter("ylg-optics-magnify").querySelector("feDisplacementMap").getAttribute("scale"), "31");
  assert.equal(w.html.style.getPropertyValue("--ylg-lens-ab"), "0.7");
  for (const [i, name] of ["player", "capsule"].entries()) {
    const current = w.filter("ylg-lens-" + name);
    assert.notEqual(current, oldNodes[i]);
    assert.equal(Number(current.getAttribute("data-ylg-lens-k")), w.api.playerLensKFor(80));
  }
  const before = w.snapshot();
  oldInterval.fn(); oldDebounces.forEach(t => t.fn()); oldObservers.forEach(o => o.deliver());
  assert.deepEqual(w.snapshot(), before, "old generation cannot affect new generation");
  // Live RO callbacks must capture the NEW strength, including later rebuilds.
  w.targets.rail.rect.width = 410; w.targets.capsule.rect.width = 176;
  w.observers.slice(-2).forEach(o => o.deliver()); w.advance(220);
  assert.equal(w.filter("ylg-lens-player").getAttribute("data-ylg-lens-w"), "410");
  assert.equal(w.filter("ylg-lens-capsule").getAttribute("data-ylg-lens-w"), "176");
  assert.equal(Number(w.filter("ylg-lens-player").getAttribute("data-ylg-lens-k")), w.api.playerLensKFor(80));
  assert.equal(Number(w.filter("ylg-lens-capsule").getAttribute("data-ylg-lens-k")), w.api.playerLensKFor(80));
  w.api.teardown(); assertClean(w);
});

test("resize bursts coalesce to two 220ms debounces; only live geometry is rebuilt", () => {
  const w = world(); w.api.install(DEFAULTS);
  const original = w.filter("ylg-lens-player");
  w.targets.rail.rect.width = 420; w.targets.capsule.rect.width = 176;
  for (let i = 0; i < 12; i++) w.observers.forEach(o => o.deliver());
  assert.equal(w.active.size, 3);
  w.advance(219); assert.equal(w.filter("ylg-lens-player"), original);
  w.advance(1);
  assert.notEqual(w.filter("ylg-lens-player"), original);
  assert.equal(w.filter("ylg-lens-player").getAttribute("data-ylg-lens-w"), "420");
  assert.equal(w.filter("ylg-lens-capsule").getAttribute("data-ylg-lens-w"), "176");
  assert.equal(w.active.size, 1);
  const before = w.counts.canvases;
  w.observers.forEach(o => o.deliver()); w.advance(220);
  assert.equal(w.counts.canvases, before, "unchanged geometry creates no map canvas");
  w.api.teardown(); assertClean(w);
});

for (const resizeObserver of [true, false]) {
  test("one 250ms poll stops at 40 ticks with missing boxes; RO=" + resizeObserver, () => {
    const w = world({ boxes: false, resizeObserver }); w.api.install(DEFAULTS);
    assert.equal(w.html.getAttribute("data-ylg-lens-split"), null);
    const interval = [...w.active.values()][0];
    assert.equal(w.active.size, 1); assert.equal(interval.delay, 250);
    w.advance(9750); assert.equal(interval.calls, 39); assert.equal(w.active.size, 1);
    w.advance(250); assert.equal(interval.calls, 40); assert.equal(w.active.size, 0);
    const before = w.snapshot(); w.advance(60000);
    assert.deepEqual(w.snapshot(), before, "no permanent polling or delayed allocation");
    w.api.teardown(); assertClean(w);
  });
}

test("bounded startup polling discovers late boxes without adding an interval", () => {
  const w = world({ boxes: false }); w.api.install(DEFAULTS);
  w.advance(500); w.addBoxes(); w.advance(250);
  assertInstalled(w);
  assert.equal(w.history.filter(t => t.kind === "interval").length, 1);
  assert.equal(w.filter("ylg-lens-capsule").getAttribute("data-ylg-lens-w"), "135");
  w.advance(9250); assert.equal(w.active.size, 0);
  w.api.teardown(); assertClean(w);
});

test("chrome edge profile uses its own dimensions and cleans up", () => {
  const w = world({ chromeBox: true }); w.api.install({ ...DEFAULTS, lensPx: 92 });
  assert.equal(w.html.getAttribute("data-ylg-chrome-lens"), "1");
  const f = w.filter("ylg-lens-chrome");
  assert.equal(f.getAttribute("data-ylg-lens-w"), "1280");
  assert.equal(f.getAttribute("data-ylg-lens-h"), "56");
  assert.equal(f.getAttribute("data-ylg-lens-profile"), "chrome-edge");
  assert.equal(f.getAttribute("data-ylg-lens-mag"), "1.000");
  assert.equal(Number(f.getAttribute("data-ylg-lens-k")), 0.23, "chrome strength unchanged");
  for (const id of ["ylg-lens-player", "ylg-lens-capsule"]) {
    const player = w.filter(id);
    assert.ok(Math.abs(1 / (1 - Number(player.getAttribute("data-ylg-lens-k"))) - 1.15) < 1e-10);
    assert.equal(player.getAttribute("data-ylg-lens-mag"), "1.150");
  }
  w.targets.chrome.rect.width = 1440;
  w.observers.forEach(o => o.deliver()); w.advance(220);
  assert.equal(w.filter("ylg-lens-chrome").getAttribute("data-ylg-lens-w"), "1440");
  w.api.teardown(); assertClean(w);
});
test("home chrome readiness does not require player boxes or dangling SVG URLs", () => {
  const w = world({ boxes: false, chromeBox: true }); w.api.install(DEFAULTS);
  assert.equal(w.html.getAttribute("data-ylg-chrome-lens"), "1");
  assert.equal(w.html.getAttribute("data-ylg-lens-split"), null);
  w.api.install({ ...DEFAULTS, lensPx: 0 });
  assert.equal(w.html.hasAttribute("data-ylg-chrome-lens"), false);
  w.api.teardown(); assertClean(w);
});
test("chrome centre is neutral and edge bends stay shallow without folds", () => {
  const w = world();
  for (const width of [720, 1280, 1920]) {
    for (const k of [0, 0.23, 0.88]) {
      for (const x of [width * 0.2, width * 0.5, width * 0.8]) {
        for (const y of [52, 64, 76]) {
          assert.deepEqual({ ...w.api.chromeEdgeOffset(x, y, width, 128, k) }, { dx: 0, dy: 0 });
        }
      }
      for (let y = 0.5; y < 56; y++) {
        for (const x of [0.5, 2, 4, 6, 8, width / 2, width - 4]) {
          const p = w.api.chromeEdgeOffset(x, y, width, 56, k);
          assert.ok(Math.hypot(p.dx, p.dy) <= 3.000001);
          const left = w.api.chromeEdgeOffset(x - 0.1, y, width, 56, k);
          const right = w.api.chromeEdgeOffset(x + 0.1, y, width, 56, k);
          const top = w.api.chromeEdgeOffset(x, y - 0.1, width, 56, k);
          const bottom = w.api.chromeEdgeOffset(x, y + 0.1, width, 56, k);
          assert.ok(1 + (right.dx - left.dx) / 0.2 > 0, "no horizontal fold");
          assert.ok(1 + (bottom.dy - top.dy) / 0.2 > 0, "no vertical fold");
        }
      }
    }
  }
  assert.ok(Math.abs(w.api.chromeEdgeOffset(640, 8, 1280, 56, 0.23).dy - 3) < 1e-10,
    "default headbar profile reaches the requested 3px");
});
test("UI geometry lenses are reused, refreshed and removed on teardown", () => {
  const w = world({ interfaceBox: true }); w.api.install({ ...DEFAULTS, lensPx: 92 });
  const nodes = w.targets.interfaces;
  assert.equal(nodes[1].style.getPropertyValue("--ylg-interface-lens"), nodes[2].style.getPropertyValue("--ylg-interface-lens"));
  assert.notEqual(nodes[0].style.getPropertyValue("--ylg-interface-lens"), nodes[1].style.getPropertyValue("--ylg-interface-lens"));
  assert.equal(w.filter("ylg-lens-ui-0").getAttribute("data-ylg-lens-w"), "600");
  assert.equal(w.filter("ylg-lens-seek").getAttribute("data-ylg-lens-w"), "44");
  assert.equal(w.filter("ylg-lens-seek").getAttribute("data-ylg-lens-h"), "28");
  let styleWrites = 0;
  for (const node of nodes) {
    const original = node.style.setProperty;
    node.style.setProperty = function (...args) { styleWrites++; return original.apply(this, args); };
  }
  const pngBefore = w.counts.png, canvasBefore = w.counts.canvases;
  for (let pass = 0; pass < 10; pass++) w.api.refreshInterface();
  assert.equal(styleWrites, 0, "unchanged UI refresh does not rewrite lens styles");
  assert.equal(w.counts.png, pngBefore, "unchanged UI refresh encodes no PNG");
  assert.equal(w.counts.canvases, canvasBefore, "unchanged UI refresh creates no canvas");
  nodes[0].rect.width = 700; w.api.refreshInterface();
  assert.equal(w.filter("ylg-lens-ui-2").getAttribute("data-ylg-lens-w"), "700");
  w.api.teardown(); assertClean(w);
  for (const node of nodes) assert.equal(node.style.getPropertyValue("--ylg-interface-lens"), "");
});
test("single controls use their own40px lens when volume expands", () => {
  const w = world({ controlBox: true });
  w.targets.well.rect.width = 92;
  w.api.install({ ...DEFAULTS, lensPx: 92 });
  assert.equal(w.html.getAttribute("data-ylg-control-lens"), "1");
  assert.equal(w.filter("ylg-lens-control").getAttribute("data-ylg-lens-w"), "40");
  assert.equal(w.filter("ylg-lens-well"), null, "unused volume lens is not built");
  assert.ok(w.observers.every(o => !o.targets.has(w.targets.well)), "volume width is not observed");
  w.advance(10000); // complete the bounded startup sync before hover-like resize
  const pngBefore = w.counts.png;
  for (const width of [40, 62, 92, 62, 40]) {
    w.targets.well.rect.width = width;
    w.observers.forEach(o => o.deliver()); w.advance(220);
  }
  assert.equal(w.counts.png, pngBefore, "volume hover resize generates no displacement textures");
  assert.equal(w.filter("ylg-lens-control").getAttribute("data-ylg-lens-mag"), "1.150");
  w.api.teardown(); assertClean(w);
});

let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log("PASS  " + name); }
  catch (error) { failed++; console.error("FAIL  " + name + "\n" + error.stack); }
}
console.log(`\nOptics lifecycle: ${cases.length - failed} passed, ${failed} failed.`);
console.log("Scope: actual optics source + mocked DOM/RO/clock; no browser, GPU, PNG fidelity, or bootstrap/settings integration claims.");
if (failed) process.exitCode = 1;
