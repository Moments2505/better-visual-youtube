"use strict";
// Execute the production module against a tree-backed DOM and local wall clock.
// These tests cover state/lifecycle and bounded work, not browser FPS or pixels.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { makeEl, queryAll } = require("./dom-fixture");
const filename = path.join(__dirname, "../src/content/daylight-background.js");
const source = () => fs.readFileSync(filename, "utf8");

function target(object = {}) {
  const listeners = new Map();
  return Object.assign(object, {
    listeners,
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name) { for (const fn of [...listeners.get(name) || []]) fn({ type: name }); },
    listenerCount() { return [...listeners.values()].reduce((n, set) => n + set.size, 0); }
  });
}

function snapshot(changes = {}) {
  return {
    enabled: true,
    motion: true,
    daylightBackground: { enabled: true, scene: "auto", intensity: 0.45 },
    ...changes
  };
}

function world({ hour = 12, minute = 0, route = "/", bodyReady = true } = {}) {
  let now = new Date(2026, 10, 6, hour, minute, 0, 0).getTime();
  let serial = 0;
  const timers = new Map();
  const html = makeEl("html"), body = makeEl("body");
  if (bodyReady) html.appendChild(body);
  const work = { frames: 0, intervals: 0, observers: 0, canvases: 0 };
  const doc = target({
    documentElement: html, body: bodyReady ? body : null,
    hidden: false, readyState: bodyReady ? "complete" : "loading",
    createElement(tag) {
      if (String(tag).toLowerCase() === "canvas") work.canvases++;
      return makeEl(tag);
    },
    getElementById(id) { return queryAll({ children: [html] }, "#" + id)[0] || null; },
    querySelectorAll(selector) { return queryAll({ children: [html] }, selector); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  });
  const reduced = target({ matches: false });
  const forced = target({ matches: false });
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = target({
    console, document: doc, Date: Clock,
    location: { pathname: route, search: "" },
    matchMedia(query) { return query.includes("forced-colors") ? forced : reduced; },
    setTimeout(fn, delay) { timers.set(++serial, { fn, delay, at: now + delay }); return serial; },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { work.intervals++; throw new Error("daylight must not poll"); },
    clearInterval() {},
    requestAnimationFrame() { work.frames++; throw new Error("daylight must not have a JS frame loop"); },
    cancelAnimationFrame() {},
    MutationObserver: class { constructor() { work.observers++; throw new Error("daylight must not observe the page tree"); } }
  });
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../src/shared/sky-environment.js"),"utf8"),context);
  vm.runInNewContext(source(), context, { filename });
  return {
    api: context.YLG_DAYLIGHT, context, doc, html, body, reduced, forced, timers, work,
    host: () => doc.getElementById("ylg-daylight-background"),
    setClock(hour, minute = 0, second = 0) { now = new Date(2026, 10, 6, hour, minute, second, 0).getTime(); },
    now: () => now,
    navigate(pathname) { context.location.pathname = pathname; doc.emit("yt-navigate-finish"); },
    hide(value) { doc.hidden = value; doc.emit("visibilitychange"); },
    media(which, value) { const q = which === "forced" ? forced : reduced; q.matches = value; q.emit("change"); },
    fireNext() {
      const item = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      assert.ok(item, "a next local-clock boundary is scheduled");
      const [id, timer] = item; timers.delete(id); now = timer.at; timer.fn();
    },
    ready() { doc.body = body; html.appendChild(body); doc.readyState = "complete"; doc.emit("DOMContentLoaded"); },
    listeners() { return doc.listenerCount() + context.listenerCount() + reduced.listenerCount() + forced.listenerCount(); }
  };
}

let count = 0;
function test(name, run) { run(); count++; console.log("PASS " + name); }
function scene(w, expected) {
  assert.equal(w.api.stats().scene, expected);
  assert.equal(w.host()?.getAttribute("data-scene"), expected);
  assert.equal(w.html.getAttribute("data-ylg-daylight"), expected);
}

test("default/disabled snapshots create no background; enabling does not duplicate its host", () => {
  const w = world();
  w.api.init(); w.api.init(); w.api.updateSettings({ enabled: true });
  assert.equal(w.host(), null); assert.equal(w.timers.size, 0);
  w.api.updateSettings(snapshot());
  const host = w.host(), listeners = w.listeners();
  assert.ok(host?.isConnected); scene(w, "day");
  for (let i = 0; i < 20; i++) { w.api.init(); w.api.updateSettings(snapshot()); }
  assert.equal(w.host(), host);
  assert.equal(w.doc.querySelectorAll("#ylg-daylight-background").length, 1);
  assert.equal(w.listeners(), listeners); assert.equal(w.timers.size, 1);
});

test("auto scenes follow exact local-clock boundaries including midnight", () => {
  for (const [hour, minute, expected] of [
    [0, 0, "night"], [4, 59, "night"], [5, 0, "morning"], [9, 59, "morning"],
    [10, 0, "day"], [15, 59, "day"], [16, 0, "sunset"], [18, 59, "sunset"],
    [19, 0, "night"], [23, 59, "night"]
  ]) {
    const w = world({ hour, minute }); w.api.updateSettings(snapshot()); scene(w, expected);
    assert.equal(w.timers.size, 1);
    assert.ok(w.api.stats().nextChangeAt > w.now());
  }
});

test("one coarse timer changes scenes at successive boundaries and schedules the next local morning", () => {
  const w = world({ hour: 4, minute: 30 }); w.api.updateSettings(snapshot());
  assert.equal([...w.timers.values()][0].delay, 30 * 60 * 1000);
  for (const expected of ["morning", "day", "sunset", "night", "morning"]) {
    w.fireNext(); scene(w, expected); assert.equal(w.timers.size, 1);
  }
  assert.equal(new Date(w.now()).getDate(), 7);
  assert.deepEqual(w.work, { frames: 0, intervals: 0, observers: 0, canvases: 0 });
});

test("explicit scenes and live intensity apply without polling or replacing the scene tree", () => {
  const w = world(); w.api.updateSettings(snapshot()); const host = w.host();
  for (const selected of ["night", "morning", "sunset", "day"]) {
    w.api.updateSettings(snapshot({ daylightBackground: { enabled: true, scene: selected, intensity: 0.7 } }));
    scene(w, selected); assert.equal(w.host(), host); assert.equal(w.timers.size, 0);
    assert.equal(w.api.stats().nextChangeAt, null);
    assert.equal(Number(host.style.getPropertyValue("--ylg-daylight-intensity")), 0.7);
  }
  w.setClock(21); w.api.updateSettings(snapshot()); scene(w, "night"); assert.equal(w.timers.size, 1);
});

test("only home and search mount; SPA route exits unmount and later entries restore", () => {
  const w = world(); w.api.updateSettings(snapshot());
  for (const pathname of ["/watch", "/shorts/123", "/@channel", "/channel/id", "/feed/subscriptions", "/playlist", "/results-other"]) {
    w.navigate(pathname); assert.equal(w.host(), null, pathname); assert.equal(w.timers.size, 0, pathname);
    assert.equal(w.api.stats().eligiblePage, false, pathname);
    assert.equal(w.html.hasAttribute("data-ylg-daylight"), false, pathname);
    w.navigate("/results"); scene(w, "day"); assert.equal(w.api.stats().eligiblePage, true);
  }
  w.context.location.pathname = "/"; w.context.emit("popstate"); scene(w, "day");
});

test("a pending SPA navigation removes the scene before the next player/page can paint", () => {
  const w=world(); w.api.updateSettings(snapshot()); scene(w,"day");
  const cancelled=[...w.timers.values()][0].fn;
  w.doc.emit("yt-navigate-start");
  assert.equal(w.host(),null); assert.equal(w.timers.size,0);
  assert.equal(w.html.hasAttribute("data-ylg-daylight"),false);
  cancelled(); assert.equal(w.host(),null,"cancelled clock cannot remount during navigation");
  w.navigate("/watch"); assert.equal(w.host(),null);
  w.navigate("/results"); scene(w,"day");
});

test("Animate sky is independent of interface Motion; reduced motion still pauses it", () => {
  const w = world(); w.api.updateSettings(snapshot()); const host = w.host();
  assert.equal(w.api.stats().moving, true);
  w.api.updateSettings(snapshot({ motion: false }));
  scene(w, "day"); assert.equal(w.host(), host); assert.equal(w.api.stats().moving, true);
  w.api.updateSettings(snapshot({ motion: true, daylightBackground: { enabled:true, animate:false, scene:"night", intensity:.45 } }));
  scene(w,"night"); assert.equal(w.api.stats().moving,false);
  assert.equal(w.host().getAttribute("data-moving"),"false");
  w.api.updateSettings(snapshot()); assert.equal(w.api.stats().moving, true);
  w.media("reduced", true); scene(w, "day"); assert.equal(w.api.stats().moving, false);
  w.media("reduced", false); assert.equal(w.api.stats().moving, true);
});

test("hidden pages pause animation and clock work; visibility catches up to the local time", () => {
  const w = world(); w.api.updateSettings(snapshot()); const host = w.host();
  w.hide(true); assert.equal(w.api.stats().animationPaused, true); assert.equal(w.timers.size, 0);
  assert.equal(w.host(), host);
  w.setClock(22); w.hide(false); scene(w, "night");
  assert.equal(w.api.stats().animationPaused, false); assert.equal(w.timers.size, 1);
});

test("forced colors removes decorative scene and leaving forced colors restores settings", () => {
  const w = world(); w.api.updateSettings(snapshot());
  w.media("forced", true); assert.equal(w.host(), null); assert.equal(w.timers.size, 0);
  assert.equal(w.html.hasAttribute("data-ylg-daylight"), false);
  w.media("forced", false); scene(w, "day");
});

test("master off and per-feature off remove the background without changing saved scene choice", () => {
  const w = world(); const selected = { enabled: true, scene: "night", intensity: 0.2 };
  const settings = snapshot({ daylightBackground: selected });
  w.api.updateSettings(settings); scene(w, "night");
  w.api.updateSettings({ ...settings, enabled: false }); assert.equal(w.host(), null); assert.equal(w.timers.size, 0);
  w.api.updateSettings(settings); scene(w, "night");
  w.api.updateSettings({ ...settings, daylightBackground: { ...selected, enabled: false } }); assert.equal(w.host(), null);
  assert.deepEqual(selected, { enabled: true, scene: "night", intensity: 0.2 });
  w.api.updateSettings(settings); scene(w, "night");
});

test("document-start waits for body; teardown prevents a late readiness callback resurrecting the scene", () => {
  const w = world({ bodyReady: false }); w.api.updateSettings(snapshot()); assert.equal(w.host(), null);
  w.ready(); scene(w, "day");
  const late = world({ bodyReady: false }); late.api.updateSettings(snapshot());
  const callbacks = [...late.doc.listeners.get("DOMContentLoaded") || []];
  late.api.teardown(); late.ready(); for (const fn of callbacks) fn();
  assert.equal(late.host(), null); assert.equal(late.listeners(), 0); assert.equal(late.timers.size, 0);
});

test("teardown releases all work; stale timers cannot resurrect or interfere with a reinitialized scene", () => {
  const w = world(); w.api.updateSettings(snapshot());
  const stale = [...w.timers.values()][0].fn;
  w.api.teardown(); w.api.teardown(); stale();
  assert.equal(w.host(), null); assert.equal(w.listeners(), 0); assert.equal(w.timers.size, 0);
  assert.equal(w.api.stats().initialized, false);
  assert.equal(w.html.hasAttribute("data-ylg-daylight"), false);
  w.api.updateSettings(snapshot({ daylightBackground: { enabled: true, scene: "morning", intensity: 0.3 } }));
  const host = w.host(); scene(w, "morning"); stale();
  assert.equal(w.host(), host); scene(w, "morning"); assert.equal(w.timers.size, 0);
});

test("a cancelled old auto callback cannot clear a newer boundary timer after a route round trip", () => {
  const w = world(); w.api.updateSettings(snapshot()); const stale = [...w.timers.values()][0].fn;
  w.navigate("/watch"); w.navigate("/");
  assert.equal(w.timers.size, 1); const current = [...w.timers.keys()][0]; stale();
  assert.equal(w.timers.size, 1); assert.ok(w.timers.has(current)); scene(w, "day");
});

test("snapshot mutation cannot silently enable animation or change the saved scene", () => {
  const w = world();
  const settings = snapshot({ motion: false, daylightBackground: { enabled: true, animate: false, scene: "night", intensity: 0.3 } });
  w.api.updateSettings(settings);
  settings.motion = true; settings.daylightBackground.animate = true; settings.daylightBackground.scene = "morning"; settings.daylightBackground.intensity = 1;
  w.hide(true); w.hide(false);
  scene(w, "night"); assert.equal(w.api.stats().moving, false);
  assert.equal(Number(w.host().style.getPropertyValue("--ylg-daylight-intensity")), 0.3);
});

test("manual RAIN is a local visual choice with bounded reusable layers and no weather access", () => {
  const w = world(), messages = weatherBridge(w);
  const choice = { enabled: true, animate: true, rain: true, scene: "night", intensity: 0.45 };
  const settings = snapshot({ motion: false, daylightBackground: choice });
  const saved = JSON.stringify(settings);
  w.api.updateSettings(settings);
  const host = w.host(), clouds = host.querySelector(".ylg-daylight-clouds"), precipitation = host.querySelector(".ylg-daylight-precipitation");
  scene(w, "night");
  assert.equal(host.getAttribute("data-rain"), "true");
  assert.equal(host.hasAttribute("data-live"), false);
  assert.equal(host.hasAttribute("data-weather"), false, "manual rain must not invent actual weather");
  assert.equal(w.api.stats().weather, null);
  assert.equal(w.api.stats().moving, true, "interface Motion must not disable rain animation");
  assert.ok(clouds && precipitation);
  for (let i = 0; i < 10; i++) {
    w.api.updateSettings(snapshot({ daylightBackground: { ...choice, rain: false } }));
    assert.equal(w.host().getAttribute("data-rain"), "false");
    w.api.updateSettings(settings);
  }
  assert.equal(w.host(), host);
  assert.equal(host.querySelector(".ylg-daylight-clouds"), clouds);
  assert.equal(host.querySelector(".ylg-daylight-precipitation"), precipitation);
  assert.equal(host.children.length, 6, "rain reuses the existing two weather layers");
  assert.equal(messages.length, 0, "manual rain must not request location or weather");
  assert.equal(JSON.stringify(settings), saved, "rendering must preserve the saved scene and input settings");
  assert.deepEqual(w.work, { frames: 0, intervals: 0, observers: 0, canvases: 0 });
});

test("RAIN pauses with Animate sky, zero intensity, reduced motion and hidden pages, then restores on eligible routes", () => {
  const w = world();
  const settings = snapshot({ motion: false, daylightBackground: { enabled: true, animate: true, rain: true, scene: "night", intensity: 0.45 } });
  w.api.updateSettings(settings);
  const host = w.host();
  const paused = () => {
    assert.equal(w.host().getAttribute("data-rain"), "true");
    assert.equal(w.host().getAttribute("data-moving"), "false");
    assert.equal(w.api.stats().animationPaused, true);
  };
  w.api.updateSettings({ ...settings, daylightBackground: { ...settings.daylightBackground, animate: false } }); paused();
  w.api.updateSettings(settings); assert.equal(w.api.stats().moving, true);
  w.api.updateSettings({ ...settings, daylightBackground: { ...settings.daylightBackground, intensity: 0 } }); paused();
  w.api.updateSettings(settings); assert.equal(w.api.stats().moving, true);
  w.media("reduced", true); paused();
  w.media("reduced", false); assert.equal(w.api.stats().moving, true);
  w.hide(true); paused(); assert.equal(w.timers.size, 0);
  w.hide(false); assert.equal(w.host(), host); assert.equal(w.api.stats().moving, true);
  w.navigate("/results"); assert.equal(w.host(), host); assert.equal(host.getAttribute("data-rain"), "true");
  w.navigate("/watch"); assert.equal(w.host(), null); assert.equal(w.timers.size, 0);
  w.navigate("/"); assert.equal(w.host().getAttribute("data-rain"), "true"); scene(w, "night");
});

test("RAIN defaults off and a caller cannot enable it by mutating an earlier snapshot", () => {
  const w = world(), settings = snapshot();
  w.api.updateSettings(settings); assert.equal(w.host().getAttribute("data-rain"), "false");
  assert.equal(w.host().children.length, 4, "dry default needs no precipitation layers");
  settings.daylightBackground.rain = true;
  w.hide(true); w.hide(false);
  assert.equal(w.host().getAttribute("data-rain"), "false");
  w.api.updateSettings(settings); assert.equal(w.host().getAttribute("data-rain"), "true");
  settings.daylightBackground.rain = false;
  w.hide(true); w.hide(false);
  assert.equal(w.host().getAttribute("data-rain"), "true");
});

test("an opt-in scene stays decorative with bounded DOM and compositor-only animation properties", () => {
  const w = world(); w.api.updateSettings(snapshot());
  assert.equal(w.host().getAttribute("aria-hidden"), "true");
  assert.ok(w.host().children.length <= 4, "the sky must not create one DOM element per star");
  assert.deepEqual(w.work, { frames: 0, intervals: 0, observers: 0, canvases: 0 });
  const css = fs.readFileSync(path.join(__dirname, "../src/styles/daylight-background.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /pointer-events:\s*none/);
  assert.doesNotMatch(css, /(?:backdrop-filter|filter)\s*:|url\s*\(/i, "the extra sky must not sample or fetch images");
  const declarations = [];
  for (const hit of css.matchAll(/@keyframes\s+[\w-]+\s*\{/g)) {
    let cursor = hit.index + hit[0].length, depth = 1, text = "";
    for (; cursor < css.length && depth; cursor++) {
      const char = css[cursor]; if (char === "{") depth++; if (char === "}") depth--; if (depth) text += char;
    }
    for (const declaration of text.matchAll(/([\w-]+)\s*:/g)) declarations.push(declaration[1]);
  }
  assert.ok(declarations.length > 0);
  assert.ok(declarations.every(property => property === "transform" || property === "opacity"), declarations.join(", "));
});

function liveSnapshot(extra={}) {
  return snapshot({motion:false,daylightBackground:{enabled:true,animate:true,liveWeather:true,scene:"auto",intensity:.6,
    location:{name:"Hà Nội",latitude:21.0285,longitude:105.8542},...extra}});
}
function weatherBridge(w) {
  const messages=[];w.context.chrome={runtime:{sendMessage:(message,reply)=>messages.push({message,reply})}};return messages;
}
function replyWeather(w,message) { message.reply({status:"current",weather:{time:w.now(),kind:"rain",cloud:.8,temperature:29,wind:10},nextRefreshAt:w.now()+900000}); }
test("RAIN switch controls the overlay on/off/on while preserving every actual weather condition", () => {
  for (const kind of ["clear", "snow", "rain", "storm"]) {
    const w = world(), messages = weatherBridge(w);
    w.api.updateSettings(liveSnapshot({ rain: true }));
    const actual = Object.freeze({ time: w.now(), kind, cloud: kind === "clear" ? 0 : 0.8, temperature: kind === "snow" ? -2 : 24, wind: 6 });
    const saved = JSON.stringify(actual);
    messages[0].reply({ status: "current", weather: actual, nextRefreshAt: w.now() + 900000 });
    const host = w.host(), clouds = host.querySelector(".ylg-daylight-clouds"), precipitation = host.querySelector(".ylg-daylight-precipitation");
    assert.equal(host.getAttribute("data-rain"), "true", kind);
    assert.equal(host.getAttribute("data-weather"), kind, "actual weather remains separate from the rain overlay");
    assert.equal(JSON.stringify(w.api.stats().weather), saved);
    w.api.updateSettings(liveSnapshot({ rain: false }));
    assert.equal(host.getAttribute("data-rain"), "false", "RAIN off must remove rain visuals even when live weather is " + kind);
    assert.equal(w.api.stats().rain, false);
    assert.equal(host.getAttribute("data-weather"), kind, "turning off RAIN keeps the original weather record");
    assert.equal(Number(host.style.getPropertyValue("--ylg-cloud-cover")), actual.cloud);
    assert.equal(JSON.stringify(actual), saved);
    assert.equal(JSON.stringify(w.api.stats().weather), saved);
    assert.equal(host.querySelector(".ylg-daylight-clouds"), clouds);
    assert.equal(host.querySelector(".ylg-daylight-precipitation"), precipitation);
    w.api.updateSettings(liveSnapshot({ rain: true }));
    assert.equal(host.getAttribute("data-rain"), "true", kind);
    assert.equal(w.api.stats().rain, true);
    assert.equal(host.getAttribute("data-weather"), kind);
    assert.equal(JSON.stringify(w.api.stats().weather), saved);
    assert.equal(host.children.length, 6); assert.equal(messages.length, 1);
  }
});

test("a late rain/storm weather reply cannot re-enable RAIN after the switch is off", () => {
  for (const kind of ["rain", "storm"]) {
    const w = world(), calls = [], messages = weatherBridge(w);
    w.context.YLG_SKY_RENDERER = { create() { return { update(value) { calls.push(value); }, resize() {}, teardown() {}, stats() { return { active: true }; } }; } };
    w.api.updateSettings(liveSnapshot({ rain: true }));
    const host = w.host(), pending = messages[0], solar = JSON.stringify(w.api.stats().solar);
    assert.equal(host.getAttribute("data-rain"), "true");
    w.api.updateSettings(liveSnapshot({ rain: false }));
    assert.equal(host.getAttribute("data-rain"), "false");
    const actual = Object.freeze({ time: w.now(), kind, cloud: .8, temperature: 24, wind: 6 });
    pending.reply({ status: "current", weather: actual, nextRefreshAt: w.now() + 900000 });
    assert.equal(host.getAttribute("data-rain"), "false", kind + " arriving after RAIN off must not restart the overlay");
    assert.equal(host.getAttribute("data-weather"), kind);
    assert.equal(w.api.stats().rain, false);
    assert.equal(JSON.stringify(w.api.stats().solar), solar, "RAIN does not change the local solar calculation");
    assert.equal(JSON.stringify(w.api.stats().weather), JSON.stringify(actual));
    assert.equal(Number(host.style.getPropertyValue("--ylg-cloud-cover")), actual.cloud);
    assert.equal(calls.at(-1).rain, false);
    assert.equal(calls.at(-1).weather.kind, kind);
    w.api.updateSettings(liveSnapshot({ rain: true }));
    assert.equal(host.getAttribute("data-rain"), "true");
    assert.equal(calls.at(-1).rain, true);
    assert.equal(calls.at(-1).weather.kind, kind);
    assert.equal(messages.length, 1, "switch changes reuse the same actual weather response");
  }
});

test("manual RAIN remains available when live weather permission is denied", () => {
  const w = world(), messages = weatherBridge(w);
  w.api.updateSettings(liveSnapshot({ rain: true }));
  messages[0].reply({ status: "permission" });
  assert.equal(w.api.stats().weatherStatus, "permission");
  assert.equal(w.api.stats().weather, null);
  assert.equal(w.host().getAttribute("data-rain"), "true");
  assert.equal(w.host().getAttribute("data-weather"), "unknown");
  w.api.updateSettings(liveSnapshot({ rain: false }));
  assert.equal(w.host().getAttribute("data-rain"), "false");
});
test("live sky uses six bounded layers, one minute timer, and cached weather without a frame loop",()=>{
  const w=world(),messages=weatherBridge(w);w.api.updateSettings(liveSnapshot());
  assert.equal(w.host().getAttribute("data-live"),"true");assert.equal(w.host().children.length,6);
  assert.equal(messages.length,1);replyWeather(w,messages[0]);
  assert.equal(w.host().getAttribute("data-weather"),"rain");assert.equal(w.api.stats().weatherStatus,"current");
  for(let i=0;i<10;i++){w.fireNext();assert.equal(w.timers.size,1);}
  assert.equal(messages.length,1);
  assert.deepEqual(w.work,{frames:0,intervals:0,observers:0,canvases:0});
  w.api.updateSettings(liveSnapshot({animate:false}));assert.equal(w.api.stats().moving,false);assert.equal(w.api.stats().liveWeather,true);
  w.hide(true);assert.equal(w.timers.size,0);w.setClock(23);w.hide(false);assert.equal(messages.length,2);
});
test("late weather replies cannot repaint another city, a manual scene, or a player route",()=>{
  const w=world(),messages=weatherBridge(w);w.api.updateSettings(liveSnapshot());
  w.api.updateSettings(liveSnapshot({location:{name:"Tokyo",latitude:35.68,longitude:139.69}}));
  assert.equal(messages.length,2);replyWeather(w,messages[0]);assert.equal(w.host().getAttribute("data-weather"),"unknown");
  replyWeather(w,messages[1]);assert.equal(w.host().getAttribute("data-weather"),"rain");
  w.api.updateSettings(liveSnapshot({scene:"night"}));assert.equal(w.host().hasAttribute("data-live"),false);assert.equal(w.host().hasAttribute("data-weather"),false);
  w.api.updateSettings(liveSnapshot());const late=messages.at(-1);
  w.doc.emit("yt-navigate-start");w.navigate("/watch");replyWeather(w,late);
  assert.equal(w.host(),null);assert.equal(w.timers.size,0);
});
test("live sky survives offline/permission denial, pauses while hidden, and cancels callbacks on teardown",()=>{
  const w=world(),messages=weatherBridge(w);w.api.updateSettings(liveSnapshot());
  messages[0].reply({status:"permission"});assert.equal(w.api.stats().weatherStatus,"permission");assert.ok(w.api.stats().solar);
  assert.equal(w.host().getAttribute("data-weather"),"unknown");
  w.hide(true);assert.equal(w.api.stats().moving,false);assert.equal(w.timers.size,0);
  w.setClock(23);w.hide(false);const late=messages.at(-1);
  w.api.teardown();replyWeather(w,late);assert.equal(w.host(),null);assert.equal(w.timers.size,0);assert.equal(w.listeners(),0);
});
test("procedural renderer stays independent of weather access and is released across route changes",()=>{
  const w=world(),calls=[];
  w.context.YLG_SKY_RENDERER={create(){calls.push("create");return {update(s){calls.push(s);},resize(){calls.push("resize");},teardown(){calls.push("teardown");},stats(){return{active:true};}};}};
  w.api.updateSettings(liveSnapshot({liveWeather:false}));
  assert.equal(calls[0],"create");assert.equal(calls.at(-1).auto,true);assert.equal(calls.at(-1).weather,null);
  assert.equal(w.timers.size,1);assert.ok([...w.timers.values()][0].delay<=60000);
  w.hide(true);assert.equal(calls.at(-1).moving,false);assert.equal(w.timers.size,0);
  w.hide(false);assert.equal(calls.at(-1).moving,true);
  w.context.emit("resize");assert.equal(calls.at(-1),"resize");
  w.navigate("/watch");assert.equal(calls.at(-1),"teardown");assert.equal(w.host(),null);
  w.navigate("/");assert.equal(calls.filter(c=>c==="create").length,2);
  w.api.teardown();assert.equal(calls.at(-1),"teardown");assert.equal(w.listeners(),0);
});

test("renderer receives the manual rain flag separately from unchanged actual weather", () => {
  const w = world(), calls = [], messages = weatherBridge(w);
  w.context.YLG_SKY_RENDERER = { create() { return { update(value) { calls.push(value); }, resize() {}, teardown() {}, stats() { return { active: true }; } }; } };
  w.api.updateSettings(liveSnapshot({ rain: true }));
  const actual = Object.freeze({ time: w.now(), kind: "snow", cloud: 0.7, temperature: -2, wind: 6 });
  messages[0].reply({ status: "current", weather: actual, nextRefreshAt: w.now() + 900000 });
  assert.equal(calls.at(-1).rain, true);
  assert.equal(calls.at(-1).weather.kind, "snow");
  w.api.updateSettings(liveSnapshot({ rain: false }));
  assert.equal(calls.at(-1).rain, false);
  assert.equal(calls.at(-1).weather.kind, "snow");
  assert.equal(actual.kind, "snow");
});
console.log("All " + count + " daylight background regressions passed (VM state/lifecycle; not a GPU benchmark).");
