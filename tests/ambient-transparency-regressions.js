"use strict";
// Standalone Node/VM contract tests. No browser or runtime source edits.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const vendor = read("vendor/ambient/content-main.js");
const cases = [];
const test = (name, fn) => cases.push({ name, fn });

for (const file of ["vendor/ambient/content-main.js", "vendor/ambient/content.js"]) {
  test(file + " retains original surrounding defaults", () => {
    const source = read(file);
    for (const [name, value] of [["surroundingContentFillOpacity", 10], ["surroundingContentShadowSize", 15]]) {
      const setting = source.match(new RegExp("name: '" + name + "',[\\s\\S]*?default: ([0-9]+)"));
      assert.ok(setting, name + " setting exists");
      assert.equal(Number(setting[1]), value, name);
    }
  });
}

// Execute the actual updateStyles body-variable code, not a copied formula.
const start = vendor.indexOf("    updateStyles() {");
const end = vendor.indexOf("      if (this.mastheadElem)", start);
assert.ok(start >= 0 && end > start, "upstream updateStyles entry must be extractable");
const prefix = vendor.slice(start + "    updateStyles() {".length, end);
function bodyVariables(fillOpacity) {
  const properties = new Map([["--ytal-fill-opacity", "1"]]);
  const context = vm.createContext({ document: { body: {} },
    setStyleProperty(element, key, value) {
      if (value === "") properties.delete(key); else properties.set(key, String(value));
    }
  });
  const update = vm.runInContext("(function () {" + prefix + "})", context);
  update.call({ settings: { surroundingContentFillOpacity: fillOpacity, pageBackgroundGreyness: 0 }, updateFixedStyle() {} });
  return properties;
}
test("original fill default 10 clears the opaque body override for CSS fallback", () => {
  assert.equal(bodyVariables(10).has("--ytal-fill-opacity"), false);
});
test("P2 fill 100 actually produces opaque body override and is not a neutral default", () => {
  assert.equal(bodyVariables(100).get("--ytal-fill-opacity"), "1");
});
test("explicit fill choices keep upstream interpolation, including zero", () => {
  for (const [value, expected] of [[0, "0.5"], [-100, "0"], [37, "0.685"]]) {
    assert.equal(bodyVariables(value).get("--ytal-fill-opacity"), expected);
  }
});
test("upstream backdrop has no added local-mask or container-opacity CSS restriction", () => {
  const css = read("src/ambient/ambient.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /data-ylg-local-glow|--ylg-local-(?:intensity|left|right|top|bottom)/);
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/\.ambientlight(?:__container)?\b/.test(match[1])) continue;
    assert.doesNotMatch(match[2], /(?:^|;)\s*(?:opacity|(?:-webkit-)?mask(?:-[\w-]+)?)\s*:/, match[1]);
  }
});
test("bridge does not reintroduce local backdrop geometry or intensity writes", () => {
  const source = read("src/ambient/ambient-vendor-bridge.js");
  assert.doesNotMatch(source, /--ylg-local-|data-ylg-local-glow|getBoundingClientRect|ResizeObserver/);
  assert.doesNotMatch(source, /(?:setProperty\(\s*["']opacity|\.style\.opacity\s*=)/);
});
test("Motion effects cannot hide the ambient backdrop or disable its clear-mode envelope", () => {
  const css = read("src/ambient/ambient.css").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/data-ylg-motion/.test(match[1])) continue;
    assert.doesNotMatch(match[2], /display|visibility|opacity|mask/, "UI motion must not hide the backdrop");
  }
  const controller = read("src/ambient/ambient-controller.js");
  const resolve = controller.slice(controller.indexOf("  function envResolve()"), controller.indexOf("  function envNodesAlive()"));
  assert.doesNotMatch(resolve, /data-ylg-motion|\.motion\b/);
  assert.match(resolve, /amb\.enabled === false/, "Ambient Light's own gate remains");
});

let passed = 0;
for (const { name, fn } of cases) {
  try { fn(); passed++; console.log("PASS " + name); }
  catch (error) { console.error("FAIL " + name + "\n" + error.stack); }
}
console.log(`\nAmbient transparency regressions: ${passed}/${cases.length} passed`);
if (passed !== cases.length) process.exitCode = 1;
