"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
function test(name, fn) {
  const res = fn();
  if (res && typeof res.then === "function") {
    return res.then(() => { passed++; console.log("PASS " + name); });
  }
  passed++;
  console.log("PASS " + name);
  return Promise.resolve();
}

const cases = [];
const queue = (name, fn) => cases.push({ name, fn });

// ---- 1. Settings, Locales, Styles & CWS contracts ----
queue("settings, defaults, popup, locales, V3 tokens, and CWS hotkeys stay aligned", () => {
  const ctx = vm.createContext({ console, localStorage: { getItem() { return null; }, setItem() {} } });
  ctx.window = ctx;
  vm.runInContext(read("src/shared/settings.js"), ctx, { filename: "src/shared/settings.js" });
  const S = ctx.YLG_SETTINGS;
  assert.equal(S.DEFAULT_SETTINGS.cardHalo, true);
  assert.equal(S.DEFAULT_SETTINGS.floatingPlayerFrame, false);
  assert.equal(S.normalizeSettings({ daylightBackground: { scene: "aurora" } }).daylightBackground.scene, "aurora");

  const defs = JSON.parse(read("default-settings.json"));
  assert.equal(defs.cardHalo, true);
  assert.equal(defs.floatingPlayerFrame, false);

  const de = {
    attrs: {},
    style: { props: {}, setProperty(k, v) { this.props[k] = v; }, getPropertyValue(k) { return this.props[k] || ""; }, removeProperty(k) { delete this.props[k]; } },
    getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    hasAttribute(k) { return Object.hasOwn(this.attrs, k); },
    removeAttribute(k) { delete this.attrs[k]; }
  };
  const rimNodes = [];
  const doc = {
    documentElement: de,
    querySelectorAll(sel) {
      assert.match(sel, /ytd-miniplayer/);
      assert.match(sel, /ytd-engagement-panel-section-list-renderer/);
      assert.match(sel, /ytd-live-chat-frame/);
      return rimNodes;
    }
  };
  S.applySettingsToDocument(doc, { cardHalo: true, floatingPlayerFrame: true, ambientLight: { enabled: true, glassSync: true } });
  assert.equal(de.getAttribute("data-ylg-card-halo"), "true");
  assert.equal(de.getAttribute("data-ylg-player-frame"), "true");
  S.applySettingsToDocument(doc, { cardHalo: true, hoverEffects: false, floatingPlayerFrame: false });
  assert.equal(de.getAttribute("data-ylg-card-halo"), null);
  assert.equal(de.getAttribute("data-ylg-player-frame"), null);

  const ytCss = read("src/styles/youtube.css");
  assert.doesNotMatch(ytCss, /--ylg-surface-panel|--ylg-border-panel|--ylg-blur-panel/, "must use real glass-tokens.css tokens");
  assert.match(ytCss, /html\[data-ylg-enabled="true"\]\[data-ylg-player-frame="true"\]\s+ytd-watch-flexy:not\(\[theater\]\):not\(\[fullscreen\]\)\s+:is\(#ytd-player,\s*#player-container-inner,\s*#movie_player\)/);
  assert.match(ytCss, /\.ytProgressBarLineProgressBarPlayed/);
  assert.match(ytCss, /\.ytProgressBarPlayheadProgressBarPlayheadDot/);

  const expCss = read("src/styles/experience-features.css");
  assert.match(expCss, /html\[data-ylg-hover="off"\]\s+#ylg-card-halo/);
  assert.match(expCss, /html\[data-ylg-scrubbing="1"\]\s+#ylg-card-halo/);
  assert.match(expCss, /html\[data-ylg-bg-suspended="1"\]\s+#ylg-card-halo/);

  const daylightCss = read("src/styles/daylight-background.css");
  assert.match(daylightCss, /\[data-scene="aurora"\]/);
  const integrationCss = read("src/styles/daylight-integration.css");
  assert.match(integrationCss, /ytd-browse/);

  const cws = read("docs/store/CHROME-WEB-STORE-LISTING.md");
  const { version } = JSON.parse(read("manifest.json"));
  const escapedVersion = String(version).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.doesNotMatch(cws, /Alt\+Shift\+G/);
  assert.match(cws, /Alt\+A \/ Alt\+S \/ Alt\+D/);
  assert.match(cws, new RegExp(`Better-visual-Youtube-${escapedVersion}\\.zip`));
});

// ---- 2. V2 Card Halo VM Tests ----
queue("card-halo reuses one node, skips touch/lowfx/scrubbing/bg-suspended/avatars/excluded zones, and cleans up on scroll & teardown", () => {
  function makeNode(tag, { id = "", attrs = {}, props = {} } = {}) {
    const node = {
      tagName: tag.toUpperCase(),
      id,
      attrs: { ...attrs },
      children: [],
      parentNode: null,
      parentElement: null,
      isConnected: true,
      width: props.width || 0,
      src: props.src || "",
      currentSrc: props.currentSrc || "",
      getAttribute(k) { return k === "id" ? (this.id || null) : (Object.hasOwn(this.attrs, k) ? this.attrs[k] : null); },
      setAttribute(k, v) { if (k === "id") this.id = String(v); else this.attrs[k] = String(v); },
      removeAttribute(k) { delete this.attrs[k]; },
      appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child);
        this.children.push(child);
        child.parentNode = this;
        child.parentElement = this;
        return child;
      },
      removeChild(child) {
        this.children = this.children.filter(c => c !== child);
        child.parentNode = null;
        child.parentElement = null;
      },
      contains(el) {
        for (let cur = el; cur; cur = cur.parentNode) if (cur === this) return true;
        return false;
      },
      matches(sel) {
        return sel.split(",").map(s => s.trim()).some(part => {
          if (part.startsWith("#")) return this.id === part.slice(1);
          return this.tagName === part.toUpperCase();
        });
      },
      closest(sel) {
        for (let cur = this; cur; cur = cur.parentNode) {
          if (typeof cur.matches === "function" && cur.matches(sel)) return cur;
        }
        return null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = cur => {
          for (const ch of cur.children) {
            if (sel === "img") {
              if (ch.tagName === "IMG") out.push(ch);
            } else if (sel.includes("img")) {
              if (ch.tagName === "IMG" && ch.parentNode && ch.parentNode.matches("ytd-thumbnail, yt-thumbnail-view-model, a")) {
                out.push(ch);
              }
            }
            walk(ch);
          }
        };
        walk(this);
        return out;
      },
      get firstElementChild() { return this.children[0] || null; }
    };
    return node;
  }

  const de = makeNode("html", {
    attrs: {
      "data-ylg-enabled": "true",
      "data-ylg-card-halo": "true",
      "data-ylg-hover": "on"
    }
  });
  const docListeners = {};
  const winListeners = {};
  const doc = {
    documentElement: de,
    hidden: false,
    createElement(tag) { return makeNode(tag); },
    getElementById(id) {
      let found = null;
      const walk = cur => {
        if (cur.id === id) { found = cur; return; }
        for (const ch of cur.children) if (!found) walk(ch);
      };
      walk(de);
      return found;
    },
    addEventListener(k, fn) { (docListeners[k] ||= []).push(fn); },
    removeEventListener(k, fn) { docListeners[k] = (docListeners[k] || []).filter(f => f !== fn); },
    emit(k, ev = {}) { for (const fn of (docListeners[k] || []).slice()) fn(ev); }
  };

  const ctx = vm.createContext({
    document: doc,
    console,
    addEventListener(k, fn) { (winListeners[k] ||= []).push(fn); },
    removeEventListener(k, fn) { winListeners[k] = (winListeners[k] || []).filter(f => f !== fn); }
  });
  ctx.window = ctx;
  ctx.fireWindow = k => { for (const fn of (winListeners[k] || []).slice()) fn({}); };
  vm.runInContext(read("src/content/card-halo.js"), ctx, { filename: "src/content/card-halo.js" });

  // Build 2 cards + 1 player excluded card
  const card1 = makeNode("ytd-rich-item-renderer");
  const thumbWrap1 = makeNode("ytd-thumbnail");
  const avatarWrap1 = makeNode("yt-avatar-shape");
  const avatarImg1 = makeNode("img", { attrs: { src: "https://yt3.ggpht.com/avatar.jpg" }, props: { width: 36 } });
  const thumbImg1 = makeNode("img", { attrs: { src: "https://i.ytimg.com/vi/abc111/hq720.jpg" }, props: { width: 320 } });
  avatarWrap1.appendChild(avatarImg1);
  thumbWrap1.appendChild(thumbImg1);
  card1.appendChild(avatarWrap1);
  card1.appendChild(thumbWrap1);

  const card2 = makeNode("yt-lockup-view-model");
  const thumbWrap2 = makeNode("yt-thumbnail-view-model");
  const thumbImg2 = makeNode("img", { attrs: { src: "https://i.ytimg.com/vi/xyz222/hq720.jpg" }, props: { width: 320 } });
  thumbWrap2.appendChild(thumbImg2);
  card2.appendChild(thumbWrap2);

  const shortsWrap = makeNode("ytd-shorts");
  const shortsCard = makeNode("ytd-rich-item-renderer");
  shortsCard.appendChild(makeNode("img", { attrs: { src: "https://i.ytimg.com/vi/sh1/hq720.jpg" }, props: { width: 320 } }));
  shortsWrap.appendChild(shortsCard);

  de.appendChild(card1);
  de.appendChild(card2);
  de.appendChild(shortsWrap);

  const halo = ctx.YLG_CARD_HALO;
  halo.init();
  assert.equal(halo.stats().active, true);

  // Touch events ignored
  doc.emit("pointerover", { pointerType: "touch", target: thumbImg1 });
  assert.equal(halo.stats().hasNode, false);

  // Desktop hover attaches 1 reused node
  doc.emit("pointerover", { pointerType: "mouse", target: thumbImg1 });
  assert.equal(halo.stats().visible, true);
  assert.equal(halo.stats().src, "https://i.ytimg.com/vi/abc111/hq720.jpg");
  assert.equal(card1.getAttribute("data-ylg-halo-host"), "1");
  const haloNode = doc.getElementById("ylg-card-halo");
  assert.ok(haloNode);

  // Hover second card reuses the exact same DOM node
  doc.emit("pointerover", { pointerType: "mouse", target: thumbImg2 });
  assert.equal(doc.getElementById("ylg-card-halo"), haloNode);
  assert.equal(card1.getAttribute("data-ylg-halo-host"), null);
  assert.equal(card2.getAttribute("data-ylg-halo-host"), "1");
  assert.equal(halo.stats().src, "https://i.ytimg.com/vi/xyz222/hq720.jpg");

  // Scroll hides cleanly without removing node prematurely; nav start detaches
  ctx.fireWindow("scroll");
  assert.equal(halo.stats().visible, false);
  doc.emit("pointerover", { pointerType: "mouse", target: thumbImg1 });
  assert.equal(halo.stats().visible, true);
  doc.emit("yt-navigate-start");
  assert.equal(halo.stats().visible, false);
  assert.equal(card1.getAttribute("data-ylg-halo-host"), null);

  // Gated off during bg-suspended / scrubbing / hover=off / lowfx / ytd-shorts
  for (const [attr, val] of [["data-ylg-bg-suspended", "1"], ["data-ylg-scrubbing", "1"], ["data-ylg-lowfx", "true"], ["data-ylg-hover", "off"]]) {
    const prev = de.getAttribute(attr);
    de.setAttribute(attr, val);
    doc.emit("pointerover", { pointerType: "mouse", target: thumbImg1 });
    assert.equal(halo.stats().visible, false, "blocked when " + attr + "=" + val);
    if (prev === null) de.removeAttribute(attr); else de.setAttribute(attr, prev);
  }
  doc.emit("pointerover", { pointerType: "mouse", target: shortsCard.children[0] });
  assert.equal(halo.stats().visible, false, "blocked inside ytd-shorts");

  // Full cleanup on teardown
  doc.emit("pointerover", { pointerType: "mouse", target: thumbImg1 });
  assert.equal(halo.stats().visible, true);
  halo.teardown();
  assert.equal(halo.stats().active, false);
  assert.equal(doc.getElementById("ylg-card-halo"), null);
  assert.equal(card1.getAttribute("data-ylg-halo-host"), null);
  assert.equal(docListeners.pointerover.length, 0);
  assert.equal(winListeners.scroll.length, 0);
});

// ---- 3. Background Audio-Only Suspend Contract Tests ----
queue("ambient-vendor-bridge suspends cleanly in background tabs with 0 storage writes and resumes cleanly", async () => {
  const storageWrites = [];
  const attrs = {};
  const doc = { hidden: false, visibilityState: "visible", documentElement: { setAttribute(k, v) { attrs[k] = v; } } };
  const data = {};
  const ctx = vm.createContext({
    console,
    document: doc,
    navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    chrome: {
      runtime: {},
      storage: {
        local: {
          get(keys, cb) { queueMicrotask(() => cb({ ...data })); },
          set(patch, cb) { storageWrites.push(patch); Object.assign(data, patch); queueMicrotask(() => cb()); },
          remove(keys, cb) { queueMicrotask(() => cb()); }
        }
      }
    },
    YLG_SETTINGS: { getStoredSettings(cb) { cb({ enabled: true, ambientLight: { enabled: true, quality: "balanced", modes: { normal: true } } }); } }
  });
  ctx.window = ctx;
  vm.runInContext(read("src/ambient/ambient-vendor-bridge.js"), ctx, { filename: "src/ambient/ambient-vendor-bridge.js" });
  const VB = ctx.YLG_AMBIENT_VENDOR;

  const calls = [];
  const engine = {
    isHidden: true,
    elem: { style: { removeProperty() {} } },
    settings: {
      enabled: false,
      set(n, v) { this[n] = v; },
      updateVisibility() {}
    },
    cancelScheduledRequestVideoFrame() { calls.push("cancelRvfc"); },
    updateKeywordsToPreventTheaterScaling() {},
    async start() { calls.push("start"); this.isHidden = false; },
    async hide() { calls.push("hide"); this.isHidden = true; },
    async optionalFrame() {}
  };

  let waiterReleased = false;
  VB.waitUntilEnabled().then(() => { waiterReleased = true; });
  await VB.push({ enabled: true, ambientLight: { enabled: true, quality: "balanced", modes: { normal: true } } });
  assert.equal(waiterReleased, true);
  assert.equal(await VB.attach(engine), true);
  assert.equal(VB.stats().state, "upstream");

  const writesBeforeSuspend = storageWrites.length;
  doc.hidden = true;
  doc.visibilityState = "hidden";
  const suspRes = await VB.setBackgroundSuspended(true);
  assert.equal(suspRes, false);
  assert.equal(VB.stats().backgroundSuspended, true);
  assert.equal(VB.stats().state, "off");
  assert.equal(engine.isHidden, true);
  assert.ok(calls.includes("cancelRvfc"));
  assert.ok(calls.includes("hide"));
  assert.equal(storageWrites.length, writesBeforeSuspend, "background suspend must NEVER write shared chrome.storage");

  // Resume foreground
  doc.hidden = false;
  doc.visibilityState = "visible";
  const resRes = await VB.setBackgroundSuspended(false);
  assert.equal(resRes, true);
  assert.equal(VB.stats().backgroundSuspended, false);
  assert.equal(VB.stats().state, "upstream");
  assert.equal(engine.isHidden, false);
  assert.equal(storageWrites.length, writesBeforeSuspend, "resume from background must use live queue without extra storage writes");
});

queue("bootstrap tears down ALL visual engines when hidden (including cold background load) and restores on visibility", async () => {
  function runScenario(startHidden) {
    const ops = [];
    const docListeners = {};
    const winListeners = {};
    const de = {
      attrs: {},
      style: { props: {}, setProperty(k, v) { this.props[k] = v; }, getPropertyValue(k) { return this.props[k] || ""; }, removeProperty(k) { delete this.props[k]; } },
      getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      hasAttribute(k) { return Object.hasOwn(this.attrs, k); },
      removeAttribute(k) { delete this.attrs[k]; }
    };
    const doc = {
      documentElement: de,
      readyState: "complete",
      hidden: startHidden,
      visibilityState: startHidden ? "hidden" : "visible",
      querySelectorAll() { return []; },
      addEventListener(k, fn) { (docListeners[k] ||= []).push(fn); },
      removeEventListener(k, fn) { docListeners[k] = (docListeners[k] || []).filter(f => f !== fn); },
      emit(k) { for (const fn of (docListeners[k] || []).slice()) fn({ type: k }); }
    };
    const observers = [];
    const storageWrites = [];
    const ctx = vm.createContext({
      document: doc,
      console,
      navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
      setTimeout(fn) { fn(); return 1; },
      clearTimeout() {},
      MutationObserver: class {
        constructor(cb) { this.active = false; this.cb = cb; observers.push(this); }
        observe() { this.active = true; }
        disconnect() { this.active = false; }
      },
      addEventListener(k, fn) { (winListeners[k] ||= []).push(fn); },
      removeEventListener(k, fn) { winListeners[k] = (winListeners[k] || []).filter(f => f !== fn); },
      localStorage: { getItem() { return null; }, setItem() { storageWrites.push(1); } },
      YLG_REFRACTION: {
        probeSupported: () => true,
        ensureFilterDefs: () => { ops.push("refract:on"); return {}; },
        setIntensity: () => {},
        dispose: () => { ops.push("refract:off"); }
      },
      YLG_OPTICS: { install: () => ops.push("optics:on"), teardown: () => ops.push("optics:off") },
      YLG_TINT: { init: () => ops.push("tint:on"), teardown: () => ops.push("tint:off"), color: () => ({ r: 10, g: 20, b: 30 }) },
      YLG_MICRO: { init: () => ops.push("micro:on"), teardown: () => ops.push("micro:off") },
      YLG_PANEL_HOVER: { init: () => ops.push("panelHover:on"), teardown: () => ops.push("panelHover:off") },
      YLG_CARD_HALO: { init: () => ops.push("cardHalo:on"), teardown: () => ops.push("cardHalo:off") },
      YLG_DESCRIPTION_MOTION: { init: () => ops.push("desc:on"), teardown: () => ops.push("desc:off") },
      YLG_PLAYER_MOTION: { init: () => ops.push("pm:on"), teardown: () => ops.push("pm:off") },
      YLG_DAYLIGHT: { init: () => ops.push("sky:init"), updateSettings: () => ops.push("sky:on"), teardown: () => ops.push("sky:off") },
      YLG_EXPERIENCE: { updateSettings: () => ops.push("exp:on"), teardown: () => ops.push("exp:off") },
      YLG_AMBIENT: { init: () => ops.push("amb:on"), updateSettings: () => {}, teardown: () => ops.push("amb:off") },
      YLG_ADAPTER: { init: () => ops.push("adapter:on"), applyAll: () => {}, teardown: () => ops.push("adapter:off") },
      YLG_NAV: { init: () => ops.push("nav:on"), teardown: () => ops.push("nav:off") },
      YLG_AMBIENT_VENDOR: {
        setBackgroundSuspended(v) { ops.push("vbSusp:" + v); return Promise.resolve(); },
        reconcile() { ops.push("vb:reconcile"); return Promise.resolve(); }
      }
    });
    ctx.window = ctx;
    vm.runInContext(read("src/shared/settings.js"), ctx, { filename: "src/shared/settings.js" });
    ctx.YLG_SETTINGS.getStoredSettings = cb => cb(ctx.YLG_SETTINGS.normalizeSettings({ enabled: true, theme: "auto", tint: "media", daylightBackground: { enabled: true } }));
    ctx.YLG_SETTINGS.onSettingsChanged = () => {};
    vm.runInContext(read("src/content/bootstrap.js"), ctx, { filename: "src/content/bootstrap.js" });
    return { ops, de, doc, observers, storageWrites };
  }

  // Case A: visible -> background -> foreground
  const a = runScenario(false);
  assert.equal(a.de.getAttribute("data-ylg-bg-suspended"), null);
  assert.ok(a.ops.includes("optics:on"));
  assert.ok(a.ops.includes("cardHalo:on"));
  assert.ok(a.ops.includes("sky:on"));
  assert.ok(a.observers.some(o => o.active));

  a.ops.length = 0;
  a.doc.hidden = true;
  a.doc.visibilityState = "hidden";
  a.doc.emit("visibilitychange");
  assert.equal(a.de.getAttribute("data-ylg-bg-suspended"), "1");
  for (const tag of ["optics:off", "refract:off", "tint:off", "micro:off", "panelHover:off", "cardHalo:off", "desc:off", "pm:off", "sky:off", "exp:off", "amb:off", "adapter:off", "nav:off", "vbSusp:true"]) {
    assert.ok(a.ops.includes(tag), "missing teardown on hide: " + tag);
  }
  assert.equal(a.observers.some(o => o.active), false, "themeObserver must disconnect in background");
  assert.equal(a.storageWrites.length, 0);

  a.ops.length = 0;
  a.doc.hidden = false;
  a.doc.visibilityState = "visible";
  a.doc.emit("visibilitychange");
  assert.equal(a.de.getAttribute("data-ylg-bg-suspended"), null);
  for (const tag of ["optics:on", "refract:on", "tint:on", "cardHalo:on", "sky:on", "exp:on", "amb:on", "adapter:on", "nav:on", "vbSusp:false"]) {
    assert.ok(a.ops.includes(tag), "missing restore on show: " + tag);
  }

  // Case B: cold opened directly in background tab
  const b = runScenario(true);
  assert.equal(b.de.getAttribute("data-ylg-bg-suspended"), "1");
  assert.equal(b.ops.some(x => x.endsWith(":on")), false, "cold background tab must not start any effect engine");
  assert.equal(b.observers.length, 0, "cold background tab must not allocate MutationObserver");
  b.doc.hidden = false;
  b.doc.visibilityState = "visible";
  b.doc.emit("visibilitychange");
  assert.equal(b.de.getAttribute("data-ylg-bg-suspended"), null);
  assert.ok(b.ops.includes("optics:on") && b.ops.includes("amb:on") && b.ops.includes("sky:on"));
});

queue("vendor content-main.js and interaction-performance.css enforce background suspension", () => {
  const main = read("vendor/ambient/content-main.js");
  assert.match(main, /if \(isPageHidden\)\s*\{\s*this\.pageHiddenTime = performance\.now\(\);\s*this\.cancelScheduledRequestVideoFrame\(\);/);
  assert.match(main, /this\.canScheduleNextFrame\s*=\s*\(\)\s*=>\s*!\([^;]*this\.isPageHidden\s*\|\|\s*document\.hidden/);

  const perfCss = read("src/styles/interaction-performance.css");
  assert.match(perfCss, /html\[data-ylg-bg-suspended="1"\]/);
  assert.match(perfCss, /animation-play-state:\s*paused\s*!important/);
  assert.match(perfCss, /:is\(#ylg-card-halo,\s*#ylg-daylight-background,\s*#ylg-shorts-glow,\s*\.ambientlight__container\)\s*\{\s*display:\s*none\s*!important/);
});

(async () => {
  for (const c of cases) {
    await test(c.name, c.fn);
  }
  console.log(passed + " v0.8.0 regression groups passed.");
})().catch(err => {
  console.error(err);
  process.exit(1);
});
