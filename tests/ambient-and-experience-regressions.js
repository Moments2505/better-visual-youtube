"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { makeEl } = require("./dom-fixture");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test("active sidebar guide pill uses neutral frosted Liquid Glass capsule + 3px accent bar", () => {
  const css = read("src/styles/youtube.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(
    css,
    /ytd-guide-entry-renderer\[active\][^{]*\{[^}]*background-color:\s*color-mix\(in srgb,\s*var\(--ylg-accent\)/,
    "active pill body must not use muddy color-mix(accent) fill"
  );
  assert.match(
    css,
    /ytd-guide-entry-renderer\[active\] a[\s\S]*?linear-gradient\(180deg,\s*rgba\(255,\s*255,\s*255,\s*0\.22\)/,
    "active pill should paint neutral frosted gradient sheen"
  );
  assert.match(
    css,
    /ytd-guide-entry-renderer\[active\] > a::before[\s\S]*?width:\s*3px;[\s\S]*?background:\s*var\(--ylg-accent/,
    "active pill must show 3px glowing left accent bar"
  );
  assert.match(
    css,
    /ytd-mini-guide-entry-renderer\[active\] a::before[\s\S]*?height:\s*3px;/,
    "collapsed mini-guide active item should match frosted pill styling"
  );
});

test("settings schema keeps v8 and normalizes all #1-#9 fields safely", () => {
  const ctx = {};
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(read("src/shared/settings.js"), ctx, { filename: "src/shared/settings.js" });
  const S = ctx.YLG_SETTINGS;

  assert.equal(S.SCHEMA_VERSION, 8);
  const def = S.normalizeSettings({});
  assert.equal(def.ambientLight.flickerReduction, 35);
  assert.equal(def.ambientLight.detectBarSize, false);
  assert.equal(def.ambientLight.glassSync, true);
  assert.equal(def.ambientLight.directionMode, "full");
  assert.equal(def.ambientLight.videoShadow, 25);
  assert.equal(def.ambientLight.energySaver, true);
  assert.equal(def.ambientLight.vibrance, 1);
  assert.equal(def.ambientLight.contrast, 1);
  assert.equal(def.immersiveCinema, false);
  assert.equal(def.hotkeys, true);
  assert.equal(def.hideShortsShelf, false);
  assert.equal(def.zenWatch, false);

  const clamped = S.normalizeSettings({
    immersiveCinema: true,
    hotkeys: false,
    hideShortsShelf: true,
    zenWatch: true,
    ambientLight: {
      flickerReduction: 999,
      detectBarSize: true,
      glassSync: false,
      directionMode: "topArch",
      videoShadow: -10,
      energySaver: false,
      vibrance: 4,
      contrast: -2
    }
  });
  assert.equal(clamped.ambientLight.flickerReduction, 100);
  assert.equal(clamped.ambientLight.detectBarSize, true);
  assert.equal(clamped.ambientLight.glassSync, false);
  assert.equal(clamped.ambientLight.directionMode, "topArch");
  assert.equal(clamped.ambientLight.videoShadow, 0);
  assert.equal(clamped.ambientLight.energySaver, false);
  assert.equal(clamped.ambientLight.vibrance, 2);
  assert.equal(clamped.ambientLight.contrast, 0);
  assert.equal(clamped.immersiveCinema, true);
  assert.equal(clamped.hotkeys, false);
  assert.equal(clamped.hideShortsShelf, true);
  assert.equal(clamped.zenWatch, true);
});

test("ambient vendor bridge maps #1, #2, #4, #6 settings and invokes live hooks safely", async () => {
  const storageData = {};
  const ctx = vm.createContext({
    console,
    navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: { documentElement: { setAttribute() {} }, hidden: false, visibilityState: "visible" },
    chrome: {
      runtime: {},
      storage: {
        local: {
          get: (k, cb) => queueMicrotask(() => cb({})),
          set: (p, cb) => { Object.assign(storageData, p); queueMicrotask(() => cb()); },
          remove: (k, cb) => queueMicrotask(() => cb())
        }
      }
    }
  });
  ctx.window = ctx;
  vm.runInNewContext(read("src/ambient/ambient-vendor-bridge.js"), ctx, { filename: "src/ambient/ambient-vendor-bridge.js" });
  const B = ctx.YLG_AMBIENT_VENDOR;

  const pSides = B.toPatch({
    enabled: true,
    ambientLight: {
      enabled: true,
      flickerReduction: 45,
      detectBarSize: true,
      directionMode: "sides",
      videoShadow: 60,
      energySaver: true,
      vibrance: 1.4,
      contrast: 1.2,
      modes: { normal: true, theater: true, fullscreen: false, shorts: true }
    }
  });
  assert.equal(pSides["setting-flickerReduction"], 45);
  assert.equal(pSides["setting-detectHorizontalBarSizeEnabled"], true);
  assert.equal(pSides["setting-detectVerticalBarSizeEnabled"], true);
  assert.equal(pSides["setting-directionTopEnabled"], false);
  assert.equal(pSides["setting-directionBottomEnabled"], false);
  assert.equal(pSides["setting-directionLeftEnabled"], true);
  assert.equal(pSides["setting-directionRightEnabled"], true);
  assert.equal(pSides["setting-videoShadowSize"], 60);
  assert.equal(pSides["setting-videoShadowOpacity"], 55);
  assert.equal(pSides["setting-energySaver"], true);
  assert.equal(pSides["setting-vibrance"], 140);
  assert.equal(pSides["setting-contrast"], 120);

  const pArch = B.toPatch({ enabled: true, ambientLight: { enabled: true, directionMode: "topArch", videoShadow: 0 } });
  assert.equal(pArch["setting-directionTopEnabled"], true);
  assert.equal(pArch["setting-directionBottomEnabled"], false);
  assert.equal(pArch["setting-videoShadowOpacity"], 0);

  const calls = [];
  const mockEngine = {
    isHidden: false,
    elem: makeEl(),
    containerElem: makeEl(),
    settings: {
      enabled: true,
      set(n, v) { this[n] = v; },
      updateVisibility() { calls.push("vis"); },
      async updateBufferProjectorWebGLCtx() { calls.push("flickerCtx"); }
    },
    barDetection: { reset() { calls.push("barReset"); } },
    projector: { async updateVibrance() { calls.push("vibrance"); return true; } },
    updateStyles() { calls.push("styles"); },
    calculateAverageVideoFramesDifference() { calls.push("energyCalc"); },
    resetAverageVideoFramesDifference() { calls.push("energyReset"); },
    async start() {},
    async hide() { this.isHidden = true; },
    async optionalFrame() {}
  };

  await B.attach(mockEngine);
  const ok = await B.push({
    enabled: true,
    ambientLight: {
      enabled: true,
      flickerReduction: 50,
      detectBarSize: true,
      directionMode: "topArch",
      videoShadow: 40,
      energySaver: true,
      vibrance: 1.5,
      contrast: 1.1,
      modes: { normal: true, theater: true, fullscreen: true, shorts: true }
    }
  });
  assert.equal(ok, true);
  for (const expected of ["flickerCtx", "barReset", "vibrance", "energyCalc", "styles"]) {
    assert.ok(calls.includes(expected), "expected live vendor hook call: " + expected);
  }
  B.refreshMode("shorts");
  await new Promise((r) => setImmediate(r));
  assert.equal(mockEngine.settings.enabled, false, "vendor engine stays disabled on shorts so #ylg-shorts-glow handles shorts");
});

test("Feature #3 & #9 apply document attributes and --ylg-ambient-rim cleanly", () => {
  const ctx = {};
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(read("src/shared/settings.js"), ctx, { filename: "src/shared/settings.js" });
  const S = ctx.YLG_SETTINGS;

  const de = makeEl("html");
  const doc = { documentElement: de };
  S.applySettingsToDocument(doc, {
    enabled: true,
    hideShortsShelf: true,
    zenWatch: true,
    ambientLight: { enabled: true, glassSync: true }
  });
  assert.equal(de.getAttribute("data-ylg-hide-shorts"), "true");
  assert.equal(de.getAttribute("data-ylg-zen-watch"), "true");

  S.setAmbientRim(doc, { r: 80, g: 170, b: 255 });
  assert.equal(de.style.getPropertyValue("--ylg-ambient-rim"), "80, 170, 255");
  assert.equal(de.getAttribute("data-ylg-ambient-sync"), "1");

  S.applySettingsToDocument(doc, {
    enabled: true,
    hideShortsShelf: false,
    zenWatch: false,
    ambientLight: { enabled: true, glassSync: false }
  });
  assert.equal(de.getAttribute("data-ylg-hide-shorts"), null);
  assert.equal(de.getAttribute("data-ylg-zen-watch"), null);
  assert.equal(de.getAttribute("data-ylg-ambient-sync"), null);
  assert.equal(de.style.getPropertyValue("--ylg-ambient-rim"), "");
});

test("Feature #5 Shorts Vertical Glow mounts #ylg-shorts-glow only on /shorts when modes.shorts=true", () => {
  const shortsHost = makeEl("ytd-shorts");
  const body = makeEl("body");
  body.appendChild(shortsHost);
  const video = makeEl("video");
  video.readyState = 4;
  let routeMode = "shorts";

  const makeMockCanvas = () => {
    const el = makeEl("canvas");
    const ops = [];
    const ctx2d = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      globalCompositeOperation: "source-over",
      clearRect() { ops.push("clear"); },
      drawImage() { ops.push("draw"); },
      fillRect() { ops.push("fill"); },
      createRadialGradient() { return { addColorStop() {} }; }
    };
    el.getContext = () => ctx2d;
    el._ops = ops;
    return el;
  };

  const doc = {
    hidden: false,
    documentElement: makeEl("html"),
    body,
    createElement: (tag) => (tag === "canvas" ? makeMockCanvas() : makeEl(tag)),
    querySelector(sel) {
      if (sel === "ytd-shorts") return routeMode === "shorts" ? shortsHost : null;
      if (sel.includes("video")) return video;
      return null;
    },
    addEventListener() {},
    removeEventListener() {}
  };
  const timers = new Map();
  let tId = 0;
  const ctx = vm.createContext({
    document: doc,
    location: { pathname: "/shorts/abc" },
    Date,
    Math,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    setTimeout: (fn) => { const id = ++tId; timers.set(id, { fn, type: "timeout" }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: (fn) => { const id = ++tId; timers.set(id, { fn, type: "interval" }); return id; },
    clearInterval: (id) => { timers.delete(id); },
    YLG_NAV: {
      getPlayer: () => ({ video, container: shortsHost, mode: routeMode }),
      onNavigation: () => () => {}
    },
    YLG_AMBIENT_VENDOR: { refreshMode() {}, onStateChanged: () => () => {}, stats: () => ({ state: "off" }) }
  });
  ctx.window = ctx;

  vm.runInNewContext(read("src/ambient/ambient-controller.js"), ctx, { filename: "src/ambient/ambient-controller.js" });
  const A = ctx.YLG_AMBIENT;
  A.init();
  A.updateSettings({
    enabled: true,
    respectReducedMotion: true,
    ambientLight: { enabled: true, fpsLimit: 16, brightness: 1.2, modes: { normal: true, theater: true, fullscreen: true, shorts: true } }
  });
  for (const [id, item] of [...timers.entries()]) {
    if (item.type === "timeout") { timers.delete(id); item.fn(); }
  }
  assert.equal(A.stats().shorts.active, true);
  assert.equal(A.stats().shorts.mounted, true);
  const canvas = shortsHost.children.find((c) => c.id === "ylg-shorts-glow");
  assert.ok(canvas, "#ylg-shorts-glow canvas must be mounted inside ytd-shorts");
  assert.ok(canvas._ops.includes("draw"), "canvas should draw video frame upscaled");

  routeMode = "normal";
  A.updateSettings({
    enabled: true,
    respectReducedMotion: true,
    ambientLight: { enabled: true, fpsLimit: 16, modes: { normal: true, theater: true, fullscreen: true, shorts: true } }
  });
  for (const [id, item] of [...timers.entries()]) {
    if (item.type === "timeout") { timers.delete(id); item.fn(); }
  }
  assert.equal(A.stats().shorts.active, false);
  assert.equal(A.stats().shorts.mounted, false, "canvas must unmount immediately when leaving /shorts");
  A.teardown();
  assert.equal(timers.size, 0, "teardown must clear all timers");
});

test("Features #7 & #8 handle Immersive Cinema idle dimming and Quick Hotkeys with editable-input guard", () => {
  const docListeners = new Map();
  const body = makeEl("body");
  const de = makeEl("html");
  const video = makeEl("video");
  video.paused = false;
  video.ended = false;
  const watchEl = makeEl("ytd-watch-flexy");
  const savedSnapshots = [];
  const doc = {
    hidden: false,
    fullscreenElement: null,
    documentElement: de,
    body,
    createElement: (tag) => makeEl(tag),
    querySelector: (sel) => (sel.includes("ytd-watch-flexy") ? watchEl : sel.includes("video") ? video : null),
    addEventListener: (k, fn) => { docListeners.set(k, fn); },
    removeEventListener: (k) => { docListeners.delete(k); }
  };
  let nowMs = 1000;
  const timeouts = [];
  let seq = 0;
  const ctx = vm.createContext({
    document: doc,
    location: { pathname: "/watch", search: "?v=test" },
    Date: { now: () => nowMs },
    Math,
    setTimeout: (fn, ms) => { const id = ++seq; timeouts.push({ id, fn, ms, cleared: false }); return id; },
    clearTimeout: (id) => { const hit = timeouts.find((t) => t.id === id); if (hit) hit.cleared = true; },
    YLG_NAV: { getPlayer: () => ({ video, mode: "normal" }), onNavigation: () => () => {} }
  });
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(read("src/shared/settings.js"), ctx, { filename: "src/shared/settings.js" });
  const origSave = ctx.YLG_SETTINGS.saveSettings;
  ctx.YLG_SETTINGS.saveSettings = (next) => { savedSnapshots.push(next); return origSave(next); };
  vm.runInNewContext(read("src/content/experience-controls.js"), ctx, { filename: "src/content/experience-controls.js" });

  const EXP = ctx.YLG_EXPERIENCE;
  const base = ctx.YLG_SETTINGS.normalizeSettings({ enabled: true, immersiveCinema: true, hotkeys: true });
  EXP.updateSettings(base);

  const pendingIdle = timeouts.filter((t) => !t.cleared && t.ms === 3500);
  assert.ok(pendingIdle.length >= 1, "idle timer armed for 3500ms");
  pendingIdle[pendingIdle.length - 1].fn();
  assert.equal(de.getAttribute("data-ylg-cinema-idle"), "true");

  nowMs += 400;
  docListeners.get("pointermove")();
  assert.equal(de.getAttribute("data-ylg-cinema-idle"), null, "pointer activity restores full brightness immediately");

  // Hotkeys ignore typing inside INPUT
  let prevented = false;
  docListeners.get("keydown")({
    altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false,
    code: "KeyA", target: { tagName: "INPUT", isContentEditable: false },
    preventDefault() { prevented = true; }
  });
  assert.equal(prevented, false);
  assert.equal(savedSnapshots.length, 0);

  // Alt+A toggles Ambient Light + shows toast
  docListeners.get("keydown")({
    altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false,
    code: "KeyA", target: { tagName: "DIV", isContentEditable: false },
    preventDefault() { prevented = true; }
  });
  assert.equal(prevented, true);
  assert.equal(savedSnapshots.length, 1);
  assert.equal(savedSnapshots[0].ambientLight.enabled, false);
  const toast = body.children.find((n) => n.id === "ylg-hud-toast");
  assert.ok(toast && toast.getAttribute("data-ylg-visible") === "true");

  // Alt+S cycles profile
  docListeners.get("keydown")({
    altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false,
    code: "KeyS", target: { tagName: "DIV", isContentEditable: false },
    preventDefault() {}
  });
  assert.equal(savedSnapshots.length, 2);
  assert.equal(ctx.YLG_SETTINGS.matchStyleProfile(savedSnapshots[1]), "crystal");

  EXP.teardown();
  assert.equal(de.getAttribute("data-ylg-cinema-idle"), null);
  assert.equal(EXP.stats().cinemaActive, false);
  assert.equal(EXP.stats().hotkeysActive, false);
});

(async () => {
  let passed = 0;
  for (const { name, fn } of cases) {
    try {
      await fn();
      passed++;
      console.log("PASS " + name);
    } catch (err) {
      console.error("FAIL " + name + "\n" + err.stack);
      process.exitCode = 1;
    }
  }
  console.log(`\nAmbient & Experience regressions: ${passed}/${cases.length} passed`);
})();
