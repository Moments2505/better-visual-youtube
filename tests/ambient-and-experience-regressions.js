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

test("active sidebar guide pill syncs opacity, tint, corner radius, highlight, clear and pale modes + 3px accent bar", () => {
  const css = read("src/styles/youtube.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(
    css,
    /ytd-guide-entry-renderer\[active\][^{]*\{[^}]*background-color:\s*color-mix\(in srgb,\s*var\(--ylg-accent\)/,
    "active pill body must not use muddy color-mix(accent) fill"
  );
  assert.match(
    css,
    /ytd-guide-entry-renderer\[active\] a[\s\S]*?var\(--ylg-surface-tint-light\)[\s\S]*?border-radius:\s*var\(--ylg-radius-s/,
    "active pill must sync fill, tint and corner radius from live glass tokens"
  );
  assert.match(
    css,
    /ytd-guide-entry-renderer\[active\] a[\s\S]*?var\(--ylg-opacity[\s\S]*?var\(--ylg-highlight/,
    "active pill opacity and specular rim must scale with --ylg-opacity and --ylg-highlight"
  );
  assert.match(
    css,
    /data-ylg-fill="none"[\s\S]*?ytd-guide-entry-renderer\[active\] a[\s\S]*?background-color:\s*transparent/,
    "active pill must go clear at Opacity = 0%"
  );
  assert.match(
    css,
    /data-ylg-opacity-pale="true"[\s\S]*?ytd-guide-entry-renderer\[active\][\s\S]*?rgba\(15,\s*23,\s*42,\s*0\.07\)/,
    "active pill must keep dark-ink contrast pill in pale/solid high opacity"
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
  de.appendChild(body);
  body.appendChild(watchEl);
  watchEl.appendChild(video);
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
  let navCb = null;
  const loc = { pathname: "/watch", search: "?v=test" };
  const ctx = vm.createContext({
    document: doc,
    location: loc,
    Date: { now: () => nowMs },
    Math,
    setTimeout: (fn, ms) => { const id = ++seq; timeouts.push({ id, fn, ms, cleared: false }); return id; },
    clearTimeout: (id) => { const hit = timeouts.find((t) => t.id === id); if (hit) hit.cleared = true; },
    YLG_NAV: { getPlayer: () => ({ video, mode: "normal" }), onNavigation: (fn) => { navCb = fn; return () => { navCb = null; }; } }
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
  // Same-URL "schedule" ticks must NOT reset or clear pending idle timer
  const activePendingId = pendingIdle[pendingIdle.length - 1].id;
  navCb({ reason: "schedule" });
  assert.equal(pendingIdle[pendingIdle.length - 1].cleared, false, "same-URL schedule tick must not cancel pending idle timer");
  assert.equal(timeouts.filter((t) => !t.cleared && t.ms === 3500 && t.id > activePendingId).length, 0, "same-URL schedule tick must not re-arm timer");

  pendingIdle[pendingIdle.length - 1].fn();
  assert.equal(de.getAttribute("data-ylg-cinema-idle"), "true");
  navCb({ reason: "schedule" });
  assert.equal(de.getAttribute("data-ylg-cinema-idle"), "true", "same-URL schedule tick must preserve active cinema idle state");

  navCb({ reason: "yt-navigate-start" });
  assert.equal(de.getAttribute("data-ylg-cinema-idle"), null, "yt-navigate-start must clear cinema idle");

  const afterNavTimers = timeouts.filter((t) => !t.cleared && t.ms === 3500);
  afterNavTimers[afterNavTimers.length - 1].fn();
  assert.equal(de.getAttribute("data-ylg-cinema-idle"), "true");
  loc.search = "?v=next";
  navCb({ reason: "schedule" });
  assert.equal(de.getAttribute("data-ylg-cinema-idle"), null, "URL change on schedule tick must clear cinema idle");

  nowMs += 400;
  docListeners.get("pointermove")();
  assert.equal(de.getAttribute("data-ylg-cinema-idle"), null, "pointer activity restores full brightness immediately");

  // Re-trigger idle, then verify live settings update clears cinema-idle scrim immediately
  const reArmed = timeouts.filter((t) => !t.cleared && t.ms === 3500);
  reArmed[reArmed.length - 1].fn();
  assert.equal(de.getAttribute("data-ylg-cinema-idle"), "true");
  EXP.updateSettings(Object.assign({}, base, { opacity: 0.6 }));
  assert.equal(de.getAttribute("data-ylg-cinema-idle"), null, "updating settings clears stale cinema-idle masthead scrim");
  assert.equal(EXP.stats().cinemaIdle, false);

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

test("ambient.css suppresses YouTube native #cinematics whenever extension is enabled (including Ambient OFF)", () => {
  const css = read("src/ambient/ambient.css").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const nativeSel of [
    "#cinematics",
    "#cinematics-container",
    "#cinematics-wide-container",
    "#cinematics-full-bleed-container",
    "ytd-cinematics",
    "#shorts-cinematic-container",
    "#cinematic-shorts-scrim",
    "ytd-shorts #cinematic-container",
    "#movie_player .ytp-cinematic-container",
    "#movie_player .ytp-ambient-mode-overlay"
  ]) {
    assert.ok(
      css.includes(`html[data-ylg-enabled="true"] ${nativeSel}`),
      `ambient.css must suppress ${nativeSel} under html[data-ylg-enabled="true"] so turning Ambient Light OFF does not let native YouTube glow pop back on`
    );
  }
});

test("Eco / Balanced / High / Auto quality presets differentiate parameters, resize WebGL live, and handle OS reduced motion", async () => {
  const ctx = {};
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(read("src/shared/settings.js"), ctx, { filename: "src/shared/settings.js" });
  const S = ctx.YLG_SETTINGS;

  assert.ok(S.AMBIENT_QUALITY_TIERS && typeof S.applyAmbientQualityTier === "function");
  const eco = S.applyAmbientQualityTier(S.DEFAULT_SETTINGS, "eco").ambientLight;
  const bal = S.applyAmbientQualityTier(S.DEFAULT_SETTINGS, "balanced").ambientLight;
  const high = S.applyAmbientQualityTier(S.DEFAULT_SETTINGS, "high").ambientLight;
  const auto = S.applyAmbientQualityTier(S.DEFAULT_SETTINGS, "auto").ambientLight;

  assert.ok(eco.fpsLimit < bal.fpsLimit && bal.fpsLimit < high.fpsLimit, "FPS cap must scale Eco < Balanced < High");
  assert.ok(eco.spread < bal.spread && bal.spread < high.spread, "Spread must scale Eco < Balanced < High");
  assert.ok(eco.blur < bal.blur && bal.blur < high.blur, "Blur must scale Eco < Balanced < High");
  assert.equal(eco.energySaver, true);
  assert.equal(high.energySaver, false);
  assert.equal(auto.quality, "auto");

  // Bridge live resize hook check when switching quality on an active engine
  const bridgeCalls = [];
  const bridgeCtx = vm.createContext({
    console,
    navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: { documentElement: { setAttribute() {} }, hidden: false, visibilityState: "visible" },
    chrome: {
      runtime: {},
      storage: {
        local: {
          get: (k, cb) => queueMicrotask(() => cb({})),
          set: (p, cb) => queueMicrotask(() => cb()),
          remove: (k, cb) => queueMicrotask(() => cb())
        }
      }
    }
  });
  bridgeCtx.window = bridgeCtx;
  vm.runInNewContext(read("src/ambient/ambient-vendor-bridge.js"), bridgeCtx, { filename: "src/ambient/ambient-vendor-bridge.js" });
  const liveEngine = {
    isHidden: false,
    elem: makeEl(),
    settings: {
      enabled: true,
      resolution: 50,
      set(n, v) { this[n] = v; }
    },
    async updateSizes() { bridgeCalls.push("updateSizes:" + this.settings.resolution); },
    resetAverageVideoFramesDifference() { bridgeCalls.push("resetDiff"); },
    async start() {},
    async hide() {},
    async optionalFrame() { bridgeCalls.push("optionalFrame"); }
  };
  await bridgeCtx.YLG_AMBIENT_VENDOR.attach(liveEngine);
  await bridgeCtx.YLG_AMBIENT_VENDOR.push(S.applyAmbientQualityTier(S.DEFAULT_SETTINGS, "high"));
  assert.ok(bridgeCalls.includes("updateSizes:100"), "changing quality to high must resize WebGL FBOs immediately");
  assert.ok(bridgeCalls.includes("resetDiff"), "changing quality must reset frame-diff cache so redraw is immediate");
});

test("STYLE_PROFILES enables modes.shorts on crystal/frosted/cinema while DEFAULT_SETTINGS preserves false", () => {
  const ctx = vm.createContext({ URL, Math });
  ctx.window = ctx;
  vm.runInNewContext(read("src/shared/settings.js"), ctx, { filename: "src/shared/settings.js" });
  const S = ctx.YLG_SETTINGS;

  assert.equal(S.DEFAULT_SETTINGS.ambientLight.modes.shorts, false, "DEFAULT_SETTINGS.ambientLight.modes.shorts must stay false");
  const customBase = {
    ...S.DEFAULT_SETTINGS,
    ambientLight: {
      ...S.DEFAULT_SETTINGS.ambientLight,
      modes: { normal: true, theater: false, fullscreen: true, shorts: false }
    }
  };
  for (const id of ["crystal", "frosted", "cinema"]) {
    const applied = S.applyStyleProfile(customBase, id);
    assert.equal(applied.ambientLight.modes.shorts, true, `${id} must enable modes.shorts`);
    assert.equal(applied.ambientLight.modes.theater, false, `${id} must deep-merge ambientLight.modes`);
    assert.equal(applied.ambientLight.enabled, true, `${id} must enable ambientLight`);
    assert.equal(S.matchStyleProfile(applied), id, `${id} must still round-trip via matchStyleProfile`);
  }
  const eco = S.applyStyleProfile(S.applyStyleProfile(customBase, "crystal"), "eco");
  assert.equal(eco.ambientLight.enabled, false, "eco must disable ambientLight");
  assert.equal(eco.ambientLight.modes.shorts, false, "eco must disable modes.shorts");
});

test("Shorts prioritizes #shorts-player video, tracks reused-video swaps, and applies 2-axis detectBarSize crop + 96x54 halo", () => {
  const { queryAll, getComputedStyle } = require("./dom-fixture");
  const html = makeEl("html");
  const body = makeEl("body");
  html.appendChild(body);
  const shortsHost = makeEl("ytd-shorts");
  body.appendChild(shortsHost);

  const preloadedReel = makeEl("ytd-reel-video-renderer");
  const vPreload = makeEl("video");
  vPreload.id = "preload";
  vPreload.paused = true;
  vPreload.readyState = 4;
  vPreload.rect = { left: 437, top: -900, width: 405, height: 720 };
  preloadedReel.appendChild(vPreload);
  shortsHost.appendChild(preloadedReel);

  const activeReel = makeEl("ytd-reel-video-renderer");
  activeReel.setAttribute("is-active", "");
  const vActiveReel = makeEl("video");
  vActiveReel.id = "active-reel";
  vActiveReel.paused = true;
  vActiveReel.readyState = 4;
  vActiveReel.rect = { left: 437, top: 40, width: 405, height: 720 };
  activeReel.appendChild(vActiveReel);
  shortsHost.appendChild(activeReel);

  const shortsPlayer = makeEl("div");
  shortsPlayer.id = "shorts-player";
  shortsPlayer.rect = { left: 437, top: 40, width: 405, height: 720 };
  const vPlayer = makeEl("video");
  vPlayer.id = "shorts-main";
  vPlayer.paused = false;
  vPlayer.readyState = 4;
  vPlayer.videoWidth = 1080;
  vPlayer.videoHeight = 1920;
  vPlayer.currentSrc = "blob:https://www.youtube.com/short-1";
  vPlayer.rect = { left: 437, top: 40, width: 405, height: 720 };
  const listenerMap = new Map();
  vPlayer.addEventListener = (ev, fn) => {
    if (!listenerMap.has(ev)) listenerMap.set(ev, new Set());
    listenerMap.get(ev).add(fn);
  };
  vPlayer.removeEventListener = (ev, fn) => {
    if (listenerMap.has(ev)) listenerMap.get(ev).delete(fn);
  };
  shortsPlayer.appendChild(vPlayer);
  shortsHost.appendChild(shortsPlayer);

  // Build synthetic 64x112 probe RGBA buffer mode:
  // "cropped" = 25% top/bottom black letterbox + 25% left/right black pillarbox around bright blue-cyan interior (with 1px safety backoff -> 24%/23.5%)
  // "caption-header" = sparse bright text strokes at y=5%..10% inside top black banner + 12.5% bottom black bar (must NOT slice caption!)
  // "clean" = full-bleed bright frame (no bars)
  let frameMode = "cropped";
  const makeProbeRgba = (mode) => {
    const w = 64, h = 112;
    const buf = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (mode === "caption-header") {
          const isCaptionText = y >= 5 && y <= 11 && x >= 14 && x <= 49 && (x % 3 === 1);
          const isMainVideo = y >= 14 && y < 98;
          const lit = isCaptionText || isMainVideo;
          buf[i] = lit ? (isCaptionText ? 245 : 72) : 0;
          buf[i + 1] = lit ? (isCaptionText ? 210 : 168) : 0;
          buf[i + 2] = lit ? (isCaptionText ? 40 : 88) : 0;
          buf[i + 3] = 255;
        } else {
          const inBar = mode === "cropped" && (y < 28 || y >= 84 || x < 16 || x >= 48);
          buf[i] = inBar ? 0 : 64;
          buf[i + 1] = inBar ? 0 : 184;
          buf[i + 2] = inBar ? 0 : 244;
          buf[i + 3] = 255;
        }
      }
    }
    return { data: buf };
  };

  const tinyDrawArgs = [];
  const makeMockCanvas = () => {
    const el = makeEl("canvas");
    const ops = [];
    const ctx2d = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      globalCompositeOperation: "source-over",
      clearRect() { ops.push("clear"); },
      drawImage(...args) {
        ops.push("draw");
        if (el.width === 16 && el.height === 16) tinyDrawArgs.push(args);
      },
      fillRect() { ops.push("fill"); },
      createRadialGradient() { return { addColorStop() {} }; },
      getImageData() { return makeProbeRgba(frameMode); }
    };
    el.getContext = () => ctx2d;
    el._ops = ops;
    return el;
  };

  const doc = {
    hidden: false,
    documentElement: html,
    body,
    createElement: (tag) => (tag === "canvas" ? makeMockCanvas() : makeEl(tag)),
    querySelector: (sel) => queryAll(html, sel)[0] || null,
    querySelectorAll: (sel) => queryAll(html, sel),
    addEventListener() {},
    removeEventListener() {}
  };
  const loc = { pathname: "/shorts/short-1" };
  const timers = new Map();
  let tId = 0;
  let clock = 10000;
  const FakeDate = { now: () => clock };
  const ctx = vm.createContext({
    document: doc,
    location: loc,
    innerWidth: 1280,
    innerHeight: 800,
    getComputedStyle,
    Date: FakeDate,
    Math,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    setTimeout: (fn) => { const id = ++tId; timers.set(id, { fn, type: "timeout" }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: (fn) => { const id = ++tId; timers.set(id, { fn, type: "interval" }); return id; },
    clearInterval: (id) => { timers.delete(id); },
    YLG_NAV: {
      // Deliberately provide stale/wrong fallback video to prove findShortsVideo overrides it via priority
      getPlayer: () => ({ video: vPreload, container: shortsHost, mode: "shorts" }),
      onNavigation: () => () => {}
    },
    YLG_AMBIENT_VENDOR: { refreshMode() {}, onStateChanged: () => () => {}, stats: () => ({ state: "off" }) }
  });
  ctx.window = ctx;
  vm.runInNewContext(read("src/ambient/ambient-controller.js"), ctx, { filename: "src/ambient/ambient-controller.js" });

  const A = ctx.YLG_AMBIENT;
  A.init();
  const baseSt = {
    enabled: true,
    respectReducedMotion: true,
    ambientLight: {
      enabled: true, fpsLimit: 16, brightness: 1, spread: 162, detectBarSize: true,
      modes: { normal: true, theater: true, fullscreen: true, shorts: true }
    }
  };
  A.updateSettings(baseSt);
  for (const [id, item] of [...timers.entries()]) {
    if (item.type === "timeout") { timers.delete(id); item.fn(); }
  }

  // Must select #shorts-player video over vPreload & attach lifecycle listeners
  assert.ok(listenerMap.get("loadeddata") && listenerMap.get("loadeddata").size === 1, "must bind loadeddata on active #shorts-player video");
  assert.ok(listenerMap.get("emptied") && listenerMap.get("emptied").size === 1, "must bind emptied listener for stream reuse");
  const canvas = shortsHost.children.find((c) => c.id === "ylg-shorts-glow");
  assert.ok(canvas && canvas.width === 96 && canvas.height === 54, "#ylg-shorts-glow must use 96x54 viewport halo canvas");

  // Initial cropped 2-axis letterbox + pillarbox detection (with 1px safety backoff on 64x112 probe)
  assert.equal(shortsHost.getAttribute("data-ylg-shorts-cropped"), "1", "2-axis black bars must set data-ylg-shorts-cropped=1");
  assert.equal(shortsHost.style.getPropertyValue("--ylg-shorts-crop-top"), "24%");
  assert.equal(shortsHost.style.getPropertyValue("--ylg-shorts-crop-bottom"), "24%");
  assert.equal(shortsHost.style.getPropertyValue("--ylg-shorts-crop-left"), "23.5%");
  assert.equal(shortsHost.style.getPropertyValue("--ylg-shorts-crop-right"), "23.5%");
  assert.deepEqual({ ...A.stats().shorts.crop }, { top: 24, bottom: 24, left: 23.5, right: 23.5 });
  const croppedDraw = tinyDrawArgs[tinyDrawArgs.length - 1];
  assert.equal(croppedDraw.length, 9, "cropped frame must pass 9-arg cropped source rect to tinyCtx.drawImage");
  assert.deepEqual([...croppedDraw.slice(1, 5)], [254, 461, 572, 998]);

  // Simulate reused <video> stream swap to an uncropped Short
  clock += 500;
  for (const fn of listenerMap.get("emptied")) fn();
  assert.equal(shortsHost.getAttribute("data-ylg-shorts-cropped"), null, "emptied event must immediately clear stale crop attr");
  vPlayer.currentSrc = "blob:https://www.youtube.com/short-2";
  loc.pathname = "/shorts/short-2";
  frameMode = "clean";
  clock += 500;
  for (const fn of listenerMap.get("loadeddata")) fn();
  assert.equal(shortsHost.getAttribute("data-ylg-shorts-cropped"), null, "clean full-bleed Short must remain uncropped");
  assert.equal(shortsHost.style.getPropertyValue("--ylg-shorts-crop-top"), "");
  assert.deepEqual({ ...A.stats().shorts.crop }, { top: 0, bottom: 0, left: 0, right: 0 });

  // Simulate baked-in caption header over top black bar (like /shorts/8XGMDdybbu4) -> must NOT slice caption text
  frameMode = "caption-header";
  clock += 500;
  for (const fn of listenerMap.get("seeked")) fn();
  assert.equal(shortsHost.getAttribute("data-ylg-shorts-cropped"), null, "baked-in caption over black top banner must not trigger aggressive top crop");
  assert.deepEqual({ ...A.stats().shorts.crop }, { top: 0, bottom: 0, left: 0, right: 0 });

  // Verify disabling detectBarSize clears active crop immediately
  frameMode = "cropped";
  clock += 500;
  for (const fn of listenerMap.get("seeked")) fn();
  assert.equal(shortsHost.getAttribute("data-ylg-shorts-cropped"), "1");
  clock += 500;
  A.updateSettings({ ...baseSt, ambientLight: { ...baseSt.ambientLight, detectBarSize: false } });
  for (const [id, item] of [...timers.entries()]) {
    if (item.type === "timeout") { timers.delete(id); item.fn(); }
  }
  assert.equal(shortsHost.getAttribute("data-ylg-shorts-cropped"), null, "disabling detectBarSize must clear crop");
  assert.equal(shortsHost.style.getPropertyValue("--ylg-shorts-crop-left"), "");

  // Fallback priority: hidden #shorts-player -> active reel -> centered playing inside ytd-shorts -> restored #shorts-player
  const activeListeners = new Map();
  vActiveReel.addEventListener = (ev, fn) => {
    if (!activeListeners.has(ev)) activeListeners.set(ev, new Set());
    activeListeners.get(ev).add(fn);
  };
  vActiveReel.removeEventListener = (ev, fn) => {
    if (activeListeners.has(ev)) activeListeners.get(ev).delete(fn);
  };
  vPlayer.style.display = "none";
  vActiveReel.paused = false;
  clock += 500;
  for (const item of timers.values()) { if (item.type === "interval") item.fn(); }
  assert.equal((listenerMap.get("loadeddata") || new Set()).size, 0, "hidden #shorts-player video must unbind listeners");
  assert.equal((activeListeners.get("loadeddata") || new Set()).size, 1, "must fall back to active reel video");

  activeReel.removeAttribute("is-active");
  vPreload.style.display = "block";
  clock += 500;
  for (const item of timers.values()) { if (item.type === "interval") item.fn(); }
  assert.equal((activeListeners.get("loadeddata") || new Set()).size, 1, "must prefer centered playing video in ytd-shorts over offscreen paused preload");

  vPlayer.style.display = "block";
  clock += 500;
  for (const item of timers.values()) { if (item.type === "interval") item.fn(); }
  assert.equal((activeListeners.get("loadeddata") || new Set()).size, 0, "restoring #shorts-player video must unbind fallback video");
  assert.equal((listenerMap.get("loadeddata") || new Set()).size, 1, "restored #shorts-player video must rebind listeners");

  A.teardown();
  for (const ev of ["play", "loadeddata", "seeked", "emptied"]) {
    assert.equal((listenerMap.get(ev) || new Set()).size, 0, `teardown must remove ${ev} listener`);
  }
  assert.equal(timers.size, 0, "teardown must clear all timers");
});

test("Shorts ambient.css, youtube.css, and @focus-chrome experience contracts stay intact", () => {
  const ambCss = read("src/ambient/ambient.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(ambCss, /#ylg-shorts-glow[^}]*object-fit:\s*cover/, "#ylg-shorts-glow must not use object-fit: cover");
  for (const sel of ["ytd-page-manager", ".player-wrapper", ".reel-video-in-sequence-thumbnail", "#shorts-player"]) {
    assert.ok(ambCss.includes(sel), `ambient.css must clear opaque background on ${sel}`);
  }
  assert.match(ambCss, /ytd-shorts\[data-ylg-shorts-cropped="1"\]\s+video\.html5-main-video[\s\S]*?clip-path:\s*inset\(/);
  for (const cv of ["--ylg-shorts-crop-top", "--ylg-shorts-crop-right", "--ylg-shorts-crop-bottom", "--ylg-shorts-crop-left"]) {
    assert.ok(ambCss.includes(cv), `ambient.css clip-path must read ${cv}`);
  }
  assert.match(ambCss, /ytd-shorts\[data-ylg-shorts-cropped="1"\]\s+\.reel-video-in-sequence-thumbnail/);

  const ytCss = read("src/styles/youtube.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(ytCss, /\.html5-video-player:not\(#shorts-player\)[\s\S]*?border-radius:\s*0/);
  const frostedBlocks = ytCss.match(/#frosted-glass[^{]*\{/g) || [];
  assert.equal(frostedBlocks.length, 1, "youtube.css must keep exactly one #frosted-glass block");

  const expCss = read("src/styles/experience-features.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(expCss, /::after\b/, "experience-features.css must not reuse ::after dark scrims");
  assert.match(expCss, /@layer\s+ylg-states\b/);
  assert.match(expCss, /\[data-ylg-zen-watch="true"\][\s\S]*?opacity:\s*0\.16\s*!important/);
  assert.match(expCss, /\[data-ylg-cinema-idle="true"\][\s\S]*?opacity:\s*0\.18\s*!important/);
  assert.match(expCss, /\[data-ylg-cinema-armed="true"\]/);
  assert.match(expCss, /@media\s*\(forced-colors:\s*active\)[\s\S]*?opacity:\s*1\s*!important/);

  // Exercise YLG_EXPERIENCE cinemaArmed lifecycle + cold-load late <video> binding on "schedule"
  const de = makeEl("html");
  const body = makeEl("body");
  de.appendChild(body);
  let activeVid = null;
  let coldNavCb = null;
  const coldTimeouts = [];
  let coldSeq = 0;
  const expCtx = vm.createContext({
    document: {
      hidden: false,
      fullscreenElement: null,
      documentElement: de,
      body,
      createElement: (t) => makeEl(t),
      querySelector: (sel) => (sel.includes("video") ? activeVid : null),
      addEventListener() {},
      removeEventListener() {}
    },
    location: { pathname: "/watch", search: "?v=cold" },
    Date,
    setTimeout: (fn, ms) => { const id = ++coldSeq; coldTimeouts.push({ id, fn, ms, cleared: false }); return id; },
    clearTimeout: (id) => { const hit = coldTimeouts.find((t) => t.id === id); if (hit) hit.cleared = true; },
    addEventListener() {},
    removeEventListener() {},
    YLG_NAV: {
      getPlayer: () => ({ video: activeVid, mode: "normal" }),
      onNavigation: (fn) => { coldNavCb = fn; return () => { coldNavCb = null; }; }
    }
  });
  expCtx.window = expCtx;
  vm.runInNewContext(read("src/content/experience-controls.js"), expCtx, { filename: "src/content/experience-controls.js" });
  const EXP = expCtx.YLG_EXPERIENCE;
  EXP.updateSettings({ enabled: true, hotkeys: false, immersiveCinema: true, zenWatch: false, hideShortsShelf: false });
  assert.equal(de.getAttribute("data-ylg-cinema-armed"), "true");
  assert.equal(EXP.stats().cinemaArmed, true);

  // Initial cold timer fires before <video> exists -> cannot idle yet
  const initialIdle = coldTimeouts.filter((t) => !t.cleared && t.ms === 3500);
  assert.equal(initialIdle.length, 1);
  initialIdle[0].fn();
  assert.equal(de.getAttribute("data-ylg-cinema-idle"), null);

  // Late <video> mounts and emits same-URL "schedule" tick -> binds pause/ended/play and arms idle
  const lateVid = makeEl("video");
  lateVid.paused = false;
  lateVid.ended = false;
  const vidEvents = new Map();
  lateVid.addEventListener = (ev, fn) => {
    if (!vidEvents.has(ev)) vidEvents.set(ev, new Set());
    vidEvents.get(ev).add(fn);
  };
  lateVid.removeEventListener = (ev, fn) => {
    if (vidEvents.has(ev)) vidEvents.get(ev).delete(fn);
  };
  body.appendChild(lateVid);
  activeVid = lateVid;
  coldNavCb({ reason: "schedule" });
  for (const ev of ["play", "pause", "ended"]) {
    assert.equal((vidEvents.get(ev) || new Set()).size, 1, `late <video> must bind ${ev} listener on schedule`);
  }
  const lateIdle = coldTimeouts.filter((t) => !t.cleared && t.ms === 3500 && t.id > initialIdle[0].id);
  assert.equal(lateIdle.length, 1, "cold-load late <video> binding must re-arm idle timer");
  lateIdle[0].fn();
  assert.equal(de.getAttribute("data-ylg-cinema-idle"), "true", "cold-load late <video> must reach cinema idle");

  EXP.updateSettings({ enabled: true, hotkeys: false, immersiveCinema: false, zenWatch: false, hideShortsShelf: false });
  assert.equal(de.getAttribute("data-ylg-cinema-armed"), null);
  assert.equal(EXP.stats().cinemaArmed, false);
  EXP.teardown();
  assert.equal(de.getAttribute("data-ylg-cinema-armed"), null);
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
