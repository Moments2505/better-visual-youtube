/* Behavioral & structural CSS contracts for the Liquid Glass engine and UI layers.
 * Replaces byte-for-byte SHA-256 pinning so root-cause CSS bugs can be fixed in
 * their owning stylesheets while preserving layer invariants and accessibility.
 */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, "");

function walkCss(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkCss(full));
    else if (entry.name.endsWith(".css")) out.push(full);
  }
  return out.sort();
}

function splitTopLevelSelectors(raw) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test("all 10 glass engine stylesheets exist and are wired in manifest.json", () => {
  const expected = [
    "glass-clear.css",
    "glass-fallback.css",
    "glass-lighting.css",
    "glass-material.css",
    "glass-motion.css",
    "glass-optics.css",
    "glass-player.css",
    "glass-ramp.css",
    "glass-refraction.css",
    "glass-tokens.css"
  ];
  const actual = fs.readdirSync(path.join(root, "src", "glass"))
    .filter(name => name.endsWith(".css"))
    .sort();
  assert.deepEqual(actual, expected);

  const manifest = JSON.parse(read("manifest.json"));
  const cssList = manifest.content_scripts[0].css;
  for (const name of expected) {
    assert.ok(cssList.includes("src/glass/" + name), `manifest missing src/glass/${name}`);
  }
});

test("lowfx degradation uses canonical data-ylg-lowfx=\"true\" and blocks floating menu entry animations", () => {
  const fallback = stripComments(read("src/glass/glass-fallback.css"));
  assert.doesNotMatch(fallback, /data-ylg-lowfx="1"/, "legacy lowfx=\"1\" attribute must not remain");
  const matches = fallback.match(/\[data-ylg-lowfx="true"\]/g) || [];
  assert.ok(matches.length >= 5, "glass-fallback.css must gate glass blur, hero blur, sheens, and floating settle on lowfx=\"true\"");

  const perf = stripComments(read("src/styles/interaction-performance.css"));
  assert.doesNotMatch(perf, /\[data-ylg-lowfx="true"\]\s*\.ylg-glass::before/,
    "interaction-performance.css must not carry duplicate lowfx sheen workarounds");

  const micro = stripComments(read("src/styles/micro-interactions.css"));
  assert.match(
    micro,
    /:not\(\[data-ylg-lowfx="true"\]\)\s*\.ylg-glass\[data-ylg-level="floating"\]\s*\{\s*animation:\s*ylg-menu-enter/,
    "micro-interactions.css must not re-enable floating menu animations on lowfx devices"
  );
});

test("every @media (prefers-reduced-motion: reduce) rule honours data-ylg-system-motion=\"ignore\"", () => {
  const cssFiles = walkCss(path.join(root, "src"));
  let reducedBlocks = 0;

  for (const fullPath of cssFiles) {
    const rel = path.relative(root, fullPath).replace(/\\/g, "/");
    const css = stripComments(fs.readFileSync(fullPath, "utf8"));
    let idx = 0;
    while ((idx = css.indexOf("@media (prefers-reduced-motion: reduce)", idx)) !== -1) {
      const open = css.indexOf("{", idx);
      assert.ok(open > idx, `${rel}: malformed @media block`);
      let depth = 1;
      let pos = open + 1;
      while (pos < css.length && depth > 0) {
        if (css[pos] === "{") depth++;
        else if (css[pos] === "}") depth--;
        pos++;
      }
      const inner = css.slice(open + 1, pos - 1);
      const rules = [...inner.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
      assert.ok(rules.length > 0, `${rel}: empty prefers-reduced-motion block`);
      reducedBlocks++;
      for (const [, rawSelectors] of rules) {
        for (const sel of splitTopLevelSelectors(rawSelectors)) {
          assert.ok(
            sel.includes(':not([data-ylg-system-motion="ignore"])'),
            `${rel}: reduced-motion selector missing :not([data-ylg-system-motion="ignore"]): ${sel}`
          );
        }
      }
      idx = pos;
    }
  }
  assert.ok(reducedBlocks >= 10, "expected reduced-motion coverage across engine, styles, ambient, and popup");

  let perfOutsideMedia = stripComments(read("src/styles/interaction-performance.css"));
  while (perfOutsideMedia.includes("@media")) {
    const start = perfOutsideMedia.indexOf("@media");
    const open = perfOutsideMedia.indexOf("{", start);
    let depth = 1;
    let pos = open + 1;
    while (pos < perfOutsideMedia.length && depth > 0) {
      if (perfOutsideMedia[pos] === "{") depth++;
      else if (perfOutsideMedia[pos] === "}") depth--;
      pos++;
    }
    perfOutsideMedia = perfOutsideMedia.slice(0, start) + perfOutsideMedia.slice(pos);
  }
  assert.doesNotMatch(
    perfOutsideMedia,
    /data-ylg-system-motion="ignore"/,
    "interaction-performance.css must not apply top-level system-motion=\"ignore\" overrides outside @media"
  );
});

test("player scrubber stays hidden at rest and right controls capsule has >= 8px inline clearance", () => {
  const liquid = stripComments(read("src/styles/liquid-components.css"));
  const restMatch = liquid.match(/html\[data-ylg-enabled="true"\]\s*\.ytp-scrubber-button\s*\{([^}]*)\}/);
  assert.ok(restMatch, "resting .ytp-scrubber-button rule must exist");
  assert.doesNotMatch(
    restMatch[1],
    /transform\s*:\s*scale\(1\)/,
    "resting .ytp-scrubber-button must not force transform: scale(1)"
  );
  assert.match(
    liquid,
    /\.ytp-progress-bar-container:is\(:hover,\s*:focus-within,\s*\[data-ylg-dragging="1"\]\)\s*\.ytp-scrubber-button\s*\{[^}]*transform:\s*scale\(1\)\s*!important/,
    "active hover/focus/drag on progress bar must reveal .ytp-scrubber-button cleanly"
  );

  const player = stripComments(read("src/glass/glass-player.css"));
  const rightControls = player.match(/html\[data-ylg-enabled="true"\]\s*\.ytp-chrome-bottom\s+\.ytp-right-controls\s*\{([^}]*)\}/);
  assert.ok(rightControls, ".ytp-right-controls rule must exist");
  const pad = rightControls[1].match(/padding-inline:\s*(\d+)px/);
  assert.ok(pad && Number(pad[1]) >= 8, `.ytp-right-controls padding-inline must be >= 8px (got ${pad ? pad[1] : "missing"})`);
});

test("watch panels clear rounded corners, bright-ambient ink covers metadata/links, and dead selectors are absent", () => {
  const youtube = stripComments(read("src/styles/youtube.css"));
  const watchPanels = youtube.match(/ytd-watch-metadata\.ylg-glass,[\s\S]*?ytd-comments\.ylg-glass\s*\{([^}]*)\}/);
  assert.ok(watchPanels, "watch-page panel geometry block must exist");
  assert.doesNotMatch(watchPanels[1], /padding:\s*var\(--ylg-radius-s\)/, "watch panels must not use cramped --ylg-radius-s padding");
  assert.match(watchPanels[1], /padding:\s*clamp\(14px,\s*var\(--ylg-radius\),\s*18px\)/);

  const frostedBlocks = youtube.match(/#frosted-glass[^{]*\{/g) || [];
  assert.equal(frostedBlocks.length, 1, "youtube.css should have a single consolidated #frosted-glass reset block");

  const light = stripComments(read("src/styles/light-ambient.css"));
  assert.doesNotMatch(light, /background(?:-color)?\s*:/);
  assert.match(light, /#description-inline-expander/);
  assert.match(light, /#info\b/);
  assert.match(light, /yt-core-attributed-string__link[\s\S]*?color:\s*#7dd3fc\s*!important/);

  for (const rel of ["src/glass/glass-tokens.css", "src/glass/glass-material.css", "src/styles/youtube.css"]) {
    assert.doesNotMatch(stripComments(read(rel)), /data-ylg-theme="auto"/, `${rel} must not contain dead data-ylg-theme="auto" rules`);
  }
  assert.doesNotMatch(stripComments(read("src/glass/glass-lighting.css")), /data-ylg-active="1"/);

  const popupHtml = read("src/popup/popup.html");
  assert.match(popupHtml, /id="ylg-sky-location">London, United Kingdom</);
});

test("release packaging, license attribution, and bilingual docs stay clean and consistent", () => {
  assert.ok(fs.existsSync(path.join(root, "scripts", "check.js")), "scripts/check.js must exist");
  assert.ok(fs.existsSync(path.join(root, "scripts", "package-release.js")), "scripts/package-release.js must exist");

  const pkgPy = read("scripts/package-release.py");
  assert.ok(pkgPy.includes('default=root / "dist" / "releases"'), "package-release.py must default output-dir to dist/releases");
  for (const devFile of ["CONTRIBUTING.md", "CHANGELOG.md", "default-settings.json", "INSTALL-EN.md", "README.md", "docs/PRIVACY-EN.md"]) {
    assert.ok(!pkgPy.includes(`"${devFile}"`), `package-release.py must not bundle repo file ${devFile}`);
  }

  const license = read("LICENSE");
  assert.match(license, /Better visual Youtube contributors/);
  assert.doesNotMatch(license, /YouTube Liquid Glass contributors/);

  assert.doesNotMatch(read("README.md"), /initially Hà Nội/);
  assert.doesNotMatch(read("README-VI.md"), /ban đầu là Hà Nội/);
  assert.match(read("docs/PRIVACY-VI.md"), /Trang chủ, Tìm kiếm hoặc trang kênh/);
});

let passed = 0;
for (const { name, fn } of cases) {
  try {
    fn();
    passed++;
    console.log("PASS " + name);
  } catch (err) {
    console.error("FAIL " + name + "\n" + err.stack);
  }
}
console.log(`\nVisual & CSS contract regressions: ${passed}/${cases.length} passed`);
if (passed !== cases.length) process.exitCode = 1;
