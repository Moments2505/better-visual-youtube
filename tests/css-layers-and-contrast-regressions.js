"use strict";
/**
 * TDD Regression Suite — Đợt B (Subagent 2):
 * 1. Explicit CSS @layer Cascade Architecture & Specificity Hack Removal (#6)
 * 2. Seamless Masthead <-> Guide Sidebar Transition under Daylight Sky (#2)
 * 3. Dark-Mode Secondary Text & Metadata Readability over Bright Ambient Light (#3)
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

function listCssFiles(dirRel) {
  const full = path.join(root, dirRel);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full)
    .filter((f) => f.endsWith(".css"))
    .sort()
    .map((f) => `${dirRel}/${f}`);
}

function splitTopLevelCommas(str) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      parts.push(str.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = str.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

/**
 * Parse a CSS source into style rules with active @layer / @media context
 * and top-level @layer order statements.
 */
function parseStylesheet(rawCss, fileIndex = 0) {
  const css = stripComments(rawCss);
  const layerStatements = [];
  const rules = [];
  let ruleOrder = 0;

  function walk(segment, contextStack) {
    let i = 0;
    while (i < segment.length) {
      while (i < segment.length && /\s/.test(segment[i])) i++;
      if (i >= segment.length) break;

      let cursor = i;
      let parenDepth = 0;
      let inStr = null;
      while (cursor < segment.length) {
        const ch = segment[cursor];
        if (inStr) {
          if (ch === "\\") cursor++;
          else if (ch === inStr) inStr = null;
        } else if (ch === '"' || ch === "'") {
          inStr = ch;
        } else if (ch === "(" || ch === "[") {
          parenDepth++;
        } else if (ch === ")" || ch === "]") {
          parenDepth = Math.max(0, parenDepth - 1);
        } else if (parenDepth === 0 && (ch === "{" || ch === ";")) {
          break;
        }
        cursor++;
      }
      if (cursor >= segment.length) break;

      const prelude = segment.slice(i, cursor).trim();
      const delimiter = segment[cursor];

      if (delimiter === ";") {
        if (/^@layer\b/.test(prelude)) {
          const names = prelude
            .replace(/^@layer\s+/, "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          layerStatements.push(names);
        }
        i = cursor + 1;
        continue;
      }

      // Find matching '}'
      let depth = 1;
      let bodyEnd = cursor + 1;
      inStr = null;
      while (bodyEnd < segment.length && depth > 0) {
        const ch = segment[bodyEnd];
        if (inStr) {
          if (ch === "\\") bodyEnd++;
          else if (ch === inStr) inStr = null;
        } else if (ch === '"' || ch === "'") {
          inStr = ch;
        } else if (ch === "{") {
          depth++;
        } else if (ch === "}") {
          depth--;
        }
        bodyEnd++;
      }
      const body = segment.slice(cursor + 1, bodyEnd - 1);

      if (prelude.startsWith("@keyframes") || prelude.startsWith("@-webkit-keyframes")) {
        i = bodyEnd;
        continue;
      }

      if (prelude.startsWith("@")) {
        walk(body, [...contextStack, prelude]);
      } else if (prelude) {
        const activeLayer = contextStack
          .filter((c) => /^@layer\s+/.test(c))
          .map((c) => c.replace(/^@layer\s+/, "").trim())
          .join(".");
        const activeMedia = contextStack.filter((c) => /^@(?:media|supports)\b/.test(c));
        const declarations = [];
        for (const rawDecl of body.split(";")) {
          const decl = rawDecl.trim();
          if (!decl) continue;
          const colon = decl.indexOf(":");
          if (colon < 0) continue;
          const prop = decl.slice(0, colon).trim();
          const rawVal = decl.slice(colon + 1).trim();
          const important = /!important\s*$/i.test(rawVal);
          const value = rawVal.replace(/\s*!important\s*$/i, "").trim();
          declarations.push({ prop, value, important });
        }
        rules.push({
          selectors: splitTopLevelCommas(prelude),
          rawPrelude: prelude,
          layer: activeLayer || null,
          media: activeMedia,
          declarations,
          fileIndex,
          order: ruleOrder++
        });
      }
      i = bodyEnd;
    }
  }

  walk(css, []);
  return { layerStatements, rules };
}

/**
 * Compute W3C Selectors Level 4 specificity [ids, classesAttrsPseudos, typesPseudoElements]
 * for a single selector (handling :where() = 0 and :is()/:not()/:has() = max branch).
 */
function computeSpecificity(selector) {
  let s = selector.trim();
  let ids = 0;
  let classes = 0;
  let types = 0;

  // Replace :where(...) with empty specificity
  const stripZeroFn = (input, fnName) => {
    let out = "";
    let idx = 0;
    while (idx < input.length) {
      const hit = input.indexOf(fnName + "(", idx);
      if (hit < 0) {
        out += input.slice(idx);
        break;
      }
      out += input.slice(idx, hit);
      let d = 1;
      let p = hit + fnName.length + 1;
      while (p < input.length && d > 0) {
        if (input[p] === "(") d++;
        else if (input[p] === ")") d--;
        p++;
      }
      idx = p;
    }
    return out;
  };

  s = stripZeroFn(s, ":where");

  // Handle :is(...), :not(...), :has(...) by replacing with max-specificity argument
  const maxFnRe = /:(?:is|not|has)\(/;
  while (maxFnRe.test(s)) {
    const match = maxFnRe.exec(s);
    const start = match.index;
    const argStart = start + match[0].length;
    let d = 1;
    let p = argStart;
    while (p < s.length && d > 0) {
      if (s[p] === "(") d++;
      else if (s[p] === ")") d--;
      p++;
    }
    const inner = s.slice(argStart, p - 1);
    const branches = splitTopLevelCommas(inner).map(computeSpecificity);
    let best = [0, 0, 0];
    for (const b of branches) {
      if (b[0] !== best[0] ? b[0] > best[0] : b[1] !== best[1] ? b[1] > best[1] : b[2] > best[2]) {
        best = b;
      }
    }
    ids += best[0];
    classes += best[1];
    types += best[2];
    s = s.slice(0, start) + " " + s.slice(p);
  }

  // Attribute selectors [...] -> 1 class each
  s = s.replace(/\[[^\]]*\]/g, () => {
    classes++;
    return " ";
  });

  // Pseudo-elements ::before, ::after, ::placeholder (and legacy :before) -> 1 type each
  s = s.replace(/::[A-Za-z-]+|:(?:before|after)\b/g, () => {
    types++;
    return " ";
  });

  // Pseudo-classes :hover, :focus-within, :focus-visible, :active, :root, :fullscreen -> 1 class each
  s = s.replace(/:[A-Za-z-]+(?:\([^)]*\))?/g, () => {
    classes++;
    return " ";
  });

  // IDs #foo
  s = s.replace(/#[A-Za-z0-9_-]+/g, () => {
    ids++;
    return " ";
  });

  // Classes .foo
  s = s.replace(/\.[A-Za-z0-9_-]+/g, () => {
    classes++;
    return " ";
  });

  // Combinators and universal selector
  s = s.replace(/[>+~*]/g, " ");

  // Remaining type selectors
  for (const token of s.split(/\s+/).filter(Boolean)) {
    if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(token)) types++;
  }

  return [ids, classes, types];
}

/**
 * W3C CSS Cascade Level 5 comparator for two competing author declarations
 * on the same element:
 * - Normal:    unlayered > later @layer > earlier @layer
 * - Important: earlier @layer !important > later @layer !important > unlayered !important
 * - Important always beats Normal.
 * Returns > 0 if `a` outranks `b`.
 */
function compareCascade(a, b, layerOrder) {
  if (a.important !== b.important) {
    return a.important ? 1 : -1;
  }

  const layerRank = (layer) => {
    if (!layer) return layerOrder.length; // unlayered
    const idx = layerOrder.indexOf(layer);
    assert.ok(idx >= 0, `Undeclared CSS @layer "${layer}"`);
    return idx;
  };

  const rankA = layerRank(a.layer);
  const rankB = layerRank(b.layer);
  if (rankA !== rankB) {
    // Normal: higher index (later layer, or unlayered = length) wins.
    // Important: lower index (earlier layer) wins, and any layer (< length) beats unlayered (= length)!
    return a.important ? rankB - rankA : rankA - rankB;
  }

  for (let k = 0; k < 3; k++) {
    if (a.specificity[k] !== b.specificity[k]) {
      return a.specificity[k] - b.specificity[k];
    }
  }

  if (a.fileIndex !== b.fileIndex) return a.fileIndex - b.fileIndex;
  return a.order - b.order;
}

/* ============================================================================
   1. CSS @layer Architecture & Specificity Hack Removal (#6)
   ============================================================================ */

const EXPECTED_LAYERS = [
  "ylg-a11y",
  "ylg-ceiling",
  "ylg-states",
  "ylg-components",
  "ylg-tokens"
];

test("glass-tokens.css establishes explicit deterministic @layer order and wraps base tokens in @layer ylg-tokens", () => {
  const parsed = parseStylesheet(read("src/glass/glass-tokens.css"), 0);
  assert.ok(
    parsed.layerStatements.length >= 1,
    "glass-tokens.css must declare the explicit @layer cascade order statement at the top"
  );
  assert.deepEqual(
    parsed.layerStatements[0],
    EXPECTED_LAYERS,
    "glass-tokens.css must declare @layer ylg-a11y, ylg-ceiling, ylg-states, ylg-components, ylg-tokens;"
  );
  assert.ok(parsed.rules.length >= 3, "glass-tokens.css must contain :root, light, and dark token rules");
  for (const rule of parsed.rules) {
    assert.equal(
      rule.layer,
      "ylg-tokens",
      `glass-tokens.css selector "${rule.rawPrelude}" must live inside @layer ylg-tokens`
    );
  }
});

test("@layer tiers protect YouTube normal-rule wins while strictly ordering !important overrides", () => {
  const layeredFiles = [
    ["src/glass/glass-fallback.css", ["ylg-a11y"]],
    ["src/styles/player-surface.css", ["ylg-a11y"]],
    ["src/styles/liquid-components.css", ["ylg-components", "ylg-states", "ylg-a11y"]],
    ["src/styles/interaction-performance.css", ["ylg-states", "ylg-a11y"]],
    ["src/styles/daylight-integration.css", ["ylg-a11y"]],
    ["src/styles/opacity-ceiling.css", ["ylg-ceiling", "ylg-a11y"]]
  ];

  for (const [rel, requiredLayers] of layeredFiles) {
    const parsed = parseStylesheet(read(rel));
    const usedLayers = new Set(parsed.rules.map((r) => r.layer).filter(Boolean));
    for (const req of requiredLayers) {
      assert.ok(usedLayers.has(req), `${rel} must use @layer ${req}`);
    }
    for (const rule of parsed.rules) {
      if (!rule.layer) continue;
      assert.ok(
        EXPECTED_LAYERS.includes(rule.layer),
        `${rel} uses undeclared @layer "${rule.layer}"`
      );
      if (rule.layer !== "ylg-tokens") {
        for (const decl of rule.declarations) {
          assert.equal(
            decl.important,
            true,
            `${rel} (${rule.rawPrelude}) inside @layer ${rule.layer} has non-!important "${decl.prop}: ${decl.value}" which YouTube's unlayered CSS could override`
          );
        }
      }
    }
  }
});

test("zero selectors across all src/**/*.css repeat any class or ID 3+ times, and player chrome repeats are gone", () => {
  const allCssFiles = [
    ...listCssFiles("src/glass"),
    ...listCssFiles("src/styles"),
    ...listCssFiles("src/ambient"),
    ...listCssFiles("src/popup")
  ];
  assert.ok(allCssFiles.length >= 27, "must scan all extension CSS files");

  const tripleRepeatRe = /([.#][A-Za-z0-9_-]+)\1\1/;
  for (const rel of allCssFiles) {
    const parsed = parseStylesheet(read(rel));
    for (const rule of parsed.rules) {
      for (const sel of rule.selectors) {
        assert.doesNotMatch(
          sel,
          tripleRepeatRe,
          `${rel} must not repeat any class or ID 3+ times: ${sel}`
        );
        assert.doesNotMatch(
          sel,
          /\.ytp-chrome-bottom\.ytp-chrome-bottom/,
          `${rel} must not repeat .ytp-chrome-bottom: ${sel}`
        );
      }
    }
  }
});

test("CSS Cascade Level 5 simulation confirms extension rules beat YouTube CSS and preserve internal tier precedence", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const cssOrder = manifest.content_scripts[0].css;
  const allRules = [];
  cssOrder.forEach((rel, idx) => {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) return;
    const parsed = parseStylesheet(fs.readFileSync(full, "utf8"), idx + 1);
    allRules.push(...parsed.rules);
  });

  const makeCandidate = (layer, selector, important, fileIndex, order, label) => ({
    layer,
    specificity: computeSpecificity(selector),
    important,
    fileIndex,
    order,
    label
  });

  const pickWinner = (candidates) =>
    candidates.reduce((best, cur) => (compareCascade(cur, best, EXPECTED_LAYERS) > 0 ? cur : best));

  // 1) Normal surface rule (unlayered) beats YouTube's unlayered Polymer rule, and glass-ramp overrides ylg-tokens
  {
    const ytPolymer = makeCandidate(null, "ytd-watch-metadata", false, 0, 1, "youtube-polymer");
    const extMaterial = makeCandidate(null, 'html[data-ylg-enabled="true"] .ylg-glass', false, 2, 1, "glass-material");
    assert.equal(pickWinner([ytPolymer, extMaterial]).label, "glass-material");

    const baseToken = makeCandidate("ylg-tokens", '[data-ylg-theme="dark"]', false, 1, 3, "glass-tokens");
    const rampToken = makeCandidate(null, '[data-ylg-theme="dark"]', false, 6, 1, "glass-ramp");
    assert.equal(pickWinner([baseToken, rampToken]).label, "glass-ramp");
  }

  // 2) player-surface.css 1x .ytp-chrome-bottom beats glass-player.css :where(:not(...)) normal rule
  {
    const glassPlayer = allRules.find(
      (r) =>
        r.fileIndex === cssOrder.indexOf("src/glass/glass-player.css") + 1 &&
        r.selectors.some((s) => s.includes(".ytp-left-controls > .ytp-button") && s.includes(".ytp-prev-button")) &&
        r.declarations.some((d) => d.prop === "background-color")
    );
    const playerSurface = allRules.find(
      (r) =>
        r.fileIndex === cssOrder.indexOf("src/styles/player-surface.css") + 1 &&
        r.selectors.some((s) => s.endsWith(".ytp-left-controls > .ytp-button")) &&
        r.declarations.some((d) => d.prop === "background-color")
    );
    assert.ok(glassPlayer && playerSurface, "both glass-player and player-surface left-button rules must exist");
    const gpSel = glassPlayer.selectors.find((s) => s.includes(".ytp-left-controls > .ytp-button"));
    const psSel = playerSurface.selectors.find((s) => s.endsWith(".ytp-left-controls > .ytp-button"));
    const gpCand = makeCandidate(glassPlayer.layer, gpSel, false, glassPlayer.fileIndex, glassPlayer.order, "glass-player");
    const psCand = makeCandidate(playerSurface.layer, psSel, false, playerSurface.fileIndex, playerSurface.order, "player-surface");
    assert.equal(pickWinner([gpCand, psCand]).label, "player-surface");
  }

  // 3) Full !important chain on .ytp-volume-area parsed directly from shipped CSS files:
  //    unlayered (YouTube/glass-player) < ylg-components (liquid-components) < ylg-states (interaction-performance) < ylg-a11y (forced-colors)
  {
    const ytImportant = makeCandidate(
      null,
      ".html5-video-player .ytp-chrome-bottom .ytp-volume-area:hover",
      true,
      99,
      99,
      "youtube-important"
    );
    const glassPlayerHoverRule = allRules.find(
      (r) =>
        r.fileIndex === cssOrder.indexOf("src/glass/glass-player.css") + 1 &&
        r.selectors.some((s) => s.includes(".ytp-volume-area:hover"))
    );
    const liquidCapsuleRule = allRules.find(
      (r) =>
        r.fileIndex === cssOrder.indexOf("src/styles/liquid-components.css") + 1 &&
        r.selectors.some((s) => s.endsWith(".ytp-volume-area")) &&
        r.declarations.some((d) => d.prop === "box-shadow")
    );
    const perfVolumeRule = allRules.find(
      (r) =>
        r.fileIndex === cssOrder.indexOf("src/styles/interaction-performance.css") + 1 &&
        !r.media.length &&
        r.selectors.some((s) => s.endsWith(".ytp-volume-area") && !s.includes("lowfx"))
    );
    const a11yForcedRule = allRules.find(
      (r) =>
        r.fileIndex === cssOrder.indexOf("src/styles/player-surface.css") + 1 &&
        r.media.some((m) => m.includes("forced-colors: active")) &&
        r.selectors.some((s) => s.endsWith(".ytp-volume-area"))
    );
    assert.ok(
      glassPlayerHoverRule && liquidCapsuleRule && perfVolumeRule && a11yForcedRule,
      "all four .ytp-volume-area rules must exist in shipped stylesheets"
    );

    const gpSel = glassPlayerHoverRule.selectors.find((s) => s.includes(".ytp-volume-area:hover"));
    const lcSel = liquidCapsuleRule.selectors.find((s) => s.endsWith(".ytp-volume-area"));
    const pfSel = perfVolumeRule.selectors.find((s) => s.endsWith(".ytp-volume-area"));
    const a11ySel = a11yForcedRule.selectors.find((s) => s.endsWith(".ytp-volume-area"));

    // Verify none of them rely on repeated .ytp-chrome-bottom specificity hacks
    for (const sel of [gpSel, lcSel, pfSel, a11ySel]) {
      assert.doesNotMatch(sel, /\.ytp-chrome-bottom\.ytp-chrome-bottom/, `must use clean single .ytp-chrome-bottom: ${sel}`);
    }

    const glassPlayerHover = makeCandidate(
      glassPlayerHoverRule.layer,
      gpSel,
      true,
      glassPlayerHoverRule.fileIndex,
      glassPlayerHoverRule.order,
      "glass-player-hover"
    );
    const liquidCapsuleRim = makeCandidate(
      liquidCapsuleRule.layer,
      lcSel,
      true,
      liquidCapsuleRule.fileIndex,
      liquidCapsuleRule.order,
      "liquid-components"
    );
    const perfTransition = makeCandidate(
      perfVolumeRule.layer,
      pfSel,
      true,
      perfVolumeRule.fileIndex,
      perfVolumeRule.order,
      "interaction-performance"
    );
    const a11yForcedColors = makeCandidate(
      a11yForcedRule.layer,
      a11ySel,
      true,
      a11yForcedRule.fileIndex,
      a11yForcedRule.order,
      "a11y-forced-colors"
    );

    assert.equal(pickWinner([ytImportant, glassPlayerHover, liquidCapsuleRim]).label, "liquid-components");
    assert.equal(pickWinner([ytImportant, liquidCapsuleRim, perfTransition]).label, "interaction-performance");
    assert.equal(
      pickWinner([ytImportant, liquidCapsuleRim, perfTransition, a11yForcedColors]).label,
      "a11y-forced-colors"
    );
  }

  // 4) Opacity ceiling vs states vs a11y parsed directly from shipped CSS files
  {
    const vendorAmbient = makeCandidate(
      null,
      "html[data-ambientlight-enabled][dark] #masthead-container #frosted-glass::before",
      true,
      99,
      50,
      "vendor-ambient"
    );
    const clearStateRule = allRules.find(
      (r) =>
        r.fileIndex === cssOrder.indexOf("src/styles/liquid-components.css") + 1 &&
        r.selectors.some((s) => s.includes('data-ylg-fill="none"') && s.includes("#guide-inner-content"))
    );
    const ceilingRule = allRules.find(
      (r) =>
        r.fileIndex === cssOrder.indexOf("src/styles/opacity-ceiling.css") + 1 &&
        !r.media.some((m) => m.includes("prefers-reduced-transparency")) &&
        r.selectors.some((s) => s.includes("data-ylg-opacity-solid") && s.includes("#frosted-glass::before") && !s.includes('data-ylg-fill="none"'))
    );
    const reducedTransRule = allRules.find(
      (r) =>
        r.fileIndex === cssOrder.indexOf("src/styles/opacity-ceiling.css") + 1 &&
        r.media.some((m) => m.includes("prefers-reduced-transparency")) &&
        r.selectors.some((s) => s.includes("#frosted-glass::before"))
    );
    assert.ok(clearStateRule && ceilingRule && reducedTransRule, "state, ceiling, and reduced-transparency rules must exist");

    const clearState = makeCandidate(
      clearStateRule.layer,
      clearStateRule.selectors[0],
      true,
      clearStateRule.fileIndex,
      clearStateRule.order,
      "ylg-states"
    );
    const ceilingScrim = makeCandidate(
      ceilingRule.layer,
      ceilingRule.selectors[0],
      true,
      ceilingRule.fileIndex,
      ceilingRule.order,
      "ylg-ceiling"
    );
    const reducedTransparency = makeCandidate(
      reducedTransRule.layer,
      reducedTransRule.selectors.find((s) => s.includes("#frosted-glass::before")),
      true,
      reducedTransRule.fileIndex,
      reducedTransRule.order,
      "ylg-a11y"
    );

    assert.equal(pickWinner([vendorAmbient, clearState]).label, "ylg-states");
    assert.equal(pickWinner([vendorAmbient, ceilingScrim]).label, "ylg-ceiling");
    assert.equal(pickWinner([vendorAmbient, clearState, ceilingScrim, reducedTransparency]).label, "ylg-a11y");
  }
});

/* ============================================================================
   2. Seamless Masthead <-> Guide Sidebar Transition under Daylight Sky (#2)
   ============================================================================ */

test("daylight-integration.css unifies masthead and open guide sidebar backdrop/scrim/edge continuity at y=56px", () => {
  const raw = read("src/styles/daylight-integration.css");
  const css = stripComments(raw);

  // Preserve ambient-transparency & settings-ramp invariants
  assert.doesNotMatch(raw, /background:\s*rgba\(/, "daylight-integration.css must not contain literal background: rgba(");
  assert.doesNotMatch(css, /--ylg-fill-strength/, "daylight-integration.css must not introduce --ylg-fill-strength");

  // Shared daylight chrome blur variable so masthead (#frosted-glass::before) and guide (#guide-inner-content) never blur differently
  assert.match(
    css,
    /--ylg-daylight-chrome-blur:\s*clamp\(12px,\s*var\(--ylg-blur,\s*40px\),\s*24px\)/,
    "daylight-integration.css must define shared --ylg-daylight-chrome-blur token"
  );

  // Intermediate guide drawer containers must be cleared so YouTube's opaque base background cannot block the sky behind #guide-inner-content
  for (const wrapper of ["tp-yt-app-drawer#guide", "#contentContainer", "#guide-wrapper", "#guide-content", "ytd-guide-renderer"]) {
    assert.ok(
      css.includes(wrapper),
      `daylight-integration.css must clear intermediate guide wrapper ${wrapper}`
    );
  }
  assert.match(
    css,
    /#guide-content[\s\S]*?background-color:\s*transparent\s*!important/,
    "daylight-integration.css must strip opaque background-color on #guide-content"
  );

  // Both #frosted-glass::before and #guide-inner-content.ylg-glass share var(--ylg-daylight-chrome-blur) and var(--ylg-chrome-scrim)
  assert.match(
    css,
    /#frosted-glass::before[\s\S]*?backdrop-filter:\s*blur\(var\(--ylg-daylight-chrome-blur\)\)\s*saturate\(1\)/,
    "#frosted-glass::before must use shared --ylg-daylight-chrome-blur"
  );
  assert.match(
    css,
    /#guide-inner-content[\s\S]*?background-color:\s*var\(--ylg-chrome-scrim\)\s*!important[\s\S]*?backdrop-filter:\s*blur\(var\(--ylg-daylight-chrome-blur\)\)\s*saturate\(1\)\s*!important/,
    "open guide sidebar must share --ylg-chrome-scrim and --ylg-daylight-chrome-blur with masthead"
  );

  // Seam elimination at y=56px when tp-yt-app-drawer#guide[opened] is docked below masthead
  assert.match(
    css,
    /:has\(tp-yt-app-drawer#guide\[opened\]\)\s*#frosted-glass\s*\{[^}]*border-bottom-left-radius:\s*0\s*!important/,
    "open guide drawer must square #frosted-glass bottom-left corner at y=56px"
  );
  assert.match(
    css,
    /:has\(tp-yt-app-drawer#guide\[opened\]\)\s*#frosted-glass\s*\{[^}]*box-shadow:\s*none\s*!important/,
    "open guide drawer must suppress #frosted-glass downward shadow band over the sidebar at y=56px"
  );
  assert.match(
    css,
    /:has\(tp-yt-app-drawer#guide\[opened\]\)\s*#frosted-glass::before\s*\{[^}]*clip-path:\s*inset\(0 round 0 0 10px 0\)/,
    "open guide drawer must square #frosted-glass::before bottom-left clip-path notch at y=56px"
  );
  assert.match(
    css,
    /:has\(tp-yt-app-drawer#guide\[opened\]\)\s*#frosted-glass::after\s*\{[^}]*mask-image:\s*linear-gradient\(90deg,\s*transparent\s+0\s+var\(--app-drawer-width,\s*240px\)/,
    "open guide drawer must mask out #frosted-glass::after horizontal bottom rim across the 240px sidebar joint"
  );
});

/* ============================================================================
   3. Dark-Mode Secondary Text & Metadata Readability over Bright Ambient (#3)
   ============================================================================ */

test("light-ambient.css elevates dark-mode watch secondary metadata & comment legibility over bright ambient light", () => {
  const raw = read("src/styles/light-ambient.css");
  const css = stripComments(raw);

  // Strict existing invariants
  assert.doesNotMatch(css, /background(?:-color)?\s*:/, "light-ambient.css must never set background or background-color");
  assert.doesNotMatch(css, /--yt-spec-text-primary:\s*#f8fafc\s*!important/, "light-ambient.css must not force --yt-spec-text-primary: #f8fafc !important");
  assert.doesNotMatch(css, /--ylg-fill-strength/, "light-ambient.css must not introduce --ylg-fill-strength");

  // Scope: html[dark] + enabled/active + data-ylg-ambient="on" + ytd-watch-flexy
  assert.match(
    css,
    /html\[dark\][^{]*\[data-ylg-ambient="on"\][^{]*ytd-watch-flexy/,
    "light-ambient.css must include dark-mode ambient readability rules scoped to ytd-watch-flexy"
  );
  assert.ok(
    css.includes('[data-ylg-enabled="true"]') && css.includes('[data-ylg-active="1"]'),
    "dark-mode ambient selector should support both runtime [data-ylg-enabled=\"true\"] and contract [data-ylg-active=\"1\"]"
  );
  assert.ok(
    css.includes(':not([data-ylg-opacity-pale="true"])'),
    "dark-mode ambient rules must yield cleanly when pale/white solid glass ink is active"
  );

  // Required watch surface coverage
  for (const surface of [
    "ytd-watch-metadata",
    "#above-the-fold",
    "#description-inner",
    "#secondary",
    "ytd-compact-video-renderer",
    "ytd-comments",
    "ytd-comment-view-model"
  ]) {
    assert.ok(
      css.includes(surface),
      `light-ambient.css dark-mode rules must cover watch surface ${surface}`
    );
  }

  // Elevated cool-white secondary/disabled tokens + protective dark text-shadow
  assert.match(css, /--ylg-text-secondary:\s*(?:rgba|color-mix)\(/, "must define high-legibility --ylg-text-secondary");
  assert.match(css, /--yt-spec-text-secondary:\s*var\(--ylg-text-secondary\)/, "must elevate --yt-spec-text-secondary");
  assert.match(css, /--yt-spec-text-disabled:\s*(?:rgba|color-mix)\(/, "must elevate --yt-spec-text-disabled");
  assert.match(
    css,
    /text-shadow:\s*0 1px 2px rgba\(0,\s*0,\s*0,\s*0\.55\)/,
    "must apply subtle protective dark text-shadow (0 1px 2px rgba(0, 0, 0, 0.55)) over bright video glow"
  );
});

let passed = 0;
for (const { name, fn } of cases) {
  try {
    fn();
    passed++;
    console.log("PASS " + name);
  } catch (error) {
    console.error("FAIL " + name + "\n" + error.stack);
  }
}
console.log(`\nCSS layers, daylight seam & dark-ambient contrast regressions: ${passed}/${cases.length} passed`);
if (passed !== cases.length) process.exitCode = 1;
