"use strict";
/**
 * Regression suite for GitHub Actions CI/CD & automated tag release workflows.
 * Validates YAML hygiene, least-privilege permissions, concurrency groups,
 * Node 22 check/package steps, artifact uploads, tag-to-manifest consistency,
 * and bundle-size / SHA-256 verification scripts in isolated fixtures.
 */
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const workflowsDir = path.join(root, ".github", "workflows");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}

function unquoteYamlScalar(raw) {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  const commentIdx = trimmed.indexOf(" #");
  return commentIdx >= 0 ? trimmed.slice(0, commentIdx).trim() : trimmed;
}

/**
 * Validates indentation/quote hygiene and parses GitHub Actions workflow YAML
 * into a structured AST sufficient for strict structural & security assertions.
 */
function lintAndParseWorkflowYaml(source, filename) {
  const normalized = source.replace(/\r\n/g, "\n");
  assert.ok(!normalized.includes("\r"), `${filename}: unexpected bare CR character`);
  const lines = normalized.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i];
    assert.ok(!line.includes("\t"), `${filename}:${lineNo}: tab characters are forbidden in YAML`);
  }

  function parseNode(startIdx, minIndent) {
    let idx = startIdx;
    while (idx < lines.length) {
      const trimmed = lines[idx].trim();
      if (trimmed === "" || trimmed.startsWith("#")) idx++;
      else break;
    }
    if (idx >= lines.length) return { value: null, nextIdx: idx };

    const firstIndent = lines[idx].match(/^ */)[0].length;
    if (firstIndent < minIndent) return { value: null, nextIdx: idx };
    assert.equal(firstIndent % 2, 0, `${filename}:${idx + 1}: expected 2-space multiple indentation`);

    if (lines[idx].slice(firstIndent).startsWith("- ") || lines[idx].slice(firstIndent) === "-") {
      return parseSequence(idx, firstIndent);
    }
    return parseMapping(idx, firstIndent);
  }

  function parseBlockScalar(startIdx, parentIndent) {
    const blockLines = [];
    let idx = startIdx;
    let blockIndent = null;
    while (idx < lines.length) {
      const rawLine = lines[idx];
      if (rawLine.trim() === "") {
        blockLines.push("");
        idx++;
        continue;
      }
      const indent = rawLine.match(/^ */)[0].length;
      if (indent <= parentIndent) break;
      if (blockIndent === null) blockIndent = indent;
      assert.ok(indent >= blockIndent, `${filename}:${idx + 1}: inconsistent block scalar indentation`);
      blockLines.push(rawLine.slice(blockIndent));
      idx++;
    }
    return { value: blockLines.join("\n").replace(/\n+$/, ""), nextIdx: idx };
  }

  function parseMapping(startIdx, mapIndent, initialObj = {}, startColumnOffset = 0) {
    const map = initialObj;
    const seenKeys = new Set(Object.keys(initialObj));
    let idx = startIdx;

    while (idx < lines.length) {
      const rawLine = lines[idx];
      const trimmed = rawLine.trim();
      if (trimmed === "" || trimmed.startsWith("#")) {
        idx++;
        continue;
      }
      const indent = startColumnOffset > 0 && idx === startIdx ? mapIndent : rawLine.match(/^ */)[0].length;
      if (indent < mapIndent) break;
      assert.equal(indent, mapIndent, `${filename}:${idx + 1}: unexpected mapping indentation (${indent} vs ${mapIndent})`);

      const content = startColumnOffset > 0 && idx === startIdx
        ? rawLine.slice(startColumnOffset)
        : rawLine.slice(mapIndent);
      if (content.startsWith("- ") || content === "-") break;

      const match = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(content);
      assert.ok(match, `${filename}:${idx + 1}: invalid mapping entry: ${content}`);
      const key = match[1];
      const rest = (match[2] || "").trim();
      assert.ok(!seenKeys.has(key), `${filename}:${idx + 1}: duplicate YAML key "${key}"`);
      seenKeys.add(key);

      if (rest === "|" || rest === "|-") {
        const block = parseBlockScalar(idx + 1, mapIndent);
        map[key] = block.value;
        idx = block.nextIdx;
      } else if (rest === "") {
        const child = parseNode(idx + 1, mapIndent + 2);
        map[key] = child.value;
        idx = child.nextIdx;
      } else {
        checkBalancedQuotes(rest, filename, idx + 1);
        map[key] = unquoteYamlScalar(rest);
        idx++;
      }
    }
    return { value: map, nextIdx: idx };
  }

  function parseSequence(startIdx, seqIndent) {
    const items = [];
    let idx = startIdx;

    while (idx < lines.length) {
      const rawLine = lines[idx];
      const trimmed = rawLine.trim();
      if (trimmed === "" || trimmed.startsWith("#")) {
        idx++;
        continue;
      }
      const indent = rawLine.match(/^ */)[0].length;
      if (indent < seqIndent) break;
      assert.equal(indent, seqIndent, `${filename}:${idx + 1}: unexpected sequence indentation`);

      const content = rawLine.slice(seqIndent);
      if (!content.startsWith("- ") && content !== "-") break;

      const afterDash = content.slice(1).trim();
      if (afterDash === "") {
        const child = parseNode(idx + 1, seqIndent + 2);
        items.push(child.value);
        idx = child.nextIdx;
      } else if (/^[A-Za-z0-9_-]+:(?:\s*.*)?$/.test(afterDash)) {
        const itemMap = parseMapping(idx, seqIndent + 2, {}, seqIndent + 2);
        items.push(itemMap.value);
        idx = itemMap.nextIdx;
      } else {
        checkBalancedQuotes(afterDash, filename, idx + 1);
        items.push(unquoteYamlScalar(afterDash));
        idx++;
      }
    }
    return { value: items, nextIdx: idx };
  }

  const parsed = parseMapping(0, 0);
  return parsed.value;
}

function checkBalancedQuotes(str, filename, lineNo) {
  if (str.startsWith('"')) {
    assert.ok(str.endsWith('"') && str.length >= 2, `${filename}:${lineNo}: unclosed double quote`);
  } else if (str.startsWith("'")) {
    assert.ok(str.endsWith("'") && str.length >= 2, `${filename}:${lineNo}: unclosed single quote`);
  }
}

function extractNodeHeredoc(runScript, stepLabel) {
  assert.equal(typeof runScript, "string", `${stepLabel}: missing run script`);
  const match = /node\s+-\s*<<'EOF'\n([\s\S]*?)\nEOF(?:\s*)$/.exec(runScript.trim());
  assert.ok(match, `${stepLabel}: expected clean "node - <<'EOF' ... EOF" heredoc`);
  const jsCode = match[1];
  new vm.Script(jsCode, { filename: `${stepLabel}.js` });
  return jsCode;
}

function runExtractedNodeScript(jsCode, cwd, envOverrides = {}) {
  const cleanEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("GITHUB_") && key !== "MAX_BUNDLE_BYTES" && key !== "RELEASE_DIR" && key !== "MANIFEST_PATH") {
      cleanEnv[key] = value;
    }
  }
  Object.assign(cleanEnv, envOverrides);
  return spawnSync(process.execPath, ["-"], {
    cwd,
    input: jsCode,
    env: cleanEnv,
    encoding: "utf8"
  });
}

function withTempFixture(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bvy-ci-workflow-"));
  try {
    return fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function makeDummyZipBuffer(totalBytes) {
  assert.ok(totalBytes >= 22, "ZIP buffer must be at least 22 bytes");
  const buf = Buffer.alloc(totalBytes, 0x61);
  buf.writeUInt32LE(0x04034b50, 0); // PK\x03\x04 local header signature
  buf.writeUInt32LE(0x06054b50, totalBytes - 22); // EOCD signature
  return buf;
}

function parseGithubOutput(outputPath) {
  if (!fs.existsSync(outputPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(outputPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const eq = line.indexOf("=");
    assert.ok(eq > 0, `Invalid GITHUB_OUTPUT line: ${line}`);
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

test("YAML validator rejects tab indentation and duplicate mapping keys", () => {
  assert.throws(
    () => lintAndParseWorkflowYaml("name: Bad\non:\n\tpush:\n", "synthetic-tab.yml"),
    /tab characters are forbidden/
  );
  assert.throws(
    () => lintAndParseWorkflowYaml("name: Bad\nname: Duplicate\n", "synthetic-dup.yml"),
    /duplicate YAML key "name"/
  );
});

test("all .github/workflows/*.yml files parse cleanly without legacy Python steps or script injection", () => {
  assert.ok(fs.existsSync(workflowsDir), ".github/workflows directory must exist");
  const files = fs.readdirSync(workflowsDir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml")).sort();
  assert.deepEqual(files, ["checks.yml", "release.yml"], "Expected checks.yml and release.yml workflows");

  for (const file of files) {
    const raw = fs.readFileSync(path.join(workflowsDir, file), "utf8");
    assert.ok(!raw.includes("check.py"), `${file} must not reference legacy scripts/check.py`);
    assert.ok(!raw.includes("package-release.py"), `${file} must not reference legacy scripts/package-release.py`);
    assert.ok(!raw.includes("setup-python"), `${file} must not install Python for Node-native build`);

    const doc = lintAndParseWorkflowYaml(raw, file);
    assert.equal(typeof doc.name, "string");
    assert.ok(doc.name.length > 0, `${file}: workflow name must be non-empty`);
    assert.ok(doc.on && typeof doc.on === "object", `${file}: missing on trigger block`);
    assert.deepEqual(doc.permissions, { contents: "read" }, `${file}: top-level permissions must be minimal contents: read`);
    assert.ok(doc.concurrency && typeof doc.concurrency === "object", `${file}: missing concurrency configuration`);
    assert.ok(doc.jobs && typeof doc.jobs === "object", `${file}: missing jobs block`);

    for (const [jobId, job] of Object.entries(doc.jobs)) {
      assert.equal(job["runs-on"], "ubuntu-latest", `${file}#${jobId}: expected ubuntu-latest runner`);
      assert.ok(Number(job["timeout-minutes"]) > 0 && Number(job["timeout-minutes"]) <= 15, `${file}#${jobId}: missing bounded timeout-minutes`);
      assert.ok(Array.isArray(job.steps) && job.steps.length > 0, `${file}#${jobId}: job must define steps`);
      for (const step of job.steps) {
        if (typeof step.run === "string") {
          assert.ok(
            !step.run.includes("${{"),
            `${file}#${jobId} step "${step.name || step.run}": do not interpolate \${{ }} directly inside run scripts`
          );
        }
      }
    }
  }
});

test("checks.yml configures triggers, PR concurrency cancellation, Node 22, checks, packaging, budget verify, and artifact upload", () => {
  const raw = fs.readFileSync(path.join(workflowsDir, "checks.yml"), "utf8");
  const doc = lintAndParseWorkflowYaml(raw, "checks.yml");

  // Triggers: push (main + v* tags), pull_request, workflow_dispatch
  assert.ok("push" in doc.on, "checks.yml must trigger on push");
  assert.ok("pull_request" in doc.on, "checks.yml must trigger on pull_request");
  assert.ok("workflow_dispatch" in doc.on, "checks.yml must support workflow_dispatch");
  assert.ok(
    Array.isArray(doc.on.push.branches) && doc.on.push.branches.includes("main"),
    "checks.yml push.branches must include main"
  );
  assert.ok(
    Array.isArray(doc.on.push.tags) && doc.on.push.tags.includes("v*"),
    "checks.yml push.tags must include v*"
  );

  // Concurrency cancels superseded PR runs cleanly
  assert.ok(doc.concurrency.group.includes("github.workflow"), "checks.yml concurrency group must include workflow");
  assert.ok(
    doc.concurrency.group.includes("pull_request") || doc.concurrency.group.includes("github.ref"),
    "checks.yml concurrency group must key by PR/ref"
  );
  assert.ok(
    doc.concurrency["cancel-in-progress"] === "true" || doc.concurrency["cancel-in-progress"].includes("pull_request"),
    "checks.yml must cancel superseded PR runs"
  );

  // Strictly read-only across every job in checks.yml (never write on PR checks)
  for (const [jobId, job] of Object.entries(doc.jobs)) {
    if (job.permissions) {
      assert.deepEqual(job.permissions, { contents: "read" }, `checks.yml#${jobId} must never elevate permissions`);
    }
  }

  const job = Object.values(doc.jobs)[0];
  const steps = job.steps;

  const checkoutIdx = steps.findIndex(s => s.uses === "actions/checkout@v4");
  const setupNodeIdx = steps.findIndex(s => s.uses === "actions/setup-node@v4");
  const checkIdx = steps.findIndex(s => s.run === "node scripts/check.js");
  const packageIdx = steps.findIndex(s => s.run === "node scripts/package-release.js");
  const verifyIdx = steps.findIndex(s => s.id === "verify-bundle");
  const uploadIdx = steps.findIndex(s => s.uses === "actions/upload-artifact@v4");

  assert.ok(checkoutIdx >= 0, "checks.yml must use actions/checkout@v4");
  assert.ok(setupNodeIdx > checkoutIdx, "checks.yml must set up Node after checkout");
  assert.equal(steps[setupNodeIdx].with["node-version"], "22", "checks.yml must use Node 22");
  assert.ok(checkIdx > setupNodeIdx, "checks.yml must run node scripts/check.js");
  assert.ok(packageIdx > checkIdx, "checks.yml must run node scripts/package-release.js after check.js");
  assert.ok(verifyIdx > packageIdx, "checks.yml must verify bundle after packaging");
  assert.equal(steps[verifyIdx].env.MAX_BUNDLE_BYTES, "600000", "checks.yml must enforce 600000-byte bundle budget");
  assert.ok(uploadIdx > verifyIdx, "checks.yml must upload artifacts after verification");

  const uploadWith = steps[uploadIdx].with;
  assert.equal(uploadWith["retention-days"], "14", "checks.yml artifact retention-days must be 14");
  assert.equal(uploadWith["if-no-files-found"], "error", "checks.yml upload-artifact must fail if files are missing");
  assert.ok(uploadWith.path.includes("dist/releases/") && uploadWith.path.includes(".zip"), "upload path must include .zip");
  assert.ok(uploadWith.path.includes(".sha256"), "upload path must include .sha256");
});

test("bundle verification script enforces .zip/.sha256 existence, SHA-256 match, and < 600 KB budget guard", () => {
  const checksDoc = lintAndParseWorkflowYaml(fs.readFileSync(path.join(workflowsDir, "checks.yml"), "utf8"), "checks.yml");
  const checksJob = Object.values(checksDoc.jobs)[0];
  const verifyStep = checksJob.steps.find(s => s.id === "verify-bundle");
  const verifyScript = extractNodeHeredoc(verifyStep.run, "checks.yml#verify-bundle");

  // Also ensure release.yml uses the exact same bundle verification script
  const releaseDoc = lintAndParseWorkflowYaml(fs.readFileSync(path.join(workflowsDir, "release.yml"), "utf8"), "release.yml");
  const packageJob = releaseDoc.jobs["verify-and-package"] || releaseDoc.jobs.release;
  const releaseVerifyStep = packageJob.steps.find(s => s.id === "verify-bundle");
  const releaseVerifyScript = extractNodeHeredoc(releaseVerifyStep.run, "release.yml#verify-bundle");
  assert.equal(releaseVerifyScript, verifyScript, "checks.yml and release.yml should share identical verify-bundle logic");

  // 1. Valid bundle well below 600 KB budget passes and writes outputs
  withTempFixture(tmpDir => {
    const ver = "0.4.80";
    fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify({ version: ver }));
    const relDir = path.join(tmpDir, "dist", "releases");
    fs.mkdirSync(relDir, { recursive: true });
    const zipName = `Better-visual-Youtube-${ver}.zip`;
    const zipBytes = makeDummyZipBuffer(285000);
    const sha = crypto.createHash("sha256").update(zipBytes).digest("hex");
    fs.writeFileSync(path.join(relDir, zipName), zipBytes);
    fs.writeFileSync(path.join(relDir, `${zipName}.sha256`), `${sha}  ${zipName}\n`);
    const outFile = path.join(tmpDir, "github_output.txt");

    const res = runExtractedNodeScript(verifyScript, tmpDir, {
      MAX_BUNDLE_BYTES: "600000",
      GITHUB_OUTPUT: outFile
    });
    assert.equal(res.status, 0, `Expected valid bundle to pass, stderr: ${res.stderr}`);
    const outputs = parseGithubOutput(outFile);
    assert.equal(outputs.version, ver);
    assert.equal(outputs.bytes, "285000");
    assert.equal(outputs.sha256, sha);
  });

  // 2. Missing .zip fails fast
  withTempFixture(tmpDir => {
    fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify({ version: "0.4.80" }));
    fs.mkdirSync(path.join(tmpDir, "dist", "releases"), { recursive: true });
    const res = runExtractedNodeScript(verifyScript, tmpDir, { MAX_BUNDLE_BYTES: "600000" });
    assert.notEqual(res.status, 0, "Missing .zip must fail");
    assert.match(res.stderr + res.stdout, /Missing release archive/i);
  });

  // 3. Missing .zip.sha256 fails fast
  withTempFixture(tmpDir => {
    const ver = "0.4.80";
    fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify({ version: ver }));
    const relDir = path.join(tmpDir, "dist", "releases");
    fs.mkdirSync(relDir, { recursive: true });
    fs.writeFileSync(path.join(relDir, `Better-visual-Youtube-${ver}.zip`), makeDummyZipBuffer(1024));
    const res = runExtractedNodeScript(verifyScript, tmpDir, { MAX_BUNDLE_BYTES: "600000" });
    assert.notEqual(res.status, 0, "Missing .sha256 must fail");
    assert.match(res.stderr + res.stdout, /Missing SHA-256 checksum/i);
  });

  // 4. Corrupted SHA-256 digest, wrong recorded filename, or truncated non-ZIP archive fails fast
  withTempFixture(tmpDir => {
    const ver = "0.4.80";
    fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify({ version: ver }));
    const relDir = path.join(tmpDir, "dist", "releases");
    fs.mkdirSync(relDir, { recursive: true });
    const zipName = `Better-visual-Youtube-${ver}.zip`;
    const zipBytes = makeDummyZipBuffer(2048);
    const sha = crypto.createHash("sha256").update(zipBytes).digest("hex");
    fs.writeFileSync(path.join(relDir, zipName), zipBytes);

    fs.writeFileSync(path.join(relDir, `${zipName}.sha256`), `${"0".repeat(64)}  ${zipName}\n`);
    const badHashRes = runExtractedNodeScript(verifyScript, tmpDir, { MAX_BUNDLE_BYTES: "600000" });
    assert.notEqual(badHashRes.status, 0, "Mismatched SHA-256 must fail");
    assert.match(badHashRes.stderr + badHashRes.stdout, /SHA-256 mismatch/i);

    fs.writeFileSync(path.join(relDir, `${zipName}.sha256`), `${sha}  wrong-package.zip\n`);
    const badNameRes = runExtractedNodeScript(verifyScript, tmpDir, { MAX_BUNDLE_BYTES: "600000" });
    assert.notEqual(badNameRes.status, 0, "Wrong filename in .sha256 must fail");
    assert.match(badNameRes.stderr + badNameRes.stdout, /Checksum filename mismatch/i);

    fs.writeFileSync(path.join(relDir, zipName), Buffer.from("not-a-zip"));
    const badZipRes = runExtractedNodeScript(verifyScript, tmpDir, { MAX_BUNDLE_BYTES: "600000" });
    assert.notEqual(badZipRes.status, 0, "Invalid/truncated ZIP bytes must fail");
    assert.match(badZipRes.stderr + badZipRes.stdout, /Invalid or empty ZIP archive/i);
  });

  // 5. Bundle size >= 600,000 bytes (exact boundary & 750 KB bloat regression) fails fast
  for (const bloatedSize of [600000, 750000]) {
    withTempFixture(tmpDir => {
      const ver = "0.4.80";
      fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify({ version: ver }));
      const relDir = path.join(tmpDir, "dist", "releases");
      fs.mkdirSync(relDir, { recursive: true });
      const zipName = `Better-visual-Youtube-${ver}.zip`;
      const zipBytes = makeDummyZipBuffer(bloatedSize);
      const sha = crypto.createHash("sha256").update(zipBytes).digest("hex");
      fs.writeFileSync(path.join(relDir, zipName), zipBytes);
      fs.writeFileSync(path.join(relDir, `${zipName}.sha256`), `${sha}  ${zipName}\n`);

      const res = runExtractedNodeScript(verifyScript, tmpDir, { MAX_BUNDLE_BYTES: "600000" });
      assert.notEqual(res.status, 0, `Bloated ${bloatedSize}-byte ZIP must fail budget check`);
      assert.match(res.stderr + res.stdout, /Bundle size budget exceeded/i);
    });
  }
});

test("release.yml gates strictly on v* tags and scopes contents: write exclusively to the release publish job", () => {
  const raw = fs.readFileSync(path.join(workflowsDir, "release.yml"), "utf8");
  const doc = lintAndParseWorkflowYaml(raw, "release.yml");

  // Triggered strictly on push to v* tags (never pull_request)
  assert.deepEqual(Object.keys(doc.on), ["push"], "release.yml must trigger exclusively on push");
  assert.deepEqual(doc.on.push, { tags: ["v*"] }, "release.yml must filter strictly to tags: ['v*']");
  assert.equal(doc.concurrency["cancel-in-progress"], "false", "release.yml must not cancel in-progress releases");

  // Top-level permissions are read-only
  assert.deepEqual(doc.permissions, { contents: "read" });

  // Verify job split & least-privilege scoping
  const jobEntries = Object.entries(doc.jobs);
  const writeJobs = jobEntries.filter(([, job]) => job.permissions && job.permissions.contents === "write");
  assert.equal(writeJobs.length, 1, "Exactly one release job may hold contents: write");
  const [releaseJobId, releaseJob] = writeJobs[0];
  assert.equal(releaseJobId, "release");
  assert.deepEqual(releaseJob.permissions, { contents: "write" });
  assert.ok(
    typeof releaseJob.if === "string" && releaseJob.if.includes("startsWith(github.ref, 'refs/tags/v')"),
    "release job must guard with startsWith(github.ref, 'refs/tags/v')"
  );

  // Check build/verify steps run under read-only job before release job
  const verifyJob = doc.jobs["verify-and-package"];
  assert.ok(verifyJob, "release.yml must separate read-only verify-and-package job from write-scoped release job");
  assert.equal(verifyJob.permissions, undefined, "verify-and-package must inherit top-level contents: read");
  assert.equal(releaseJob.needs, "verify-and-package", "release job must depend on verify-and-package");

  const vSteps = verifyJob.steps;
  const tagIdx = vSteps.findIndex(s => s.id === "verify-tag");
  const checkIdx = vSteps.findIndex(s => s.run === "node scripts/check.js");
  const pkgIdx = vSteps.findIndex(s => s.run === "node scripts/package-release.js");
  const bundleIdx = vSteps.findIndex(s => s.id === "verify-bundle");
  const uploadIdx = vSteps.findIndex(s => s.uses === "actions/upload-artifact@v4");

  assert.ok(tagIdx >= 0, "verify-and-package must run verify-tag step");
  assert.ok(checkIdx > tagIdx, "verify-tag must fail fast before running full check suite");
  assert.ok(pkgIdx > checkIdx, "package-release.js must run after check.js");
  assert.ok(bundleIdx > pkgIdx, "verify-bundle must run after package-release.js");
  assert.ok(uploadIdx > bundleIdx, "upload-artifact must run after verify-bundle");

  // Release job downloads verified artifacts and publishes via softprops/action-gh-release@v2
  const rSteps = releaseJob.steps;
  const downloadStep = rSteps.find(s => s.uses === "actions/download-artifact@v4");
  const publishStep = rSteps.find(s => s.uses === "softprops/action-gh-release@v2");
  assert.ok(downloadStep, "release job must download verified package artifact");
  assert.equal(downloadStep.with.path, "dist/releases");
  assert.ok(publishStep, "release job must publish with softprops/action-gh-release@v2");
  assert.equal(publishStep.with.generate_release_notes, "true");
  assert.equal(publishStep.with.fail_on_unmatched_files, "true");
  assert.ok(publishStep.with.files.includes("zip_file") && publishStep.with.files.includes("sha256_file"));
});

test("tag-to-manifest consistency script passes on matching v* tag and fails fast with clear error on mismatch", () => {
  const releaseDoc = lintAndParseWorkflowYaml(fs.readFileSync(path.join(workflowsDir, "release.yml"), "utf8"), "release.yml");
  const verifyJob = releaseDoc.jobs["verify-and-package"] || releaseDoc.jobs.release;
  const tagStep = verifyJob.steps.find(s => s.id === "verify-tag");
  const tagScript = extractNodeHeredoc(tagStep.run, "release.yml#verify-tag");

  // 1. Matching current repository manifest.json version succeeds
  withTempFixture(tmpDir => {
    fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify({ version: manifest.version }));
    const outFile = path.join(tmpDir, "github_output.txt");
    const res = runExtractedNodeScript(tagScript, tmpDir, {
      GITHUB_REF: `refs/tags/v${manifest.version}`,
      GITHUB_REF_NAME: `v${manifest.version}`,
      GITHUB_OUTPUT: outFile
    });
    assert.equal(res.status, 0, `Matching tag v${manifest.version} must succeed: ${res.stderr}`);
    const outputs = parseGithubOutput(outFile);
    assert.equal(outputs.tag, `v${manifest.version}`);
    assert.equal(outputs.version, manifest.version);
    assert.equal(outputs.zip_file, `dist/releases/Better-visual-Youtube-${manifest.version}.zip`);
    assert.equal(outputs.sha256_file, `dist/releases/Better-visual-Youtube-${manifest.version}.zip.sha256`);
  });

  // 2. Mismatched tag version (e.g. v0.4.81 vs manifest 0.4.80) fails fast with actionable message
  withTempFixture(tmpDir => {
    fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify({ version: "0.4.80" }));
    const res = runExtractedNodeScript(tagScript, tmpDir, {
      GITHUB_REF: "refs/tags/v0.4.81",
      GITHUB_REF_NAME: "v0.4.81"
    });
    assert.notEqual(res.status, 0, "Mismatched tag version must fail");
    const combined = res.stderr + res.stdout;
    assert.match(combined, /v0\.4\.81/);
    assert.match(combined, /0\.4\.80/);
    assert.match(combined, /mismatch/i);
  });

  // 3. Invalid tag format (missing leading 'v', prerelease suffix, or branch ref) fails fast
  for (const badRef of ["refs/heads/main", "refs/tags/0.4.80", "refs/tags/v0.4.80-rc1", ""]) {
    withTempFixture(tmpDir => {
      fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify({ version: "0.4.80" }));
      const res = runExtractedNodeScript(tagScript, tmpDir, {
        GITHUB_REF: badRef
      });
      assert.notEqual(res.status, 0, `Invalid ref "${badRef}" must fail`);
    });
  }

  // 4. Conflicting GITHUB_REF and GITHUB_REF_NAME fails fast
  withTempFixture(tmpDir => {
    fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify({ version: "0.4.80" }));
    const res = runExtractedNodeScript(tagScript, tmpDir, {
      GITHUB_REF: "refs/tags/v0.4.80",
      GITHUB_REF_NAME: "v0.4.99"
    });
    assert.notEqual(res.status, 0, "Conflicting GITHUB_REF and GITHUB_REF_NAME must fail");
  });
});

let passed = 0;
(async () => {
  for (const { name, fn } of cases) {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  }
  console.log(`${passed} CI/release workflow regression groups passed.`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
