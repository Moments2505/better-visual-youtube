/* Approved visual restore: exact original glass CSS, including the player.
 * Digests were captured from _scratch/p0-p1-p2-baseline-20261103/src/glass.
 * Keep this self-contained: the external checkpoint need not ship in a package.
 * These are source-contract checks, not a substitute for browser visual QA.
 */
"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const expected = {
  "glass-fallback.css": "EB7BBBB4C619575D30ABAC60D55F3D11441525F32FAD25B09079E9B1E0FA613E",
  "glass-lighting.css": "A8867B1BC4BC5DB863D09AB135F26DF9D5E0BDA17D05BDC894F613EC1EA9E6C6",
  "glass-material.css": "825E868140B17E926B19DB8931487093D62D8F4633D5C7F223DC8BBF827F044A",
  "glass-motion.css": "90BA8C9E260F53C733FE75D4E1B355BAA8EF876534F36FDCF1F26A3C23AFA785",
  "glass-optics.css": "8DBB9DA639E01B481BBDC67A8A5556777717F8DA0682D0CE7639BE16776D4801",
  "glass-player.css": "47F605AB314941EB4379C01238C61B8162DD17BC20FCF3EED6142D3D2A7E9EE8",
  "glass-refraction.css": "A95AEBC7EBA9ACBD72FE8DB05BD113EC6C80AA257B5BDABC3A18FFB3C9EF0D65",
  "glass-tokens.css": "FA1633E5EBFA954E83EDBE4452E2A01994EA624F6253A9E3E740775783378B0B"
};
const glassDir = path.join(__dirname, "..", "src", "glass");
// The eight original engine files must still match the checkpoint byte-for-byte.
// glass-clear.css (opt-in "completely clear" state) and glass-ramp.css (the
// perceptual opacity ramp that multiplies rim/sheen/scatter alphas by
// --ylg-fill-strength) are NEW ADDITIVE layers allowed to exist alongside them;
// neither may be folded into the originals.
const additive = ["glass-clear.css", "glass-ramp.css"];
assert.deepEqual(fs.readdirSync(glassDir).filter(name => name.endsWith(".css")).sort(),
  Object.keys(expected).concat(additive).sort(), "all original glass CSS files are accounted for");
let passed = 1;
for (const [name, digest] of Object.entries(expected)) {
  const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(glassDir, name))).digest("hex").toUpperCase();
  assert.equal(actual, digest, `${name} must exactly match the approved original visual checkpoint`);
  passed++;
}
console.log(`Visual restore checkpoint: ${passed} passed, 0 failed (8 exact CSS digests + file inventory).`);