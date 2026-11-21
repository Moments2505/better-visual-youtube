"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { makeEl, queryAll, getComputedStyle } = require("./dom-fixture");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

// Helper: extract workerCode$1 + BarDetection from vendor/ambient/content-main.js and run against synthetic frames
function createWatchBarWorkerHarness() {
  const main = read("vendor/ambient/content-main.js");
  const start = main.indexOf("  const workerCode$1 = function () {");
  const end = main.indexOf("  class BarDetection {", start);
  assert.ok(start > 0 && end > start, "workerCode$1 block must exist in content-main.js");
  const workerSnippet = main.slice(start, end);

  const bdStart = end;
  const bdEnd = main.indexOf("\n  const FRAMESYNC_DECODEDFRAMES =", bdStart);
  assert.ok(bdEnd > bdStart, "BarDetection class must exist in content-main.js");
  const bdSnippet = main.slice(bdStart, bdEnd);

  const sandbox = {
    Uint8Array,
    Uint8ClampedArray,
    Uint16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Math,
    Array,
    Object,
    Number,
    Error,
    Promise,
    console,
    performance: { now: () => 1000 },
    setTimeout,
    clearTimeout,
    requestIdleCallback: (fn) => fn(),
    wrapErrorHandler: (fn) => fn,
    appendErrorStack: () => {},
    SentryReporter: { captureException() {} },
    SafeOffscreenCanvas: class {
      constructor(w, h) { this.width = w; this.height = h; }
      getContext() { return null; }
    }
  };
  vm.createContext(sandbox);
  const { workerCode, BarDetection } = vm.runInContext(
    `(function () {\n${workerSnippet}\n${bdSnippet}\nreturn { workerCode: workerCode$1, BarDetection };\n})()`,
    sandbox
  );

  // Instantiate FallbackWorker directly
  let lastResult = null;
  const scope = {
    isFallbackWorker: true,
    postMessage(msg) { lastResult = msg; },
    onmessage: null
  };
  workerCode.bind(scope)();

  let runId = 0;
  async function detectFrame(rgbaFn, opts = {}) {
    const size = opts.size || 256;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [r, g, b, a = 255] = rgbaFn(x, y, size, size);
        const i = (y * size + x) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
      }
    }
    const mockCanvas = { width: size, height: size };
    const mockCtx = {
      getImageData: () => ({ width: size, height: size, data }),
      clearRect: () => {}
    };
    lastResult = null;
    await scope.onmessage({
      data: {
        id: ++runId,
        canvasInfo: { canvas: mockCanvas, ctx: mockCtx },
        detectColored: opts.detectColored === true,
        offsetPercentage: opts.offsetPercentage || 0,
        detectHorizontal: opts.detectHorizontal !== false,
        currentHorizontalPercentage: opts.currentHorizontalPercentage,
        detectVertical: opts.detectVertical !== false,
        currentVerticalPercentage: opts.currentVerticalPercentage,
        ratio: opts.ratio || (9 / 16),
        allowedAnomaliesPercentage: opts.allowedAnomaliesPercentage ?? 20,
        allowedUnevenBarsPercentage: opts.allowedUnevenBarsPercentage ?? 10,
        xOffsetSize: opts.xOffsetSize || 4
      }
    });
    return lastResult;
  }

  return { detectFrame, BarDetection, mainSource: main };
}

test("Watch BarDetection uses 256x256 lightweight canvas and fixes bottom out-of-bounds + ignoreEdge bug", () => {
  const main = read("vendor/ambient/content-main.js");
  assert.doesNotMatch(main, /for\s*\(\s*let\s+y\s*=\s*maxY\s*-\s*1\s*\+\s*ignoreEdge/, "bottom scanline must not start out of bounds at maxY - 1 + ignoreEdge");
  assert.match(main, /new SafeOffscreenCanvas\(\s*256\s*,\s*256\s*\)/, "BarDetection should use 256x256 canvas for 4x lighter main-thread GPU readback");
});

test("Watch worker detects limited-range studio-black (rgb 16,16,16) + noisy compressed 21:9 bars", async () => {
  const { detectFrame } = createWatchBarWorkerHarness();
  const res = await detectFrame((x, y, w, h) => {
    const inBar = y < Math.round(h * 0.125) || y >= Math.round(h * 0.875);
    if (inBar) {
      const n = ((x * 7 + y * 13) % 5) - 2; // +-2 compression noise around studio black 16
      return [16 + n, 16 + n, 17 + n];
    }
    return [90 + (x % 80), 130 + (y % 60), 185];
  });
  assert.ok(res && !res.error, "worker must not error");
  assert.ok(
    res.horizontalBarSizeInfo && res.horizontalBarSizeInfo.percentage >= 11 && res.horizontalBarSizeInfo.percentage <= 14,
    `expected ~12.5% horizontal studio-black bar, got ${JSON.stringify(res.horizontalBarSizeInfo)}`
  );
  assert.equal(res.verticalBarSizeInfo.percentage, 0);
});

test("Watch worker detects 21:9 bars even when 40% of active scene touching the bar is dark shadow/night sky", async () => {
  const { detectFrame } = createWatchBarWorkerHarness();
  const res = await detectFrame((x, y, w, h) => {
    const inBar = y < Math.round(h * 0.125) || y >= Math.round(h * 0.875);
    if (inBar) return [2, 2, 2];
    // Left 40% of frame is pitch dark shadow touching both top and bottom bars!
    if (x < w * 0.4) return [3, 3, 4];
    return [190, 120, 60];
  });
  assert.ok(
    res.horizontalBarSizeInfo && res.horizontalBarSizeInfo.percentage >= 11 && res.horizontalBarSizeInfo.percentage <= 14,
    `expected ~12.5% bar despite 40% dark-edge scene, got ${JSON.stringify(res.horizontalBarSizeInfo)}`
  );
});

test("Watch worker detects asymmetric bars (top 8% / bottom 16% and single-sided bottom 15%) with per-side percentages", async () => {
  const { detectFrame } = createWatchBarWorkerHarness();
  const asym = await detectFrame((x, y, w, h) => {
    if (y < Math.round(h * 0.08) || y >= Math.round(h * 0.84)) return [4, 4, 4];
    return [80, 160, 220];
  });
  assert.ok(
    asym.horizontalBarSizeInfo && asym.horizontalBarSizeInfo.topPercentage >= 7 && asym.horizontalBarSizeInfo.topPercentage <= 9.5,
    `expected top ~8%, got ${JSON.stringify(asym.horizontalBarSizeInfo)}`
  );
  assert.ok(
    asym.horizontalBarSizeInfo && asym.horizontalBarSizeInfo.bottomPercentage >= 14.5 && asym.horizontalBarSizeInfo.bottomPercentage <= 17.5,
    `expected bottom ~16%, got ${JSON.stringify(asym.horizontalBarSizeInfo)}`
  );

  const bottomOnly = await detectFrame((x, y, w, h) => {
    if (y >= Math.round(h * 0.85)) return [0, 0, 0];
    return [140, 180, 90];
  });
  assert.equal(bottomOnly.horizontalBarSizeInfo.topPercentage, 0, "top edge is bright video and must stay 0%");
  assert.ok(
    bottomOnly.horizontalBarSizeInfo.bottomPercentage >= 13.5 && bottomOnly.horizontalBarSizeInfo.bottomPercentage <= 16.5,
    `expected single-sided bottom ~15%, got ${JSON.stringify(bottomOnly.horizontalBarSizeInfo)}`
  );
});

test("Watch worker detects 2-axis windowboxed bars (horizontal + vertical simultaneously) and 4:3 pillarboxes", async () => {
  const { detectFrame } = createWatchBarWorkerHarness();
  const boxed = await detectFrame((x, y, w, h) => {
    if (y < Math.round(h * 0.12) || y >= Math.round(h * 0.88) || x < Math.round(w * 0.18) || x >= Math.round(w * 0.82)) {
      return [10, 10, 10];
    }
    return [210, 140, 90];
  });
  assert.ok(
    boxed.horizontalBarSizeInfo.percentage >= 10.5 && boxed.horizontalBarSizeInfo.percentage <= 13.5,
    `expected windowboxed horizontal ~12%, got ${JSON.stringify(boxed.horizontalBarSizeInfo)}`
  );
  assert.ok(
    boxed.verticalBarSizeInfo.percentage >= 16.5 && boxed.verticalBarSizeInfo.percentage <= 19.5,
    `expected windowboxed vertical ~18%, got ${JSON.stringify(boxed.verticalBarSizeInfo)}`
  );
});

test("Watch worker protects burned-in subtitles inside bar while ignoring tiny corner watermark and holding on fade-to-black", async () => {
  const { detectFrame, BarDetection } = createWatchBarWorkerHarness();
  // Wide bright subtitle across center of bottom black bar (y = 89%..94%, x = 22%..78%)
  const sub = await detectFrame((x, y, w, h) => {
    const isSub = y >= Math.round(h * 0.89) && y <= Math.round(h * 0.94) && x >= Math.round(w * 0.22) && x <= Math.round(w * 0.78);
    if (isSub) return [250, 250, 250];
    if (y < Math.round(h * 0.125) || y >= Math.round(h * 0.875)) return [0, 0, 0];
    return [70, 150, 200];
  });
  assert.ok(
    (sub.horizontalBarSizeInfo.bottomPercentage ?? sub.horizontalBarSizeInfo.percentage ?? 0) <= 6.5,
    `must not slice burned-in subtitle sitting at bottom 6%..11%, got ${JSON.stringify(sub.horizontalBarSizeInfo)}`
  );

  // Fade-to-black frame must return undefined (inconclusive), NOT poison BarDetection history with 0
  const fade = await detectFrame(() => [0, 0, 0]);
  assert.equal(fade.horizontalBarSizeInfo.percentage, undefined, "all-black fade frame must be inconclusive");
  const bd = new BarDetection({ stats: {} });
  const rFade = bd.averagePercentage(fade.horizontalBarSizeInfo, {}, 1.25, bd.history.horizontal, 4);
  assert.equal(rFade, undefined, "inconclusive fade frame must not emit or seed 0 into bar history");
  assert.equal(bd.history.horizontal.length, 0, "inconclusive fade frame must leave history clean");
});

test("Ambient vendor bridge resets active bars to 0 when detectBarSize is toggled OFF", async () => {
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
          set: (p, cb) => queueMicrotask(() => cb()),
          remove: (k, cb) => queueMicrotask(() => cb())
        }
      }
    }
  });
  ctx.window = ctx;
  vm.runInNewContext(read("src/ambient/ambient-vendor-bridge.js"), ctx, { filename: "src/ambient/ambient-vendor-bridge.js" });
  const B = ctx.YLG_AMBIENT_VENDOR;
  const calls = [];
  const engine = {
    isHidden: false,
    elem: makeEl(),
    settings: {
      enabled: true,
      detectHorizontalBarSizeEnabled: true,
      detectVerticalBarSizeEnabled: true,
      horizontalBarsClipPercentage: 12.5,
      verticalBarsClipPercentage: 10,
      set(n, v) { this[n] = v; calls.push(["set", n, v]); }
    },
    barDetection: { reset() { calls.push(["barReset"]); } },
    setHorizontalBars(v) { this.settings.horizontalBarsClipPercentage = v; calls.push(["setH", v]); return true; },
    setVerticalBars(v) { this.settings.verticalBarsClipPercentage = v; calls.push(["setV", v]); return true; },
    async updateSizes() { calls.push(["updateSizes"]); },
    resetAverageVideoFramesDifference() { calls.push(["resetDiff"]); },
    async start() {},
    async hide() {},
    async optionalFrame() { calls.push(["optionalFrame"]); }
  };
  await B.attach(engine);
  await B.push({ enabled: true, ambientLight: { enabled: true, detectBarSize: true, modes: { normal: true, theater: true, fullscreen: true, shorts: false } } });
  calls.length = 0;
  engine.settings.horizontalBarsClipPercentage = 12.5;
  engine.settings.verticalBarsClipPercentage = 10;
  await B.push({ enabled: true, ambientLight: { enabled: true, detectBarSize: false, modes: { normal: true, theater: true, fullscreen: true, shorts: false } } });
  assert.equal(engine.settings.horizontalBarsClipPercentage, 0, "disabling detectBarSize must reset horizontalBarsClipPercentage to 0");
  assert.equal(engine.settings.verticalBarsClipPercentage, 0, "disabling detectBarSize must reset verticalBarsClipPercentage to 0");
  assert.ok(calls.some((c) => c[0] === "updateSizes"), "disabling detectBarSize must immediately call updateSizes()");
});

test("Shorts bar detector handles studio-black (16,16,16), dark-edge scenes, asymmetric bars, 39% ultrawide, fade persistence, and cached halo box", () => {
  const html = makeEl("html");
  const body = makeEl("body");
  html.appendChild(body);
  const shortsHost = makeEl("ytd-shorts");
  body.appendChild(shortsHost);
  const shortsPlayer = makeEl("div");
  shortsPlayer.id = "shorts-player";
  let rectReads = 0;
  shortsPlayer.getBoundingClientRect = () => {
    rectReads++;
    return { left: 437, top: 40, width: 405, height: 720, right: 842, bottom: 760 };
  };
  const vPlayer = makeEl("video");
  vPlayer.paused = false;
  vPlayer.readyState = 4;
  vPlayer.videoWidth = 1080;
  vPlayer.videoHeight = 1920;
  vPlayer.currentSrc = "blob:https://www.youtube.com/short-s1";
  vPlayer.rect = { left: 437, top: 40, width: 405, height: 720 };
  const listeners = new Map();
  vPlayer.addEventListener = (ev, fn) => {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev).add(fn);
  };
  vPlayer.removeEventListener = (ev, fn) => { if (listeners.has(ev)) listeners.get(ev).delete(fn); };
  shortsPlayer.appendChild(vPlayer);
  shortsHost.appendChild(shortsPlayer);

  let mode = "studio-black-dark-edge";
  const makeProbe = () => {
    const w = 64, h = 112;
    const buf = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let r = 80, g = 180, b = 230;
        if (mode === "studio-black-dark-edge") {
          // 16:9 inside 9:16 (~34% top/bottom) at studio black rgb(16,16,16) + dark jacket covering 40% of width
          if (y < 38 || y >= 74) { r = 16; g = 16; b = 17; }
          else if (x < 26) { r = 4; g = 4; b = 5; }
        } else if (mode === "fade-black") {
          r = 0; g = 0; b = 0;
        } else if (mode === "asymmetric-caption") {
          // Exact model of /shorts/8XGMDdybbu4: 5% black above bright yellow caption (y=5..11), 12.5% bottom black bar
          const isCaption = y >= 5 && y <= 11 && x >= 12 && x <= 51 && (x % 3 === 1);
          const isVideo = y >= 14 && y < 98;
          if (isCaption) { r = 245; g = 210; b = 40; }
          else if (!isVideo) { r = 0; g = 0; b = 0; }
        } else if (mode === "dim-asymmetric-caption") {
          // Models /shorts/8XGMDdybbu4 at ct=11.29..11.64 where scene edge above bottom bar is dim (luma ~13.7)
          const isCaption = y >= 5 && y <= 11 && x >= 12 && x <= 51 && (x % 3 === 1);
          const isVideo = y >= 14 && y < 98;
          if (isCaption) { r = 245; g = 210; b = 40; }
          else if (isVideo) { r = 8; g = 14; b = 28; }
          else { r = 0; g = 0; b = 0; }
        } else if (mode === "ultrawide-39") {
          if (y < 44 || y >= 68) { r = 6; g = 6; b = 6; }
        } else if (mode === "clean") {
          r = 90; g = 190; b = 120;
        }
        buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
      }
    }
    return { data: buf };
  };

  const makeMockCanvas = () => {
    const el = makeEl("canvas");
    const ctx2d = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      globalCompositeOperation: "source-over",
      clearRect() {},
      drawImage() {},
      fillRect() {},
      createRadialGradient() { return { addColorStop() {} }; },
      getImageData: () => makeProbe()
    };
    el.getContext = () => ctx2d;
    return el;
  };

  let rvfcCb = null;
  vPlayer.requestVideoFrameCallback = (cb) => { rvfcCb = cb; return 1; };
  vPlayer.cancelVideoFrameCallback = () => { rvfcCb = null; };

  let clock = 20000;
  const timers = new Map();
  let tId = 0;
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
  const ctx = vm.createContext({
    document: doc,
    location: { pathname: "/shorts/short-s1" },
    innerWidth: 1280,
    innerHeight: 800,
    getComputedStyle,
    Date: { now: () => clock },
    Math,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    setTimeout: (fn) => { const id = ++tId; timers.set(id, { fn, type: "timeout" }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: (fn) => { const id = ++tId; timers.set(id, { fn, type: "interval" }); return id; },
    clearInterval: (id) => { timers.delete(id); },
    YLG_NAV: { getPlayer: () => ({ video: vPlayer, container: shortsHost, mode: "shorts" }), onNavigation: () => () => {} },
    YLG_AMBIENT_VENDOR: { refreshMode() {}, onStateChanged: () => () => {}, stats: () => ({ state: "off" }) }
  });
  ctx.window = ctx;
  vm.runInNewContext(read("src/ambient/ambient-controller.js"), ctx, { filename: "src/ambient/ambient-controller.js" });

  const A = ctx.YLG_AMBIENT;
  A.init();
  A.updateSettings({
    enabled: true,
    respectReducedMotion: true,
    ambientLight: { enabled: true, fpsLimit: 16, brightness: 1, spread: 162, detectBarSize: true, modes: { normal: true, theater: true, fullscreen: true, shorts: true } }
  });
  for (const [id, item] of [...timers.entries()]) {
    if (item.type === "timeout") { timers.delete(id); item.fn(); }
  }

  // 1. Studio black (16,16,16) + 40% dark jacket touching edge must still crop ~33% top/bottom!
  const c1 = A.stats().shorts.crop;
  assert.ok(c1.top >= 31 && c1.top <= 35 && c1.bottom >= 31 && c1.bottom <= 35, `expected ~33% crop on studio-black dark-edge Short, got ${JSON.stringify(c1)}`);

  // 2. Fade-to-black frame must HOLD previous crop (zero flicker!)
  mode = "fade-black";
  clock += 500;
  rvfcCb();
  const cFade = A.stats().shorts.crop;
  assert.deepEqual({ ...cFade }, { ...c1 }, "fade-to-black frame must preserve active crop without flashing black bars");

  // 3. Bright full-bleed frame must immediately clear crop
  mode = "clean";
  clock += 500;
  rvfcCb();
  assert.deepEqual({ ...A.stats().shorts.crop }, { top: 0, bottom: 0, left: 0, right: 0 }, "bright full-bleed frame must immediately un-crop");

  // 4. Asymmetric caption header (5% above caption + 12.5% bottom black bar): protect top caption (top===0) while cropping bottom ~11.5%!
  mode = "asymmetric-caption";
  clock += 1200;
  rvfcCb();
  clock += 500;
  rvfcCb();
  const cAsym = A.stats().shorts.crop;
  assert.equal(cAsym.top, 0, "top baked-in caption at y=5% must never be sliced");
  assert.ok(cAsym.bottom >= 10 && cAsym.bottom <= 13, `bottom 12.5% black bar must still be cropped independently, got ${JSON.stringify(cAsym)}`);

  // 4b. Dim-scene asymmetric frame (luma ~13.7 just above bar) must keep cropping bottom bar without flickering to 0
  mode = "dim-asymmetric-caption";
  clock += 1200;
  rvfcCb();
  const cDimAsym = A.stats().shorts.crop;
  assert.equal(cDimAsym.top, 0, "top baked-in caption must stay protected during dim scenes");
  assert.ok(cDimAsym.bottom >= 10 && cDimAsym.bottom <= 13, `dim-scene asymmetric bottom bar must stay cropped without flickering to 0, got ${JSON.stringify(cDimAsym)}`);

  // 5. Ultrawide 2.39:1 inside 9:16 (~39% bars)
  mode = "ultrawide-39";
  clock += 1200;
  rvfcCb();
  const cUltra = A.stats().shorts.crop;
  assert.ok(cUltra.top >= 37 && cUltra.bottom >= 37, `expected ~38.5% crop on ultrawide Short, got ${JSON.stringify(cUltra)}`);

  // 6. Halo box geometry is cached across video frames (does not query getBoundingClientRect every frame!)
  const readsBefore = rectReads;
  for (let f = 0; f < 10; f++) {
    clock += 80;
    rvfcCb();
  }
  assert.ok(rectReads - readsBefore <= 1, `resolveHaloBox must cache layout rect across frames (got ${rectReads - readsBefore} reads for 10 frames)`);

  A.teardown();
});

test("navigation.js skips 5s background-tab reconcile ticks while hidden and reconciles on visibility return", () => {
  const docListeners = new Map();
  const intervals = [];
  const timeouts = [];
  let seq = 0;
  const doc = {
    hidden: true,
    fullscreenElement: null,
    body: makeEl("body"),
    documentElement: makeEl("html"),
    addEventListener(ev, fn) {
      if (!docListeners.has(ev)) docListeners.set(ev, new Set());
      docListeners.get(ev).add(fn);
    },
    removeEventListener(ev, fn) { if (docListeners.has(ev)) docListeners.get(ev).delete(fn); },
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const ctx = vm.createContext({
    document: doc,
    window: null,
    location: { pathname: "/watch" },
    history: { pushState() {}, replaceState() {} },
    addEventListener() {},
    removeEventListener() {},
    setInterval: (fn, ms) => { const id = ++seq; intervals.push({ id, fn, ms, cleared: false }); return id; },
    clearInterval: (id) => { const it = intervals.find((x) => x.id === id); if (it) it.cleared = true; },
    setTimeout: (fn, ms) => { const id = ++seq; timeouts.push({ id, fn, ms, cleared: false }); return id; },
    clearTimeout: (id) => { const it = timeouts.find((x) => x.id === id); if (it) it.cleared = true; },
    YLG_SELECTORS: { queryAll: () => [], query: () => null, invalidate() {} }
  });
  ctx.window = ctx;
  vm.runInNewContext(read("src/content/navigation.js"), ctx, { filename: "src/content/navigation.js" });

  let notifications = 0;
  ctx.YLG_NAV.init();
  ctx.YLG_NAV.onNavigation(() => { notifications++; });

  const reconcile = intervals.find((x) => x.ms === 5000 && !x.cleared);
  assert.ok(reconcile, "5s reconcile timer must be registered");
  reconcile.fn();
  for (const t of timeouts.splice(0)) { if (!t.cleared) t.fn(); }
  assert.equal(notifications, 0, "hidden background tab must not run 5s reconcile notifications");

  // Tab becomes visible -> visibilitychange schedules a reconcile
  doc.hidden = false;
  assert.ok(docListeners.has("visibilitychange") && docListeners.get("visibilitychange").size === 1, "must subscribe to visibilitychange");
  for (const fn of docListeners.get("visibilitychange")) fn();
  for (const t of timeouts.splice(0)) { if (!t.cleared) t.fn(); }
  assert.ok(notifications >= 1, "returning to visible tab must trigger reconcile");

  ctx.YLG_NAV.teardown();
  assert.equal((docListeners.get("visibilitychange") || new Set()).size, 0, "teardown must remove visibilitychange listener");
});

test("tint-sampler.js excludes black letterbox bars when computing average media tint color", () => {
  const html = makeEl("html");
  const video = makeEl("video");
  video.readyState = 4;
  video.paused = false;
  video.ended = false;
  video.seeking = false;

  // 24x14 frame: top 4 rows & bottom 4 rows are pure black bars (57% of pixels!), middle 6 rows are vivid blue-cyan (20, 120, 220)
  const w = 24, h = 14;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inBar = y < 4 || y >= 10;
      px[i] = inBar ? 0 : 20;
      px[i + 1] = inBar ? 0 : 120;
      px[i + 2] = inBar ? 0 : 220;
      px[i + 3] = 255;
    }
  }
  const mockCanvas = {
    width: w, height: h,
    getContext: () => ({ clearRect() {}, drawImage() {}, getImageData: () => ({ data: px }) })
  };
  let published = null;
  const ctx = vm.createContext({
    document: {
      hidden: false,
      documentElement: html,
      createElement: () => mockCanvas,
      querySelector: (sel) => (sel.includes("video") ? video : null),
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {}
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    dispatchEvent(ev) { if (ev.type === "ylg-tint") published = ev.detail; },
    Date,
    Math,
    setInterval: () => 1,
    clearInterval: () => {}
  });
  ctx.window = ctx;
  vm.runInNewContext(read("src/content/tint-sampler.js"), ctx, { filename: "src/content/tint-sampler.js" });

  ctx.YLG_TINT.init({ enabled: true, tint: "media", ambientLight: { enabled: true, glassSync: true } });
  assert.ok(published, "letterboxed video must produce a tint color");
  // Without excluding black bars, raw average is (9, 51, 94) -> luma=43 -> clamped k=1.35 -> b=127.
  // Excluding black bars gives raw (20, 120, 220) -> luma=105 -> k=0.70 -> (14, 84, 155), much stronger blue signal & accurate hue!
  assert.ok(published.b >= 145, `excluding black bars must yield accurate vivid blue tint (got ${JSON.stringify(published)})`);
  ctx.YLG_TINT.teardown();
});

(async () => {
  let passed = 0;
  for (const { name, fn } of cases) {
    try {
      await fn();
      passed++;
      console.log("PASS " + name);
    } catch (error) {
      console.error("FAIL " + name + "\n" + error.stack);
    }
  }
  console.log(`\nBar-detection & perf regressions: ${passed}/${cases.length} passed`);
  if (passed !== cases.length) process.exitCode = 1;
})();
