"use strict";
// Standalone: node tests/ambient-bridge-regressions.js. No browser or dependencies.
// Execute the real bridge in a fresh VM per case; storage callbacks and renderer
// promises are controlled independently to exercise actual queue interleavings.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { makeEl } = require("./dom-fixture");
const upstreamDefaults = {
  "setting-headerShadowSize": 0, "setting-headerFillOpacity": 100,
  "setting-headerImagesOpacity": 100, "setting-surroundingContentShadowSize": 15,
  "setting-surroundingContentFillOpacity": 10, "setting-surroundingContentImagesOpacity": 100,
  "setting-pageBackgroundGreyness": 0
};
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const bridgeFile = "src/ambient/ambient-vendor-bridge.js";
// Pin one source revision across all asynchronous cases while A6 is editing.
const bridgeSource = read(bridgeFile);
console.log("Bridge SHA256 " + require("node:crypto").createHash("sha256").update(bridgeSource).digest("hex"));
const plain = value => JSON.parse(JSON.stringify(value));
const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
// A host event-loop turn drains nested VM/host promise jobs without wall-clock sleeps.
const settle = () => new Promise(resolve => setImmediate(resolve));
const settings = (ambient = {}, enabled = true) => ({ enabled, ambientLight: {
  enabled: true, quality: "balanced", blur: 60, brightness: 1, saturation: 1.1,
  fpsLimit: 12, spread: 100, intensity: 0.55,
  modes: { normal: true, theater: true, fullscreen: false }, ...ambient
} });
function harness({ manual = false, initial = settings(), stored = {} } = {}) {
  const events = [], pending = [], attrs = {}, data = plain(stored), queries = new Map();
  const runtime = {};
  const failures = {};
  function operation(kind, payload, callback) {
    events.push({ kind, payload: plain(payload) });
    if (failures[kind] === "throw") throw new Error("injected " + kind);
    const finish = (error = failures[kind]) => {
      if (error) runtime.lastError = { message: "injected " + kind };
      else {
        if (kind === "remove") payload.forEach(key => { delete data[key]; });
        if (kind === "set") Object.assign(data, plain(payload));
      }
      events.push({ kind: kind + ":done", error: !!error });
      try { callback(kind === "get" ? Object.fromEntries(payload.filter(key => Object.hasOwn(data, key)).map(key => [key, plain(data[key])])) : undefined); }
      finally { delete runtime.lastError; }
    };
    if (manual) pending.push({ kind, finish }); else queueMicrotask(() => finish());
  }
  const context = vm.createContext({ console,
    navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
    matchMedia(query) {
      if (!queries.has(query)) queries.set(query, { matches: false, listeners: [],
        addEventListener(type, fn) { if (type === "change") this.listeners.push(fn); }
      });
      return queries.get(query);
    },
    document: { documentElement: { setAttribute(key, value) { attrs[key] = value; } } },
    chrome: { runtime, storage: { local: {
      get: (keys, cb) => operation("get", keys, cb),
      set: (patch, cb) => operation("set", patch, cb),
      remove: (keys, cb) => operation("remove", keys, cb)
    } } },
    YLG_SETTINGS: { getStoredSettings(cb) { events.push({ kind: "settings:get" }); cb(initial); } }
  });
  context.window = context;
  vm.runInContext(bridgeSource, context, { filename: bridgeFile });
  return { bridge: context.YLG_AMBIENT_VENDOR, context, events, pending, attrs, data, failures,
    writes: () => events.filter(e => e.kind === "set").map(e => e.payload),
    media(query, matches) {
      const item = queries.get(query); item.matches = matches;
      item.listeners.forEach(fn => fn({ matches }));
    },
    async finish(kind, error = false) {
      await settle();
      const item = pending.shift();
      assert.ok(item, "expected pending " + kind);
      assert.equal(item.kind, kind);
      item.finish(error); await settle();
    }
  };
}
function renderer(h) {
  const calls = [];
  const engine = { isHidden: true, pendingStart: false, elem: makeEl(), containerElem: makeEl(),
    settings: { enabled: false,
      set(name, value, noSave, noEvent) {
        assert.equal(noSave, true, "external settings must not re-save");
        assert.equal(noEvent, true, "external settings must not dispatch DOM events");
        this[name] = value; calls.push(["set", name, value]);
      }, updateVisibility() { calls.push(["visibility"]); }
    },
    chromiumBugVideoJitterWorkaround: { update() { calls.push(["jitter"]); } },
    updateKeywordsToPreventTheaterScaling() { calls.push(["keywords"]); },
    async start() { calls.push(["start"]); this.isHidden = false; },
    async hide() { calls.push(["hide"]); this.isHidden = true; },
    async optionalFrame(force) { calls.push(["frame", force]); }
  };
  return { engine, calls };
}

test("manifest loads isolated bridge after settings and before vendor/bootstrap; both constructors attach", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  const entry = manifest.content_scripts.find(item => item.js.includes("vendor/ambient/content.js"));
  assert.ok(entry); assert.equal(entry.run_at, "document_start");
  assert.notEqual(entry.world, "MAIN"); assert.equal(entry.all_frames, false);
  for (const file of entry.js) assert.ok(fs.statSync(path.join(root, file)).isFile(), file);
  const position = file => entry.js.indexOf(file);
  assert.equal(entry.js.filter(file => file === bridgeFile).length, 1);
  assert.ok(position("src/shared/settings.js") < position(bridgeFile));
  assert.ok(position(bridgeFile) < position("vendor/ambient/content.js"));
  assert.ok(position("vendor/ambient/content.js") < position("src/content/bootstrap.js"));
  const loader = read("vendor/ambient/content.js");
  const body = loader.slice(loader.indexOf("async function loadContentScript()"));
  const gate = body.indexOf("await window.YLG_AMBIENT_VENDOR.waitUntilEnabled()");
  assert.ok(gate >= 0);
  for (const marker of ["chrome.runtime.getURL('vendor/ambient/content.css')", "chrome.runtime.getURL('vendor/ambient/injected.js')", "await import(scriptUrl)"]) {
    assert.ok(body.indexOf(marker) > gate, marker + " must be gated");
  }
  const main = read("vendor/ambient/content-main.js");
  const constructions = [...main.matchAll(/window\.ambientlight\s*=\s*await new Ambientlight\(([^;]+)\);\s*await window\.YLG_AMBIENT_VENDOR\.attach\(window\.ambientlight\);/g)];
  assert.equal(constructions.length, 2, "embed and desktop must both attach after construction");
  assert.equal(constructions[0][1], "videoElem");
  assert.match(constructions[1][1], /videoElem, ytdAppElem, ytdWatchElem, mastheadElem/);
});

test("essential mapping uses supported vendor units, clamping and master preference", () => {
  const { bridge: b } = harness();
  const p = plain(b.toPatch(settings()));
  // Assert a subset: future supported mapped keys (e.g. spill) are permitted.
  for (const [key, value] of Object.entries({
    "setting-enabled": true, "setting-resolution": 50, "setting-blur2": 47.1,
    "setting-brightness": 100, "setting-saturation": 110, "setting-framerateLimit": 12,
    "setting-spread": 100, "setting-enableInViews": 2, "setting-enableInPictureInPicture": false
  })) assert.equal(p[key], value, key);
  for (const key of ["enabled", "setting-quality", "setting-fpsLimit", "setting-blur"])
    assert.equal(Object.hasOwn(p, key), false, "legacy key must not be written: " + key);
  for (const [quality, resolution] of [["eco", 25], ["balanced", 50], ["high", 100], ["auto", 50]])
    assert.equal(b.toPatch(settings({ quality }))["setting-resolution"], resolution);
  const bounded = b.toPatch(settings({ blur: 999, brightness: -4, saturation: 999, fpsLimit: 100, spread: "999" }));
  assert.equal(bounded["setting-blur2"], 100); assert.equal(bounded["setting-brightness"], 0);
  assert.equal(bounded["setting-saturation"], 200); assert.equal(bounded["setting-framerateLimit"], 30);
  assert.equal(bounded["setting-spread"], 200);
  assert.equal(b.toPatch(settings({}, false))["setting-enabled"], false);
  assert.equal(b.toPatch(settings({ enabled: false }))["setting-enabled"], false);
});

test("legacy removal completes before mapped write, which completes before loader release", async () => {
  const h = harness({ manual: true }); let released = false;
  h.bridge.waitUntilEnabled().then(() => { released = true; h.events.push({ kind: "released" }); });
  await settle(); assert.equal(released, false); assert.equal(h.writes().length, 0);
  assert.deepEqual(h.events.find(e => e.kind === "get").payload.sort(), Object.keys(upstreamDefaults).concat(["ylg-ambient-visual-baseline-v1"]).sort());
  assert.equal(h.events.some(e => e.kind === "remove"), false, "read completes before migration");
  await h.finish("get");
  assert.deepEqual(h.events.find(e => e.kind === "remove").payload.sort(), ["enabled", "setting-blur", "setting-fpsLimit", "setting-quality"].sort());
  await h.finish("remove"); assert.equal(h.writes().length, 1); assert.equal(released, false);
  await h.finish("set"); assert.equal(released, true);
  for (const [key, value] of Object.entries(upstreamDefaults)) assert.equal(h.writes()[0][key], value, key + " upstream seed");
  assert.ok(h.events.findIndex(e => e.kind === "get:done") < h.events.findIndex(e => e.kind === "remove"));
  assert.ok(h.events.findIndex(e => e.kind === "remove:done") < h.events.findIndex(e => e.kind === "set"));
  assert.ok(h.events.findIndex(e => e.kind === "set:done") < h.events.findIndex(e => e.kind === "released"));
  assert.equal(h.bridge.stats().state, "pending"); assert.equal(await h.bridge.upstreamActive(), false);
  assert.equal(h.bridge.ownsRenderer(), true, "pending bridge reserves renderer ownership");
});

test("disabled startup waits through storage completion and releases on enable without reload", async () => {
  const h = harness({ initial: settings({ enabled: false }) }); let releases = 0;
  h.bridge.waitUntilEnabled().then(() => { releases++; });
  await settle(); assert.equal(releases, 0); assert.equal(h.data["setting-enabled"], false);
  await h.bridge.push(settings()); await settle(); assert.equal(releases, 1);
  await h.bridge.push(settings()); assert.equal(releases, 1);
  assert.equal(h.events.filter(e => e.kind === "remove").length, 1, "migration runs once");
  assert.equal(h.bridge.stats().attached, false); assert.equal(await h.bridge.upstreamActive(), false);
});

test("attach applies real latest snapshot, publishes active only after renderer start", async () => {
  const h = harness(); const r = renderer(h); const start = deferred();
  await h.bridge.push(settings({ fpsLimit: 8 }));
  const latest = settings({ fpsLimit: 17, intensity: 0.4 });
  await h.bridge.push(latest); latest.ambientLight.fpsLimit = 29;
  r.engine.start = async function () { r.calls.push(["start"]); await start.promise; this.isHidden = false; };
  const attached = h.bridge.attach(r.engine); await settle();
  assert.equal(h.bridge.stats().state, "pending"); assert.equal(await h.bridge.upstreamActive(), false);
  assert.equal(r.engine.settings.framerateLimit, 17, "immutable latest snapshot is attached");
  assert.equal(r.engine.containerElem.style.getPropertyValue("--ylg-local-intensity"), "", "upstream backdrop is not locally attenuated");
  assert.equal(r.engine.elem.style.getPropertyValue("opacity"), "");
  assert.equal(r.engine.elem.style.opacity, undefined);
  start.resolve(); assert.equal(await attached, true);
  assert.equal(h.bridge.stats().state, "upstream"); assert.equal(await h.bridge.upstreamActive(), true);
  assert.equal(r.engine.sizesChanged, true); assert.equal(r.engine.canvassesInvalidated, true);
  assert.ok(r.calls.some(c => c[0] === "jitter"));
});

test("actual serialized queue skips superseded work while an earlier renderer await is in flight", async () => {
  const h = harness(); const r = renderer(h); await h.bridge.push(settings());
  const start = deferred(); let starting = false;
  r.engine.start = async function () { starting = true; await start.promise; this.isHidden = false; };
  const first = h.bridge.attach(r.engine); await settle(); assert.equal(starting, true);
  const middle = h.bridge.push(settings({ fpsLimit: 7 }));
  const newest = h.bridge.push(settings({ fpsLimit: 23, brightness: 1.4 }));
  const writesBeforeRelease = h.writes().length;
  await settle(); assert.equal(h.writes().length, writesBeforeRelease, "no overlapping queued write");
  start.resolve();
  assert.equal(await first, false, "stale in-flight request cannot claim success");
  assert.equal(await middle, false); assert.equal(await newest, true);
  assert.equal(h.writes().some(p => p["setting-framerateLimit"] === 7), false);
  assert.equal(r.calls.some(c => c[0] === "set" && c[1] === "framerateLimit" && c[2] === 7), false);
  assert.equal(r.engine.settings.framerateLimit, 23); assert.equal(r.engine.settings.brightness, 140);
  assert.equal(h.data["setting-framerateLimit"], 23); assert.equal(h.bridge.stats().state, "upstream");
});

test("superseding an in-flight storage write never releases stale enabled startup", async () => {
  const h = harness({ manual: true }); let released = false;
  h.bridge.waitUntilEnabled().then(() => { released = true; });
  await h.finish("get");
  await h.finish("remove"); // enabled write is now pending
  const off = h.bridge.push(settings({}, false));
  await h.finish("set"); assert.equal(released, false, "stale on write cannot release loader");
  await h.finish("get"); await h.finish("set"); await off; assert.equal(released, false);
  const on = h.bridge.push(settings()); await h.finish("get"); await h.finish("set"); await on;
  assert.equal(released, true);
});

test("master disable hides even during pendingStart; re-enable reuses attached renderer", async () => {
  const h = harness(); const r = renderer(h); await h.bridge.push(settings()); await h.bridge.attach(r.engine);
  r.engine.pendingStart = true;
  assert.equal(await h.bridge.push(settings({}, false)), false);
  assert.equal(r.engine.settings.enabled, false); assert.equal(r.engine.isHidden, true);
  assert.equal(h.data["setting-enabled"], false); assert.equal(h.bridge.stats().state, "off");
  assert.equal(await h.bridge.upstreamActive(), false); assert.ok(r.calls.some(c => c[0] === "hide"));
  r.engine.pendingStart = false;
  assert.equal(await h.bridge.push(settings()), true); assert.equal(r.engine.isHidden, false);
  assert.equal(r.calls.filter(c => c[0] === "start").length, 2);
  assert.equal(h.bridge.stats().attached, true); assert.equal(h.data["setting-enabled"], true);
  await h.bridge.push(settings({ enabled: false })); assert.equal(r.engine.settings.enabled, false);
  assert.equal(await h.bridge.push(settings()), true);
});

test("Motion effects off keeps Ambient Light running, including cold startup and rapid toggles", async () => {
  const h = harness(); const r = renderer(h);
  const still = { ...settings(), motion: false, radius: 28 };
  let released = false;
  h.bridge.waitUntilEnabled().then(() => { released = true; });
  await h.bridge.push(still); await settle();
  assert.equal(released, true, "motion-off startup releases the ambient loader");
  assert.equal(await h.bridge.attach(r.engine), true);
  const starts = r.calls.filter(c => c[0] === "start").length;
  for (let i = 0; i < 4; i++) {
    assert.equal(await h.bridge.push({ ...still, motion: i % 2 === 0 }), true);
    assert.equal(r.engine.isHidden, false);
  }
  await Promise.all([true, false, true, false].map(motion => h.bridge.push({ ...still, motion })));
  assert.equal(h.bridge.stats().state, "upstream");
  assert.equal(r.engine.settings.enabled, true);
  assert.equal(r.calls.some(c => c[0] === "hide"), false);
  assert.equal(r.calls.filter(c => c[0] === "start").length, starts, "no renderer restart on a motion toggle");
  assert.equal(h.data["setting-enabled"], true);
  await h.bridge.push({ ...still, ambientLight: { ...still.ambientLight, enabled: false } });
  assert.equal(r.engine.isHidden, true, "Ambient Light's own switch still stops the renderer");
  assert.equal(await h.bridge.push(still), true);
  assert.equal(r.engine.isHidden, false);
});

test("system reduced motion and forced colours still gate Ambient independently of UI motion", async () => {
  const h = harness(); const r = renderer(h);
  const still = { ...settings(), motion: false };
  await h.bridge.push(still); assert.equal(await h.bridge.attach(r.engine), true);
  for (const query of ["(prefers-reduced-motion: reduce)", "(forced-colors: active)"]) {
    h.media(query, true); await settle();
    assert.equal(r.engine.isHidden, true); assert.equal(h.bridge.stats().state, "off");
    assert.equal(h.data["setting-enabled"], true, "system gate must not reset the saved ambient switch");
    h.media(query, false); await settle();
    assert.equal(r.engine.isHidden, false); assert.equal(h.bridge.stats().state, "upstream");
  }
});

test("explicit system-motion opt-out restores ambient but preserves forced-colour and master gates", async () => {
  const h = harness(); const r = renderer(h);
  h.media("(prefers-reduced-motion: reduce)", true);
  await h.bridge.push(settings()); await h.bridge.attach(r.engine);
  assert.equal(r.engine.isHidden, true);
  await h.bridge.push({ ...settings(), respectReducedMotion: false });
  assert.equal(h.bridge.stats().state, "upstream");
  h.media("(forced-colors: active)", true); await settle();
  assert.equal(h.bridge.stats().state, "off");
  h.media("(forced-colors: active)", false); await settle();
  assert.equal(h.bridge.stats().state, "upstream");
  await h.bridge.push({ ...settings({}, false), respectReducedMotion: false });
  assert.equal(h.bridge.stats().state, "off");
});

test("per-tab layout gates hide live renderer without persisting master=false", async () => {
  const h = harness(); const r = renderer(h); await h.bridge.push(settings()); await h.bridge.attach(r.engine);
  for (const mode of ["shorts", "miniplayer", "fullscreen", "normal", "theater"]) {
    h.bridge.refreshMode(mode); await settle();
    const on = mode === "normal" || mode === "theater";
    assert.equal(r.engine.settings.enabled, on, mode);
    assert.equal(h.bridge.stats().state, on ? "upstream" : "off", mode);
  }
  await h.bridge.push(settings({ modes: { normal: false, theater: false, fullscreen: true } }));
  assert.equal(r.engine.settings.enabled, false, "theater preference enforced");
  h.bridge.refreshMode("fullscreen"); await settle(); assert.equal(r.engine.settings.enabled, true);
  h.bridge.refreshMode("normal"); await settle(); assert.equal(r.engine.settings.enabled, false);
  assert.ok(h.writes().every(p => p["setting-enabled"] === true), "tab layout must not disable other tabs");
  assert.equal(h.bridge.ownsRenderer(), true);
});

for (const kind of ["get", "remove", "set"]) for (const failure of ["callback", "throw"]) {
  test(`${kind} ${failure} error fails closed without releasing startup or touching renderer`, async () => {
    const h = harness(); const r = renderer(h); let releases = 0;
    h.failures[kind] = failure; h.bridge.waitUntilEnabled().then(() => { releases++; });
    await settle(); assert.equal(releases, 0);
    assert.equal(h.bridge.stats().state, "error"); assert.equal(h.bridge.stats().error, "storage-write-failed");
    assert.equal(h.attrs["data-ylg-ambient-engine"], "error"); assert.equal(h.bridge.ownsRenderer(), true);
    assert.equal(await h.bridge.attach(r.engine), false); assert.equal(r.calls.length, 0);
    assert.equal(await h.bridge.upstreamActive(), false);
    if (kind === "remove") assert.equal(h.writes().length, 0);
    // Recovery after callback errors and synchronous throws is tested below.
  });
}

for (const kind of ["get", "remove", "set"]) for (const failure of ["callback", "throw"]) {
  test(`${kind} ${failure} error recovers on a successful reconcile`, async () => {
    const h = harness(); const r = renderer(h); let released = false;
    h.failures[kind] = failure;
    h.bridge.waitUntilEnabled().then(() => { released = true; });
    await settle(); await h.bridge.attach(r.engine);
    assert.equal(released, false); delete h.failures[kind];
    assert.equal(await h.bridge.push(settings()), true); await settle();
    assert.equal(released, true); assert.equal(h.bridge.stats().error, null);
    assert.equal(h.bridge.stats().state, "upstream");
  });
}

test("original upstream defaults seed only missing keys and preserve explicit optional choices", async () => {
  const stored = { "setting-headerShadowSize": 19, "setting-headerFillOpacity": 0,
    "setting-surroundingContentImagesOpacity": 43, "setting-pageBackgroundGreyness": 28,
    "setting-unrelatedFutureOption": 77 };
  const h = harness({ stored }); const r = renderer(h);
  await h.bridge.push(settings()); await h.bridge.attach(r.engine);
  for (const [key, fallback] of Object.entries(upstreamDefaults)) {
    const expected = Object.hasOwn(stored, key) ? stored[key] : fallback;
    assert.equal(h.data[key], expected, key + " persisted value");
    assert.equal(r.engine.settings[key.slice(8)], expected, key + " applied live");
    if (Object.hasOwn(stored, key)) assert.ok(h.writes().every(patch => !Object.hasOwn(patch, key)), key + " not rewritten");
  }
  assert.equal(h.data["setting-unrelatedFutureOption"], 77);
  assert.ok(h.writes().every(patch => !Object.hasOwn(patch, "setting-unrelatedFutureOption")));
  for (const key of Object.keys(upstreamDefaults).filter(key => !Object.hasOwn(stored, key))) {
    assert.equal(h.writes().filter(patch => Object.hasOwn(patch, key)).length, 1, key + " seeded once");
  }
});

test("upstream intensity is not locally attenuated and does not reset ylgSettings", async () => {
  const stored = { ylgSettings: { opacity: 0.23, ambientLight: { intensity: 0.31 } } };
  const h = harness({ stored }); const r = renderer(h);
  r.engine.elem.style.setProperty("opacity", "0.2");
  await h.bridge.push(settings({ intensity: 0 })); await h.bridge.attach(r.engine);
  for (const value of [0, 9, -1, NaN, 0.63]) {
    await h.bridge.push(settings({ intensity: value }));
    assert.equal(r.engine.containerElem.style.getPropertyValue("--ylg-local-intensity"), "");
    assert.equal(r.engine.containerElem.style.getPropertyValue("opacity"), "");
    assert.equal(r.engine.elem.style.getPropertyValue("opacity"), "");
  }
  assert.deepEqual(h.data.ylgSettings, stored.ylgSettings);
  assert.ok(h.writes().every(p => !Object.hasOwn(p, "ylgSettings")));
});

const p2Signature = { ...upstreamDefaults, "setting-surroundingContentShadowSize": 0,
  "setting-surroundingContentFillOpacity": 100 };
const migrationKey = "ylg-ambient-visual-baseline-v1";
test("complete unmarked P2 signature migrates once to original upstream defaults", async () => {
  const h = harness({ stored: p2Signature }); const r = renderer(h);
  let styleUpdates = 0; r.engine.updateStyles = () => { styleUpdates++; };
  await h.bridge.push(settings()); await h.bridge.attach(r.engine);
  for (const [key, value] of Object.entries(upstreamDefaults)) {
    assert.equal(h.data[key], value, key);
    assert.equal(r.engine.settings[key.slice(8)], value, key + " live");
  }
  assert.equal(h.data[migrationKey], 1);
  assert.ok(styleUpdates > 0, "visual changes refresh upstream body variables");
  Object.assign(h.data, p2Signature); // later explicit identical preference survives
  await h.bridge.push(settings());
  for (const [key, value] of Object.entries(p2Signature)) assert.equal(h.data[key], value, key);
});

test("partial and customized P2-like groups preserve every explicit preference", async () => {
  const variants = [{ ...p2Signature, [migrationKey]: 1 }];
  for (const key of Object.keys(p2Signature)) {
    const partial = { ...p2Signature }; delete partial[key];
    variants.push(partial, { ...p2Signature, [key]: p2Signature[key] === 0 ? 19 : 0 });
  }
  for (const stored of variants) {
    const h = harness({ stored }); const r = renderer(h);
    await h.bridge.push(settings()); await h.bridge.attach(r.engine);
    for (const [key, value] of Object.entries(stored)) {
      assert.equal(h.data[key], value, key);
      assert.ok(h.writes().every(p => !Object.hasOwn(p, key)), key + " never rewritten");
    }
  }
});

test("superseded visual-default read cannot migrate, write or release stale enabled startup", async () => {
  const h = harness({ manual: true }); let released = false;
  h.bridge.waitUntilEnabled().then(() => { released = true; });
  await settle();
  const off = h.bridge.push(settings({}, false));
  await h.finish("get");
  assert.equal(h.events.some(e => e.kind === "remove"), false);
  assert.equal(h.writes().length, 0);
  await h.finish("get"); await h.finish("remove"); await h.finish("set"); await off;
  assert.equal(released, false);
  assert.equal(h.data["setting-enabled"], false);
  assert.equal(h.events.filter(e => e.kind === "remove").length, 1);
});

test("renderer errors stay reserved/error and next reconcile can recover", async () => {
  const h = harness(); const r = renderer(h); await h.bridge.push(settings());
  const start = r.engine.start;
  r.engine.start = async () => { throw new Error("renderer unavailable"); };
  assert.equal(await h.bridge.attach(r.engine), false);
  assert.equal(h.bridge.stats().state, "error"); assert.equal(h.bridge.stats().error, "vendor-apply-failed");
  assert.equal(h.bridge.ownsRenderer(), true); assert.equal(await h.bridge.upstreamActive(), false);
  r.engine.start = start; assert.equal(await h.bridge.push(settings()), true);
});

(async () => {
  let passed = 0;
  for (const { name, fn } of cases) {
    // A timeout is a deadlock sentinel only; test scheduling never uses sleeps.
    let timer;
    try {
      await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("test deadlocked (5s)")), 5000);
      })]);
      console.log("PASS " + name); passed++;
    } catch (error) { console.error("FAIL " + name + "\n" + error.stack); }
    finally { clearTimeout(timer); }
  }
  console.log(`\nAmbient bridge regressions: ${passed}/${cases.length} passed`);
  if (passed !== cases.length) process.exitCode = 1;
})();
