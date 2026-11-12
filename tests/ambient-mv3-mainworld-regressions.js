"use strict";
// Standalone Node/VM TDD regression suite for Đợt C:
// 1. Procedural cached 2D canvas noise replacing 753 KB vendor/ambient/images/noise-{1,2,3}.png
// 2. Native MV3 "world": "MAIN" injected.js + zero cross-origin DOM/module tag injection + inactive CSS/JS gating

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

function stripJsComments(source) {
  // Strip /* ... */ and // ... comments outside string/template literals for static code checks
  let out = "";
  let i = 0;
  const n = source.length;
  let quote = null;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\" && i + 1 < n) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i + 1 < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function createMockCanvasFactory(stats, TypedArrayCtor = Uint8ClampedArray) {
  return function createElement(tag) {
    stats.createdTags.push(tag);
    if (String(tag).toLowerCase() !== "canvas") {
      return {
        tagName: String(tag).toUpperCase(),
        style: {},
        classList: { add() {}, remove() {}, toggle() {} },
        setAttribute() {},
        getAttribute() { return ""; },
        remove() {}
      };
    }
    let width = 0;
    let height = 0;
    let lastPixels = null;
    return {
      get width() { return width; },
      set width(v) { width = Number(v) || 0; },
      get height() { return height; },
      set height(v) { height = Number(v) || 0; },
      style: {},
      getContext(type) {
        stats.getContextCalls++;
        if (stats.returnNullContext || type !== "2d") return null;
        return {
          createImageData(w, h) {
            return { width: w, height: h, data: new TypedArrayCtor(w * h * 4) };
          },
          putImageData(imgData) {
            const src = imgData.data;
            lastPixels = Buffer.from(src.buffer, src.byteOffset, src.byteLength);
            stats.buffers.push({ width, height, data: new Uint8Array(lastPixels) });
          }
        };
      },
      toDataURL(mime = "image/png") {
        stats.toDataURLCalls++;
        const payload = (lastPixels || Buffer.alloc(0)).toString("base64");
        return `data:${mime};base64,${payload}`;
      }
    };
  };
}

// ============================================================================
// DELIVERABLE 1: Procedural Canvas Noise replacing 753 KB noise-{1,2,3}.png
// ============================================================================

test("static 753 KB vendor/ambient/images/noise-{1,2,3}.png files and images directory are deleted", () => {
  for (const rel of [
    "vendor/ambient/images/noise-1.png",
    "vendor/ambient/images/noise-2.png",
    "vendor/ambient/images/noise-3.png",
    "vendor/ambient/images"
  ]) {
    assert.equal(fs.existsSync(path.join(root, rel)), false, `${rel} must be removed`);
  }
});

test("vendor/ambient sources contain zero references to images/noise-*.png or vendor/ambient/ baseUrl", () => {
  for (const rel of [
    "vendor/ambient/content-main.js",
    "vendor/ambient/content.js",
    "vendor/ambient/injected.js",
    "vendor/ambient/content.css"
  ]) {
    const src = read(rel);
    assert.doesNotMatch(src, /images\/noise-/, `${rel} must not reference images/noise-`);
    assert.doesNotMatch(src, /getURL\(\s*['"]vendor\/ambient\/['"]\s*\)/, `${rel} must not resolve vendor/ambient/ baseUrl`);
  }
});

test("getProceduralNoiseDataUrl generates deterministic, cached, <15ms 128x128 monochrome grain with upstream alpha 3/5/8", () => {
  const main = read("vendor/ambient/content-main.js");
  const start = main.indexOf("  const proceduralNoiseCache");
  const end = main.indexOf("  class Ambientlight {", start >= 0 ? start : 0);
  assert.ok(start >= 0 && end > start, "proceduralNoiseCache + getProceduralNoiseDataUrl block must precede class Ambientlight");
  const snippet = main.slice(start, end);

  function runGeneratorInstance() {
    const stats = { createdTags: [], getContextCalls: 0, toDataURLCalls: 0, buffers: [], returnNullContext: false };
    const ctx = vm.createContext({});
    const vmUint8ClampedArray = vm.runInContext("Uint8ClampedArray", ctx);
    ctx.document = { createElement: createMockCanvasFactory(stats, vmUint8ClampedArray) };
    const getNoise = vm.runInContext(`(function () {\n${snippet}\nreturn getProceduralNoiseDataUrl;\n})()`, ctx);
    return { getNoise, stats };
  }

  const a = runGeneratorInstance();
  const t0 = performance.now();
  const u1 = a.getNoise(1);
  const u2 = a.getNoise(2);
  const u3 = a.getNoise(3);
  const elapsedMs = performance.now() - t0;

  assert.ok(elapsedMs < 10, `3 cold 128x128 procedural noise textures must generate in <10ms (got ${elapsedMs.toFixed(2)}ms)`);
  for (const [lvl, url] of [[1, u1], [2, u2], [3, u3]]) {
    assert.match(url, /^url\("data:image\/png;base64,[A-Za-z0-9+/=]+"\)?$/, `level ${lvl} must return CSS url("data:image/png;base64,...")`);
  }
  assert.notEqual(u1, u2);
  assert.notEqual(u2, u3);
  assert.notEqual(u1, u3);

  // Lazy in-memory cache check: repeated calls must NOT allocate canvases or re-encode
  for (let i = 0; i < 10; i++) {
    assert.equal(a.getNoise(1), u1);
    assert.equal(a.getNoise(2), u2);
    assert.equal(a.getNoise(3), u3);
  }
  assert.equal(a.stats.createdTags.length, 3, "must allocate exactly 1 canvas per noise level");
  assert.equal(a.stats.toDataURLCalls, 3, "must call toDataURL exactly once per noise level");

  // Pixel buffer verification: 128x128, monochrome R=G=B with non-trivial variance, exact alpha 3 / 5 / 8
  const expectedAlphas = [3, 5, 8];
  assert.equal(a.stats.buffers.length, 3);
  a.stats.buffers.forEach((buf, idx) => {
    assert.equal(buf.width, 128);
    assert.equal(buf.height, 128);
    assert.equal(buf.data.length, 128 * 128 * 4);
    const expectedAlpha = expectedAlphas[idx];
    let minLuma = 255;
    let maxLuma = 0;
    const seenValues = new Set();
    for (let p = 0; p < buf.data.length; p += 4) {
      const r = buf.data[p];
      const g = buf.data[p + 1];
      const b = buf.data[p + 2];
      const alpha = buf.data[p + 3];
      assert.equal(r, g, "grain must be monochrome (R === G)");
      assert.equal(g, b, "grain must be monochrome (G === B)");
      assert.equal(alpha, expectedAlpha, `level ${idx + 1} alpha must match upstream PNG alpha ${expectedAlpha}`);
      if (r < minLuma) minLuma = r;
      if (r > maxLuma) maxLuma = r;
      seenValues.add(r);
    }
    assert.ok(maxLuma - minLuma >= 100, `level ${idx + 1} grain must span wide luminance dynamic range`);
    assert.ok(seenValues.size >= 32, `level ${idx + 1} grain must contain rich discrete dither values`);
  });

  // Cross-instance determinism check
  const b = runGeneratorInstance();
  assert.equal(b.getNoise(1), u1, "level 1 must be 100% deterministic across runs");
  assert.equal(b.getNoise(2), u2, "level 2 must be 100% deterministic across runs");
  assert.equal(b.getNoise(3), u3, "level 3 must be 100% deterministic across runs");
});

test("updateStyles wires procedural noise CSS variables and degrades safely when canvas 2D context is null or absent", () => {
  const main = read("vendor/ambient/content-main.js");
  const noiseStart = main.indexOf("  const proceduralNoiseCache");
  const noiseEnd = main.indexOf("  class Ambientlight {", noiseStart >= 0 ? noiseStart : 0);
  assert.ok(noiseStart >= 0 && noiseEnd > noiseStart, "procedural noise helper must exist");
  const noiseCode = main.slice(noiseStart, noiseEnd);

  const updateStart = main.indexOf("    updateStyles() {");
  const updateEnd = main.indexOf("    resizeCanvasses() {", updateStart);
  assert.ok(updateStart >= 0 && updateEnd > updateStart, "updateStyles method must be extractable");
  const updateMethodSource = main.slice(updateStart, updateEnd);

  function runUpdateStyles({ debandingStrength = 0, videoDebandingStrength = 0, minimalDom = false, nullCtx = false }) {
    const props = new Map();
    const stats = { createdTags: [], getContextCalls: 0, toDataURLCalls: 0, buffers: [], returnNullContext: nullCtx };
    const doc = minimalDom
      ? { body: { toggleAttribute() {} } }
      : {
          body: { toggleAttribute() {} },
          createElement: createMockCanvasFactory(stats)
        };
    const ctx = vm.createContext({
      DEBANDING_BLEND_MODE_LCD: 0,
      DEBANDING_BLEND_MODE_OLED: 1,
      document: doc,
      setStyleProperty(_elem, key, value) {
        props.set(key, value);
      }
    });
    const fn = vm.runInContext(
      `(function () {\n${noiseCode}\nreturn ({${updateMethodSource}}).updateStyles;\n})()`,
      ctx
    );
    const instance = {
      settings: {
        pageBackgroundGreyness: 0,
        surroundingContentFillOpacity: 10,
        surroundingContentImagesOpacity: 100,
        surroundingContentTextAndBtnOnly: false,
        surroundingContentShadowSize: 0,
        surroundingContentShadowOpacity: 0,
        videoShadowSize: 0,
        videoShadowOpacity: 0,
        videoDebandingStrength,
        debandingStrength,
        debandingBlendMode: 0
      },
      videoElem: { getAttribute() { return ""; } },
      videoContainerElem: { appendChild() {} },
      updateFixedStyle() {}
    };
    fn.call(instance);
    return { props, stats };
  }

  // Zero strength -> zero canvas allocations!
  const zero = runUpdateStyles({ debandingStrength: 0, videoDebandingStrength: 0 });
  assert.equal(zero.stats.createdTags.length, 0, "disabled debanding must not create any canvas");
  assert.equal(zero.props.get("--ytal-debanding-background"), "");
  assert.equal(zero.props.get("--ytal-video-debanding-background"), "");

  // Active strengths -> data URLs for levels 1 (<=50), 2 (51..75), 3 (>75)
  const active1 = runUpdateStyles({ debandingStrength: 35, videoDebandingStrength: 60 });
  const active3 = runUpdateStyles({ debandingStrength: 90, videoDebandingStrength: 90 });
  assert.match(active1.props.get("--ytal-debanding-background"), /^url\("data:image\/png;base64,/);
  assert.match(active1.props.get("--ytal-video-debanding-background"), /^url\("data:image\/png;base64,/);
  assert.notEqual(active1.props.get("--ytal-debanding-background"), active1.props.get("--ytal-video-debanding-background"));
  assert.equal(active3.props.get("--ytal-debanding-background"), active3.props.get("--ytal-video-debanding-background"));

  // Null 2D context safety in headless/minimal VM
  const nullContextRes = runUpdateStyles({ debandingStrength: 50, videoDebandingStrength: 80, nullCtx: true });
  assert.equal(nullContextRes.props.get("--ytal-debanding-background"), "");
  assert.equal(nullContextRes.props.get("--ytal-video-debanding-background"), "");

  // Minimal DOM (no document.createElement) safety when videoDebandingStrength === 0 and debandingStrength > 0
  const minimalDomRes = runUpdateStyles({ debandingStrength: 50, videoDebandingStrength: 0, minimalDom: true });
  assert.equal(minimalDomRes.props.get("--ytal-debanding-background"), "");
});

// ============================================================================
// DELIVERABLE 2: Native MV3 "world": "MAIN" & Zero Cross-Origin Tag Injection
// ============================================================================

test("vendor/ambient/injected.js runs safely at document_start in MAIN world, is idempotent, and handles CustomEvent handshake", () => {
  const injectedSrc = read("vendor/ambient/injected.js");
  assert.doesNotMatch(injectedSrc, /currentScript/, "injected.js must never rely on document.currentScript");
  assert.doesNotMatch(injectedSrc, /['"]no-animation['"]/, "injected.js must use namespaced ytal-no-animation class");

  const docListeners = [];
  const outboundMessages = [];
  const htmlAttrs = new Set();
  const mastheadClasses = new Set();

  const mockDocument = {
    head: null,
    body: null,
    documentElement: null, // null at very early document_start!
    addEventListener(type, listener) {
      docListeners.push({ type, listener });
    },
    removeEventListener() {},
    dispatchEvent(event) {
      for (const entry of [...docListeners]) {
        if (entry.type === event.type) entry.listener(event);
      }
      if (event.type === "ytal-message" && typeof event.detail === "string") {
        const parsed = JSON.parse(event.detail);
        if (parsed.injectedScript === "youtube-ambient-light-extension") {
          outboundMessages.push(parsed);
        }
      }
      return true;
    },
    querySelector(sel) {
      if (sel === '[data-ytal-elem="masthead"]') return mockMasthead;
      if (sel === '[data-ytal-elem="video-player"]') return mockPlayer;
      return null;
    }
  };

  const mockMasthead = {
    isConnected: true,
    dataset: { ytalElem: "masthead" },
    classList: {
      add(c) { mastheadClasses.add(c); },
      remove(c) { mastheadClasses.delete(c); }
    }
  };
  const mockPlayer = {
    isConnected: true,
    dataset: { ytalElem: "video-player" },
    getVideoData() { return { isHdr: true, video_id: "abc" }; },
    setSize() {},
    setInternalSize() {}
  };

  const sandbox = {
    console,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    Error,
    JSON,
    Math,
    Object,
    document: mockDocument,
    performance: { now: () => 0 }
    // Notice: matchMedia is intentionally omitted to verify safe optional chaining!
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  // 1st execution at document_start (head/body/documentElement all null!)
  vm.runInContext(injectedSrc, sandbox);
  assert.equal(sandbox.__ytalMainWorldInjected, true, "idempotency flag must be set on globalThis");
  const listenerCountAfterFirstRun = docListeners.filter(l => l.type === "ytal-message").length;
  assert.equal(listenerCountAfterFirstRun, 1, "must register single global ytal-message listener on document");

  // 2nd execution must be a complete no-op (idempotent)
  vm.runInContext(injectedSrc, sandbox);
  assert.equal(
    docListeners.filter(l => l.type === "ytal-message").length,
    1,
    "re-running injected.js must NOT double-register ytal-message listener"
  );

  // Now attach documentElement & dispatch isolated-world messages
  mockDocument.documentElement = {
    toggleAttribute(attr, force) {
      const on = force === undefined ? !htmlAttrs.has(attr) : Boolean(force);
      if (on) htmlAttrs.add(attr); else htmlAttrs.delete(attr);
    },
    getAttribute(attr) {
      return htmlAttrs.has(attr) ? "" : null;
    }
  };

  const sendFromContentScript = (type, message) => {
    mockDocument.dispatchEvent(
      new sandbox.CustomEvent("ytal-message", {
        detail: JSON.stringify({
          type,
          message,
          contentScript: "youtube-ambient-light-extension"
        })
      })
    );
  };

  sendFromContentScript("is-hdr-video");
  assert.equal(outboundMessages.at(-1)?.type, "is-hdr-video");
  assert.equal(outboundMessages.at(-1)?.message, true);

  sendFromContentScript("show", {
    ytdAppElemBackground: "",
    toDark: true,
    hideScrollbar: true,
    relatedScrollbar: false,
    immersiveMode: false
  });
  assert.equal(htmlAttrs.has("data-ambientlight-enabled"), true);
  assert.equal(htmlAttrs.has("data-ambientlight-hide-scrollbar"), true);
  assert.equal(mastheadClasses.size, 0, "transient ytal-no-animation class must be cleaned up after show");
  assert.equal(outboundMessages.at(-1)?.type, "show");

  sendFromContentScript("hide", { toDark: false });
  assert.equal(htmlAttrs.has("data-ambientlight-enabled"), false);
  assert.equal(outboundMessages.at(-1)?.type, "hide");
});

test("vendor/ambient/content.css has ZERO unscoped selectors affecting YouTube when html[data-ambientlight-enabled] is absent", () => {
  const css = read("vendor/ambient/content.css").replace(/\/\*[\s\S]*?\*\//g, "");

  function collectRuleSelectors(block) {
    const selectors = [];
    let i = 0;
    const n = block.length;
    while (i < n) {
      while (i < n && /\s/.test(block[i])) i++;
      if (i >= n) break;
      const open = block.indexOf("{", i);
      if (open === -1) break;
      const header = block.slice(i, open).trim();
      let depth = 1;
      let pos = open + 1;
      while (pos < n && depth > 0) {
        if (block[pos] === "{") depth++;
        else if (block[pos] === "}") depth--;
        pos++;
      }
      const inner = block.slice(open + 1, pos - 1);
      if (header.startsWith("@")) {
        if (/^@(?:media|supports|container)\b/i.test(header)) {
          selectors.push(...collectRuleSelectors(inner));
        }
      } else if (header) {
        selectors.push(header);
      }
      i = pos;
    }
    return selectors;
  }

  function splitTopLevelCommas(selectorList) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < selectorList.length; i++) {
      const ch = selectorList[i];
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
      else if (ch === "," && depth === 0) {
        parts.push(selectorList.slice(start, i).trim());
        start = i + 1;
      }
    }
    const tail = selectorList.slice(start).trim();
    if (tail) parts.push(tail);
    return parts;
  }

  const ruleHeaders = collectRuleSelectors(css);
  assert.ok(ruleHeaders.length > 200, "must parse all rule blocks in vendor/ambient/content.css");

  const allowedScopePattern = /(?:data-ambientlight-|\.ambientlight|\.ytpa-ambientlight|\.ytp-ambientlight|\.ytal-)/;
  const violations = [];
  for (const header of ruleHeaders) {
    for (const sel of splitTopLevelCommas(header)) {
      if (!allowedScopePattern.test(sel)) {
        violations.push(sel);
      }
    }
  }
  assert.deepEqual(violations, [], `Found unscoped CSS selectors in vendor/ambient/content.css: ${violations.join(" | ")}`);
  assert.doesNotMatch(css, /\.no-animation\b/, "unscoped .no-animation must be replaced with .ytal-no-animation");
});

test("vendor/ambient/content.js performs zero cross-origin <link>/<script>/import() injections and stays idle when disabled", async () => {
  const raw = read("vendor/ambient/content.js");
  const codeOnly = stripJsComments(raw);

  assert.doesNotMatch(codeOnly, /chrome\.runtime\.getURL/, "executable code in content.js must not call chrome.runtime.getURL");
  assert.doesNotMatch(codeOnly, /createElement\(\s*['"](?:link|script)['"]\s*\)/, "content.js must not create <link> or <script> tags");
  assert.doesNotMatch(codeOnly, /document\.head/, "content.js must not touch document.head");
  assert.doesNotMatch(codeOnly, /\bimport\s*\(/, "content.js must not dynamically import() chrome-extension:// modules");

  let releaseGate;
  const gatePromise = new Promise(resolve => { releaseGate = resolve; });
  const createdElements = [];
  const docListeners = [];
  let storageGets = 0;
  let getUrlCalls = 0;

  const sandbox = {
    console,
    Error,
    JSON,
    Math,
    Object,
    Promise,
    Set,
    Map,
    WeakMap,
    Symbol,
    Uint8Array,
    crypto: { getRandomValues: arr => arr },
    setTimeout,
    clearTimeout,
    location: { pathname: "/watch", href: "https://www.youtube.com/watch?v=1" },
    navigator: { userAgent: "Mozilla/5.0 Chrome/125.0.0.0" },
    YLG_AMBIENT_VENDOR: {
      waitUntilEnabled: () => gatePromise
    },
    chrome: {
      runtime: {
        id: "ext-id",
        getManifest: () => ({ version: "0.4.80" }),
        getURL: () => { getUrlCalls++; return "chrome-extension://ext-id/x"; }
      },
      storage: {
        local: {
          get(_keys, cb) { storageGets++; cb({}); },
          set(_items, cb) { if (cb) cb(); },
          onChanged: { addListener() {}, removeListener() {} }
        }
      }
    },
    document: {
      readyState: "loading",
      documentElement: null,
      head: null,
      body: null,
      createElement(tag) { createdElements.push(tag); return { style: {} }; },
      addEventListener(type, fn) { docListeners.push(type); void fn; },
      removeEventListener() {},
      dispatchEvent() { return true; }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(raw, sandbox);

  await Promise.resolve();
  assert.equal(sandbox.__YLG_AMBIENT_LOADER_RELEASED__, false, "loader must remain unreleased while Ambient is disabled");
  assert.ok(sandbox.__YLG_AMBIENT_LOADER_READY__ && typeof sandbox.__YLG_AMBIENT_LOADER_READY__.then === "function");
  assert.equal(docListeners.length, 0, "disabled content.js must register zero document listeners");
  assert.equal(storageGets, 0, "disabled content.js must perform zero chrome.storage reads");
  assert.equal(createdElements.length, 0, "disabled content.js must create zero DOM elements");

  // Enable Ambient and verify loader resolves cleanly with zero DOM/URL injections
  releaseGate();
  await sandbox.__YLG_AMBIENT_LOADER_READY__;
  assert.equal(sandbox.__YLG_AMBIENT_LOADER_RELEASED__, true, "loader must mark itself released once enabled");
  assert.equal(createdElements.length, 0, "enabled content.js must still create zero <link>/<script> DOM tags");
  assert.equal(getUrlCalls, 0, "enabled content.js must never call chrome.runtime.getURL");
});

test("vendor/ambient/content-main.js gates startup on YLG_AMBIENT_VENDOR.waitUntilEnabled() and DOMContentLoaded with zero disabled listeners", async () => {
  const main = read("vendor/ambient/content-main.js");
  const start = main.indexOf("  setErrorHandler(ex => SentryReporter.captureException(ex));");
  const errorHelperIdx = main.indexOf("  const logErrorEventWithPageTrees =", start);
  assert.ok(start >= 0 && errorHelperIdx > start, "startup section anchor must exist in content-main.js");
  const initDefsBlock = main.slice(start, errorHelperIdx);

  // Ensure initVersionAndCrashOptions and initErrorEvents are defined as named functions, NOT self-invoked IIFEs
  assert.match(initDefsBlock, /\bconst\s+initVersionAndCrashOptions\s*=\s*wrapErrorHandler\(/);
  assert.match(initDefsBlock, /\bconst\s+initErrorEvents\s*=\s*wrapErrorHandler\(/);
  assert.doesNotMatch(
    initDefsBlock,
    /\}\)\(\)\s*;/,
    "initVersionAndCrashOptions and initErrorEvents must not execute as top-level IIFEs before waitUntilEnabled"
  );

  // Extract startup orchestration slice and run in VM
  const onLoadIdx = main.indexOf("  const onLoad = wrapErrorHandler(async function onLoadCallback()");
  assert.ok(onLoadIdx >= 0, "onLoadCallback must exist in content-main.js");
  const startupSlice = main.slice(onLoadIdx, main.lastIndexOf("})();"));

  let releaseVendorGate;
  const vendorGate = new Promise(resolve => { releaseVendorGate = resolve; });
  const winListeners = [];
  const docListeners = new Map();
  const calls = [];

  const sandbox = {
    window: null,
    document: {
      readyState: "loading",
      addEventListener(type, fn) {
        docListeners.set(type, fn);
      }
    },
    YLG_AMBIENT_VENDOR: {
      waitUntilEnabled: () => vendorGate
    },
    errorEvents: undefined,
    initErrorEvents() {
      calls.push("initErrorEvents");
      sandbox.errorEvents = { list: [] };
      winListeners.push("beforeunload");
    },
    async initVersionAndCrashOptions() {
      calls.push("initVersionAndCrashOptions");
    },
    async loadAmbientlight() {
      calls.push("loadAmbientlight");
    },
    SentryReporter: {
      captureException(ex) { throw ex; }
    },
    wrapErrorHandler(fn) { return fn; }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(startupSlice, sandbox);

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(sandbox.ambientlight, undefined, "window.ambientlight must stay undefined while disabled");
  assert.equal(winListeners.length, 0, "disabled page must attach zero beforeunload listeners (preserves bfcache)");
  assert.equal(docListeners.has("DOMContentLoaded"), false, "disabled page must not even attach DOMContentLoaded listener before enabled");
  assert.deepEqual(calls, [], "disabled page must run zero initialization hooks");

  // Release waitUntilEnabled while document.readyState is STILL "loading" -> must wait for DOMContentLoaded!
  releaseVendorGate();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sandbox.ambientlight, undefined, "must wait for DOMContentLoaded before setting window.ambientlight = false");
  assert.equal(docListeners.has("DOMContentLoaded"), true, "must subscribe to DOMContentLoaded when enabled during loading");
  assert.deepEqual(calls, []);

  // Fire DOMContentLoaded -> now initialization runs in exact order!
  sandbox.document.readyState = "interactive";
  docListeners.get("DOMContentLoaded")();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(sandbox.ambientlight, false, "window.ambientlight must transition to false right before loadAmbientlight()");
  assert.ok(calls.includes("initErrorEvents"), "initErrorEvents must run after enable + DOMContentLoaded");
  assert.ok(calls.includes("initVersionAndCrashOptions"), "initVersionAndCrashOptions must run after enable + DOMContentLoaded");
  assert.equal(calls.at(-1), "loadAmbientlight", "loadAmbientlight must run after crash/error setup");
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
  console.log(`\nAmbient MV3 MAIN-world & procedural noise regressions: ${passed}/${cases.length} passed`);
  if (passed !== cases.length) process.exitCode = 1;
})();
