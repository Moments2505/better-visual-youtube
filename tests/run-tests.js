#!/usr/bin/env node
/**
 * YouTube Liquid Glass - automated test suite (A5 scope, Lead-executed).
 * Plain Node, no frameworks: node tests/run-tests.js
 * Loads the extension's modules in a node:vm sandbox with hand-rolled DOM
 * stubs (no browser). Exit code 1 on any failure. SKIPPED tests are explicit.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SRC = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let passed = 0, failed = 0, skipped = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}
function skip(name, why) { skipped++; results.push("SKIP  " + name + "  (" + why + ")"); }

/* ---------------- DOM stubs ---------------- */
const { makeEl, queryAll, getComputedStyle } = require("./dom-fixture");

function buildWorld(opts) {
  opts = opts || {};
  const DOC = {
    documentElement: null, body: null, readyState: "complete", hidden: false, fullscreenElement: null,
    createElement: (t) => makeEl(t), createElementNS: (ns, t) => makeEl(t),
    getElementById: id => DOC.querySelector("#" + id),
    querySelector: sel => DOC.querySelectorAll(sel)[0] || null,
    querySelectorAll: sel => queryAll({ children: [DOC.documentElement] }, sel),
    addEventListener() {}, removeEventListener() {}
  };
  const html = makeEl("html"), body = makeEl("body");
  DOC.documentElement = html; DOC.body = body; html.appendChild(body);
  const masthead = makeEl("ytd-masthead");
  const search = makeEl("ytd-searchbox");
  const guide = makeEl("div"); guide.attrs.id = "guide-inner-content";
  const chip = makeEl("yt-chip-cloud-chip-renderer");
  const card = makeEl("ytd-rich-item-renderer");
  const thumb = makeEl("a"); thumb.attrs.id = "thumbnail";
  const watchInfo = makeEl("ytd-watch-metadata");
  const secondary = makeEl("div"); secondary.attrs.id = "secondary";
  const comments = makeEl("ytd-comments"); comments.attrs.id = "comments";
  const player = makeEl("div"); player.attrs.id = "movie_player";
  const video = makeEl("video"); video.tagName = "VIDEO"; video.paused = false; video.ended = false; video.readyState = 2;
  video.classes.add("video-stream"); video.classes.add("html5-main-video"); // real YouTube classes
  player.appendChild(video);
  const playerContainer = makeEl("div"); playerContainer.attrs.id = "player-container";
  playerContainer.appendChild(player);
  const flexy = makeEl("ytd-watch-flexy"); flexy.appendChild(playerContainer);
  body.appendChild(masthead); body.appendChild(search); body.appendChild(guide);
  body.appendChild(chip); body.appendChild(card); body.appendChild(thumb);
  body.appendChild(flexy); body.appendChild(watchInfo); body.appendChild(secondary); body.appendChild(comments);
  const pendingTimers = [];
  const storageData = {};
  const storageListeners = [];
  const sandbox = {
    console: { log() {}, error() {}, warn() {} },
    Math, Date, Number, Object, String, Array, JSON, Boolean, isNaN, isFinite, parseInt, parseFloat,
    Uint8ClampedArray, WeakMap, Set,
    setTimeout: (fn) => { pendingTimers.push(fn); return pendingTimers.length; },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    performance: { now: () => Date.now() },
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    MutationObserver: class { observe() {} disconnect() {} },
    document: DOC, getComputedStyle, innerWidth: 1280, innerHeight: 720,
    location: { pathname: opts.pathname || "/watch" },
    navigator: { userAgent: "Chrome/120.0.0.0", hardwareConcurrency: 8, deviceMemory: 8 },
    chrome: { storage: {
      local: { get: (k, cb) => cb({ [k]: storageData[k] || null }), set: (o, cb) => { Object.assign(storageData, o); if (cb) cb(); } },
      onChanged: { addListener: (fn) => storageListeners.push(fn), removeListener: (fn) => { const i = storageListeners.indexOf(fn); if (i >= 0) storageListeners.splice(i, 1); } }
    } },
    CSS: { supports: () => !!opts.cssSupports }
  };
  sandbox.addEventListener = function () {}; sandbox.removeEventListener = function () {};
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return { sandbox, html, body, masthead, search, guide, chip, card, thumb, watchInfo, secondary,
    comments, player, video, playerContainer, flexy, pendingTimers, storageData, storageListeners };
}

function load(w, mods) {
  for (const mod of mods) {
    vm.runInContext(SRC(mod), w.sandbox, { filename: mod });
  }
}
const flush = (w) => { while (w.pendingTimers.length) w.pendingTimers.shift()(); };
const ALL = ["src/shared/settings.js", "src/ambient/ambient-vendor-bridge.js",
  "src/glass/glass-refraction.js", "src/ambient/ambient-controller.js",
  "src/content/selector-registry.js", "src/content/dom-adapter.js",
  "src/content/navigation.js", "src/content/bootstrap.js"];

/* ================= settings tests ================= */
{
  const w = buildWorld();
  load(w, ["src/shared/settings.js"]);
  const S = w.sandbox.YLG_SETTINGS;
  const n = S.normalizeSettings({ blur: 999, opacity: 5, renderMode: "nope", tint: "nope", accent: "javascript:alert(1)" });
  check("settings clamps blur to range", n.blur === 40, "got " + n.blur);
  check("settings clamps opacity", n.opacity === 1, "got " + n.opacity);
  // schema 8 has no `preset` and no `renderMode`: the enum that still exists is tint.
  check("settings rejects bad enum", n.tint === S.DEFAULT_SETTINGS.tint, "got " + n.tint);
  check("settings drops the schema-8 removed keys",
    !("preset" in n) && !("renderMode" in n));
  check("settings sanitizes accent", n.accent === "#3ea6ff", "got " + n.accent);
  const m = S.normalizeSettings({ enabled: true, blur: 25 }); // v1.0 shape: no ambientLight
  check("v1.0 settings migrate with ambient defaults", m.ambientLight && m.ambientLight.quality === "auto" && m.ambientLight.blur === S.DEFAULT_SETTINGS.ambientLight.blur);
  const amb = S.normalizeSettings({ ambientLight: { quality: "ultra", intensity: 9, blur: -5, fpsLimit: 500 } }).ambientLight;
  check("ambient nested validation", amb.quality === "auto" && amb.intensity === 1 && amb.blur === 0 && amb.fpsLimit === 30);
  // --- optics (v1.2) ---
  const optDef = S.normalizeSettings({}).optics;
  check("optics defaults present", optDef && optDef.enabled === true && optDef.aberration === true && optDef.magnify === true, JSON.stringify(optDef));
  const optOff = S.normalizeSettings({ optics: { enabled: false, aberration: false } }).optics;
  check("optics booleans survive normalization", optOff.enabled === false && optOff.aberration === false, JSON.stringify(optOff));
  const optClamp = S.normalizeSettings({ optics: { aberrationPx: 99, magnifyScale: 999, hoverScale: 5 } }).optics;
  check("optics numeric ranges clamp", optClamp.aberrationPx === 6 && optClamp.magnifyScale === 60 && optClamp.hoverScale === 1.12, JSON.stringify(optClamp));
  // --- v1.3.7: the capsule strength is 1.30x, and older defaults must follow ---
  const lensDef = S.normalizeSettings({}).optics.lensPx;
  // 92/400 = k 0.23, and 1/(1-0.23) = 1.2987x. 400*(1 - 1/1.3) = 92.31, so 92 is
  // the whole-number dial that lands closest to the requested 1.30x.
  check("stored capsule strength default remains 92", 
    lensDef === 92, "got " + lensDef);
  check("legacy raw mapping of 92 is 1.30x before player calibration",
    Number((1 / (1 - 92 / 400)).toFixed(2)) === 1.3, "got " + (1 / (1 - 92 / 400)).toFixed(3));
  // Every install that ran v1.3.3-1.3.5 has 300 in storage and every install that
  // ran v1.3.6 has 200, because those builds WROTE their default on first run.
  // Lowering DEFAULT_SETTINGS alone would leave them at 4.00x / 2.00x.
  const mig300 = S.normalizeSettings({ schemaVersion: 4, optics: { lensPx: 300 } }).optics.lensPx;
  check("stored 300 (v1.3.5 default) migrates to 92", mig300 === 92, "got " + mig300);
  const mig200 = S.normalizeSettings({ schemaVersion: 5, optics: { lensPx: 200 } }).optics.lensPx;
  check("stored 200 (v1.3.6 default) migrates to 92", mig200 === 92, "got " + mig200);
  const migKeep = S.normalizeSettings({ schemaVersion: 4, optics: { lensPx: 150 } }).optics.lensPx;
  check("a deliberately chosen lensPx is preserved", migKeep === 150, "got " + migKeep);
  const migDone = S.normalizeSettings({ schemaVersion: 6, optics: { lensPx: 300 } }).optics.lensPx;
  check("migration is not re-applied once at schema 6", migDone === 300, "got " + migDone);
  const migNew = S.normalizeSettings({ schemaVersion: 6, optics: { lensPx: 92 } }).optics.lensPx;
  check("current default survives a schema-6 round trip", migNew === 92, "got " + migNew);
    const ambOff = S.normalizeSettings({ enabled: true, ambientLight: { enabled: false } }).ambientLight;
  check("ambient boolean enabled survives normalization (regression)", ambOff.enabled === false, "got " + ambOff.enabled);
  // Schema 8 removed S.PRESETS / S.applyPreset entirely, so this block now pins
  // the CONTRACT normalizeSettings() actually owns: the schema stamp, the five
  // tint values, and the promise that a stored snapshot carrying the removed
  // keys comes back without them while every live value survives.
  const norm = S.normalizeSettings({ schemaVersion: 6, preset: "crystal", renderMode: "advanced", blur: 12,
    tint: "custom", accent: "#a78bfa", ambientLight: { smoothing: 0.7, enabled: false } });
  check("normalizeSettings stamps schema 8", S.SCHEMA_VERSION === 8 && norm.schemaVersion === 8,
    "SCHEMA_VERSION=" + S.SCHEMA_VERSION + " stamped=" + norm.schemaVersion);
  check("normalizeSettings drops preset / renderMode / smoothing",
    !("preset" in norm) && !("renderMode" in norm) && !("smoothing" in norm.ambientLight), JSON.stringify(norm).slice(0, 120));
  check("normalizeSettings keeps every live value",
    norm.blur === 12 && norm.tint === "custom" && norm.accent === "#a78bfa" && norm.ambientLight.enabled === false,
    "blur=" + norm.blur + " tint=" + norm.tint + " accent=" + norm.accent);
  check("normalizeSettings accepts all five tint values",
    ["auto", "black", "white", "media", "custom"].every(t => S.normalizeSettings({ tint: t }).tint === t),
    JSON.stringify(S.ENUMS.tint));
  const attrs = {}; const vars = {};
  S.applySettingsToDocument({ documentElement: { style: { setProperty: (k, v) => { vars[k] = v; } }, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } } }, { enabled: true });
  check("document activation attributes", attrs["data-ylg-enabled"] === "true" && attrs["data-ylg-ambient"] === "on");
  check("css vars mapped", vars["--ylg-blur"] === S.DEFAULT_SETTINGS.blur + "px" && vars["--ylg-accent"] === "#3ea6ff");
  const themedDoc = { documentElement: w.html };
  w.html.setAttribute("dark", "");
  check("Auto theme follows YouTube dark Appearance", S.applyThemeToDocument(themedDoc, "auto") === "dark");
  w.html.removeAttribute("dark");
  check("Auto theme follows YouTube light Appearance", S.applyThemeToDocument(themedDoc, "auto") === "light");
  check("Explicit dark overrides YouTube light", S.applyThemeToDocument(themedDoc, "dark") === "dark");
  w.html.setAttribute("dark", "");
  check("Explicit light overrides YouTube dark", S.applyThemeToDocument(themedDoc, "light") === "light");
  check("Theme preference is retained separately", w.html.getAttribute("data-ylg-theme-preference") === "light");
}

/* ================= refraction tests ================= */
{
  const w = buildWorld({ cssSupports: true });
  load(w, ["src/glass/glass-refraction.js"]);
  const R = w.sandbox.YLG_REFRACTION;
  check("refraction probe true (supports + Chrome UA)", R.probeSupported() === true);
  const w2 = buildWorld({ cssSupports: false });
  load(w2, ["src/glass/glass-refraction.js"]);
  check("refraction probe false without CSS.supports", w2.sandbox.YLG_REFRACTION.probeSupported() === false);
  const maps = R._buildMapsForTest(0.5);
  check("displacement map generated as data URI", !!maps && maps.map > 20 && maps.rim > 20, JSON.stringify(maps));
  const defs = R.ensureFilterDefs(w.sandbox.document);
  check("filter defs svg created", !!defs);
  R.setIntensity(0.8);
  check("intensity update does not throw", true);
  R.dispose();
  check("dispose removes defs (no throw)", true);
}

/* ================= ambient css + adapter safety tests ================= */
{
  const ambCss = SRC("src/ambient/ambient.css").replace(/\/\*[\s\S]*?\*\//g, "");
  check("ambient.css drops dead native .ylg-ambient-host/.ylg-ambient-canvas selectors",
    !/\.ylg-ambient-(?:host|canvas)\b/.test(ambCss));
  const w = buildWorld();
  load(w, ["src/content/selector-registry.js", "src/content/dom-adapter.js"]);
  const ambRoot = makeEl("div"); ambRoot.classes.add("ambientlight");
  const ambChip = makeEl("yt-chip-cloud-chip-renderer"); ambRoot.appendChild(ambChip); w.body.appendChild(ambRoot);
  w.sandbox.YLG_ADAPTER.init();
  check("dom-adapter never tags nodes inside vendor .ambientlight tree",
    !ambChip.classes.has("ylg-glass") && !ambChip.classes.has("ylg-chip"));
}

/* ================= selector registry tests ================= */
{
  const w = buildWorld();
  load(w, ["src/content/selector-registry.js"]);
  const SEL = w.sandbox.YLG_SELECTORS;
  check("registry finds masthead", SEL.query("masthead") === w.masthead);
  check("registry finds searchbox", SEL.query("searchBoxContainer") === w.search);
  check("registry finds guide content", SEL.query("guideContent") === w.guide);
  check("registry invalid selector does not throw", SEL.query("nonexistent") === null);
  check("queryAll for chips", SEL.queryAll("chip").length === 1);
  SEL.invalidate();
  check("invalidate then re-query works", SEL.query("masthead") === w.masthead);
  const toast = makeEl("yt-notification-action-renderer");
  w.body.appendChild(toast);
  SEL.invalidate();
  check("registry finds real YouTube toast element", SEL.queryAll("toasts").length === 1 && SEL.query("toasts") === toast);
}

/* ================= dom adapter tests ================= */
{
  const w = buildWorld();
  const observers = [];
  w.sandbox.MutationObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; this.active = true; }
    disconnect() { this.active = false; }
  };
  load(w, ["src/content/selector-registry.js", "src/content/dom-adapter.js", "src/content/navigation.js"]);
  const AD = w.sandbox.YLG_ADAPTER;
  AD.init();
  flush(w);
  check("masthead tagged hero + refract", w.masthead.classes.has("ylg-glass") && w.masthead.attrs["data-ylg-level"] === "hero" && w.masthead.attrs["data-ylg-refract"] === "1");
  check("card tagged ylg-card only (no glass)", w.card.classes.has("ylg-card") && !w.card.classes.has("ylg-glass"));
  check("chip tagged chip level", w.chip.attrs["data-ylg-level"] === "chip");
  const s1 = AD.stats();
  AD.applyAll();
  const s2 = AD.stats();
  check("applyAll idempotent (tagged stable)", s1.tagged === s2.tagged, s1.tagged + " vs " + s2.tagged);
  check("refraction budget <= 8", s2.refractionSurfaces <= 8, String(s2.refractionSurfaces));
  w.watchInfo.classList.remove("ylg-glass");
  AD.applyAll();
  check("metadata marker does not prevent repairing a removed glass class",
    w.watchInfo.classes.has("ylg-glass") && AD.stats().tagged === s2.tagged);
  const metadataObserver = observers.find(o => o.target === w.watchInfo);
  w.watchInfo.classList.remove("ylg-glass");
  metadataObserver.callback();
  check("metadata class overwrite heals without a document rescan",
    w.watchInfo.classes.has("ylg-glass") && AD.stats().passes === s2.passes + 1 &&
    JSON.stringify(metadataObserver.options.attributeFilter) === '["class"]');
  // player never tagged
  check("player container untouched", !w.player.classes.has("ylg-glass") && !w.playerContainer.classes.has("ylg-glass"));
  AD.teardown();
  metadataObserver.callback();
  check("metadata observer disconnects and cannot restore glass after teardown",
    !metadataObserver.active && !w.watchInfo.classes.has("ylg-glass"));
  check("teardown removes classes", [...w.masthead.classes].filter(c => c.startsWith("ylg-")).length === 0);
  check("teardown removes data attrs", Object.keys(w.masthead.attrs).filter(k => k.startsWith("data-ylg")).length === 0);
}

/* ================= navigation tests ================= */
{
  const w = buildWorld();
  load(w, ["src/content/selector-registry.js", "src/content/navigation.js"]);
  const NAV = w.sandbox.YLG_NAV;
  NAV.init();
  const p = NAV.getPlayer();
  check("getPlayer shape", p && "video" in p && "container" in p && "mode" in p);
  check("getPlayer video resolution", p.video === w.video);
  check("getPlayer mode normal", p.mode === "normal");
  check("onNavigation subscribe/unsubscribe", (() => { const u = NAV.onNavigation(() => {}); u(); return true; })());
  NAV.teardown();
  check("nav teardown does not throw", true);
}

/* ================= ambient controller (mode sync + clear envelope) tests ================= */
{
  const w = buildWorld();
  const modesSeen = [];
  w.sandbox.YLG_AMBIENT_VENDOR = {
    refreshMode(m) { modesSeen.push(m); },
    onStateChanged() { return () => {}; },
    stats() { return { state: "upstream", attached: true, mode: modesSeen[modesSeen.length - 1] || "normal" }; }
  };
  const ambContainer = makeEl("div"); ambContainer.classes.add("ambientlight__container");
  const ambFilter = makeEl("div"); ambFilter.classes.add("ambientlight__filter");
  ambContainer.appendChild(ambFilter);
  w.body.appendChild(ambContainer);
  ambContainer.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 });
  w.video.getBoundingClientRect = () => ({ left: 100, top: 80, right: 900, bottom: 530, width: 800, height: 450 });
  load(w, ["src/ambient/ambient-controller.js"]);
  const A = w.sandbox.YLG_AMBIENT;
  check("dead createAmbientController factory removed", typeof A.createAmbientController === "undefined");
  const settings = { enabled: true, ambientLight: { enabled: true, quality: "auto", intensity: 0.6, blur: 50, spread: 70, saturation: 1.1, brightness: 1, fpsLimit: 10, modes: { normal: true, theater: true, fullscreen: false, shorts: false } } };
  w.html.setAttribute("data-ylg-fill", "none");
  A.init();
  A.updateSettings(settings); flush(w);
  check("controller forwards player mode to vendor bridge without mounting dead native host",
    modesSeen.includes("normal") && w.playerContainer.children.every(c => c.className !== "ylg-ambient-host"));
  check("clear-mode envelope activates on .ambientlight__filter when fill is none",
    A.stats().envelope.active === true && ambFilter.attrs["data-ylg-ambient-envelope"] === "1");
  w.flexy.setAttribute("theater", "");
  A.updateSettings(settings); flush(w);
  check("theater layout forwards theater mode to vendor bridge", modesSeen.includes("theater"));
  w.html.setAttribute("data-ylg-fill", "glass");
  A.updateSettings(settings); flush(w);
  check("nonzero glass fill clears local envelope so glass panels refract full backdrop",
    A.stats().envelope.active === false && !ambFilter.attrs["data-ylg-ambient-envelope"]);
  w.html.setAttribute("data-ylg-fill", "none");
  A.updateSettings(settings); flush(w);
  check("returning to clear mode re-arms envelope", A.stats().envelope.active === true);
  A.teardown();
  check("facade teardown clears envelope cleanly", A.stats().envelope.active === false && !ambFilter.attrs["data-ylg-ambient-envelope"]);
}

/* ================= full chain + disable-restores-original ================= */
{
  const w = buildWorld();
  load(w, ALL);
  flush(w);
  const S = w.sandbox.YLG_SETTINGS;
  check("bootstrap activates glass", w.html.attrs["data-ylg-enabled"] === "true");
  check("bootstrap activates ambient attr", w.html.attrs["data-ylg-ambient"] === "on");
  check("masthead glass applied", w.masthead.classes.has("ylg-glass"));
  // disable via storage change (popup path)
  w.storageListeners.forEach(fn => fn({ ylgSettings: { newValue: { enabled: false } } }, "local"));
  flush(w);
  check("disable flips root attr", w.html.attrs["data-ylg-enabled"] === "false");
  check("disable flips ambient attr", w.html.attrs["data-ylg-ambient"] === "off");
  check("disable removes glass classes", [...w.masthead.classes].filter(c => c.startsWith("ylg-")).length === 0);
  check("disable removes data-ylg attrs from DOM", Object.keys(w.masthead.attrs).filter(k => k.startsWith("data-ylg")).length === 0);
  check("no dead native ambient host created in full chain", w.playerContainer.children.every(c => c.className !== "ylg-ambient-host"));
  // re-enable
  w.storageListeners.forEach(fn => fn({ ylgSettings: { newValue: { enabled: true } } }, "local"));
  flush(w);
  check("re-enable restores glass", w.masthead.classes.has("ylg-glass"));
  // corrupted storage self-heals
  w.storageListeners.forEach(fn => fn({ ylgSettings: { newValue: { blur: 9999, preset: "bogus", ambientLight: { fpsLimit: 999 } } } }, "local"));
  flush(w);
  check("corrupt settings normalized on apply", w.html.style._["--ylg-blur"] === "40px");
}

/* ============ v1.2.1 regressions: player rail, panel cost, focus motion ==== */
const ROOTC = path.join(__dirname, "..");

check("panel level hard-blocks backdrop-filter (large surfaces must not blur)",
  /\[data-ylg-level="panel"\]\s*\{[^}]*backdrop-filter:\s*none\s*!important/.test(
    fs.readFileSync(path.join(ROOTC, "src", "glass", "glass-material.css"), "utf8")));

const playerCss = fs.readFileSync(path.join(ROOTC, "src", "glass", "glass-player.css"), "utf8");
const playerRules = playerCss.replace(/\/\*[\s\S]*?\*\//g, "");
check("player layer does not restyle .ytp-play-progress (stock scrubber colour)",
  playerRules.indexOf("ytp-play-progress") === -1);
check("player layer does not restyle .ytp-scrubber-button (stock scrubber)",
  playerRules.indexOf("ytp-scrubber-button") === -1);
// The hover well used to be painted on the button border box, so inside a 40px
// capsule with 5px padding it drew a 48x40 pill that broke out of the glass.
// It is now a pseudo-element pinned to the rail.
/* v1.3.3 - the well is a circle sized from the short axis and centred in the
   48x40 button; the old "inset: 3px 2px" pill measured 48x32 and read as a blob. */
check("hover well is a centred 32x32 circle, not the old 48x32 pill",
  /ytp-button::after[\s\S]{0,700}inset:\s*4px;[\s\S]{0,200}width:\s*32px;[\s\S]{0,120}height:\s*32px;[\s\S]{0,200}margin:\s*auto/.test(playerRules) &&
  !/ytp-button::after[\s\S]{0,400}inset:\s*3px 2px/.test(playerRules));
check("liquid motion is exposed as tunable custom properties",
  /--ylg-liquid-dur:/.test(playerRules) && /--ylg-liquid-ease:/.test(playerRules));
check("hover well motion is disabled under prefers-reduced-motion",
  /prefers-reduced-motion[\s\S]{0,400}::after[\s\S]{0,200}transition:\s*none/.test(playerRules));
check("autoplay toggle container is flex-centred on the rail",
  /ytp-autonav-toggle-button-container[\s\S]{0,400}align-items:\s*center/.test(playerCss));

const noCommentsYoutubeCss = fs.readFileSync(path.join(ROOTC, "src", "styles", "youtube.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const opticsNoComments = fs.readFileSync(path.join(ROOTC, "src", "glass", "glass-optics.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
check("hover focus zooms (anchored scale) again",
  /:hover[\s\S]{0,240}transform:\s*scale\(var\(--ylg-hover-scale/.test(opticsNoComments));
// A lifted surface has to clear the whole watch-page column trio, not just its
// own siblings: #primary, #secondary and #below are siblings stacked by DOM
// order, so #below (comments) used to paint over a zooming recommendations card
// no matter what z-index the card itself carried. Measured fix: columns get
// explicit z-index 1/2/1 and the hovered panel is lifted to 30.
// v1.3.3 - measured on the live page: ytd-watch-metadata sits inside #below,
// not inside #primary, so a lift on it creates a context INSIDE #below and the
// sibling comparison decides against whichever column the element lives in.
// The lift must clear all three columns (31 > 3), and the column order must put
// the owner of the focused surface above its neighbour.
check("focused surface paints above the column trio (z-index: 31)",
  /:hover[\s\S]{0,500}z-index:\s*31/.test(opticsNoComments));
check("watch-page columns are explicitly stacked so a lift can escape one",
  /#primary\s*\{\s*position:\s*relative;\s*z-index:\s*2/.test(opticsNoComments) &&
  /#secondary\s*\{\s*position:\s*relative;\s*z-index:\s*3/.test(opticsNoComments) &&
  /#below\s*\{\s*position:\s*relative;\s*z-index:\s*2/.test(opticsNoComments));
check("the focus lift outranks every column (31 > 3)",
  (function () {
    const lift = opticsNoComments.match(/:hover[\s\S]{0,500}?z-index:\s*(\d+)/);
    const cols = [...opticsNoComments.matchAll(/#(?:primary|secondary|below)\s*\{\s*position:\s*relative;\s*z-index:\s*(\d+)/g)]
      .map((m) => Number(m[1]));
    return !!lift && cols.length === 3 && Number(lift[1]) > Math.max(...cols);
  })());
check("watch-page columns do not clip a surface that scales out of them",
  /ytd-watch-flexy[\s\S]{0,200}#below[\s\S]{0,60}\{\s*overflow:\s*visible/.test(opticsNoComments));
// The inset must read the same on all four sides. Padding blocks margin
// collapsing, so YouTube's own margin-top on the comments header was trapped
// inside our padding: measured 34px top vs 9px left before, 9/9 after.
check("comments inset is symmetric (trapped margin neutralised)",
  /ytd-comments\.ylg-glass ytd-comments-header-renderer[\s\S]{0,80}margin-top:\s*0/.test(noCommentsYoutubeCss));
check("recommendations card top aligns with the video-info card",
  /#secondary\.ylg-glass[\s\S]{0,80}margin-top:\s*12px/.test(noCommentsYoutubeCss));

// A centre-origin scale grows in every direction, so a surface already flush
// against an edge loses the text on that side off-screen. Each region pins the
// edge it sits against and grows inward instead.
check("video info anchors top-left (grows right and down)",
  /ytd-watch-metadata[^{]*\{[^}]*transform-origin:\s*left top/.test(opticsNoComments));
check("comments anchor top-left (grows right)",
  /ytd-comments[^{]*\{[^}]*transform-origin:\s*left top/.test(opticsNoComments));
check("recommendations anchor top-right (grows left, never off-screen)",
  /#secondary[^{]*\{[^}]*transform-origin:\s*right top/.test(opticsNoComments));
check("masthead and drawer never scale (sticky edges)",
  /ytd-masthead[^{]*\{[^}]*transform:\s*none/.test(opticsNoComments));
check("inner media is not counter-transformed (would shrink text back)",
  !/\.ylg-glass:hover img\s*\{[^}]*transform:\s*none/.test(opticsNoComments));
check("rest state does not pin a transform (no layer promotion)",
  !/\.ylg-glass\s*\{\s*transform:\s*translate3d\(0,\s*0,\s*0\)/.test(opticsNoComments));

/* ====== v1.2.1 second pass: scatter hard edge + search capsule seam ====== */
const materialNoComments = fs.readFileSync(path.join(ROOTC, "src", "glass", "glass-material.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// The bottom light scatter used `inset: auto 6% -1px 6%`, so it painted a
// 1033x173 rounded rectangle that terminated mid-panel and read as a stray
// bright box inside every tall glass card. It must run edge to edge and fade.
check("scatter layer spans the full width (no 6% inset rectangle)",
  !/::after\s*\{[^}]*inset:\s*auto\s+6%/.test(materialNoComments));
check("scatter layer fades in instead of ending on a hard line",
  /::after\s*\{[^}]*mask-image:\s*linear-gradient\(180deg,\s*transparent/.test(materialNoComments));

const opticsSearch = fs.readFileSync(path.join(ROOTC, "src", "glass", "glass-optics.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// Two adjacent backdrop-filtered boxes cannot join cleanly - each clamps its
// own blur and paints its own contact shadow. Measured 112/96/109 across the
// joint. The capsule is now single-painter: the input owns both right radii and
// the button is an unfilled overlay holding only the icon.
check("search button is an unfilled overlay (single painter)",
  /ytSearchboxComponentSearchButton[^{]*\{[^}]*background-color:\s*transparent\s*!important/.test(opticsSearch) &&
  /ytSearchboxComponentSearchButton[^{]*\{[^}]*position:\s*absolute\s*!important/.test(opticsSearch));
check("search input closes both ends of the capsule",
  /ytSearchboxComponentInputBox\s*\{[^}]*border-top-right-radius:\s*999px/.test(opticsSearch));
check("search input is no longer clipped at the button seam",
  !/ytSearchboxComponentInputBox\s*\{[^}]*border-top-right-radius:\s*0\s*!important/.test(opticsSearch));

/* ============ donation UI removed from the vendored ambient menu ========== */
const vendorAmbient = path.join(ROOTC, "vendor", "ambient");
const vendorJs = fs.readFileSync(path.join(vendorAmbient, "content-main.js"), "utf8");
const vendorCss = fs.readFileSync(path.join(vendorAmbient, "content.css"), "utf8");

// The upstream settings menu ships a "Buy Me a Coffee" link to the author's
// Ko-fi page. It is removed here: this build must not solicit donations.
check("vendored JS creates no donation link",
  vendorJs.indexOf("ytpa-donate-link") === -1 && vendorJs.indexOf("ko-fi") === -1);
check("vendored CSS has no donation styles",
  vendorCss.indexOf("ytpa-donate-link") === -1);
check("donation artwork is not shipped",
  !fs.existsSync(path.join(vendorAmbient, "images", "donate.svg")));
check("manifest does not reference donation artwork",
  fs.readFileSync(path.join(ROOTC, "manifest.json"), "utf8").indexOf("donate") === -1);
// The menu still renders its feedback row, which shares the header class.
check("feedback row survives the donation removal",
  vendorJs.indexOf("ytpa-feedback-link") !== -1 &&
  vendorCss.indexOf(".ytpa-menuitem--header {") !== -1);

/* ====== v1.3.0: liquid-glass lens on the player control pills ============== */
const opticsJs = fs.readFileSync(path.join(ROOTC, "src", "glass", "glass-optics.js"), "utf8");

// The refraction must be driven by a displacement map fed through feImage, the
// way the reference article builds it. A hand-tuned gradient cannot bend a
// rounded rectangle evenly around its corners.
check("lens builds a displacement map and feeds it to feDisplacementMap",
  /feImage[\s\S]{0,400}feDisplacementMap/.test(opticsJs));
check("lens map is generated from a bezel profile, not a hardcoded PNG",
  opticsJs.indexOf("convexSquircle") !== -1 && opticsJs.indexOf("lensMapURI") !== -1);

// A TIGHT filter region is wrong and this guard used to demand one. The blue
// copy is displaced further than the base, so at the rim it samples just outside
// the element box; outside the region is transparent, blue resolves to 0 and the
// rim turns lime. Measured on a cyan backdrop rgb(60,175,225): the outermost
// columns read (66,180,0). Pad=100 cleared it at every control size and at both
// px=22 and the px=60 maximum, where the displacement exceeds a 40px button.
check("capsule and hover lenses derive padded bounds from displacement",
  opticsJs.includes("lensFilterBounds(w, h, map.maxPx)") &&
  opticsJs.includes("lensFilterBounds(32, 32, Math.abs(px) / 2)"));
check("player lens region is not tight to the element box",
  !/el\("filter",\s*\{\s*id:\s*id,\s*x:\s*"0",\s*y:\s*"0",\s*width:\s*"100%",\s*height:\s*"100%"/.test(opticsJs));
// THE MAP MUST COVER 100% OF THE ELEMENT BOX.
// Three geometries were measured on the live player, and only this one works:
//   33.3333% inside a 300% region -> ONE FLAT COLOUR; the filter was completely
//                                   inert. Scale 130px moved nothing at all.
//   inset to the element's own
//   footprint (45.45% x 14.28%)  -> also inert: 1.00x at scales 100..400.
//   0/0/100%/100%                -> the lens works; 2.15x measured at scale 300
//                                   over a grey ramp, inverting at 450.
// So the feImage geometry is load-bearing and may not be "tidied" back to an
// inset.
//
// THE NEUTRAL FLOOD IS ALSO LOAD-BEARING, for a second measured reason. The map
// stops at the element box while the filter region is padded far beyond it, and
// feDisplacementMap multiplies its offset by the map's ALPHA. A sample pushed
// outside the box therefore reads offset 0 for the blue copy while the red and
// green copies have already moved, and the capsule shows a hard lime band
// across its lower half - reproduced at scales 200, 250, 299, 330 and 345, and
// absent the moment a constant 128 flood is merged underneath the map.
// FEIMAGE MUST BE SIZED IN ABSOLUTE PIXELS.
// A percentage feImage is resolved against 100x100, not the element box, so a
// 384x41 map was squashed to 100x40 and then stretched back: the lens measured
// 1.00x at every strength while still painting, i.e. an inert filter. Measured
// A/B on a 10px stripe backdrop with the same map and scale 281.72:
//     width="100%" height="100%" -> 20px period = 1.00x
//     width="374"  height="40"   -> 80px period = 4.00x
check("lens map covers the whole element box inside the padded region",
  /href: map\.uri,[\s\S]{0,80}width: String\(w\), height: String\(h\)/.test(opticsJs));
check("lens map is not inset away from the region",
  !/x:\s*"33\.3333%",\s*y:\s*"33\.3333%"/.test(opticsJs) &&
  !/x:\s*"27\.2727%"/.test(opticsJs));
// THE LENS IS ONE DISPLACEMENT, AND THAT IS THE FIX, NOT AN OVERSIGHT.
// The shipped chain used to split red+green from blue, displace the two copies
// by different amounts and screen them back together. The blue copy's samples
// fell outside the map, and because feDisplacementMap multiplies its offset by
// the map's ALPHA, blue read 0 in a horizontal stripe while red and green kept
// their values: rgb(174,174,0), a hard lime band across the lower half of the
// capsule. Reproduced on a grey ramp at scales 200/250/299/330/345, with and
// without the ambient light, on video as well as on the ramp.
//
// A neutral flood under the map fixed the colour and flattened the map - the
// lens measured 1.00x with it - so it is not the answer. Dropping the blue
// branch is: measured on the same rail in the same paused frame,
//     px 299 -> 2.12x    px 345 -> 3.40x    yellow pixels 0.00% at both.
// Losing the chromatic split costs the fringe, but the fringe was only ever
// visible on the frames where the band was not, and the band is unacceptable.
check("the capsule lens is a single displacement",
  (opticsJs.match(/el\("feDisplacementMap"/g) || []).length === 3);
check("no lens carries a second, blue-only displacement",
  !/bOnly|dBlue|baseRG/.test(opticsJs));
check("no lens floods the region, because a flood flattens the map",
  !/el\("feFlood"/.test(opticsJs));
check("no lens sizes its map with a percentage feImage",
  !/width:\s*"100%",\s*height:\s*"100%"/.test(opticsJs));
check("every lens sizes its map in absolute pixels", (() => {
  const px = opticsJs.match(/width:\s*(?:"(\d+)"|String\(w\)),\s*height:\s*(?:"(\d+)"|String\(h\))/g) || [];
  return px.length === 3;
})());
check("dispersion does not split into three channels",
  opticsJs.indexOf('result: "dG"') === -1);

const playerCssNoComments = fs.readFileSync(path.join(ROOTC, "src", "glass", "glass-player.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const opticsCssNoComments = fs.readFileSync(path.join(ROOTC, "src", "glass", "glass-optics.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/* REGRESSION GUARD - v1.3.11.
   glass-optics.css used to contain
       #movie_player *, ytd-player * { transform: none !important }
   to stop our own hover lift from firing inside the player. Because an
   !important rule outranks an INLINE style, it also erased YouTube's own
   inline transforms on player internals:
     - .ytp-play-progress   style="transform: scaleX(0.71)"  -> computed "none"
       => the red bar jumped to 100% and never animated again
     - the scrubber timestamp tooltip is positioned with translateX
       => it stayed pinned at the left edge ("slider timestamp lỗi")
   These two assertions fail the build if either mistake comes back. */
const cssSources = ["glass-optics.css", "glass-player.css", "glass-material.css", "glass-motion.css", "glass-lighting.css", "glass-refraction.css", "glass-fallback.css", "glass-tokens.css"]
  .map((f) => fs.readFileSync(path.join(ROOTC, "src", "glass", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""))
  .join("\n");
check("no stylesheet wildcards the player subtree for transform/filter",
  !/#movie_player\s*\*|ytd-player\s*\*|\.ytp-chrome-bottom\s*\*/.test(cssSources));
check("no stylesheet transitions or transforms YouTube's progress bar",
  !/ytp-(play|load|hover)-progress|ytp-scrubber-/.test(cssSources.replace(/\/\*[\s\S]*?\*\//g, "")));
check("player transform reset is scoped to our own .ylg-glass surfaces",
  /#movie_player\s+\.ylg-glass/.test(opticsCssNoComments) &&
  !/#movie_player\s*\*[\s\S]{0,80}transform:\s*none\s*!important/.test(opticsCssNoComments));


// The player subtree must never be transformed, so the hover magnification is
// painted by a pseudo-element whose backdrop-filter does the scaling. If a
// future edit puts transform/scale on a .ytp-button directly, the icon would
// resample and the geometry contract would break.
check("hover lens magnifies via backdrop-filter on a pseudo-element",
  /\.ytp-button(?::not\([^)]*\))?::before[^{]*\{[^}]*backdrop-filter:\s*url\(#ylg-lens-hover\)/.test(playerCssNoComments));
check("hover lens is a centred 32x32 circle and never scales the control itself",
  /\.ytp-button(?::not\([^)]*\))?::before[^{]*\{[^}]*inset:\s*4px;[^}]*width:\s*32px;[^}]*height:\s*32px;[^}]*margin:\s*auto/.test(playerCssNoComments) &&
  !/ytp-button:hover\s*\{[^}]*transform/.test(playerCssNoComments) &&
  !/ytp-chrome-bottom[^{]*ytp-button:hover:not[^{]*\{[^}]*transform/.test(playerCssNoComments));
check("glyph rides above the lens layer and is never displaced",
  /\.ytp-button svg[^{]*\{[^}]*z-index:\s*1/.test(playerCssNoComments));

// The capsule must stay see-through: a heavy fill is what made it read as
// smoked plastic rather than wet glass.
/* v1.3.3 - measured: the milkiness came from WHITE gradients, not from fill
   alpha, so the fill dropped further (0.16) and every broad white term went with
   it. The assertion now pins the fill AND that no 24px white bloom survives. */
const capsuleFill = playerCssNoComments.match(/rgba\(8,\s*11,\s*16,\s*(0\.[0-9]+)\)/);
check("capsule fill is thin enough to read the video through",
  !!capsuleFill && parseFloat(capsuleFill[1]) <= 0.20, capsuleFill ? capsuleFill[1] : "not found");
check("capsule has no broad white bloom over the whole sheet",
  !/inset 0 0 24px rgba\(255,\s*255,\s*255,\s*0\.09\)/.test(playerCssNoComments));
check("capsule optics are gated on the runtime lens probe",
  /html\[data-ylg-lens="1"\]/.test(playerCssNoComments) &&
  opticsJs.indexOf("backdropFilterURLOK") !== -1);

// Fallback path: when the probe fails, the previous light well must still be
// there, and it must not stack on top of a working lens.
check("light-well fallback only applies when the lens is unavailable",
  /:not\(\[data-ylg-lens-hover="1"\]\)\s+\.ytp-chrome-bottom\s+\.ytp-right-controls\s+\.ytp-button:hover/.test(playerCssNoComments));


/* ====== v1.3.5: the lens obeys the physics from the kube.io article ======= */
/* The numbers below are the article's contract, not styling preferences:
     - the displacement map is normalised, and the filter's scale is DERIVED
       from the map's own maximum, so one stored unit is one pixel on BOTH axes
     - the field must stay monotonic (no fold) so nothing samples outside the
       backdrop and no hard ring appears
     - magnification is 1/(1-k), isotropic, independent of the element width
   These run the shipped functions, not a copy of them. */
{
  const w = buildWorld({ pathname: "/watch" });
  load(w, ["src/glass/glass-optics.js"]);
  const O = w.sandbox.YLG_OPTICS;
  check("optics exposes the displacement field for measurement",
    !!O && typeof O.lensFieldRaw === "function" && typeof O.lensFieldGradientOK === "function");

  // The encoding law: feDisplacementMap reads src = p + scale*(C - 0.5), so with
  // C = 128 + 127u the channel term is 127/255 = 0.498039, NOT 127/128. Deriving
  // the gain from 0.5 instead of 128/255 is what makes the vertical axis 7.5x
  // weaker than the horizontal one.
  check("encoding gain is 127/255, i.e. measured against 0.5 not against neutral/255",
    Math.abs(O.LENS_ENC_GAIN - 127 / 255) < 1e-12, String(O.LENS_ENC_GAIN));

  const W = 374, H = 40;
  for (const [width, height] of [[40, 40], [44, 28], [374, 40], [1280, 56]]) {
    for (const maxPx of [0, 3.2, 20, 150]) {
      const b = O.lensFilterBounds(width, height, maxPx);
      check("filter bounds cover both displacement axes " + width + "x" + height + "/" + maxPx,
        b.filterUnits === "userSpaceOnUse" && -Number(b.x) >= maxPx + 32 &&
        -Number(b.y) >= maxPx + 32 && Number(b.x) + Number(b.width) >= width + maxPx + 32 &&
        Number(b.y) + Number(b.height) >= height + maxPx + 32);
    }
    const map = O.lensMapURI(width, height, O.playerLensKFor(92));
    const b = O.lensFilterBounds(width, height, map.maxPx);
    check("default lens bounds reduce reserved raster area " + width + "x" + height,
      Number(b.width) * Number(b.height) < width * height * 2.2 * 7);
  }
  for (const [width, height] of [[40, 40], [44, 28], [374, 40]]) {
    const k = 1 - 1 / 1.15;
    const F = O.lensFieldRaw(width, height, k, height / 2, O.lensBezelAmp(k, height / 2), 128);
    let error = 0, meanY = 0;
    for (let y = 0; y < F.MH; y++) {
      for (let x = 0; x < F.MW; x++) {
        const q = y * F.MW + x;
        const mirrorY = (F.MH - 1 - y) * F.MW + x;
        const mirrorX = y * F.MW + F.MW - 1 - x;
        error = Math.max(error, Math.abs(F.dy[q] + F.dy[mirrorY]),
          Math.abs(F.dx[q] - F.dx[mirrorY]), Math.abs(F.dx[q] + F.dx[mirrorX]),
          Math.abs(F.dy[q] - F.dy[mirrorX]));
        meanY += F.dy[q];
      }
    }
    check("lens " + width + "x" + height + " mirrors both rims without vertical drift",
      error < 1e-9 && Math.abs(meanY / F.dy.length) < 1e-9);
    check("symmetric lens " + width + "x" + height + " has no folded samples",
      O.lensFieldGradientOK(F, width, height));
  }
  for (const px of [150, 225, 300]) {
    const k = O.lensKFor(px);
    const F = O.lensFieldRaw(W, H, k, 12, O.lensBezelAmp(k, 12), 384);
    // magnetification on each axis, measured as the mean gradient of the field
    // over the body of the lens (the rim is excluded because it is meant to bend)
    const cx = Math.round(F.MW / 2), cy = Math.round(F.MH / 2);
    const gx = 1 + (F.dx[cy * F.MW + cx + 1] - F.dx[cy * F.MW + cx]) / (W / F.MW);
    const gy = 1 + (F.dy[(cy + 1) * F.MW + cx] - F.dy[cy * F.MW + cx]) / (H / F.MH);
    check("lens " + px + "px is isotropic at the centre (" + gx.toFixed(4) + " vs " + gy.toFixed(4) + ")",
      Math.abs(gx - gy) < 0.01 && Math.abs(gx - (1 - k)) < 0.01);
    check("lens " + px + "px magnifies " + (1 / (1 - k)).toFixed(2) + "x with no fold on either axis",
      O.lensFieldGradientOK(F, W, H));
  }

  // the bezel is ALLOCATED from the remaining gradient, so it never strands the
  // rim at zero (measured: a fixed amplitude collapsed to 0.5px at 4x) and never
  // eats the whole budget either
  const amps = [0.2, 0.375, 0.563, 0.75].map((k) => O.lensBezelAmp(k, 12));
  check("bezel amplitude shrinks as magnification rises " + amps.map((a) => a.toFixed(2)).join(" > "),
    amps.every((a, i) => a > 0 && (i === 0 || a <= amps[i - 1])));
  const folds = [];
  for (let k = 0.05; k <= 0.8801; k += 0.05) {
    const a = O.lensBezelAmp(k, 12);
    const F = O.lensFieldRaw(W, H, k, 12, a, 256);
    if (!O.lensFieldGradientOK(F, W, H)) folds.push(k.toFixed(2));
  }
  check("no strength from 0.05 to 0.88 folds, so nothing samples past the backdrop",
    folds.length === 0, folds.join(","));

  // scale = maxPx / gain is what makes the stored map pixel-exact
  const map = O.lensMapURI(W, H, O.lensKFor(300));
  check("map scale is derived from the map maximum, not hand-tuned",
    !!map && Math.abs(map.scale - map.maxPx / O.LENS_ENC_GAIN) < 1e-6,
    map ? map.scale.toFixed(3) + " vs " + (map.maxPx / O.LENS_ENC_GAIN).toFixed(3) : "no map");
  check("the raw 300px lens model resolves to 4.00x before player calibration",
    !!map && Math.abs(map.mag - 4) < 0.01, map ? map.mag.toFixed(3) : "no map");

  // the article rebuilds the whole map on any change except scale, which is
  // expensive, so the map is memoised on the exact geometry it was built for
  check("the map is cached per geometry instead of rebuilt every tick",
    /var lensMapCache = \{\}/.test(opticsJs) &&
    /lensMapCache\[key\]\s*=\s*out/.test(opticsJs) &&
    /if \(lensMapCache\[key\]\) return lensMapCache\[key\]/.test(opticsJs));
}

/* ================= output ================= */
for (const r of results) console.log(r);
console.log("\n" + passed + " passed, " + failed + " failed, " + skipped + " skipped");
if (failed > 0) process.exitCode = 1;
