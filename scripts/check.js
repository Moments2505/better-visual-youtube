"use strict";
/**
 * Node-native validation & test runner for Better visual Youtube.
 * Verifies manifest integrity, icon assets, JS syntax across src/ and vendor/,
 * absence of debug/telemetry artifacts, and executes every regression suite.
 */
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out.sort();
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3, "manifest_version must be 3");
assert.ok(manifest.description.length <= 132, "Manifest description exceeds 132 chars");
assert.ok(Number(manifest.minimum_chrome_version) >= 121, "minimum_chrome_version must be >= 121");
if (manifest.default_locale) {
  const defaultMsgPath = path.join(root, "_locales", manifest.default_locale, "messages.json");
  assert.ok(fs.existsSync(defaultMsgPath), `Missing default_locale catalog: ${defaultMsgPath}`);
  for (const localeEntry of fs.readdirSync(path.join(root, "_locales"), { withFileTypes: true })) {
    if (!localeEntry.isDirectory()) continue;
    const msgPath = path.join(root, "_locales", localeEntry.name, "messages.json");
    assert.ok(fs.existsSync(msgPath), `Missing messages.json for locale ${localeEntry.name}`);
    const parsed = JSON.parse(fs.readFileSync(msgPath, "utf8"));
    for (const [k, v] of Object.entries(parsed)) {
      assert.equal(typeof v?.message, "string", `Invalid locale message "${k}" in ${localeEntry.name}`);
    }
  }
}

const requiredPaths = [
  manifest.action.default_popup,
  ...Object.values(manifest.icons || {}),
  ...(manifest.background && manifest.background.service_worker ? [manifest.background.service_worker] : [])
];
for (const cs of manifest.content_scripts || []) {
  requiredPaths.push(...(cs.js || []), ...(cs.css || []));
}
for (const war of manifest.web_accessible_resources || []) {
  requiredPaths.push(...(war.resources || []));
}
const allRepoFiles = ["assets", "src", "vendor"]
  .flatMap(dir => walk(path.join(root, dir)))
  .map(full => path.relative(root, full).replace(/\\/g, "/"));

for (const rel of requiredPaths) {
  if (rel.includes("*")) {
    const re = new RegExp("^" + rel.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+") + "$");
    assert.ok(allRepoFiles.some(f => re.test(f)), `Manifest glob matches 0 files: ${rel}`);
  } else {
    assert.ok(fs.existsSync(path.join(root, rel)), `Manifest references missing file: ${rel}`);
  }
}

for (const folder of ["src", "vendor"]) {
  for (const full of walk(path.join(root, folder))) {
    const rel = path.relative(root, full).replace(/\\/g, "/");
    assert.ok(!rel.endsWith(".map") && !rel.endsWith(".log"), `Debug artifact in runtime tree: ${rel}`);
    if (full.endsWith(".js")) {
      const code = fs.readFileSync(full, "utf8");
      new vm.Script(code, { filename: rel });
      assert.ok(!code.includes("_sentryDebugIds"), `Unexpected _sentryDebugIds in ${rel}`);
      assert.ok(!code.includes("sourceMappingURL="), `Unexpected sourceMappingURL in ${rel}`);
    }
  }
}
console.log(`Manifest & syntax preflight OK (${requiredPaths.length} runtime references verified).`);

const testsDir = path.join(root, "tests");
const suites = [
  "run-tests.js",
  ...fs.readdirSync(testsDir).filter(name => name.endsWith("-regressions.js")).sort()
];

let failed = 0;
for (const suite of suites) {
  console.log(`\n== ${suite} ==`);
  const res = spawnSync(process.execPath, [path.join(testsDir, suite)], {
    cwd: root,
    stdio: "inherit"
  });
  if (res.status !== 0) {
    failed++;
    process.exitCode = 1;
    break;
  }
}

if (failed === 0) {
  console.log(`\nAll ${suites.length} suites passed.`);
}
