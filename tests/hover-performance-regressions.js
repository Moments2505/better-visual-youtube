"use strict";
// Diagnostic validity and cleanup checks; these do not benchmark rendering.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "diagnostics/hover-performance.js"), "utf8");

function target(object = {}) {
  const listeners = new Map();
  return Object.assign(object, {
    listeners,
    addEventListener(name, callback, options) {
      if (!listeners.has(name)) listeners.set(name, new Map());
      listeners.get(name).set(callback, options);
    },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    emit(name, properties = {}) {
      const event = { type: name,
        preventDefault() { throw new Error("diagnostic must not consume native input"); },
        stopPropagation() { throw new Error("diagnostic must not stop native input"); },
        ...properties };
      for (const callback of [...listeners.get(name)?.keys() || []]) callback(event);
    },
    listenerCount() { return [...listeners.values()].reduce((n, map) => n + map.size, 0); }
  });
}

function world({ hidden = false, longTasks = true } = {}) {
  let now = 1000, serial = 0;
  const frames = new Map(), timers = new Map(), observers = [];
  const document = target({ hidden, documentElement: { getAttribute(name) {
    return { "data-ylg-build": "test-build", "data-ylg-motion": "off", "data-ylg-ambient-engine": "upstream" }[name] || null;
  } } });
  const context = target({
    document, location: { hostname: "www.youtube.com", pathname: "/watch", href: "https://www.youtube.com/watch?v=test" },
    performance: { now: () => now }, console: { log() {} }, innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
    requestAnimationFrame(callback) { frames.set(++serial, callback); return serial; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback, delay) { timers.set(++serial, { callback, delay }); return serial; },
    clearTimeout(id) { timers.delete(id); },
    PerformanceObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe() { if (!longTasks) throw new Error("long tasks unsupported"); }
      disconnect() { this.disconnected = true; }
    }
  });
  context.window = context;
  vm.runInNewContext(source, context);
  const node = kind => ({ closest(selector) {
    return (kind === "seek" && selector === ".ytp-progress-bar-container") ||
      (kind === "volume" && selector === ".ytp-volume-area") ? this : null;
  } });
  return {
    context, document, frames, timers, observers, node,
    stop: () => context.YLG_HOVER_BENCH.stop(),
    frame(delta = 1000 / 120) {
      now += delta; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(now));
    },
    move(kind) { document.emit("pointermove", { target: node(kind) }); },
    hide(value) { document.hidden = value; document.emit("visibilitychange"); },
    restart() { vm.runInNewContext(source, context); }
  };
}

let count = 0;
function test(name, run) { run(); count++; console.log("PASS " + name); }

test("background visits invalidate a run even when no rAF fires while hidden", () => {
  const w = world(); w.frame(); w.hide(true); w.hide(false); w.frame();
  const result = w.stop();
  assert.equal(result.hiddenFrames, 0, "simulate normal background rAF suspension");
  assert.equal(result.wasHidden, true); assert.equal(result.visibilityChanges, 2); assert.equal(result.invalidRun, true);
  const initial = world({ hidden: true }); initial.hide(false);
  assert.equal(initial.stop().wasHidden, true, "a run started in the background is also invalid");
});

test("hover and native seek/volume drags remain distinct outside their controls with Motion effects off", () => {
  const w = world(); w.frame();
  for (const kind of ["seek", "volume"]) {
    w.move(kind); w.frame(); w.frame();
    w.document.emit("pointerdown", { target: w.node(kind), button: 0 });
    w.move("outside"); w.frame(); w.frame();
    w.context.emit("pointerup", { target: w.node("outside") });
  }
  w.move("seek"); w.document.emit("pointerdown", { target: w.node("seek"), button: 2 });
  w.move("outside"); w.frame(); w.frame();
  const report = w.stop();
  assert.equal(report.motion, "off");
  for (const name of ["seek", "volume", "seek-drag", "volume-drag", "idle"]) {
    assert.ok(report.groups[name].frames.samples >= 1, name);
  }
  assert.equal(report.groups["seek-drag"].moves, 1, "right-click must not start another seek drag");
  assert.equal(report.invalidRun, false);
});

test("pointer cancel and window blur release diagnostic drag state without consuming native events", () => {
  const w = world();
  for (const event of ["pointercancel", "blur"]) {
    w.document.emit("pointerdown", { target: w.node("seek"), button: 0 });
    w.context.emit(event, { target: w.node("outside") }); w.move("outside"); w.frame();
  }
  const report = w.stop();
  assert.equal(report.groups["seek-drag"], undefined); assert.equal(report.groups.idle.moves, 2);
  const active = world();
  for (const [name, listeners] of active.document.listeners) {
    if (name.startsWith("pointer")) for (const options of listeners.values()) assert.equal(options.passive, true);
  }
  for (const [name, listeners] of active.context.listeners) {
    if (name.startsWith("pointer")) for (const options of listeners.values()) assert.equal(options.passive, true);
  }
  active.stop();
});

test("unsupported long-task observation is distinguished from a supported run with no long tasks", () => {
  const unsupported = world({ longTasks: false }), missing = unsupported.stop();
  assert.equal(missing.longTaskSupported, false); assert.equal(missing.longTasks.samples, 0);
  assert.equal(unsupported.observers[0].disconnected, true);
  const w = world();
  w.observers[0].callback({ getEntries: () => [{ duration: 70 }] });
  const report = w.stop();
  assert.equal(report.longTaskSupported, true); assert.equal(report.longTasks.samples, 1); assert.equal(report.longTasks.maxMs, 70);
});

test("stop and automatic timeout release every listener, timer, frame and observer; restarting does not stack probes", () => {
  const w = world(); const previousFrame = [...w.frames.values()][0];
  w.restart(); assert.equal(w.observers[0].disconnected, true);
  assert.equal(w.frames.size, 1); assert.equal(w.timers.size, 1);
  const timeout = [...w.timers.values()][0]; assert.equal(timeout.delay, 60000);
  timeout.callback(); const report = w.context.YLG_HOVER_BENCH.result;
  assert.ok(report); assert.equal(w.document.listenerCount(), 0); assert.equal(w.context.listenerCount(), 0);
  assert.equal(w.frames.size, 0); assert.equal(w.timers.size, 0); assert.equal(w.observers[1].disconnected, true);
  previousFrame(2000); assert.equal(w.frames.size, 0, "a stale callback from the prior run cannot restart it");
  assert.equal(w.stop(), report, "stop returns the finished report unchanged");
});

test("navigation is flagged and percentile results remain labelled as scheduling proxies", () => {
  const w = world(); w.frame(); w.move("seek"); w.frame(20); w.frame(20);
  w.context.location.href = "https://www.youtube.com/watch?v=other";
  const report = w.stop();
  assert.equal(report.urlChanged, true); assert.equal(report.invalidRun, true);
  assert.ok(report.groups.seek.frames.over120HzBudget >= 1);
  assert.match(report.limitations, /not GPU-presented FPS or physical input latency/);
});

console.log("All " + count + " hover diagnostic validity regressions passed (not a performance measurement).");
