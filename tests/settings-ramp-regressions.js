"use strict";
/* Settings ramp + tint/chrome regressions (schema 8) - A5 suite, standalone.
 *
 * Scope: the SHIPPED sources only, executed in a Node VM with a minimal
 * documentElement stub (style + attributes). No browser, no computed styles, no
 * pixels, no shared fixture with the other suites.
 *
 * What this pins:
 *   1. the perceptual opacity slider: opacityToSlider / sliderToOpacity are exact
 *      inverses at every stop, strictly monotonic, exact at both endpoints
 *      (0 -> 0, 100 -> 0.85), and clamped instead of producing NaN
 *   2. --ylg-fill-strength: exactly 0 at alpha 0, exactly 1 at 0.85, monotonic,
 *      and read by glass-ramp.css ONLY through a fallback-1 alias
 *   3. ONE colour concept: tint=custom derives the surface tint channel AND
 *      --ylg-accent from the stored accent (accepting #rgb / #rrggbb / rgb() and
 *      refusing junk), while black/white change only the surface; the chrome and
 *      search scrims follow the same choice
 *   4. setMediaTint writes BOTH channels and clearing it restores the theme tone
 *   5. blur: 0 is accepted and written as "0px", 999 clamps to 40, and the
 *      derived blur sizes collapse with a zero blur
 *   6. the schema-8 removals: no --ylg-accent-soft / --ylg-aberration-px writes
 *      and no data-ylg-render-mode attribute, while every live property, var and
 *      attribute is still written
 *   7. static: glass-ramp.css is a gated, paint-only, !important-free additive
 *      layer referenced exactly once in manifest.json in the right position, and
 *      the popup has no dangling ids in either direction
 *
 * Deliberately NOT asserted: paint/computed-style results, the eight original
 * glass CSS digests (tests/visual-restore-regressions.js owns those) and the
 * clear-mode layer (tests/clear-glass-regressions.js owns that).
 *
 * Run: node tests/settings-ramp-regressions.js
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

test("100% opacity reaches alpha one, releases solid material below maximum and preserves saved alpha", () => {
  const { el } = applyOn({ opacity: 0.85, schemaVersion: 8 });
  assert.equal(el.props["--ylg-opacity"], "0.85");
  assert.equal(el.getAttribute("data-ylg-opacity-solid"), "false");
  S.applySettingsToDocument({ documentElement: el }, { opacity: S.sliderToOpacity(100) });
  assert.equal(el.props["--ylg-opacity"], "1");
  assert.equal(el.getAttribute("data-ylg-opacity-solid"), "true");
  S.applySettingsToDocument({ documentElement: el }, { opacity: S.sliderToOpacity(99) });
  assert.equal(el.getAttribute("data-ylg-opacity-solid"), "false");
});

test("maximum opacity stays white across themes, tint choices and late media samples", () => {
  for (const theme of ["light", "dark", "auto"]) {
    for (const tint of ["auto", "black", "white", "custom", "media"]) {
      const { el, normalized } = applyOn({ theme, tint, accent: "#123456", opacity: 1 });
      const doc = { documentElement: el };
      assert.equal(normalized.tint, tint, "do not overwrite the saved tint");
      for (const prop of ["--ylg-chrome-scrim", "--ylg-search-scrim"]) {
        assert.deepEqual(scrim(el.props[prop]), { rgb: "255, 255, 255", alpha: 1 });
      }
      S.setMediaTint(doc, { r: 7, g: 20, b: 39 });
      S.applyThemeToDocument(doc, "dark");
      assert.deepEqual(scrim(el.props["--ylg-chrome-scrim"]), { rgb: "255, 255, 255", alpha: 1 });
      S.applySettingsToDocument(doc, { theme: "dark", tint, accent: "#123456", opacity: 0.5 });
      const expected = { auto: DARK_AUTO_RGB, black: "0, 0, 0", white: "255, 255, 255", custom: "18, 52, 86", media: "7, 20, 39" }[tint];
      assert.deepEqual(scrim(el.props["--ylg-chrome-scrim"]), { rgb: expected, alpha: expectedAlpha(0.5) });
      S.setMediaTint(doc, null);
    }
  }
});

test("upper slider range whitens gradually without a 99-to-100 colour or reading-palette jump", () => {
  for (const tint of ["black", "auto", "custom", "media"]) {
    const { el } = applyOn({ tint, theme: "dark", accent: "#123456", opacity: 0.5 });
    const doc = { documentElement: el };
    S.setMediaTint(doc, { r: 4, g: 20, b: 35 });
    let previous;
    let penultimate;
    for (let percent = 60; percent <= 100; percent++) {
      S.applySettingsToDocument(doc, { tint, theme: "dark", accent: "#123456", opacity: S.sliderToOpacity(percent) });
      const channels = scrim(el.props["--ylg-chrome-scrim"]).rgb.split(", ").map(Number);
      assert.equal(el.props["--ylg-chrome-scrim"], el.props["--ylg-search-scrim"]);
      if (previous) channels.forEach((v, i) => {
        assert.ok(v >= previous[i], "whitening must be monotonic");
        assert.ok(v - previous[i] <= 15, "one slider stop must not swap materials");
      });
      if (percent === 99) penultimate = { channels, ink: el.getAttribute("data-ylg-opacity-pale") };
      if (percent === 100) {
        channels.forEach((v, i) => assert.ok(v - penultimate.channels[i] <= 1));
        assert.equal(el.getAttribute("data-ylg-opacity-pale"), penultimate.ink);
        assert.deepEqual(channels, [255, 255, 255]);
      }
      previous = channels;
    }
    S.applySettingsToDocument(doc, { tint: "black", opacity: 0.5 });
    assert.equal(el.getAttribute("data-ylg-opacity-pale"), "false", "lowering opacity releases the pale palette");
    assert.equal(scrim(el.props["--ylg-chrome-scrim"]).rgb, "0, 0, 0");
    S.setMediaTint(doc, null);
  }
});

test("light-mode reading ink follows opacity across the threshold and updates on the same document", () => {
  const { el } = applyOn({ opacity: 0.3 });
  assert.equal(el.getAttribute("data-ylg-light-ink"), "light");
  for (const opacity of [0, 0.3, 0.599, 0.6, 0.85, 0.2]) {
    S.applySettingsToDocument({ documentElement: el }, { opacity });
    assert.equal(el.getAttribute("data-ylg-light-ink"), opacity < 0.6 ? "light" : "dark");
  }
});

/* ---------------- shared contract, loaded once ---------------- */
function contract() {
  const context = vm.createContext({ console });
  context.window = context;
  context.globalThis = context;
  vm.runInContext(source("src/shared/settings.js"), context, { filename: "src/shared/settings.js" });
  return context.YLG_SETTINGS;
}
const S = contract();
const ALPHA_MAX = 1;

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
const RGBA = /^rgba\((\d+), (\d+), (\d+), ([0-9.]+)\)$/;
function scrim(value) {
  const m = RGBA.exec(value);
  assert.ok(m, "scrim must be a hand-built rgba() triplet: " + JSON.stringify(value));
  return { rgb: [m[1], m[2], m[3]].join(", "), alpha: Number(m[4]) };
}
const expectedAlpha = opacity => Math.round(Math.min(1, opacity * 1.15) * 1000) / 1000;
const DARK_AUTO_RGB = "22, 28, 38";
const LIGHT_AUTO_RGB = "248, 250, 252";

/* Tiny block reader: returns every style rule with the at-rules wrapping it. */
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

/* =====================================================================
   1. THE OPACITY RAMP
   ===================================================================== */
test("opacityToSlider and sliderToOpacity are exact inverses at every documented stop", () => {
  assert.equal(typeof S.opacityToSlider, "function", "the popup feature-detects this export");
  assert.equal(typeof S.sliderToOpacity, "function");
  for (const p of [0, 1, 5, 10, 25, 50, 75, 99, 100]) {
    const alpha = S.sliderToOpacity(p);
    assert.equal(S.opacityToSlider(alpha), p, "slider " + p + " -> alpha " + alpha + " -> slider");
    assert.ok(Number.isInteger(S.opacityToSlider(alpha)), "the slider position is an integer");
  }
  // Every integer position round-trips, not just the ones named above.
  for (let p = 0; p <= 100; p++) {
    assert.equal(S.opacityToSlider(S.sliderToOpacity(p)), p, "round trip at slider " + p);
  }
  // Endpoints are exact by construction, never by rounding.
  assert.equal(S.sliderToOpacity(0), 0);
  assert.equal(S.sliderToOpacity(100), 1);
  assert.equal(S.opacityToSlider(0), 0);
  assert.equal(S.opacityToSlider(1), 100);
  // The documented gamma curve: alpha = 0.85 * (p/100) ^ 1.4.
  for (const p of [1, 5, 10, 25, 50, 75, 99]) {
    assert.ok(Math.abs(S.sliderToOpacity(p) - Math.pow(p / 100, 1.4)) < 1e-15, "curve at slider " + p);
  }
});

test("the opacity curve is strictly monotonic and stays inside RANGES.opacity", () => {
  assert.ok(S.sliderToOpacity(1) < 0.002, "first notch stays below 0.2% actual alpha");
  assert.ok(S.sliderToOpacity(2) - S.sliderToOpacity(1) < 0.003, "second notch remains gradual");
  const alphas = [];
  for (let p = 0; p <= 100; p++) alphas.push(S.sliderToOpacity(p));
  for (let i = 1; i < alphas.length; i++) {
    assert.ok(alphas[i] > alphas[i - 1], "not strictly increasing at slider " + i + " (" + alphas[i - 1] + " >= " + alphas[i] + ")");
  }
  assert.ok(alphas.every(a => a >= S.RANGES.opacity[0] && a <= S.RANGES.opacity[1]), "alpha must stay in RANGES.opacity");
  // The inverse is monotonic too: a bigger alpha can never map to a smaller stop.
  let last = -1;
  for (let a = 0; a <= ALPHA_MAX + 1e-9; a += 0.01) {
    const stop = S.opacityToSlider(a);
    assert.ok(stop >= last, "opacityToSlider is not monotonic at alpha " + a);
    last = stop;
  }
  // Out-of-range and non-finite input clamps instead of producing NaN/Infinity.
  assert.equal(S.sliderToOpacity(-1), 0);
  assert.equal(S.sliderToOpacity(1000), ALPHA_MAX);
  assert.equal(S.sliderToOpacity(NaN), 0);
  assert.equal(S.sliderToOpacity("50"), 0, "a non-number is treated as the floor, not parsed");
  assert.equal(S.opacityToSlider(-1), 0);
  assert.equal(S.opacityToSlider(5), 100);
  assert.equal(S.opacityToSlider(NaN), 0);
  // Non-finite input is treated as the floor, never as "maximum".
  assert.equal(S.opacityToSlider(Infinity), 0);
  assert.equal(S.sliderToOpacity(Infinity), 0);
});

/* =====================================================================
   2. --ylg-fill-strength
   ===================================================================== */
test("--ylg-fill-strength is 0 at alpha 0, 1 at 0.85 and monotonic in between", () => {
  // schemaVersion 8 keeps 0.45 as a deliberate alpha; an older schema treats that
  // exact value as "untouched" and lifts it to 0.
  const fill = alpha => applyOn({ schemaVersion: 8, opacity: alpha }).el.props["--ylg-fill-strength"];
  assert.ok(Object.hasOwn(applyOn({ schemaVersion: 8, opacity: 0.4 }).el.props, "--ylg-fill-strength"), "the property is always written");
  assert.equal(fill(0), "0", "alpha 0 must be exactly 0, not 0.0000");
  assert.equal(fill(0.85), "1", "the ceiling must be exactly 1");
  const samples = [0, 0.01, 0.05, 0.1, 0.19, 0.3, 0.45, 0.6, 0.7, 0.85];
  const values = samples.map(a => Number(fill(a)));
  assert.ok(values.every(Number.isFinite), "every fill strength is a number: " + values.join(","));
  for (let i = 1; i < values.length; i++) {
    assert.ok(values[i] > values[i - 1], "fill strength must grow with alpha (" + samples[i - 1] + " -> " + samples[i] + ")");
  }
  // The contract value: pow(alpha / 0.85, 1), rounded to four decimals as written.
  for (const a of samples) {
    const expected = Math.round(Math.min(1, Math.pow(a / 0.85, 1)) * 10000) / 10000;
    assert.equal(Number(fill(a)), expected, "fill strength at alpha " + a);
  }
  // Out of range clamps to the endpoints rather than overshooting.
  assert.equal(fill(2), "1");
  assert.equal(fill(-1), "0");
});

test("glass-ramp.css reads --ylg-fill-strength only through the fallback-1 alias", () => {
  const file = "src/glass/glass-ramp.css";
  const body = source(file).replace(/\/\*[\s\S]*?\*\//g, "");
  const refs = body.match(/var\(--ylg-fill-strength[^)]*\)/g) || [];
  assert.ok(refs.length >= 1, "the ramp layer must actually read the property");
  for (const ref of refs) {
    assert.equal(ref, "var(--ylg-fill-strength, 1)", "the fallback must be 1 so the layer is inert without settings.js");
  }
  // settings.js OWNS the value; a stylesheet declaring it would fight the runtime.
  assert.equal((body.match(/--ylg-fill-strength\s*:/g) || []).length, 0, "the stylesheet must not declare the value");
  assert.equal((body.match(/--ylg-ramp\s*:\s*var\(--ylg-fill-strength, 1\)/g) || []).length, 1, "the alias is declared exactly once");
  // The separate chrome painter also scales its restored edge lights. The
  // eight pinned engine files remain independent and byte-identical.
  for (const dir of ["src/glass", "src/styles", "src/ambient", "src/popup"]) {
    for (const name of fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith(".css"))) {
      const other = path.posix.join(dir, name);
      if (other === file) continue;
      if (["src/styles/chrome-surface.css", "src/styles/panel-refinement.css"].includes(other)) {
        const chrome = source(other).replace(/\/\*[\s\S]*?\*\//g, "");
        const refs = chrome.match(/var\(--ylg-fill-strength[^)]*\)/g) || [];
        assert.ok(refs.length > 0, "chrome edge lights must follow opacity");
        for (const ref of refs) assert.equal(ref, "var(--ylg-fill-strength, 1)");
        assert.doesNotMatch(chrome, /--ylg-fill-strength\s*:/, "settings owns the ramp value");
        continue;
      }
      assert.ok(!/--ylg-fill-strength/.test(source(other)), other + " must not depend on the ramp value");
    }
  }
});

/* =====================================================================
   3. ONE COLOUR CONCEPT: tint
   ===================================================================== */
test("tint custom drives BOTH the surface tint channel and --ylg-accent", () => {
  const custom = accent => applyOn({ tint: "custom", accent, theme: "dark" });
  const triplet = hex => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).join(", ");
  for (const accent of ["#3ea6ff", "#a78bfa", "#112233", "#ffffff"]) {
    const { el, normalized } = custom(accent);
    assert.equal(normalized.tint, "custom", "custom survives normalization");
    assert.equal(el.props["--ylg-surface-tint-light"], triplet(accent.slice(1)), "surface tint for " + accent);
    assert.equal(el.props["--ylg-accent"], accent, "accent for " + accent);
  }
  // The chrome and search scrims follow the same colour, and stay identical.
  const hex = custom("#112233");
  assert.equal(scrim(hex.el.props["--ylg-chrome-scrim"]).rgb, "17, 34, 51");
  assert.equal(hex.el.props["--ylg-chrome-scrim"], hex.el.props["--ylg-search-scrim"]);
});

test("tint custom accepts #rgb and rgb() as well as #rrggbb", () => {
  const short = applyOn({ tint: "custom", accent: "#abc" });
  assert.equal(short.el.props["--ylg-surface-tint-light"], "170, 187, 204", "#rgb expands to a triplet");
  assert.equal(short.el.props["--ylg-accent"], "#abc");
  const fn = applyOn({ tint: "custom", accent: "rgb(255, 0, 128)" });
  assert.equal(fn.el.props["--ylg-surface-tint-light"], "255, 0, 128");
  assert.equal(fn.el.props["--ylg-accent"], "rgb(255, 0, 128)");
  assert.equal(scrim(fn.el.props["--ylg-chrome-scrim"]).rgb, "255, 0, 128");
  // Percent notation and an alpha component are both reduced to an opaque triplet.
  // (50% -> 50 * 2.55 = 127.49999999999999 in binary floating point, hence 127.)
  const pct = applyOn({ tint: "custom", accent: "rgb(100%, 0%, 50%)" });
  assert.equal(pct.el.props["--ylg-surface-tint-light"], "255, 0, 127");
  const withAlpha = applyOn({ tint: "custom", accent: "#11223344" });
  assert.equal(withAlpha.el.props["--ylg-surface-tint-light"], "17, 34, 51", "the alpha byte is dropped on purpose");
});

test("tint custom refuses junk instead of painting an invalid triplet", () => {
  // 5- and 7-digit hex pass normalizeSettings's loose guard but are not colours:
  // the surface channel falls back to the theme tone (property removed) and only
  // the user's raw string is kept as the accent.
  for (const junk of ["#12345", "#1234567", "rgb(12"]) {
    const { el, normalized } = applyOn({ tint: "custom", accent: junk });
    assert.equal(normalized.accent, junk, "the stored accent string is preserved: " + junk);
    assert.ok(!Object.hasOwn(el.props, "--ylg-surface-tint-light"), "no surface override for " + junk);
    assert.equal(el.props["--ylg-accent"], junk);
  }
  // A value normalization itself rejects becomes the default accent, and the
  // surface then follows that default (never a broken value).
  const script = applyOn({ tint: "custom", accent: "javascript:alert(1)" });
  assert.equal(script.el.props["--ylg-accent"], "#3ea6ff");
  assert.equal(script.el.props["--ylg-surface-tint-light"], "62, 166, 255");
});

test("black/white change only the surface; the stored accent is untouched", () => {
  const accent = "#a78bfa";
  const black = applyOn({ tint: "black", accent, theme: "dark" });
  assert.equal(black.el.props["--ylg-surface-tint-light"], "0, 0, 0");
  assert.equal(black.el.props["--ylg-accent"], accent, "black is a surface choice, not an accent choice");
  assert.equal(scrim(black.el.props["--ylg-chrome-scrim"]).rgb, "0, 0, 0");
  const white = applyOn({ tint: "white", accent, theme: "dark" });
  assert.equal(white.el.props["--ylg-surface-tint-light"], "255, 255, 255");
  assert.equal(white.el.props["--ylg-accent"], accent);
  assert.equal(scrim(white.el.props["--ylg-chrome-scrim"]).rgb, "255, 255, 255");
  // Auto keeps the accent and drops the surface override so the theme token wins.
  const auto = applyOn({ tint: "auto", accent, theme: "dark" });
  assert.ok(!Object.hasOwn(auto.el.props, "--ylg-surface-tint-light"));
  assert.equal(auto.el.props["--ylg-accent"], accent);
  assert.equal(scrim(auto.el.props["--ylg-chrome-scrim"]).rgb, DARK_AUTO_RGB);
  // ...and without a theme preference Auto resolves YouTube's Appearance instead
  // of a hardcoded tone (the stub has no html[dark], i.e. light).
  assert.equal(scrim(applyOn({ tint: "auto", accent }).el.props["--ylg-chrome-scrim"]).rgb, LIGHT_AUTO_RGB);
});

/* =====================================================================
   4. setMediaTint
   ===================================================================== */
test("setMediaTint writes the surface tint AND the accent; clearing restores the theme tone", () => {
  const el = newRootElement();
  const doc = { documentElement: el };
  // schemaVersion 8 keeps 0.45 as a deliberate alpha (an older schema treats that
  // exact value as "untouched" and lifts it to 0, which would hide the alpha check).
  S.applySettingsToDocument(doc, { schemaVersion: 8, tint: "media", accent: "#a78bfa", theme: "dark", opacity: 0.45 });
  // Nothing sampled yet: theme tone for the surface, user accent for accents.
  assert.ok(!Object.hasOwn(el.props, "--ylg-surface-tint-light"));
  assert.equal(el.props["--ylg-accent"], "#a78bfa");
  assert.equal(el.getAttribute("data-ylg-tint-media"), "1", "the sampled-tint state is marked");
  assert.equal(scrim(el.props["--ylg-chrome-scrim"]).rgb, DARK_AUTO_RGB);

  // A sampled frame tints BOTH channels, so a thumbnail-tinted header also tints
  // focus rings and emphasis.
  S.setMediaTint(doc, { r: 12, g: 200, b: 40 });
  assert.equal(el.props["--ylg-surface-tint-light"], "12, 200, 40");
  assert.equal(el.props["--ylg-accent"], "rgb(12, 200, 40)", "the accent follows the sampled colour");
  assert.equal(scrim(el.props["--ylg-chrome-scrim"]).rgb, "12, 200, 40");
  assert.equal(scrim(el.props["--ylg-search-scrim"]).rgb, "12, 200, 40");
  assert.equal(scrim(el.props["--ylg-chrome-scrim"]).alpha, expectedAlpha(0.45), "sampling must not disturb the opacity alpha");

  // Clearing the sample restores the theme tone and the user's accent.
  S.setMediaTint(doc, null);
  assert.ok(!Object.hasOwn(el.props, "--ylg-surface-tint-light"), "the theme token must win again");
  assert.equal(el.props["--ylg-accent"], "#a78bfa");
  assert.equal(scrim(el.props["--ylg-chrome-scrim"]).rgb, DARK_AUTO_RGB);

  // The restore is theme-aware, not a hardcoded dark triplet.
  S.applySettingsToDocument(doc, { tint: "media", accent: "#a78bfa", theme: "light" });
  S.setMediaTint(doc, { r: 255, g: 0, b: 0 });
  assert.equal(el.props["--ylg-surface-tint-light"], "255, 0, 0");
  S.setMediaTint(doc, null);
  assert.ok(!Object.hasOwn(el.props, "--ylg-surface-tint-light"));
  assert.equal(scrim(el.props["--ylg-chrome-scrim"]).rgb, LIGHT_AUTO_RGB);

  // Any other tint ignores late samples from the sampler.
  S.applySettingsToDocument(doc, { tint: "auto", accent: "#a78bfa", theme: "dark" });
  S.setMediaTint(doc, { r: 1, g: 2, b: 3 });
  assert.ok(!Object.hasOwn(el.props, "--ylg-surface-tint-light"));
  assert.equal(el.props["--ylg-accent"], "#a78bfa");
});

/* =====================================================================
   5. BLUR
   ===================================================================== */
test("blur 0 is accepted and written as 0px; blur 999 clamps to 40", () => {
  assert.deepEqual([...S.RANGES.blur], [0, 40]);
  assert.equal(S.normalizeSettings({ blur: 0 }).blur, 0, "0 is a legitimate 'no backdrop blur' state");
  const zero = applyOn({ blur: 0 });
  assert.equal(zero.el.props["--ylg-blur"], "0px");
  assert.equal(zero.el.props["--ylg-blur-s"], "0px", "the derived small blur collapses with it");
  assert.equal(zero.el.props["--ylg-blur-l"], "0px");
  assert.equal(S.normalizeSettings({ blur: 999 }).blur, 40);
  const top = applyOn({ blur: 999 });
  assert.equal(top.el.props["--ylg-blur"], "40px");
  assert.equal(top.el.props["--ylg-blur-s"], "20px");
  assert.equal(top.el.props["--ylg-blur-l"], "48px");
  // Negative clamps to the floor; a non-number is the default, never 0 by accident.
  assert.equal(S.normalizeSettings({ blur: -5 }).blur, 0);
  assert.equal(S.normalizeSettings({ blur: "nope" }).blur, S.DEFAULT_SETTINGS.blur);
  assert.equal(S.normalizeSettings({}).blur, S.DEFAULT_SETTINGS.blur);
});

/* =====================================================================
   6. THE SCHEMA-8 REMOVALS
   ===================================================================== */
test("applySettingsToDocument stopped writing the removed properties and attribute", () => {
  const { el } = applyOn({ tint: "custom", accent: "#3ea6ff", blur: 12, opacity: 0.4, refraction: 0.3 });
  for (const gone of ["--ylg-accent-soft", "--ylg-aberration-px"]) {
    assert.ok(!Object.hasOwn(el.props, gone), gone + " must not be written any more");
  }
  assert.ok(!Object.hasOwn(el.attrs, "data-ylg-render-mode"), "data-ylg-render-mode is gone with renderMode");
  // ...while the live contract is still written.
  for (const prop of ["--ylg-blur", "--ylg-blur-s", "--ylg-blur-l", "--ylg-opacity", "--ylg-radius",
    "--ylg-radius-s", "--ylg-radius-l", "--ylg-refraction", "--ylg-highlight", "--ylg-accent",
    "--ylg-hover-scale", "--ylg-fill-strength", "--ylg-chrome-scrim", "--ylg-search-scrim"]) {
    assert.ok(Object.hasOwn(el.props, prop), prop + " must still be written");
  }
  for (const attr of ["data-ylg-enabled", "data-ylg-theme", "data-ylg-theme-preference", "data-ylg-tint",
    "data-ylg-motion", "data-ylg-optics", "data-ylg-optics-request-aberration",
    "data-ylg-optics-request-magnify", "data-ylg-ambient", "data-ylg-ambient-quality"]) {
    assert.ok(Object.hasOwn(el.attrs, attr), attr + " must still be written");
  }
  // The sources themselves must not re-introduce the removed writes, and neither
  // the runtime nor the popup may read the removed settings.
  const settingsJs = source("src/shared/settings.js");
  const bootstrapJs = source("src/content/bootstrap.js");
  const popupJs = source("src/popup/popup.js") + "\n" + source("src/popup/sky-controls.js");
  for (const [name, text] of [["settings.js", settingsJs], ["bootstrap.js", bootstrapJs]]) {
    assert.ok(!/setAttribute\(\s*["']data-ylg-render-mode["']/.test(text), name + " must not write data-ylg-render-mode");
    assert.ok(!/setProperty\(\s*["']--ylg-accent-soft["']/.test(text), name + " must not write --ylg-accent-soft");
    assert.ok(!/setProperty\(\s*["']--ylg-aberration-px["']/.test(text), name + " must not write --ylg-aberration-px");
  }
  for (const [name, text] of [["settings.js", settingsJs], ["bootstrap.js", bootstrapJs], ["popup.js", popupJs]]) {
    assert.ok(!/(?:s|settings|stored|next|normalized|current)\.renderMode\b/.test(text), name + " must not read renderMode");
    assert.ok(!/applyPreset|PRESETS/.test(text), name + " must not reference the removed preset API");
  }
});

/* =====================================================================
   7. STATIC: glass-ramp.css + manifest + popup ids
   ===================================================================== */
const RAMP_FILE = "src/glass/glass-ramp.css";
const rampCss = source(RAMP_FILE);
const rampNoComments = rampCss.replace(/\/\*[\s\S]*?\*\//g, "");
const GATE = 'html[data-ylg-enabled="true"]';

test("glass-ramp.css is an additive, gated, paint-only layer", () => {
  assert.ok(fs.existsSync(path.join(root, RAMP_FILE)));
  assert.ok(!/!important/.test(rampNoComments), "the additive layer must win on order, never on !important");
  assert.ok(!/(^|[;{])\s*transition\s*:/.test(rampNoComments), "must not declare a transition");
  assert.ok(!/(^|[;{])\s*animation\s*:/.test(rampNoComments), "must not declare an animation");
  assert.ok(!/url\(/.test(rampNoComments), "no external image/filter resources");
  const forbidden = /\bvideo\b|html5-main-video|#movie_player|\.ytp-|ytp-|play-progress|load-progress|hover-progress|scrubber|progress-bar/i;
  assert.ok(!forbidden.test(rampNoComments), "glass-ramp.css must not name player internals at all");
  const rules = parseRules(rampNoComments);
  assert.ok(rules.length >= 8, "expected the mirrored rim/sheen/scatter rules, got " + rules.length);
  assert.ok(rules.some(r => r.selector.includes(".ylg-glass")), "must reach the glass surface itself");
  assert.ok(rules.some(r => r.selector.includes('[data-ylg-level="hero"]')), "must cover the hero rim");
  const selectors = rules.flatMap(rule => rule.selector.split(",").map(part => part.trim()).filter(Boolean));
  for (const selector of selectors) {
    assert.ok(selector.startsWith(GATE), "ungated selector would paint while the extension is off: " + selector);
    const rest = selector.slice(GATE.length);
    assert.ok(/^\s+\S/.test(rest), "the gate must be followed by a real target: " + selector);
    assert.ok(!forbidden.test(selector), "player-affecting selector: " + selector);
    assert.ok(!/(^|[\s,>+~])\*/.test(selector), "no universal selector: " + selector);
  }
  // Paint only: no layout, geometry, stacking, pointer or compositing changes.
  assert.ok(!/(^|[;{])\s*(?:width|height|inset|top|left|right|bottom|padding|margin|border-radius|transform|pointer-events|z-index|opacity|display|position)\s*:/.test(rampNoComments),
    "the ramp may only rewrite alpha values");
});

test("manifest loads glass-ramp.css exactly once, after the engine files it mirrors", () => {
  const manifest = JSON.parse(source("manifest.json"));
  const css = manifest.content_scripts[0].css;
  const at = file => css.indexOf(file);
  assert.equal(css.filter(entry => entry === RAMP_FILE).length, 1, "loaded exactly once");
  assert.ok(at(RAMP_FILE) >= 0, "listed in content_scripts[0].css");
  assert.ok(fs.existsSync(path.join(root, RAMP_FILE)), "a manifest path that does not exist ships a dead stylesheet");
  // The file re-states declarations from these layers, so it must come after them.
  for (const before of ["glass-tokens.css", "glass-material.css", "glass-refraction.css", "glass-optics.css", "glass-lighting.css"]) {
    assert.ok(at(RAMP_FILE) > at("src/glass/" + before), RAMP_FILE + " must load after " + before);
  }
  // ...and before every layer that must keep winning over it.
  for (const after of ["glass-motion.css", "glass-fallback.css", "glass-clear.css"]) {
    assert.ok(at(RAMP_FILE) < at("src/glass/" + after), RAMP_FILE + " must load before " + after);
  }
  // Nothing may @import or reference it from another stylesheet: manifest-only.
  for (const dir of ["src/glass", "src/styles", "src/ambient", "src/popup"]) {
    for (const name of fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith(".css"))) {
      const other = path.posix.join(dir, name);
      if (other === RAMP_FILE) continue;
      assert.ok(!/glass-ramp/.test(source(other)), other + " must not reference glass-ramp.css");
    }
  }
});

test("popup.js has no dangling ids and popup.html has no orphans", () => {
  const popupHtml = source("src/popup/popup.html");
  const popupJs = source("src/popup/popup.js") + "\n" + source("src/popup/sky-controls.js");
  const htmlIds = new Set([...popupHtml.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  // Every control id in popup.js is a string literal (passed to $(id), setSlider,
  // setChecked, bindSeg, ...) or an id inside a selector literal such as
  // "#ylg-body input". Colour literals are excluded so they are not read as ids.
  const jsIds = new Set();
  for (const literal of [...popupJs.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1])) {
    // "ylg-amb-" / "ylg-optics-" are id PREFIX checks, not ids.
    if (/^ylg-[\w-]+$/.test(literal) && !/-$/.test(literal)) jsIds.add(literal);
    for (const m of literal.matchAll(/#(ylg-[\w-]+)/g)) jsIds.add(m[1]);
  }
  for (const m of popupJs.matchAll(/\$\(\s*"([^"]+)"\s*\)/g)) jsIds.add(m[1]);
  assert.ok(htmlIds.size > 20, "the popup markup was parsed: " + htmlIds.size + " ids");
  assert.ok(jsIds.size > 20, "popup.js queries were parsed: " + jsIds.size + " ids");
  // Direction 1: anything popup.js looks up must exist in the markup.
  for (const id of jsIds) {
    assert.ok(htmlIds.has(id), "popup.js queries #" + id + " which popup.html does not define");
  }
  // Direction 2: every control in the markup must be bound or explicitly labelled.
  const labelled = new Set([...popupHtml.matchAll(/(?:aria-labelledby|for)="([^"]+)"/g)].map(m => m[1]));
  for (const id of htmlIds) {
    assert.ok(jsIds.has(id) || labelled.has(id), "#" + id + " exists in the markup but nothing binds or labels it");
  }
  // The four schema-8 removals must be gone from BOTH files, in every spelling.
  for (const gone of ["ylg-preset", "ylg-renderMode", "ylg-amb-smoothing", "ylg-amb-intensity"]) {
    assert.ok(!htmlIds.has(gone), "#" + gone + " must not exist in popup.html");
    assert.ok(!jsIds.has(gone), "popup.js must not query #" + gone);
    assert.ok(!popupJs.includes(gone) && !popupHtml.includes(gone), "neither file may mention " + gone);
  }
});

/* ---------------- runner ---------------- */
(async () => {
  for (const { name, fn } of cases) {
    try { await fn(); passed++; console.log(`PASS ${name}`); }
    catch (error) { console.error(`FAIL ${name}\n${error.stack}`); process.exitCode = 1; }
  }
  console.log(`\nSettings ramp regressions: ${passed}/${cases.length} passed`);
  console.log("Scope: shipped sources in a Node VM with a hand-rolled documentElement stub; no browser, no computed styles, no pixels.");
})();
