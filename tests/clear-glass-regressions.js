"use strict";
/* Clear-glass + tint regressions (schema 8) - A5 suite, standalone.
 *
 * Scope: the SHIPPED sources only, executed in a Node VM with a hand-rolled
 * element / popup DOM model. No browser, no computed styles, no pixels, no
 * shared fixture with the other suites.
 *
 * What this pins:
 *   1. schema-8 contract: the five-value tint enum (auto/black/white/media/
 *      custom), opacity floor 0 and the raw alpha still stored, the 0.45 -> 0
 *      migration, the "a deliberate value wins" rule, schema-8 round trip, and
 *      the removal of preset / renderMode / ambientLight.smoothing
 *   2. applySettingsToDocument: data-ylg-fill only at exactly 0, data-ylg-tint
 *      always, chrome/search scrim = rgba(tint RGB, round(min(1,opacity*1.15),3)),
 *      Black/White override --ylg-surface-tint-light and Auto removes it
 *   3. popup: Opacity is a 0..100 PERCENT slider over the stored alpha (perceptual
 *      curve, not percent/100), Tint radiogroup ARIA / roving tabindex / keyboard
 *      / immediate save, invalid stored tint normalizes to Auto, reset restores
 *      0 + Auto, master disable gates the group
 *   4. static: glass-clear.css is manifest-loaded between glass-fallback.css and
 *      ambient.css, every selector is gated on
 *      html[data-ylg-enabled="true"][data-ylg-fill="none"], and nothing in it can
 *      reach the video element or the player progress bar
 *
 * Deliberately NOT asserted: paint/computed-style results, the ambient glow that
 * can still wash a clear header (A6 owns src/ambient/**), the additivity of
 * glass-ramp.css (tests/settings-ramp-regressions.js owns that) and the eight
 * pinned engine files - tests/visual-restore-regressions.js owns their digests.
 *
 * Run: node tests/clear-glass-regressions.js
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");

let passed = 0;
const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

/* ---------------- shared contract, loaded once ---------------- */
function contract() {
  const context = vm.createContext({ console });
  context.window = context;
  context.globalThis = context;
  vm.runInContext(source("src/shared/settings.js"), context, { filename: "src/shared/settings.js" });
  return context.YLG_SETTINGS;
}
const S = contract();

/* ---------------- minimal documentElement (style + attributes) ------------ */
function newRootElement() {
  const attrs = Object.create(null);
  const props = Object.create(null);
  return {
    attrs, props,
    style: {
      setProperty(name, value) { props[name] = String(value); },
      getPropertyValue(name) { return name in props ? props[name] : ""; },
      removeProperty(name) { const old = name in props ? props[name] : ""; delete props[name]; return old; }
    },
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return name in attrs ? attrs[name] : null; },
    removeAttribute(name) { delete attrs[name]; },
    hasAttribute(name) { return name in attrs; }
  };
}
function applyOn(settings) {
  const el = newRootElement();
  const normalized = S.applySettingsToDocument({ documentElement: el }, settings);
  return { el, normalized };
}
/* The runtime builds these strings by hand, so the assertions read them the same
 * way: rgba(R, G, B, A) with the exact rounding applySettingsToDocument() uses. */
const RGBA = /^rgba\((\d+), (\d+), (\d+), ([0-9.]+)\)$/;
function scrim(value) {
  const m = RGBA.exec(value);
  assert.ok(m, "scrim must be a hand-built rgba() triplet: " + JSON.stringify(value));
  return { rgb: [m[1], m[2], m[3]].join(", "), alpha: Number(m[4]) };
}
const expectedAlpha = opacity => Math.round(Math.min(1, opacity * 1.15) * 1000) / 1000;
const DARK_AUTO_RGB = "22, 28, 38";
const LIGHT_AUTO_RGB = "248, 250, 252";

/* ---------------- schema 8 contract ---------------- */
test("schema 8 ships the documented defaults and ranges", () => {
  assert.equal(S.SCHEMA_VERSION, 8);
  assert.equal(S.DEFAULT_SETTINGS.tint, "media");
  assert.equal(S.DEFAULT_SETTINGS.opacity, 0.001347159213591947);
  assert.deepEqual([...S.ENUMS.tint], ["auto", "black", "white", "media", "custom"]);
  assert.deepEqual([...S.RANGES.opacity], [0, 1]);
  // Blur 0 is a real state ("no backdrop blur"), so the range starts at zero.
  assert.deepEqual([...S.RANGES.blur], [0, 40]);
  // The schema-8 removals: no preset / renderMode setting and no PRESETS table.
  assert.ok(!Object.hasOwn(S.DEFAULT_SETTINGS, "preset"));
  assert.ok(!Object.hasOwn(S.DEFAULT_SETTINGS, "renderMode"));
  assert.ok(!Object.hasOwn(S.DEFAULT_SETTINGS.ambientLight, "smoothing"));
  assert.equal(S.PRESETS, undefined);
  assert.equal(S.applyPreset, undefined);
});

test("tint accepts only its five documented values", () => {
  for (const value of ["auto", "black", "white", "media", "custom"]) assert.equal(S.normalizeSettings({ tint: value }).tint, value);
  // Anything else falls back to the theme-derived surface, never to a partial match.
  for (const bad of ["Black", "BLACK", " blue", "grey", "transparent", "Custom", "", null, 0, 1, true, false, [], {}, ["black"]]) {
    assert.equal(S.normalizeSettings({ tint: bad }).tint, S.DEFAULT_SETTINGS.tint, "tint " + JSON.stringify(bad) + " must normalize to auto");
  }
});

test("opacity 0 is legal and is never clamped up", () => {
  assert.equal(S.normalizeSettings({ opacity: 0 }).opacity, 0);
  assert.equal(S.normalizeSettings({ schemaVersion: 8, opacity: 0 }).opacity, 0);
  // The floor and the ceiling still hold on both sides of 0.
  assert.equal(S.normalizeSettings({ opacity: -0.01 }).opacity, 0);
  assert.equal(S.normalizeSettings({ opacity: -50 }).opacity, 0);
  assert.equal(S.normalizeSettings({ opacity: 1 }).opacity, 1);
  assert.equal(S.normalizeSettings({ opacity: 0.001 }).opacity, 0.001);
  // A non-number never becomes 0 by accident - it becomes the default, which now IS 0.
  assert.equal(S.normalizeSettings({ opacity: "0" }).opacity, S.DEFAULT_SETTINGS.opacity);
  assert.equal(S.normalizeSettings({ opacity: null }).opacity, S.DEFAULT_SETTINGS.opacity);
  assert.equal(S.normalizeSettings({ opacity: Infinity }).opacity, S.DEFAULT_SETTINGS.opacity);
});

test("legacy 0.45 (the value old builds wrote) migrates to the captured default", () => {
  for (const schemaVersion of [undefined, 1, 2, 3, 4, 5, 6]) {
    const stored = schemaVersion === undefined ? { opacity: 0.45 } : { schemaVersion, opacity: 0.45 };
    assert.equal(S.normalizeSettings(stored).opacity, S.DEFAULT_SETTINGS.opacity, "schema " + schemaVersion + " must migrate 0.45");
  }
  // A stored value that is not the exact old default is a deliberate choice.
  for (const kept of [0.44, 0.4499, 0.46, 0.3, 0.5, 0.6, 0.85, 0.12]) {
    assert.equal(S.normalizeSettings({ schemaVersion: 6, opacity: kept }).opacity, kept, "schema 6 must keep " + kept);
  }
});

test("migration never re-runs once the current schema is stored", () => {
  assert.equal(S.normalizeSettings({ schemaVersion: 8, opacity: 0.45 }).opacity, 0.45);
  assert.equal(S.normalizeSettings({ schemaVersion: 8, opacity: 0 }).opacity, 0);
  // Any schema number at or above the sentinel is treated as "already migrated".
  assert.equal(S.normalizeSettings({ schemaVersion: 7, opacity: 0.45 }).opacity, 0.45);
  assert.equal(S.normalizeSettings({ schemaVersion: 99, opacity: 0.45 }).opacity, 0.45);
});

test("schema-8 settings round-trip without drift", () => {
  const first = S.normalizeSettings({ schemaVersion: 6, opacity: 0.45, tint: "white" });
  const second = S.normalizeSettings(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(second, first);
  assert.equal(first.schemaVersion, 8);
  assert.equal(first.opacity, S.DEFAULT_SETTINGS.opacity);
  assert.equal(first.tint, "white");
  // Stamping the schema is what stops a later load from re-running the migration.
  assert.equal(S.normalizeSettings(first).opacity, S.DEFAULT_SETTINGS.opacity);
});

test("the removed preset / renderMode / smoothing keys never survive normalization", () => {
  // Schema 8 DELETES these settings instead of remapping them, because the audit
  // found no consumer. They must come back absent while every live value is kept,
  // so a stored snapshot from an older build is not silently reset.
  const stored = S.normalizeSettings({
    schemaVersion: 6, preset: "balanced", renderMode: "advanced",
    ambientLight: { smoothing: 0.7, quality: "high" }, opacity: 0.3, blur: 20, tint: "custom"
  });
  assert.ok(!Object.hasOwn(stored, "preset"), "preset must be dropped");
  assert.ok(!Object.hasOwn(stored, "renderMode"), "renderMode must be dropped");
  assert.ok(!Object.hasOwn(stored.ambientLight, "smoothing"), "ambient smoothing must be dropped");
  assert.equal(stored.opacity, 0.3);
  assert.equal(stored.blur, 20);
  assert.equal(stored.tint, "custom");
  assert.equal(stored.ambientLight.quality, "high");
  assert.equal(stored.schemaVersion, 8);
  // ...and a round trip never resurrects them.
  assert.ok(!Object.hasOwn(S.normalizeSettings(stored), "preset"));
});

/* ---------------- applySettingsToDocument ---------------- */
test("data-ylg-fill is set only at exactly opacity 0", () => {
  const zero = applyOn({ schemaVersion: 8, opacity: 0 });
  assert.equal(zero.el.getAttribute("data-ylg-fill"), "none");
  assert.equal(zero.el.props["--ylg-opacity"], "0");
  for (const opacity of [0.001, 0.01, 0.2, 0.45, 0.85]) {
    const above = applyOn({ schemaVersion: 8, opacity });
    assert.equal(above.el.getAttribute("data-ylg-fill"), null, "opacity " + opacity + " must not be clear");
    assert.equal(above.el.props["--ylg-opacity"], String(opacity));
  }
});

test("raising opacity back up removes the clear attribute again", () => {
  const el = newRootElement();
  S.applySettingsToDocument({ documentElement: el }, { schemaVersion: 8, opacity: 0 });
  assert.equal(el.getAttribute("data-ylg-fill"), "none");
  S.applySettingsToDocument({ documentElement: el }, { schemaVersion: 8, opacity: 0.45 });
  assert.equal(el.getAttribute("data-ylg-fill"), null, "a later apply must not keep the stale clear state");
  S.applySettingsToDocument({ documentElement: el }, { schemaVersion: 8, opacity: 0 });
  assert.equal(el.getAttribute("data-ylg-fill"), "none");
});

test("data-ylg-tint always reflects the choice, including at opacity 0", () => {
  for (const tint of ["auto", "black", "white", "media"]) {
    for (const opacity of [0, 0.45]) {
      const { el } = applyOn({ schemaVersion: 8, opacity, tint });
      assert.equal(el.getAttribute("data-ylg-tint"), tint, tint + " at opacity " + opacity);
    }
  }
});

test("chrome and search scrims share one alpha driven by the opacity slider", () => {
  for (const opacity of [0, 0.01, 0.2, 0.33, 0.45, 0.6, 0.85]) {
    const { el } = applyOn({ schemaVersion: 8, opacity, theme: "dark", tint: "auto" });
    const chrome = scrim(el.props["--ylg-chrome-scrim"]);
    const search = scrim(el.props["--ylg-search-scrim"]);
    assert.equal(el.props["--ylg-chrome-scrim"], el.props["--ylg-search-scrim"], "header and search must share the slider");
    assert.equal(chrome.alpha, expectedAlpha(opacity), "alpha at opacity " + opacity);
    assert.ok(chrome.alpha <= 1, "alpha is capped at 1");
    assert.equal(chrome.rgb, opacity === 0.85 ? "181, 183, 186" : DARK_AUTO_RGB);
  }
  // 0 really is fully see-through, not a floor value.
  assert.equal(scrim(applyOn({ schemaVersion: 8, opacity: 0 }).el.props["--ylg-chrome-scrim"]).alpha, 0);
  // A saved 0.85 alpha keeps its transparency; the new maximum is solid white.
  assert.deepEqual(scrim(applyOn({ schemaVersion: 8, opacity: 1 }).el.props["--ylg-chrome-scrim"]), { rgb: "255, 255, 255", alpha: 1 });
  assert.equal(scrim(applyOn({ schemaVersion: 8, opacity: 0.85 }).el.props["--ylg-chrome-scrim"]).alpha, 0.977);
});

test("scrim RGB follows tint, and Auto follows the theme triplet", () => {
  const black = scrim(applyOn({ schemaVersion: 8, opacity: 0.45, tint: "black" }).el.props["--ylg-chrome-scrim"]);
  const white = scrim(applyOn({ schemaVersion: 8, opacity: 0.45, tint: "white" }).el.props["--ylg-chrome-scrim"]);
  assert.equal(black.rgb, "0, 0, 0");
  assert.equal(white.rgb, "255, 255, 255");
  // Explicit theme preferences resolve deterministically.
  assert.equal(scrim(applyOn({ schemaVersion: 8, opacity: 0.45, tint: "auto", theme: "dark" }).el.props["--ylg-chrome-scrim"]).rgb, DARK_AUTO_RGB);
  assert.equal(scrim(applyOn({ schemaVersion: 8, opacity: 0.45, tint: "auto", theme: "light" }).el.props["--ylg-chrome-scrim"]).rgb, LIGHT_AUTO_RGB);
  // Tint outranks the theme for the scrim: black stays black in light mode.
  assert.equal(scrim(applyOn({ schemaVersion: 8, opacity: 0.45, tint: "black", theme: "light" }).el.props["--ylg-chrome-scrim"]).rgb, "0, 0, 0");
  assert.equal(scrim(applyOn({ schemaVersion: 8, opacity: 0.45, tint: "white", theme: "dark" }).el.props["--ylg-chrome-scrim"]).rgb, "255, 255, 255");
});

test("Auto scrim resolves YouTube Appearance at apply time, not the OS", () => {
  // YouTube represents light mode by the ABSENCE of html[dark].
  const light = newRootElement();
  S.applySettingsToDocument({ documentElement: light }, { schemaVersion: 8, opacity: 0.45, theme: "auto", tint: "auto" });
  assert.equal(light.getAttribute("data-ylg-theme"), "light");
  assert.equal(scrim(light.props["--ylg-chrome-scrim"]).rgb, LIGHT_AUTO_RGB);
  const dark = newRootElement();
  dark.setAttribute("dark", "");
  S.applySettingsToDocument({ documentElement: dark }, { schemaVersion: 8, opacity: 0.45, theme: "auto", tint: "auto" });
  assert.equal(dark.getAttribute("data-ylg-theme"), "dark");
  assert.equal(scrim(dark.props["--ylg-chrome-scrim"]).rgb, DARK_AUTO_RGB);
});

test("a YouTube Appearance flip re-derives the chrome scrim", () => {
  // The scrim cannot be written once: with Auto the resolved theme can change
  // under us when YouTube toggles html[dark], so applyThemeToDocument re-syncs it.
  const el = newRootElement();
  const doc = { documentElement: el };
  S.applySettingsToDocument(doc, { schemaVersion: 8, opacity: 0.45, theme: "auto", tint: "auto" });
  assert.equal(scrim(el.props["--ylg-chrome-scrim"]).rgb, LIGHT_AUTO_RGB);
  el.setAttribute("dark", "");
  S.applyThemeToDocument(doc, "auto");
  assert.equal(scrim(el.props["--ylg-chrome-scrim"]).rgb, DARK_AUTO_RGB);
  assert.equal(el.props["--ylg-chrome-scrim"], el.props["--ylg-search-scrim"]);
  assert.equal(scrim(el.props["--ylg-chrome-scrim"]).alpha, expectedAlpha(0.45), "a theme flip must not disturb the opacity alpha");
  el.removeAttribute("dark");
  S.applyThemeToDocument(doc, "auto");
  assert.equal(scrim(el.props["--ylg-chrome-scrim"]).rgb, LIGHT_AUTO_RGB);
  // An explicit tint is immune to the theme flip.
  S.applySettingsToDocument(doc, { schemaVersion: 8, opacity: 0.45, theme: "auto", tint: "black" });
  el.setAttribute("dark", "");
  S.applyThemeToDocument(doc, "dark");
  el.removeAttribute("dark");
  S.applyThemeToDocument(doc, "auto");
  assert.equal(scrim(el.props["--ylg-chrome-scrim"]).rgb, "0, 0, 0");
});

test("a theme sync in a fresh page context writes no scrim", () => {
  // applyThemeToDocument() is also reached from bootstrap's observer, which can
  // fire before the first apply. In a fresh context there is no chrome state to
  // derive from, so it must not invent a scrim (the module keeps that state, so
  // this needs its own instance rather than the shared contract above).
  const fresh = contract();
  const el = newRootElement();
  assert.equal(fresh.applyThemeToDocument({ documentElement: el }, "dark"), "dark");
  assert.ok(!Object.hasOwn(el.props, "--ylg-chrome-scrim"));
  assert.ok(!Object.hasOwn(el.props, "--ylg-search-scrim"));
  // The very next full apply does paint them.
  el.setAttribute("dark", "");
  fresh.applySettingsToDocument({ documentElement: el }, { schemaVersion: 8, opacity: 0.45, theme: "dark", tint: "auto" });
  assert.equal(scrim(el.props["--ylg-chrome-scrim"]).rgb, DARK_AUTO_RGB);
});

test("Black/White override the surface tint channel and Auto removes it", () => {
  const el = newRootElement();
  const apply = settings => S.applySettingsToDocument({ documentElement: el }, { schemaVersion: 8, opacity: 0.45, theme: "dark", ...settings });
  apply({ tint: "black" });
  assert.equal(el.props["--ylg-surface-tint-light"], "0, 0, 0");
  apply({ tint: "white" });
  assert.equal(el.props["--ylg-surface-tint-light"], "255, 255, 255");
  // Auto must REMOVE the inline channel so the theme token in glass-tokens.css wins.
  apply({ tint: "auto" });
  assert.equal(el.style.getPropertyValue("--ylg-surface-tint-light"), "", "auto must delete the override, not write a third value");
  assert.ok(!Object.hasOwn(el.props, "--ylg-surface-tint-light"), "the property itself must be gone, not set to an empty string");
  // ...and back again, to prove the removal is not a one-way latch.
  apply({ tint: "white" });
  assert.equal(el.props["--ylg-surface-tint-light"], "255, 255, 255");
});

test("clear mode is expressed as an attribute, not as a zeroed slider variable", () => {
  const { el } = applyOn({ schemaVersion: 8, opacity: 0 });
  // Panels still read the real value; the clear layer only reacts to the attribute.
  assert.equal(el.props["--ylg-opacity"], "0");
  assert.equal(el.getAttribute("data-ylg-fill"), "none");
  assert.equal(el.getAttribute("data-ylg-enabled"), "true");
});

/* ---------------- popup: small DOM model (adapted from p0-regressions) ----- */
function dom() {
  let doc;
  class Element {
    constructor(tag, attrs = {}, parent = null) {
      this.tagName = tag; this.attrs = attrs; this.id = attrs.id || "";
      this.parent = parent; this.children = []; this.listeners = {};
      this.disabled = false; this.checked = false; this.textContent = "";
      this.style = { setProperty() {} }; this.valueWrites = 0; this._value = "";
      const classes = new Set((attrs.class || "").split(/\s+/).filter(Boolean));
      this.classList = { toggle(k, on) { if (on) classes.add(k); else classes.delete(k); }, contains: k => classes.has(k) };
      if (parent) parent.children.push(this);
    }
    get value() { return this._value; }
    set value(v) { this.valueWrites++; this._value = String(v); }
    getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    hasAttribute(k) { return Object.hasOwn(this.attrs, k); }
    removeAttribute(k) { delete this.attrs[k]; }
    matches(s) {
      if (s[0] === "#") return this.id === s.slice(1);
      if (s[0] === ".") return this.classList.contains(s.slice(1));
      if (s === "button[data-value]") return this.tagName === "button" && this.hasAttribute("data-value");
      return this.tagName === s;
    }
    querySelectorAll(s) {
      const all = this.children.flatMap(c => [c, ...c.querySelectorAll("*")]);
      if (s === "*") return all;
      return all.filter(el => s.split(",").some(part => {
        const bits = part.trim().split(/\s+/); const last = bits.pop();
        return el.matches(last) && (!bits.length || !!el.parent?.closest(bits.join(" ")));
      }));
    }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    closest(s) { return this.matches(s) ? this : this.parent?.closest(s) || null; }
    contains(el) { return el === this || this.children.some(c => c.contains(el)); }
    addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); }
    removeEventListener(k, fn) { this.listeners[k] = (this.listeners[k] || []).filter(f => f !== fn); }
    emit(type, extra = {}) {
      const e = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (let el = this; el; el = el.parent) for (const fn of el.listeners[type] || []) fn.call(el, e);
      return e;
    }
    click() { if (!this.disabled) this.emit("click"); }
    focus() { doc.activeElement = this; }
  }
  doc = new Element("document");
  const stack = [doc];
  for (const match of source("src/popup/popup.html").matchAll(/<\/?([a-z][\w-]*)([^>]*)>/gi)) {
    const tag = match[1].toLowerCase();
    if (match[0][1] === "/") { if (stack[stack.length - 1].tagName === tag) stack.pop(); continue; }
    const attrs = {};
    for (const a of match[2].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    const el = new Element(tag, attrs, stack[stack.length - 1]);
    if (!["input", "link", "meta", "br", "img", "hr"].includes(tag)) stack.push(el);
  }
  doc.getElementById = id => doc.querySelector("#" + id);
  doc.documentElement = doc.querySelector("html"); doc.readyState = "complete";
  return doc;
}
function clock() {
  let now = 0, id = 0;
  const tasks = new Map();
  return {
    setTimeout(fn, ms) { tasks.set(++id, { at: now + ms, fn }); return id; },
    clearTimeout(key) { tasks.delete(key); },
    tick(ms) {
      const until = now + ms;
      while (true) {
        const entry = [...tasks].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        now = entry[1].at; tasks.delete(entry[0]); entry[1].fn();
      }
      now = until;
    }
  };
}
function sandbox(doc) {
  const timer = clock(); const listeners = {};
  const context = vm.createContext({
    document: doc, console, ...timer,
    navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
    addEventListener(k, fn) { (listeners[k] ||= []).push(fn); },
    removeEventListener() {},
    localStorage: { getItem() { return null; }, setItem() {} }
  });
  context.window = context;
  const load = file => vm.runInContext(source(file), context, { filename: file });
  load("src/shared/settings.js");
  return { context, load, timer, doc };
}
function popup(seed = {}) {
  const h = sandbox(dom()); const writes = []; let getCallback;
  h.context.chrome = {
    runtime: {}, storage: {
      local: {
        get(key, cb) { getCallback = cb; },
        set(payload, cb) { writes.push({ settings: JSON.parse(JSON.stringify(payload.ylgSettings)), cb }); }
      }
    }
  };
  h.load("src/popup/popup.js");
  h.doc.emit("DOMContentLoaded");
  h.$ = id => h.doc.getElementById(id);
  h.writes = writes;
  h.resolve = () => getCallback({ ylgSettings: seed });
  h.input = (id, value) => { h.$(id).value = value; h.$(id).emit("input"); };
  h.change = (id, checked) => { h.$(id).checked = checked; h.$(id).emit("change"); };
  h.finish = (index, error) => { h.context.chrome.runtime.lastError = error; writes[index].cb(); delete h.context.chrome.runtime.lastError; };
  return h;
}
const loaded = seed => { const h = popup(seed); h.resolve(); return h; };
function selected(h, id, value) {
  const buttons = h.$(id).querySelectorAll("button[data-value]");
  for (const b of buttons) {
    const on = b.getAttribute("data-value") === value;
    assert.equal(b.getAttribute("aria-checked"), String(on), id + "[" + b.getAttribute("data-value") + "] aria-checked");
    assert.equal(b.getAttribute("tabindex"), on && !b.disabled ? "0" : "-1", id + "[" + b.getAttribute("data-value") + "] tabindex");
  }
}
const choose = (h, id, value) => h.$(id).querySelectorAll("button[data-value]").find(b => b.getAttribute("data-value") === value).click();

/* ---------------- popup markup ---------------- */
test("popup markup: Opacity is a 0..100 percent slider and Tint is a labelled radiogroup", () => {
  const h = sandbox(dom());
  const opacity = h.doc.getElementById("ylg-opacity");
  assert.equal(opacity.getAttribute("type"), "range");
  assert.equal(opacity.getAttribute("min"), "0", "the slider must be able to reach the clear state");
  assert.equal(opacity.getAttribute("max"), "100", "the slider is a percentage, not the raw alpha");
  assert.equal(opacity.getAttribute("step"), "1");
  // The two ends of the percent control are the stored alpha range, exactly: this
  // is the schema-8 mapping, so the ceiling is RANGES.opacity[1] (0.85), not 85%.
  assert.equal(S.sliderToOpacity(Number(opacity.getAttribute("min"))), S.RANGES.opacity[0]);
  assert.equal(S.sliderToOpacity(Number(opacity.getAttribute("max"))), S.RANGES.opacity[1]);
  assert.equal(S.opacityToSlider(S.RANGES.opacity[0]), 0);
  assert.equal(S.opacityToSlider(S.RANGES.opacity[1]), 100);
  assert.equal(h.doc.getElementById("ylg-opacity-v").tagName, "output");
  const group = h.doc.getElementById("ylg-tint");
  assert.equal(group.getAttribute("role"), "radiogroup");
  assert.equal(group.getAttribute("aria-labelledby"), "ylg-tint-label");
  assert.equal(h.doc.getElementById("ylg-tint-label").tagName, "label");
  const values = group.querySelectorAll("button[data-value]").map(b => b.getAttribute("data-value"));
  assert.deepEqual(values, [...S.ENUMS.tint], "popup order must match the shared enum");
  assert.equal(values.length, 5, "auto, black, white, media and custom");
  assert.ok(values.includes("custom"), "Custom is a first-class tint value in schema 8");
  assert.ok(group.querySelectorAll("button").every(b => b.getAttribute("role") === "radio"));
  // The inline colour controls that only Custom reveals still exist.
  assert.equal(h.doc.getElementById("ylg-accent").getAttribute("type"), "color");
  assert.equal(h.doc.getElementById("ylg-accent-row").getAttribute("id"), "ylg-accent-row");
  // The row that keeps the label column aligned with the sliders still exists.
  assert.ok(h.doc.querySelector(".ylg-tint-row"));
  // Removed in schema 8 - the markup must not carry these ids at all.
  for (const gone of ["ylg-preset", "ylg-renderMode", "ylg-amb-smoothing", "ylg-amb-intensity"]) {
    assert.equal(h.doc.getElementById(gone), null, "#" + gone + " must not exist");
  }
});

/* ---------------- popup behaviour ---------------- */
test("loading renders the captured opacity and tint defaults", () => {
  const h = loaded();
  assert.equal(h.$("ylg-opacity").value, String(S.opacityToSlider(S.DEFAULT_SETTINGS.opacity)));
  assert.equal(h.$("ylg-opacity-v").textContent, S.opacityToSlider(S.DEFAULT_SETTINGS.opacity) + "%");
  selected(h, "ylg-tint", S.DEFAULT_SETTINGS.tint);
  assert.equal(h.writes.length, 0, "loading alone must never write");
});

test("tint click saves immediately and keeps ARIA/tab stops in sync", () => {
  const h = loaded();
  choose(h, "ylg-tint", "black");
  selected(h, "ylg-tint", "black");
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].settings.tint, "black");
  assert.equal(h.writes[0].settings.schemaVersion, 8);
  choose(h, "ylg-tint", "white");
  selected(h, "ylg-tint", "white");
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].settings.tint, "white");
});

test("tint radios respond to arrows/Home/End with wrap, focus and a save", () => {
  const h = loaded();
  const buttons = h.$("ylg-tint").querySelectorAll("button[data-value]");
  // Five options in schema 8: auto, black, white, media (Thumbnail), custom.
  assert.equal(buttons.length, 5);
  const steps = [
    [buttons[0], "ArrowRight", "black"],
    [buttons[4], "ArrowRight", "auto"],
    [buttons[0], "ArrowLeft", "custom"],
    [buttons[0], "End", "custom"],
    [buttons[4], "Home", "auto"],
    [buttons[0], "ArrowDown", "black"],
    [buttons[1], "ArrowUp", "auto"]
  ];
  for (const [target, key, expected] of steps) {
    assert.equal(target.emit("keydown", { key }).defaultPrevented, true, key + " must be handled");
    selected(h, "ylg-tint", expected);
    assert.equal(h.doc.activeElement.getAttribute("data-value"), expected, key + " must move focus");
  }
  assert.equal(h.writes.length, steps.length, "every keyboard change persists once");
  assert.equal(h.writes[h.writes.length - 1].settings.tint, "auto");
});

test("a stored tint outside the enum is normalized to the default before it reaches the UI", () => {
  for (const bad of ["Blue", "black ", 42, null]) {
    const h = loaded({ tint: bad });
    selected(h, "ylg-tint", S.DEFAULT_SETTINGS.tint);
    choose(h, "ylg-tint", "white");
    assert.equal(h.writes[0].settings.tint, "white", "recovered selection must save a legal value");
  }
});

test("legacy 0.45 opens the popup at the default opacity, and the percent slider follows the shared curve", () => {
  const legacy = loaded({ schemaVersion: 6, opacity: 0.45 });
  assert.equal(legacy.$("ylg-opacity").value, String(S.opacityToSlider(S.DEFAULT_SETTINGS.opacity)));
  assert.equal(legacy.$("ylg-opacity-v").textContent, S.opacityToSlider(S.DEFAULT_SETTINGS.opacity) + "%");
  // Current schema: 0.45 is a DELIBERATE alpha, so it is kept - but the slider is
  // a perceptual percent control, so the position is the exported inverse, not 45.
  const current = loaded({ schemaVersion: 8, opacity: 0.45 });
  const at = String(S.opacityToSlider(0.45));
  assert.equal(current.$("ylg-opacity").value, at);
  assert.equal(current.$("ylg-opacity-v").textContent, at + "%");
  assert.notEqual(at, "45", "the old percent/100 mapping is gone");
  assert.equal(S.opacityToSlider(S.sliderToOpacity(Number(at))), Number(at), "the slider position round-trips");
  // The maximum is reachable as 100%, and alpha 0 is still 0%.
  const top = loaded({ schemaVersion: 8, opacity: 1 });
  assert.equal(top.$("ylg-opacity").value, "100");
  assert.equal(top.$("ylg-opacity-v").textContent, "100%");
  const zero = loaded({ schemaVersion: 8, opacity: 0 });
  assert.equal(zero.$("ylg-opacity").value, "0");
  assert.equal(zero.$("ylg-opacity-v").textContent, "0%");
});

test("committing opacity 0 persists exactly 0 and is not clamped up", () => {
  const h = loaded({ schemaVersion: 8, opacity: 0.45 });
  h.input("ylg-opacity", 0);
  h.$("ylg-opacity").emit("change");
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].settings.opacity, 0);
  assert.equal(h.$("ylg-opacity").value, "0");
  assert.equal(h.$("ylg-opacity-v").textContent, "0%");
  // A mid-slider position stores the curve's alpha, never percent/100.
  h.input("ylg-opacity", 45);
  h.$("ylg-opacity").emit("change");
  assert.equal(h.writes[1].settings.opacity, S.sliderToOpacity(45));
  assert.notEqual(h.writes[1].settings.opacity, 0.45, "45% is not alpha 0.45 on a perceptual slider");
  assert.equal(S.opacityToSlider(h.writes[1].settings.opacity), 45);
  assert.equal(h.$("ylg-opacity-v").textContent, "45%");
  // 0 -> 45 -> 0 survives the round trip: no sticky "already transparent" latch.
  h.input("ylg-opacity", 0);
  h.$("ylg-opacity").emit("change");
  assert.equal(h.writes[2].settings.opacity, 0);
});

test("master disable gates the tint group, clears its tab stops and blocks saves", () => {
  const h = loaded({ schemaVersion: 8, tint: "white" });
  h.change("ylg-enabled", false);
  // The master toggle itself persists immediately (document-level change flush).
  const afterDisable = h.writes.length;
  assert.equal(h.writes[afterDisable - 1].settings.enabled, false);
  assert.ok(h.$("ylg-tint").querySelectorAll("button").every(b => b.disabled));
  selected(h, "ylg-tint", "white");           // aria-checked survives, tabindex is -1
  assert.ok(h.$("ylg-tint").querySelectorAll("button").every(b => b.getAttribute("tabindex") === "-1"));
  choose(h, "ylg-tint", "black");
  assert.equal(h.writes.length, afterDisable, "a disabled group must not write");
  assert.equal(h.$("ylg-tint").querySelectorAll("button[data-value]")[1].emit("keydown", { key: "ArrowRight" }).defaultPrevented, false);
  h.change("ylg-enabled", true);
  const afterEnable = h.writes.length;
  assert.ok(h.$("ylg-tint").querySelectorAll("button").every(b => !b.disabled));
  selected(h, "ylg-tint", "white");
  choose(h, "ylg-tint", "black");
  assert.equal(h.writes.length, afterEnable + 1);
  assert.equal(h.writes[afterEnable].settings.tint, "black");
});

test("reset restores captured defaults in one snapshot", () => {
  const h = loaded({ schemaVersion: 8, opacity: 0.6, tint: "black" });
  h.$("ylg-reset").click();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].settings.opacity, S.DEFAULT_SETTINGS.opacity);
  assert.equal(h.writes[0].settings.tint, S.DEFAULT_SETTINGS.tint);
  assert.equal(h.writes[0].settings.schemaVersion, 8);
  assert.equal(h.$("ylg-opacity").value, String(S.opacityToSlider(S.DEFAULT_SETTINGS.opacity)));
  assert.equal(h.$("ylg-opacity-v").textContent, S.opacityToSlider(S.DEFAULT_SETTINGS.opacity) + "%");
  selected(h, "ylg-tint", S.DEFAULT_SETTINGS.tint);
  // Custom-only inline colour controls close again with the default tint.
  assert.equal(h.$("ylg-accent-row").getAttribute("hidden"), "");
});

/* ---------------- static: glass-clear.css + manifest ---------------- */
const CLEAR_FILE = "src/glass/glass-clear.css";
const clearCss = source(CLEAR_FILE);
const clearNoComments = clearCss.replace(/\/\*[\s\S]*?\*\//g, "");
const GATE = 'html[data-ylg-enabled="true"][data-ylg-fill="none"]';

/* Tiny block reader: returns every style rule with the at-rules wrapping it, so
 * a media-query rule is checked against the same gate as a top-level one. */
function parseRules(css) {
  const rules = [];
  let i = 0, buffer = "";
  const at = [];
  while (i < css.length) {
    const ch = css[i];
    if (ch === "{") {
      const prelude = buffer.trim(); buffer = "";
      if (prelude.startsWith("@")) { at.push(prelude); i++; continue; }
      let depth = 1, j = i + 1, body = "";
      while (j < css.length) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") { depth--; if (depth === 0) break; }
        body += css[j]; j++;
      }
      rules.push({ selector: prelude, body, at: at.slice() });
      i = j + 1; continue;
    }
    if (ch === "}") { at.pop(); buffer = ""; i++; continue; }
    buffer += ch; i++;
  }
  return rules;
}
const clearRules = parseRules(clearNoComments);
const clearSelectors = clearRules.flatMap(rule => rule.selector.split(",").map(part => part.trim()).filter(Boolean));

test("glass-clear.css is a real, non-trivial additive layer", () => {
  assert.ok(fs.existsSync(path.join(root, CLEAR_FILE)));
  assert.ok(clearRules.length >= 8, "expected the panel/rim/masthead/search/chip/description rules, got " + clearRules.length);
  assert.ok(clearRules.some(rule => rule.selector.includes(".ylg-glass")), "must reset the glass surface itself");
  assert.ok(clearRules.some(rule => /ytd-masthead|#masthead/.test(rule.selector)), "must cover the header bar");
  assert.ok(clearRules.some(rule => rule.selector.includes("ytSearchboxComponentInputBox")), "must cover the search pill");
});

test("manifest loads glass-clear.css after glass-fallback.css and before ambient.css", () => {
  const manifest = JSON.parse(source("manifest.json"));
  const css = manifest.content_scripts[0].css;
  const at = file => css.indexOf(file);
  assert.equal(css.filter(entry => entry === CLEAR_FILE).length, 1, "loaded exactly once");
  assert.ok(at("src/glass/glass-fallback.css") >= 0);
  assert.ok(at(CLEAR_FILE) > at("src/glass/glass-fallback.css"), "the clear layer must win the cascade over the fallback");
  assert.ok(at(CLEAR_FILE) < at("src/ambient/ambient.css"), "clear must come before the ambient layer");
  // It follows every original engine file it is meant to override...
  for (const file of ["glass-tokens.css", "glass-material.css", "glass-refraction.css", "glass-optics.css", "glass-lighting.css", "glass-motion.css"]) {
    assert.ok(at(CLEAR_FILE) > at("src/glass/" + file), CLEAR_FILE + " must load after " + file);
  }
  // ...and still precedes the player/YouTube overrides, which must stay last.
  assert.ok(at(CLEAR_FILE) < at("src/glass/glass-player.css"));
  assert.ok(at(CLEAR_FILE) < at("src/styles/youtube.css"));
  // A manifest path that does not exist ships a silently dead stylesheet.
  assert.ok(fs.existsSync(path.join(root, CLEAR_FILE)));
});

test("every clear rule is gated on the exact attribute pair the runtime writes", () => {
  assert.ok(clearSelectors.length >= 8);
  for (const selector of clearSelectors) {
    assert.ok(selector.startsWith(GATE), "ungated selector would paint outside clear mode: " + selector);
    // The accessibility opt-in may narrow the root gate further; it cannot
    // replace the master/clear gate or remove the descendant target.
    const rest = selector.slice(GATE.length).replace(/^:not\(\[data-ylg-transparency="glass"\]\)/, "");
    assert.ok(/^\s+\S/.test(rest), "the gate must be followed by a real target: " + selector);
  }
  // The gate includes data-ylg-enabled so a disabled extension can never go clear...
  assert.ok(GATE.includes('data-ylg-enabled="true"'));
  // ...and the attribute value is the literal settings.js writes.
  assert.match(source("src/shared/settings.js"), /s\.opacity === 0\)\s*de\.setAttribute\("data-ylg-fill", "none"\)/);
  assert.ok(clearCss.includes('[data-ylg-fill="none"]'));
});

test("no clear rule can reach the video element or the player progress bar", () => {
  const forbidden = /\bvideo\b|html5-main-video|#movie_player|\.ytp-|\bytp-[a-z]|play-progress|load-progress|hover-progress|scrubber|progress-bar/i;
  for (const selector of clearSelectors) {
    assert.ok(!forbidden.test(selector), "player-affecting selector: " + selector);
    assert.ok(!/(^|[\s,>+~])\*/.test(selector), "no universal selector: " + selector);
    assert.ok(!/^html\s*$|^body\s*$|^html\s*\{/.test(selector), "no bare root rule: " + selector);
  }
  // Nothing in the file mentions the player chrome at all, including declarations.
  assert.ok(!forbidden.test(clearNoComments), "glass-clear.css must not name player internals");
});

test("display:none / content:none only ever hit our own pseudo-elements", () => {
  for (const rule of clearRules) {
    if (!/display\s*:\s*none|content\s*:\s*none/.test(rule.body)) continue;
    for (const part of rule.selector.split(",").map(s => s.trim())) {
      assert.ok(/::(before|after)$/.test(part), "content/display reset on a real element would hide it: " + part);
    }
  }
  // The panel itself keeps its box; only its paint goes away.
  const panel = clearRules.find(rule => /\.ylg-glass\s*$/.test(rule.selector));
  assert.ok(panel, "expected a plain .ylg-glass reset rule");
  assert.ok(/background-image:\s*none\s*!important/.test(panel.body));
  assert.ok(/-webkit-backdrop-filter:\s*none\s*!important/.test(panel.body));
  assert.ok(/backdrop-filter:\s*none\s*!important/.test(panel.body));
});

test("clear mode freezes no motion and never rewrites the opacity variable", () => {
  // The 180ms hover/focus transition lives in the original engine files; the
  // additive layer must not disable it or the surface would stop animating.
  assert.ok(!/transition\s*:/.test(clearNoComments), "must not declare transition");
  assert.ok(!/animation\s*:/.test(clearNoComments), "must not declare animation");
  assert.ok(!/--ylg-opacity\s*:/.test(clearNoComments), "clear mode is the attribute, not a forced 0");
  assert.ok(!/--ylg-chrome-scrim\s*:|--ylg-search-scrim\s*:/.test(clearNoComments), "scrims stay owned by settings.js");
  assert.ok(!/url\(/.test(clearNoComments), "no external image/filter resources");
});

test("clear mode keeps the surface operable and honours accessibility prefs", () => {
  const focus = clearRules.find(rule => rule.selector.includes("ytSearchboxComponentInputBox:focus-within"));
  assert.ok(focus, "the search field must keep a focus ring while clear");
  assert.ok(/box-shadow\s*:/.test(focus.body) && /--ylg-accent/.test(focus.body));
  const chip = clearRules.find(rule => rule.selector.includes('[data-ylg-level="chip"]'));
  assert.ok(chip && /box-shadow\s*:\s*inset/.test(chip.body), "chips keep an outline hint");
  const media = clearRules.find(rule => rule.at.some(at => /prefers-reduced-transparency|forced-colors/.test(at)));
  assert.ok(media, "a forced-colors / reduced-transparency fallback must re-solidify the surface");
  assert.ok(/Canvas/.test(media.body));
});

test("glass-clear.css stays manifest-only: no other stylesheet pulls it in", () => {
  const dirs = ["src/glass", "src/styles", "src/ambient", "src/popup"];
  for (const dir of dirs) {
    for (const name of fs.readdirSync(path.join(root, dir)).filter(file => file.endsWith(".css"))) {
      const file = path.posix.join(dir, name);
      if (file === CLEAR_FILE) continue;
      assert.ok(!/glass-clear/.test(source(file)), file + " must not @import or reference glass-clear.css");
    }
  }
  // The eight original files are untouched by this feature (digests live in the
  // visual checkpoint suite); at minimum they must not embed the clear layer.
  for (const name of ["glass-fallback.css", "glass-material.css", "glass-optics.css", "glass-player.css", "glass-tokens.css"]) {
    assert.ok(!/data-ylg-fill/.test(source("src/glass/" + name)), name + " must not grow clear-mode rules");
  }
});

/* ---------------- runner ---------------- */
(async () => {
  for (const { name, fn } of cases) {
    try { await fn(); passed++; console.log(`PASS ${name}`); }
    catch (error) { console.error(`FAIL ${name}\n${error.stack}`); process.exitCode = 1; }
  }
  console.log(`\nClear-glass regressions: ${passed}/${cases.length} passed`);
  console.log("Scope: shipped sources in a Node VM with hand-rolled element/popup DOMs; no browser, no computed styles, no pixels, no ambient geometry.");
})();
