"use strict";
// Standalone node tests/navigation-regressions.js; real registry/navigation in VM.
// This is deterministic DOM/lifecycle coverage, not a live-YouTube visual claim.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { makeEl, queryAll, getComputedStyle } = require("./dom-fixture");
const tests = [];
const test = (name, run) => tests.push({ name, run });
function eventTarget(target = {}) {
  const listeners = new Map();
  return Object.assign(target, {
    listeners,
    addEventListener(name, cb) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(cb); },
    removeEventListener(name, cb) { listeners.get(name)?.delete(cb); },
    dispatch(name) { for (const cb of [...listeners.get(name) || []]) cb({ type: name }); }
  });
}
function world() {
  const html = makeEl("html"), body = makeEl("body"); html.appendChild(body);
  const document = eventTarget({ documentElement: html, body, fullscreenElement: null,
    querySelectorAll: selector => queryAll({ children: [html] }, selector),
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; } });
  const timers = new Map(), intervals = new Map(), observers = []; let id = 0;
  const context = eventTarget({ console, document, getComputedStyle, innerWidth: 1280, innerHeight: 720,
    location: { pathname: "/watch" }, history: { pushState() {}, replaceState() {} },
    setTimeout(cb) { timers.set(++id, cb); return id; }, clearTimeout(id) { timers.delete(id); },
    setInterval(cb) { intervals.set(++id, cb); return id; }, clearInterval(id) { intervals.delete(id); },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
      observe(target, options) { this.targets.push({ target, options }); }
      disconnect() { this.targets = []; }
      trigger() { this.callback([]); }
    }
  });
  context.window = context; vm.createContext(context);
  for (const file of ["src/content/selector-registry.js", "src/content/navigation.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context, { filename: file });
  }
  function player(parent = body, { watch = true, id = "movie_player" } = {}) {
    const flexy = watch ? makeEl("ytd-watch-flexy") : parent;
    if (watch) parent.appendChild(flexy);
    const wrapper = makeEl(); wrapper.setAttribute("id", "player-container"); flexy.appendChild(wrapper);
    const container = makeEl(); container.setAttribute("id", id); container.classList.add("html5-video-player"); wrapper.appendChild(container);
    const video = makeEl("video"); video.classList.add("html5-main-video", "video-stream"); container.appendChild(video);
    return { flexy, wrapper, container, video };
  }
  return { context, document, body, html, timers, intervals, observers, player, nav: context.YLG_NAV,
    flush() { while (timers.size) { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(cb => cb()); } } };
}
function selected(w, player, mode) {
  const actual = w.nav.getPlayer();
  assert.equal(actual.container, player?.container || null, "container");
  assert.equal(actual.video, player?.video || null, "scoped video");
  assert.equal(actual.mode, mode, "mode");
}

test("fixture selectors use compound/list/descendant matching, scope and containment", () => {
  const w = world(); const a = w.player(); const b = w.player();
  assert.equal(w.document.querySelectorAll("#movie_player, .html5-video-player").length, 2, "list deduplicates in tree order");
  assert.equal(a.container.querySelector("video.video-stream"), a.video);
  assert.equal(a.container.querySelector("ytd-watch-flexy video"), a.video);
  assert.equal(a.video.querySelector("video"), null, "element queries exclude self");
  assert.equal(a.container.contains(b.video), false); assert.equal(a.container.contains(a.video), true);
  assert.equal(a.container.parentElement, a.wrapper);
  a.flexy.remove(); assert.equal(a.video.isConnected, false);
});

test("normal/theater follow owning watch, not an unrelated stale watch", () => {
  const w = world(); const stale = w.player(); stale.flexy.setAttribute("theater", ""); stale.flexy.hidden = true;
  const live = w.player(); selected(w, live, "normal");
  live.flexy.setAttribute("theater", ""); selected(w, live, "theater");
  live.flexy.removeAttribute("theater"); selected(w, live, "normal");
});
for (const [name, hide] of [
  ["hidden attribute", el => { el.hidden = true; }],
  ["aria-hidden", el => el.setAttribute("aria-hidden", "true")],
  ["display none", el => { el.style.display = "none"; }],
  ["visibility hidden", el => { el.style.visibility = "hidden"; }],
  ["visibility collapse", el => { el.style.visibility = "collapse"; }],
  ["opacity zero", el => { el.style.opacity = "0"; }]
]) test("reject player with ancestor " + name + " without reviving wrapper", () => {
  const w = world(); const p = w.player(); hide(p.flexy); selected(w, null, null);
});

test("zero-size player is rejected rather than revived through visible wrapper", () => {
  const w = world(); const p = w.player(); p.container.rect.width = 0; selected(w, null, null);
});

test("visible mini wins, selects own video and never unrelated watch video", () => {
  const w = world(); w.player(); const mini = makeEl("ytd-miniplayer"); w.body.appendChild(mini);
  const p = w.player(mini, { watch: false, id: "mini-player" }); selected(w, p, "miniplayer");
});

test("hidden/offscreen/empty mini cannot disable visible watch", () => {
  const w = world(); const live = w.player(); const mini = makeEl("ytd-miniplayer"); w.body.appendChild(mini);
  const p = w.player(mini, { watch: false, id: "mini-player" });
  mini.hidden = true; selected(w, live, "normal"); mini.hidden = false;
  p.container.rect.left = 1300; p.video.rect.left = 1300; selected(w, live, "normal");
  p.container.rect.left = 0; p.video.rect.left = 0; p.video.remove(); selected(w, live, "normal");
});

test("recycled minimized class and watch miniplayer attribute gate independently", () => {
  const w = world(); const p = w.player(); p.container.classList.add("ytp-player-minimized");
  selected(w, p, "miniplayer"); p.container.classList.remove("ytp-player-minimized");
  p.flexy.setAttribute("miniplayer", ""); selected(w, p, "miniplayer");
  p.flexy.removeAttribute("miniplayer"); selected(w, p, "normal");
});

test("fullscreen descendant/ancestor containment wins stale mini/theater; Shorts remains gated", () => {
  const w = world(); const p = w.player(); p.flexy.setAttribute("theater", ""); p.container.classList.add("ytp-player-minimized");
  w.document.fullscreenElement = p.video; selected(w, p, "fullscreen");
  w.document.fullscreenElement = p.flexy; selected(w, p, "fullscreen");
  w.context.location.pathname = "/shorts/123"; selected(w, p, "shorts");
});

test("player replacement bypasses connected-node registry caches without navigation", () => {
  const w = world(); const old = w.player(); selected(w, old, "normal");
  const next = w.player(); old.flexy.hidden = true; selected(w, next, "normal");
  next.video.remove(); const video = makeEl("video"); video.classList.add("video-stream"); next.container.appendChild(video);
  selected(w, { ...next, video }, "normal");
});

test("fallback wrapper resolves its scoped video only when no rejected player is inside", () => {
  const w = world(); const p = w.player(); p.container.remove(); p.wrapper.appendChild(p.video);
  selected(w, { container: p.wrapper, video: p.video }, "normal");
});

test("init is idempotent; mode observer uses exact targets and refreshes after SPA", () => {
  const w = world(); const old = w.player(); w.nav.init(); w.nav.init();
  assert.equal(w.observers.length, 2); assert.equal(w.intervals.size, 1);
  const mode = w.observers.find(observer => observer.targets.some(t => t.options.attributes));
  assert.ok(mode.targets.some(t => t.target === old.flexy && t.options.attributeFilter.includes("miniplayer")));
  assert.ok(mode.targets.every(t => !t.options.subtree));
  let notifications = 0; w.nav.onNavigation(() => { notifications++; });
  mode.trigger(); mode.trigger(); assert.equal(w.timers.size, 1); w.flush(); assert.equal(notifications, 1);
  old.flexy.remove(); const next = w.player(); w.document.dispatch("yt-navigate-finish"); w.flush();
  assert.ok(mode.targets.some(t => t.target === next.container));
  assert.ok(mode.targets.every(t => t.target !== old.container)); selected(w, next, "normal");
});

test("teardown cancels all resources and stale observer callback; reinit binds once", () => {
  const w = world(); w.player(); w.nav.init(); let notifications = 0;
  const unsubscribe = w.nav.onNavigation(() => { notifications++; });
  w.document.dispatch("yt-navigate-finish"); const queued = [...w.timers.values()]; const oldObservers = [...w.observers];
  w.nav.teardown(); assert.equal(w.timers.size, 0); assert.equal(w.intervals.size, 0);
  assert.ok(oldObservers.every(o => o.targets.length === 0));
  for (const listeners of w.document.listeners.values()) assert.equal(listeners.size, 0);
  queued.forEach(cb => cb()); oldObservers.forEach(o => o.trigger()); w.flush(); assert.equal(notifications, 0);
  // disconnect() discards queued mutation records in a real DOM. Do not invent
  // callbacks from disconnected child-list observers after reinitialization.
  w.nav.init(); assert.equal(w.intervals.size, 1);
  assert.equal(w.observers.filter(o => o.targets.length > 0).length, 2);
  assert.equal(notifications, 0);
  w.document.dispatch("yt-navigate-finish"); w.flush(); assert.equal(notifications, 1);
  unsubscribe(); w.document.dispatch("fullscreenchange"); assert.equal(notifications, 1); w.nav.teardown();
});
test("player UI churn skips page rescans but video replacement and page changes reconcile", () => {
  const w = world(); const p = w.player(); w.nav.init();
  const observer = w.observers.find(o => o.targets.some(t => t.options.childList));
  const label = makeEl("span"); p.container.appendChild(label);
  observer.callback([{target:label,addedNodes:[],removedNodes:[]}]);
  assert.equal(w.timers.size,0,"timeline/label churn must not schedule a full pass");
  observer.callback([{target:p.container,addedNodes:[makeEl("video")],removedNodes:[]}]);
  assert.equal(w.timers.size,1,"replacement video must still be discovered"); w.flush();
  observer.callback([{target:w.body,addedNodes:[makeEl("ytd-rich-item-renderer")],removedNodes:[]}]);
  assert.equal(w.timers.size,1,"page surfaces must still be tagged");w.nav.teardown();
});
let passed = 0;
for (const { name, run } of tests) {
  try { run(); console.log("PASS " + name); passed++; }
  catch (error) { console.error("FAIL " + name + "\n" + error.stack); }
}
console.log(`\nNavigation regressions: ${passed}/${tests.length} passed`);
if (passed !== tests.length) process.exitCode = 1;
