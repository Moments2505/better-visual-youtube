"use strict";
/**
 * Build a clean, deterministic, whitelist-only MV3 release ZIP using Node built-ins.
 * Verifies every archived entry byte-for-byte via inflateRawSync before writing .sha256.
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
let outputDir = path.join(root, "dist", "releases");
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--output-dir" && args[i + 1]) {
    outputDir = path.resolve(args[++i]);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert.ok(manifest.description.length <= 132, "Manifest description exceeds 132 characters");
assert.deepEqual(manifest.permissions, ["storage"]);
assert.deepEqual(manifest.host_permissions, ["https://www.youtube.com/*"]);
assert.deepEqual(manifest.optional_host_permissions, [
  "https://api.open-meteo.com/*",
  "https://geocoding-api.open-meteo.com/*"
]);

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const files = [
  "manifest.json",
  "LICENSE",
  "THIRD-PARTY-NOTICES.md"
].map(rel => path.join(root, rel));

for (const folder of ["assets", "src", "vendor", "_locales"]) {
  files.push(...walkFiles(path.join(root, folder)));
}

const entries = files
  .map(full => ({
    full,
    name: path.relative(root, full).replace(/\\/g, "/")
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const nameSet = new Set(entries.map(e => e.name));
for (const name of nameSet) {
  for (const part of name.split("/")) {
    assert.ok(!part.startsWith("_") || part === "_locales", `Forbidden underscore path: ${name}`);
    assert.ok(!part.startsWith("."), `Hidden path in package: ${name}`);
  }
  assert.ok(!name.endsWith(".map") && !name.endsWith(".log"), `Unneeded debug artifact: ${name}`);
}

const required = [manifest.action.default_popup, ...Object.values(manifest.icons)];
if (manifest.background && manifest.background.service_worker) {
  required.push(manifest.background.service_worker);
}
for (const cs of manifest.content_scripts) {
  required.push(...(cs.js || []), ...(cs.css || []));
}
for (const war of manifest.web_accessible_resources || []) {
  required.push(...(war.resources || []));
}
for (const req of required) {
  if (req.includes("*")) {
    const re = new RegExp("^" + req.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+") + "$");
    assert.ok([...nameSet].some(f => re.test(f)), `Missing runtime glob match: ${req}`);
  } else {
    assert.ok(nameSet.has(req), `Missing runtime dependency: ${req}`);
  }
}
assert.ok(nameSet.has("vendor/ambient/LICENSE"), "Missing vendor/ambient/LICENSE");

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0x0000;
const DOS_DATE = 0x0021; // 1980-01-01 deterministic timestamp
const localChunks = [];
const centralChunks = [];
let offset = 0;

for (const entry of entries) {
  const raw = fs.readFileSync(entry.full);
  const deflated = zlib.deflateRawSync(raw, { level: 9 });
  const useDeflate = deflated.length < raw.length;
  const method = useDeflate ? 8 : 0;
  const payload = useDeflate ? deflated : raw;
  const sum = crc32(raw);
  const nameBuf = Buffer.from(entry.name, "utf8");

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
  localHeader.writeUInt16LE(method, 8);
  localHeader.writeUInt16LE(DOS_TIME, 10);
  localHeader.writeUInt16LE(DOS_DATE, 12);
  localHeader.writeUInt32LE(sum, 14);
  localHeader.writeUInt32LE(payload.length, 18);
  localHeader.writeUInt32LE(raw.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0x0800, 8);
  centralHeader.writeUInt16LE(method, 10);
  centralHeader.writeUInt16LE(DOS_TIME, 12);
  centralHeader.writeUInt16LE(DOS_DATE, 14);
  centralHeader.writeUInt32LE(sum, 16);
  centralHeader.writeUInt32LE(payload.length, 20);
  centralHeader.writeUInt32LE(raw.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(offset, 42);

  localChunks.push(localHeader, nameBuf, payload);
  centralChunks.push(centralHeader, nameBuf);
  offset += localHeader.length + nameBuf.length + payload.length;
}

const centralDir = Buffer.concat(centralChunks);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(entries.length, 8);
eocd.writeUInt16LE(entries.length, 10);
eocd.writeUInt32LE(centralDir.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

fs.mkdirSync(outputDir, { recursive: true });
const target = path.join(outputDir, `Better-visual-Youtube-${manifest.version}.zip`);
const zipBuffer = Buffer.concat([...localChunks, centralDir, eocd]);
fs.writeFileSync(target, zipBuffer);

// Verify archive round-trip byte-for-byte
const verifyBuf = fs.readFileSync(target);
const eocdOffset = verifyBuf.length - 22;
assert.equal(verifyBuf.readUInt32LE(eocdOffset), 0x06054b50);
const cdCount = verifyBuf.readUInt16LE(eocdOffset + 10);
assert.equal(cdCount, entries.length);
let cdPos = verifyBuf.readUInt32LE(eocdOffset + 16);
for (let i = 0; i < cdCount; i++) {
  assert.equal(verifyBuf.readUInt32LE(cdPos), 0x02014b50);
  const method = verifyBuf.readUInt16LE(cdPos + 10);
  const expectedCrc = verifyBuf.readUInt32LE(cdPos + 16);
  const compSize = verifyBuf.readUInt32LE(cdPos + 20);
  const nameLen = verifyBuf.readUInt16LE(cdPos + 28);
  const localOff = verifyBuf.readUInt32LE(cdPos + 42);
  const name = verifyBuf.subarray(cdPos + 46, cdPos + 46 + nameLen).toString("utf8");
  const localNameLen = verifyBuf.readUInt16LE(localOff + 26);
  const localExtraLen = verifyBuf.readUInt16LE(localOff + 28);
  const dataStart = localOff + 30 + localNameLen + localExtraLen;
  const compData = verifyBuf.subarray(dataStart, dataStart + compSize);
  const restored = method === 8 ? zlib.inflateRawSync(compData) : compData;
  assert.equal(crc32(restored), expectedCrc, `CRC mismatch on ${name}`);
  assert.equal(Buffer.compare(restored, fs.readFileSync(path.join(root, name))), 0, `Byte mismatch on ${name}`);
  cdPos += 46 + nameLen;
}

const checksum = crypto.createHash("sha256").update(verifyBuf).digest("hex");
fs.writeFileSync(target + ".sha256", `${checksum}  ${path.basename(target)}\n`, "utf8");
console.log(JSON.stringify({
  zip: target,
  bytes: verifyBuf.length,
  files: entries.length,
  sha256: checksum,
  descriptionLength: manifest.description.length
}, null, 2));
