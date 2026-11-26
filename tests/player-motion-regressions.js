"use strict";
// Actual controller source with lightweight mock DOM & timers. Verifies that
// mode toggles never run FLIP transforms or sidebar layout hijacks and settle cleanly.
const assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs");
const source = fs.readFileSync(require("node:path").join(__dirname, "../src/content/player-motion.js"), "utf8");

function world({ sidebar = false, miniplayer = false } = {}) {
  const attrs = new Map([["data-ylg-enabled", "true"], ["data-ylg-motion", "on"]]);
  const listeners = new Map(), raf = new Map(), timers = new Map(), calls = [];
  let id = 0, theater = false, reduced = false, syncCalls = 0, refreshCalls = 0, playerAnimateCalls = 0;
  const target = { closest: s => s === ".ytp-size-button" ? target : null };
  const flexy = { hasAttribute: k => (k === "theater" && theater) || (k === "miniplayer" && miniplayer) };
  const player = {
    isConnected: true,
    animate() { playerAnimateCalls++; throw new Error("FLIP animate must not be called"); }
  };
  const sideStyles = new Map();
  const secondary = {
    style: {
      setProperty(k, v) { sideStyles.set(k, v); },
      removeProperty(k) { sideStyles.delete(k); }
    },
    animate() { throw new Error("sidebar layout animation must not be called"); }
  };
  const root = {
    document: {
      fullscreenElement: null,
      hidden: false,
      documentElement: {
        getAttribute: k => attrs.get(k) ?? null,
        setAttribute: (k, v) => attrs.set(k, String(v)),
        removeAttribute: k => attrs.delete(k),
        hasAttribute: k => attrs.has(k)
      },
      querySelector: s => s === "ytd-watch-flexy" ? flexy : s === "ytd-player#ytd-player" ? player : s === "#secondary" && sidebar ? secondary : null,
      addEventListener: (k, f) => listeners.set(k, f),
      removeEventListener: (k, f) => { if (listeners.get(k) === f) listeners.delete(k); }
    },
    requestAnimationFrame: f => { raf.set(++id, f); return id; },
    cancelAnimationFrame: i => raf.delete(i),
    setTimeout: (fn, ms) => { timers.set(++id, { fn, ms }); return id; },
    clearTimeout: i => timers.delete(i),
    matchMedia: () => ({ matches: reduced }),
    addEventListener() {},
    removeEventListener() {},
    YLG_AMBIENT_VENDOR: { syncGeometry() { syncCalls++; calls.push("sync"); return true; } },
    YLG_OPTICS: { refreshPlayer() { refreshCalls++; calls.push("refresh"); } }
  };
  root.window = root;
  vm.runInNewContext(source, root);
  root.YLG_PLAYER_MOTION.init();
  return {
    root, attrs, raf, timers, player, secondary, sideStyles, listeners, target, calls,
    get syncCalls() { return syncCalls; },
    get refreshCalls() { return refreshCalls; },
    get playerAnimateCalls() { return playerAnimateCalls; },
    toggle() { theater = !theater; },
    reduce(v = true) { reduced = v; },
    event(k = "click", extra = {}) {
      let prevented = false, stopped = false;
      listeners.get(k)?.({
        type: k, target, key: "t",
        preventDefault() { prevented = true; },
        stopPropagation() { stopped = true; },
        ...extra
      });
      return { prevented, stopped };
    },
    frame() {
      const callbacks = [...raf.values()];
      raf.clear();
      callbacks.forEach(f => f());
    },
    flushTimers() {
      const list = [...timers.values()];
      timers.clear();
      list.forEach(t => t.fn());
    }
  };
}

let passed = 0;
function test(name, fn) { fn(); console.log("PASS " + name); passed++; }

test("mode change avoids FLIP animation, avoids #secondary overrides, preserves native event, and settles sync+optics", () => {
  const w = world({ sidebar: true });
  const ev = w.event();
  assert.equal(ev.prevented, false);
  assert.equal(ev.stopped, false);
  assert.equal(w.sideStyles.size, 0);
  assert.equal(w.attrs.has("data-ylg-player-transition"), false);
  w.toggle();
  w.frame();
  assert.equal(w.playerAnimateCalls, 0);
  assert.equal(w.timers.size, 1);
  assert.equal([...w.timers.values()][0].ms, 48);
  assert.equal(w.syncCalls, 0);
  assert.equal(w.refreshCalls, 0);
  w.flushTimers();
  assert.equal(w.syncCalls, 1);
  assert.equal(w.refreshCalls, 1);
  assert.equal(w.attrs.has("data-ylg-player-transition"), false);
});

test("keyboard 't' triggers settle sync and throwing hooks stay contained", () => {
  const w = world();
  w.root.YLG_AMBIENT_VENDOR = { syncGeometry() { throw new Error("detached engine"); } };
  w.root.YLG_OPTICS = { refreshPlayer() { throw new Error("detached player"); } };
  w.event("keydown");
  w.toggle();
  w.frame();
  assert.doesNotThrow(() => w.flushTimers());
  assert.equal(w.attrs.has("data-ylg-player-transition"), false);
});

test("unchanged mode cancels after three frames without scheduling timer", () => {
  const w = world();
  w.event();
  w.frame();
  w.frame();
  w.frame();
  assert.equal(w.raf.size, 0);
  assert.equal(w.timers.size, 0);
  assert.equal(w.syncCalls, 0);
  assert.equal(w.refreshCalls, 0);
});

test("rapid reversal cancels prior settle timer so sync+refresh only fire once for latest toggle", () => {
  const w = world();
  w.event(); w.toggle(); w.frame();
  const firstTimerId = [...w.timers.keys()][0];
  w.event(); w.toggle(); w.frame();
  assert.equal(w.timers.has(firstTimerId), false);
  assert.equal(w.timers.size, 1);
  w.flushTimers();
  assert.equal(w.syncCalls, 1);
  assert.equal(w.refreshCalls, 1);
});

test("editing, modified/repeat keys, reduced motion, Motion off, miniplayer, and fullscreen skip work", () => {
  for (const extra of [{ repeat: true }, { ctrlKey: true }, { altKey: true }, { target: { closest: () => true } }]) {
    const w = world(); w.event("keydown", extra); assert.equal(w.raf.size, 0);
  }
  const a = world(); a.reduce(true); a.event(); assert.equal(a.raf.size, 0);
  const b = world(); b.attrs.set("data-ylg-motion", "off"); b.event(); assert.equal(b.raf.size, 0);
  const c = world(); c.root.document.fullscreenElement = {}; c.event(); assert.equal(c.raf.size, 0);
  const d = world({ miniplayer: true }); d.event(); assert.equal(d.raf.size, 0);
});

test("explicit system-motion opt-out permits player settle without bypassing Motion off", () => {
  const w = world(); w.reduce(true); w.attrs.set("data-ylg-system-motion", "ignore");
  w.event(); w.toggle(); w.frame(); w.flushTimers();
  assert.equal(w.syncCalls, 1); assert.equal(w.refreshCalls, 1);
  w.attrs.set("data-ylg-motion", "off"); w.event(); assert.equal(w.raf.size, 0);
});

test("teardown cancels pending frames and timers, removes listeners, and ignores stale callbacks", () => {
  const w = world();
  w.event();
  const queuedFrame = [...w.raf.values()][0];
  w.root.YLG_PLAYER_MOTION.teardown();
  w.toggle();
  queuedFrame();
  assert.equal(w.timers.size, 0);
  assert.equal(w.listeners.size, 0);
  w.root.YLG_PLAYER_MOTION.init();
  w.event(); w.toggle(); w.frame();
  const queuedTimer = [...w.timers.values()][0].fn;
  w.root.YLG_PLAYER_MOTION.teardown();
  assert.equal(w.timers.size, 0);
  queuedTimer();
  assert.equal(w.syncCalls, 0);
  assert.equal(w.refreshCalls, 0);
});

console.log(`${passed} player motion regressions passed (VM; no rendered-frame claim).`);
