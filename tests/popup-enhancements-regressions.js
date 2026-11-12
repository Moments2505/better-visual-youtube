"use strict";
/**
 * Popup UX Enhancements Regression Suite (Dot A - Subagent 1)
 * Covers:
 *   1. 1-Click Curated Style Profiles bar (Crystal Clear, Tahoe Frosted, Cinema Glow, Eco Minimal)
 *   2. Cross-device chrome.storage.sync mirror + JSON Export / Import
 *   3. Native bilingual localization (_locales/en & _locales/vi + safe fallback hydration)
 *
 * Run: node tests/popup-enhancements-regressions.js
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");

let passed = 0;
const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}

function clock() {
  let now = 0;
  let id = 0;
  const tasks = new Map();
  return {
    setTimeout(fn, ms) {
      tasks.set(++id, { at: now + (ms || 0), fn });
      return id;
    },
    clearTimeout(key) {
      tasks.delete(key);
    },
    tick(ms) {
      const until = now + ms;
      while (true) {
        const entry = [...tasks]
          .filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        now = entry[1].at;
        tasks.delete(entry[0]);
        entry[1].fn();
      }
      now = until;
    }
  };
}

// Minimal DOM parser that also captures initial textContent and supports createElement / appendChild
function buildPopupDom() {
  let doc;
  class Element {
    constructor(tag, attrs = {}, parent = null) {
      this.tagName = tag;
      this.attrs = { ...attrs };
      this.id = attrs.id || "";
      this.parent = parent;
      this.parentNode = parent;
      this.children = [];
      this.listeners = {};
      this.disabled = false;
      this.checked = false;
      this.textContent = "";
      this.files = null;
      this.download = "";
      this.href = "";
      this.clicked = 0;
      this.style = { setProperty() {}, removeProperty() {} };
      this._value = attrs.value || "";
      const classes = new Set((attrs.class || "").split(/\s+/).filter(Boolean));
      this.classList = {
        add: k => classes.add(k),
        remove: k => classes.delete(k),
        toggle(k, on) {
          if (on === undefined) {
            if (classes.has(k)) { classes.delete(k); return false; }
            classes.add(k);
            return true;
          }
          if (on) classes.add(k);
          else classes.delete(k);
          return !!on;
        },
        contains: k => classes.has(k)
      };
      if (parent) parent.children.push(this);
    }
    get value() { return this._value; }
    set value(v) { this._value = String(v); }
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parent = this;
      child.parentNode = this;
      this.children.push(child);
      return child;
    }
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
      child.parent = null;
      child.parentNode = null;
      return child;
    }
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    }
    replaceChildren(...nodes) {
      this.children = [];
      for (const n of nodes) this.appendChild(n);
    }
    getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === "id") this.id = String(v);
    }
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
        const bits = part.trim().split(/\s+/);
        const last = bits.pop();
        return el.matches(last) && (!bits.length || !!el.parent?.closest(bits.join(" ")));
      }));
    }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    closest(s) { return this.matches(s) ? this : this.parent?.closest(s) || null; }
    contains(el) { return el === this || this.children.some(c => c.contains(el)); }
    addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); }
    removeEventListener(k, fn) { this.listeners[k] = (this.listeners[k] || []).filter(f => f !== fn); }
    emit(type, extra = {}) {
      const e = {
        type,
        target: this,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        ...extra
      };
      for (let el = this; el; el = el.parent) {
        for (const fn of el.listeners[type] || []) fn.call(el, e);
      }
      return e;
    }
    click() {
      this.clicked++;
      if (!this.disabled) this.emit("click");
    }
    focus() { doc.activeElement = this; }
  }

  doc = new Element("document");
  const htmlSrc = source("src/popup/popup.html");
  const stack = [doc];
  const createdElements = [];
  let lastIndex = 0;
  const tagRe = /<!--[\s\S]*?-->|<\/?([a-z][\w-]*)([^>]*)>/gi;
  let match;
  while ((match = tagRe.exec(htmlSrc)) !== null) {
    const between = htmlSrc.slice(lastIndex, match.index);
    if (between && stack.length > 1) {
      const trimmed = between.replace(/\s+/g, " ").trim();
      if (trimmed) {
        const top = stack[stack.length - 1];
        top.textContent = top.textContent ? top.textContent + " " + trimmed : trimmed;
      }
    }
    lastIndex = tagRe.lastIndex;
    if (match[0].startsWith("<!--")) continue;
    const tag = match[1].toLowerCase();
    if (match[0][1] === "/") {
      if (stack[stack.length - 1].tagName === tag) stack.pop();
      continue;
    }
    const attrs = {};
    for (const a of match[2].matchAll(/([\w-]+)(?:\s*=\s*"([^"]*)")?/g)) {
      attrs[a[1]] = a[2] !== undefined ? a[2] : "";
    }
    const el = new Element(tag, attrs, stack[stack.length - 1]);
    if (!["input", "link", "meta", "br", "img", "hr"].includes(tag)) stack.push(el);
  }

  doc.createElement = tag => {
    const el = new Element(String(tag).toLowerCase());
    createdElements.push(el);
    return el;
  };
  doc.createdElements = createdElements;
  doc.getElementById = id => doc.querySelector("#" + id);
  doc.documentElement = doc.querySelector("html");
  doc.body = doc.querySelector("body");
  doc.readyState = "complete";
  return doc;
}

function loadSettingsContract(extraGlobals = {}) {
  const ctx = vm.createContext({
    console,
    Promise,
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
    isFinite,
    parseInt,
    parseFloat,
    setTimeout,
    clearTimeout,
    localStorage: { getItem() { return null; }, setItem() {} },
    addEventListener() {},
    removeEventListener() {},
    ...extraGlobals
  });
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInContext(source("src/shared/settings.js"), ctx, { filename: "src/shared/settings.js" });
  return { ctx, S: ctx.YLG_SETTINGS };
}

function createPopupHarness({ seed = {}, i18nCatalog = null, uiLang = "en", withBlob = true, syncStore = null } = {}) {
  const doc = buildPopupDom();
  const timer = clock();
  const localWrites = [];
  const syncWrites = [];
  const blobUrls = [];
  const revokedUrls = [];
  const storageListeners = [];
  const localData = seed === null ? {} : { ylgSettings: JSON.parse(JSON.stringify(seed)) };
  const syncData = syncStore ? JSON.parse(JSON.stringify(syncStore)) : {};

  class MockBlob {
    constructor(parts, opts = {}) {
      this.parts = parts;
      this.type = opts.type || "";
      this.textContent = parts.join("");
    }
    text() { return Promise.resolve(this.textContent); }
  }

  const chromeObj = {
    runtime: { getManifest: () => ({ version: "0.4.80" }) },
    storage: {
      local: {
        get(key, cb) {
          const out = { [key]: Object.hasOwn(localData, key) ? localData[key] : undefined };
          if (cb) cb(out);
          return Promise.resolve(out);
        },
        set(payload, cb) {
          Object.assign(localData, JSON.parse(JSON.stringify(payload)));
          localWrites.push(JSON.parse(JSON.stringify(payload)));
          if (cb) cb();
          return Promise.resolve();
        },
        remove(keys, cb) {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete localData[k];
          if (cb) cb();
        }
      },
      sync: {
        get(key, cb) {
          const out = { [key]: Object.hasOwn(syncData, key) ? syncData[key] : undefined };
          if (cb) cb(out);
          return Promise.resolve(out);
        },
        set(payload, cb) {
          Object.assign(syncData, JSON.parse(JSON.stringify(payload)));
          syncWrites.push(JSON.parse(JSON.stringify(payload)));
          if (cb) cb();
          return Promise.resolve();
        }
      },
      onChanged: {
        addListener(fn) { storageListeners.push(fn); },
        removeListener(fn) {
          const idx = storageListeners.indexOf(fn);
          if (idx >= 0) storageListeners.splice(idx, 1);
        }
      }
    }
  };

  if (i18nCatalog) {
    chromeObj.i18n = {
      getUILanguage: () => uiLang,
      getMessage(key) {
        return (i18nCatalog[key] && i18nCatalog[key].message) || "";
      }
    };
  }

  const ctx = vm.createContext({
    document: doc,
    console,
    Promise,
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
    encodeURIComponent,
    isFinite,
    parseInt,
    parseFloat,
    ...timer,
    navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
    addEventListener() {},
    removeEventListener() {},
    localStorage: { getItem() { return null; }, setItem() {} },
    chrome: chromeObj,
    ...(withBlob ? {
      Blob: MockBlob,
      URL: {
        createObjectURL(blob) {
          const url = "blob:ylg-test/" + (blobUrls.length + 1);
          blobUrls.push({ url, blob });
          return url;
        },
        revokeObjectURL(url) {
          revokedUrls.push(url);
        }
      }
    } : {})
  });
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInContext(source("src/shared/settings.js"), ctx, { filename: "src/shared/settings.js" });
  vm.runInContext(source("src/popup/sky-controls.js"), ctx, { filename: "src/popup/sky-controls.js" });
  vm.runInContext(source("src/popup/popup.js"), ctx, { filename: "src/popup/popup.js" });
  doc.emit("DOMContentLoaded");

  return {
    ctx,
    doc,
    timer,
    S: ctx.YLG_SETTINGS,
    $: id => doc.getElementById(id),
    localData,
    syncData,
    localWrites,
    syncWrites,
    blobUrls,
    revokedUrls,
    storageListeners,
    input(id, value) {
      const el = doc.getElementById(id);
      el.value = value;
      el.emit("input");
    },
    change(id, checked) {
      const el = doc.getElementById(id);
      el.checked = checked;
      el.emit("change");
    }
  };
}

/* ============================================================================
   1. QUICK STYLE PROFILES BAR
   ============================================================================ */
test("STYLE_PROFILES defines 4 curated schema-8 profiles and does not match DEFAULT_SETTINGS", () => {
  const { S } = loadSettingsContract();
  assert.ok(S.STYLE_PROFILES && typeof S.STYLE_PROFILES === "object", "STYLE_PROFILES must be exposed");
  assert.equal(typeof S.applyStyleProfile, "function", "applyStyleProfile must be exposed");
  assert.equal(typeof S.matchStyleProfile, "function", "matchStyleProfile must be exposed");

  const ids = Object.keys(S.STYLE_PROFILES);
  assert.deepEqual(ids, ["crystal", "frosted", "cinema", "eco"]);
  assert.equal(S.matchStyleProfile(S.normalizeSettings({})), null, "DEFAULT_SETTINGS must not pre-highlight a profile");

  for (const id of ids) {
    const applied = S.applyStyleProfile(S.DEFAULT_SETTINGS, id);
    assert.equal(applied.schemaVersion, 8);
    assert.equal(applied.enabled, true);
    assert.equal(S.matchStyleProfile(applied), id, `applied ${id} must match ONLY ${id}`);
  }

  // Verify signature characteristics of each curated profile
  const crystal = S.applyStyleProfile(S.DEFAULT_SETTINGS, "crystal");
  assert.equal(crystal.blur, 8);
  assert.equal(S.opacityToSlider(crystal.opacity), 18);
  assert.equal(crystal.radius, 18);
  assert.equal(crystal.tint, "auto");
  assert.equal(crystal.motion, true);
  assert.equal(crystal.ambientLight.enabled, true);

  const frosted = S.applyStyleProfile(S.DEFAULT_SETTINGS, "frosted");
  assert.equal(frosted.blur, 18);
  assert.equal(S.opacityToSlider(frosted.opacity), 52);
  assert.equal(frosted.radius, 20);
  assert.equal(frosted.tint, "auto");
  assert.equal(frosted.motion, true);
  assert.equal(frosted.ambientLight.enabled, true);

  const cinema = S.applyStyleProfile(S.DEFAULT_SETTINGS, "cinema");
  assert.equal(cinema.theme, "dark");
  assert.equal(cinema.blur, 14);
  assert.equal(S.opacityToSlider(cinema.opacity), 32);
  assert.equal(cinema.radius, 18);
  assert.equal(cinema.motion, true);
  assert.equal(cinema.ambientLight.enabled, true);

  const eco = S.applyStyleProfile({ ...S.DEFAULT_SETTINGS, daylightBackground: { ...S.DEFAULT_SETTINGS.daylightBackground, enabled: true } }, "eco");
  assert.equal(eco.blur, 8);
  assert.equal(S.opacityToSlider(eco.opacity), 40);
  assert.equal(eco.radius, 14);
  assert.equal(eco.refraction, 0);
  assert.equal(eco.motion, false);
  assert.equal(eco.hoverEffects, false);
  assert.equal(eco.optics.enabled, false);
  assert.equal(eco.ambientLight.enabled, false);
  assert.equal(eco.daylightBackground.enabled, false);
});

test("clicking Style Profile pills in popup updates controls, saves, sets active state, and clears on manual tweak", () => {
  const h = createPopupHarness({ seed: {} });
  const btnIds = [
    ["crystal", "ylg-profile-crystal"],
    ["frosted", "ylg-profile-frosted"],
    ["cinema", "ylg-profile-cinema"],
    ["eco", "ylg-profile-eco"]
  ];

  assert.ok(h.$("ylg-style-profiles"), "#ylg-style-profiles container must exist");
  for (const [, domId] of btnIds) {
    const btn = h.$(domId);
    assert.ok(btn, `#${domId} must exist`);
    assert.equal(btn.getAttribute("aria-pressed"), "false");
    assert.equal(btn.classList.contains("is-active"), false);
  }

  // Click each profile and verify active pill + UI controls + storage write + status
  for (const [profileKey, domId] of btnIds) {
    const beforeWrites = h.localWrites.length;
    h.$(domId).click();
    assert.equal(h.localWrites.length, beforeWrites + 1, `${profileKey} click must save immediately`);
    const saved = h.localWrites.at(-1).ylgSettings;
    assert.equal(h.S.matchStyleProfile(saved), profileKey);
    assert.ok(h.$("ylg-status").textContent.length > 0, "clicking profile must show status feedback");

    for (const [, otherId] of btnIds) {
      const active = otherId === domId;
      assert.equal(h.$(otherId).getAttribute("aria-pressed"), String(active), `${otherId} aria-pressed`);
      assert.equal(h.$(otherId).classList.contains("is-active"), active, `${otherId} .is-active`);
    }
    assert.equal(h.$("ylg-blur").value, String(saved.blur));
    assert.equal(h.$("ylg-opacity").value, String(h.S.opacityToSlider(saved.opacity)));
    assert.equal(h.$("ylg-radius").value, String(saved.radius));
  }

  // Currently on "eco": manually tweak blur from 8 -> 12 -> active highlight must clear immediately!
  h.input("ylg-blur", "12");
  h.$("ylg-blur").emit("change");
  for (const [, domId] of btnIds) {
    assert.equal(h.$(domId).getAttribute("aria-pressed"), "false", "manual slider tweak must clear aria-pressed");
    assert.equal(h.$(domId).classList.contains("is-active"), false, "manual slider tweak must clear .is-active");
  }

  // Master disable -> click Crystal Clear -> turns extension back on in 1 click!
  h.change("ylg-enabled", false);
  assert.equal(h.$("ylg-enabled").checked, false);
  h.$("ylg-profile-crystal").click();
  assert.equal(h.$("ylg-enabled").checked, true);
  assert.equal(h.$("ylg-profile-crystal").getAttribute("aria-pressed"), "true");
  assert.equal(h.$("ylg-blur").disabled, false);

  // Reset to Defaults clears active highlight
  h.$("ylg-reset").click();
  for (const [, domId] of btnIds) {
    assert.equal(h.$(domId).getAttribute("aria-pressed"), "false");
    assert.equal(h.$(domId).classList.contains("is-active"), false);
  }
});

test("popup.css keeps zero-horizontal-overflow layout rules for 380px popup width", () => {
  const css = source("src/popup/popup.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /--panel-w:\s*380px/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /\.ylg-profiles-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.ylg-footer\s*\{[^}]*flex-wrap:\s*wrap/);
});

/* ============================================================================
   2. CROSS-DEVICE chrome.storage.sync MIRROR + JSON EXPORT / IMPORT
   ============================================================================ */
test("loadSettings falls back to chrome.storage.sync when local is empty, hydrates local, and ignores sync errors", async () => {
  const { S } = loadSettingsContract();
  const hydrated = [];
  const chromeWithSync = {
    runtime: {},
    storage: {
      local: {
        get: (k, cb) => cb({}),
        set: (payload, cb) => { hydrated.push(payload); if (cb) cb(); }
      },
      sync: {
        get: (k, cb) => cb({ ylgSettings: { blur: 26, theme: "dark", tint: "white" } })
      }
    }
  };

  const loaded = await S.loadSettings(chromeWithSync);
  assert.equal(loaded.blur, 26);
  assert.equal(loaded.theme, "dark");
  assert.equal(loaded.tint, "white");
  assert.equal(hydrated.length, 1, "local store must be hydrated from sync fallback");
  assert.equal(hydrated[0].ylgSettings.blur, 26);

  // When local already has saved settings, local wins without needing sync
  const chromeLocalWins = {
    runtime: {},
    storage: {
      local: { get: (k, cb) => cb({ ylgSettings: { blur: 11 } }) },
      sync: { get: () => { throw new Error("sync must not be queried when local has data"); } }
    }
  };
  const fromLocal = await S.loadSettings(chromeLocalWins);
  assert.equal(fromLocal.blur, 11);

  // Sync error / rejection is silently ignored and falls back to DEFAULT_SETTINGS
  const chromeBrokenSync = {
    runtime: { lastError: { message: "Sync disabled" } },
    storage: {
      local: {
        get(k, cb) {
          const savedErr = chromeBrokenSync.runtime.lastError;
          delete chromeBrokenSync.runtime.lastError;
          cb({});
          chromeBrokenSync.runtime.lastError = savedErr;
        }
      },
      sync: {
        get: () => Promise.reject(new Error("QUOTA_EXCEEDED"))
      }
    }
  };
  const fallback = await S.loadSettings(chromeBrokenSync);
  assert.equal(fallback.blur, S.DEFAULT_SETTINGS.blur);
});

test("saveSettings mirrors to chrome.storage.sync best-effort and never fails when sync throws or rejects", async () => {
  const { S } = loadSettingsContract();
  const localSaves = [];
  const syncSaves = [];

  const chromeHealthy = {
    runtime: {},
    storage: {
      local: { set(p, cb) { localSaves.push(p); if (cb) cb(); } },
      sync: { set(p, cb) { syncSaves.push(p); if (cb) cb(); } }
    }
  };
  const saved = await S.saveSettings({ blur: 29, theme: "light" }, chromeHealthy);
  assert.equal(saved.blur, 29);
  assert.equal(localSaves.length, 1);
  assert.equal(syncSaves.length, 1);
  assert.deepEqual(syncSaves[0].ylgSettings, localSaves[0].ylgSettings);

  // Sync throwing synchronously or rejecting Promise must NEVER fail saveSettings
  let callbackResult = null;
  let callbackErr = "unset";
  const chromeQuotaSync = {
    runtime: {},
    storage: {
      local: { set(p, cb) { localSaves.push(p); if (cb) cb(); } },
      sync: { set() { return Promise.reject(new Error("QUOTA_BYTES_PER_ITEM quota exceeded")); } }
    }
  };
  const res2 = await S.saveSettings({ blur: 19 }, (res, err) => {
    callbackResult = res;
    callbackErr = err;
  }, chromeQuotaSync);
  assert.equal(res2.blur, 19);
  assert.equal(callbackResult.blur, 19);
  assert.equal(callbackErr, null);
});

test("subscribeSettings reacts to remote sync updates, hydrates local, and prevents echo loops", () => {
  const { S } = loadSettingsContract();
  const listeners = [];
  let localStore = { ylgSettings: S.normalizeSettings({ blur: 14 }) };
  let localSetCalls = 0;

  const chromeMock = {
    runtime: {},
    storage: {
      local: {
        get(k, cb) { cb({ [k]: localStore[k] }); },
        set(p, cb) {
          localSetCalls++;
          const prev = localStore.ylgSettings;
          localStore = { ...localStore, ...JSON.parse(JSON.stringify(p)) };
          // Simulate real Chrome firing onChanged("local") whenever local.set runs!
          for (const fn of listeners) {
            fn({ ylgSettings: { oldValue: prev, newValue: localStore.ylgSettings } }, "local");
          }
          if (cb) cb();
        }
      },
      sync: {
        set(p, cb) {
          // Simulate real Chrome firing onChanged("sync") whenever sync.set runs!
          for (const fn of listeners) {
            fn({ ylgSettings: { newValue: p.ylgSettings } }, "sync");
          }
          if (cb) cb();
        }
      },
      onChanged: {
        addListener(fn) { listeners.push(fn); },
        removeListener(fn) {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        }
      }
    }
  };

  const received = [];
  const unsub = S.subscribeSettings(s => received.push(s), chromeMock);

  // 1. Remote sync update arrives from another device -> hydrates local ONCE and fires callback ONCE
  for (const fn of listeners) {
    fn({ ylgSettings: { newValue: { blur: 33, theme: "dark" } } }, "sync");
  }
  assert.equal(localSetCalls, 1, "remote sync update must hydrate local exactly once");
  assert.equal(localStore.ylgSettings.blur, 33);
  assert.equal(received.length, 1, "remote sync update must not double-fire callback via local hydration echo");
  assert.equal(received[0].blur, 33);

  // 2. Duplicate sync event with identical settings -> 0 local writes, 0 callbacks
  for (const fn of listeners) {
    fn({ ylgSettings: { newValue: { blur: 33, theme: "dark" } } }, "sync");
  }
  assert.equal(localSetCalls, 1, "identical sync echo must not rewrite local");
  assert.equal(received.length, 1, "identical sync echo must not re-fire callback");

  // 3. Local saveSettings mirrors to sync -> local fires once, sync echo is ignored
  S.saveSettings({ blur: 22, theme: "light" }, chromeMock);
  assert.equal(localSetCalls, 2);
  assert.equal(received.length, 2, "own saveSettings mirror to sync must not trigger a second callback");
  assert.equal(received[1].blur, 22);

  unsub();
  assert.equal(listeners.length, 0);
});

test("exportSettingsPayload and parseImportedSettingsPayload round-trip and reject malformed inputs", () => {
  const { S } = loadSettingsContract();
  const plain = v => JSON.parse(JSON.stringify(v));
  const custom = S.normalizeSettings({ blur: 24, theme: "dark", tint: "custom", accent: "#a78bfa" });
  const json = S.exportSettingsPayload(custom);
  const parsedEnvelope = JSON.parse(json);

  assert.equal(parsedEnvelope.schema, "better-visual-youtube-settings");
  assert.equal(parsedEnvelope.version, 1);
  assert.deepEqual(parsedEnvelope.settings, plain(custom));
  assert.ok(json.includes("\n  "), "exported JSON must be pretty-printed with 2 spaces");

  // Wrapper format round-trips within the same VM realm
  assert.deepEqual(S.parseImportedSettingsPayload(json), custom);

  // Direct settings object format also works and sanitizes out-of-bounds fields
  const sanitized = S.parseImportedSettingsPayload(JSON.stringify({
    blur: 999,
    tint: "invalid-tint",
    accent: "javascript:evil()",
    ambientLight: { spread: 180, fpsLimit: 99 }
  }));
  assert.equal(sanitized.blur, 40);
  assert.equal(sanitized.tint, "auto");
  assert.equal(sanitized.accent, "#3ea6ff");
  assert.equal(sanitized.ambientLight.spread, 180);
  assert.equal(sanitized.ambientLight.fpsLimit, 30);

  // Malformed JSON, primitives, arrays, and invalid wrappers throw descriptive Errors
  for (const bad of [
    "",
    "   ",
    "{broken json",
    "null",
    "true",
    "42",
    '"string"',
    "[1, 2, 3]",
    '{"settings": null}',
    '{"settings": []}',
    '{"settings": "bad"}',
    null,
    undefined,
    123
  ]) {
    assert.throws(
      () => S.parseImportedSettingsPayload(bad),
      err => err instanceof Error && err.message.length > 5,
      "must reject malformed input: " + JSON.stringify(bad)
    );
  }
});

test("popup Export and Import buttons download JSON, import valid files, and reject invalid files", async () => {
  const h = createPopupHarness({ seed: { blur: 27, theme: "dark" } });

  // Export with Blob + URL.createObjectURL
  h.$("ylg-export").click();
  assert.equal(h.blobUrls.length, 1);
  const exportedObj = JSON.parse(h.blobUrls[0].blob.textContent);
  assert.equal(exportedObj.schema, "better-visual-youtube-settings");
  assert.equal(exportedObj.settings.blur, 27);
  const anchor = h.doc.createdElements.find(el => el.tagName === "a");
  assert.ok(anchor, "Export must create a download anchor");
  assert.equal(anchor.download, "better-visual-youtube-settings.json");
  assert.equal(anchor.clicked, 1);
  assert.equal(h.$("ylg-status").textContent, "Settings exported");
  h.timer.tick(10);
  assert.equal(h.revokedUrls.length, 1);

  // Export safe fallback without Blob/URL in minimal VMs
  const hNoBlob = createPopupHarness({ seed: { blur: 15 }, withBlob: false });
  hNoBlob.$("ylg-export").click();
  assert.equal(hNoBlob.$("ylg-status").textContent, "Settings exported");
  const fallbackAnchor = hNoBlob.doc.createdElements.find(el => el.tagName === "a");
  assert.ok(fallbackAnchor.href.startsWith("data:application/json"));

  // Import button opens hidden file input
  const fileInput = h.$("ylg-import-file");
  assert.ok(fileInput, "#ylg-import-file must exist");
  const clicksBefore = fileInput.clicked;
  h.$("ylg-import").click();
  assert.equal(fileInput.clicked, clicksBefore + 1);

  // Selecting a valid settings JSON file updates controls, saves, and shows "Settings imported"
  const importPayload = h.S.exportSettingsPayload({ blur: 31, theme: "light", radius: 22, tint: "white" });
  const writesBeforeImport = h.localWrites.length;
  fileInput.files = [{ name: "settings.json", text: () => Promise.resolve(importPayload) }];
  fileInput.emit("change");
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(h.localWrites.length, writesBeforeImport + 1);
  assert.equal(h.localWrites.at(-1).ylgSettings.blur, 31);
  assert.equal(h.localWrites.at(-1).ylgSettings.theme, "light");
  assert.equal(h.localWrites.at(-1).ylgSettings.tint, "white");
  assert.equal(h.$("ylg-blur").value, "31");
  assert.equal(h.$("ylg-radius").value, "22");
  assert.equal(h.$("ylg-status").textContent, "Settings imported");

  // Selecting an invalid file shows "Invalid settings file" and does NOT write or corrupt UI
  const writesBeforeBad = h.localWrites.length;
  fileInput.files = [{ name: "broken.json", text: () => Promise.resolve("{not-valid-json") }];
  fileInput.emit("change");
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(h.localWrites.length, writesBeforeBad, "invalid import must not write storage");
  assert.equal(h.$("ylg-blur").value, "31", "invalid import must keep previous UI state");
  assert.equal(h.$("ylg-status").textContent, "Invalid settings file");
});

/* ============================================================================
   3. BILINGUAL LOCALIZATION (_locales/en & _locales/vi + FALLBACK HYDRATION)
   ============================================================================ */
test("_locales/en/messages.json and _locales/vi/messages.json are valid, complete, and cover all data-i18n attributes", () => {
  const enPath = path.join(root, "_locales", "en", "messages.json");
  const viPath = path.join(root, "_locales", "vi", "messages.json");
  assert.ok(fs.existsSync(enPath), "_locales/en/messages.json must exist");
  assert.ok(fs.existsSync(viPath), "_locales/vi/messages.json must exist");

  const en = JSON.parse(fs.readFileSync(enPath, "utf8"));
  const vi = JSON.parse(fs.readFileSync(viPath, "utf8"));

  const enKeys = Object.keys(en).sort();
  const viKeys = Object.keys(vi).sort();
  assert.deepEqual(viKeys, enKeys, "en and vi catalogs must contain the exact same message keys");
  assert.ok(enKeys.includes("extName") && enKeys.includes("extDescription"), "must include extName and extDescription");
  assert.ok(enKeys.length >= 45, "catalogs must cover headings, controls, profiles, buttons, and statuses");

  for (const key of enKeys) {
    assert.ok(typeof en[key].message === "string" && en[key].message.trim().length > 0, `en.${key}.message must be non-empty`);
    assert.ok(typeof vi[key].message === "string" && vi[key].message.trim().length > 0, `vi.${key}.message must be non-empty`);
  }

  // Every data-i18n* attribute in popup.html must exist in both message catalogs
  const popupHtml = source("src/popup/popup.html");
  const referencedKeys = [...popupHtml.matchAll(/data-i18n(?:-(?:title|placeholder|aria-label))?="([^"]+)"/g)].map(m => m[1]);
  assert.ok(referencedKeys.length >= 35, "popup.html must annotate headings, labels, profiles, and buttons with data-i18n*");
  for (const key of referencedKeys) {
    assert.ok(Object.hasOwn(en, key), `popup.html references missing en i18n key: ${key}`);
    assert.ok(Object.hasOwn(vi, key), `popup.html references missing vi i18n key: ${key}`);
  }
});

test("Vietnamese locale hydrates popup DOM labels/attributes and translates runtime statuses without breaking child inputs", () => {
  const vi = JSON.parse(fs.readFileSync(path.join(root, "_locales", "vi", "messages.json"), "utf8"));
  const h = createPopupHarness({ seed: {}, i18nCatalog: vi, uiLang: "vi-VN" });

  assert.equal(h.doc.documentElement.getAttribute("lang"), "vi");
  assert.equal(h.$("ylg-theme-h").textContent, vi.themeHeading.message);
  assert.equal(h.$("ylg-adj-h").textContent, vi.adjustmentsHeading.message);
  assert.equal(h.$("ylg-profile-crystal").textContent, vi.profileCrystal.message);
  assert.equal(h.$("ylg-reset").textContent, vi.btnReset.message);
  assert.equal(h.$("ylg-export").textContent, vi.btnExport.message);
  assert.equal(h.$("ylg-import").textContent, vi.btnImport.message);
  assert.equal(h.$("ylg-sky-city").getAttribute("placeholder"), vi.cityPlaceholder.message);
  assert.equal(h.$("ylg-enabled").getAttribute("aria-label"), vi.enableExtension.message);

  // Child checkbox inputs inside <label> rows must still exist and remain interactive!
  assert.ok(h.$("ylg-motion"), "#ylg-motion input must not be wiped by label hydration");
  assert.ok(h.$("ylg-ambient-enabled"), "#ylg-ambient-enabled input must not be wiped by label hydration");

  // Runtime status messages use Vietnamese translations
  h.change("ylg-motion", false);
  assert.equal(h.$("ylg-status").textContent, vi.statusSaved.message);

  h.$("ylg-reset").click();
  assert.equal(h.$("ylg-status").textContent, vi.statusDefaultsRestored.message);

  h.$("ylg-export").click();
  assert.equal(h.$("ylg-status").textContent, vi.statusExported.message);

  // Sky controls status string also translates to Vietnamese
  assert.equal(h.$("ylg-sky-status").textContent, vi.skyWeatherOff.message);
});

(async () => {
  for (const { name, fn } of cases) {
    try {
      await fn();
      passed++;
      console.log(`PASS ${name}`);
    } catch (err) {
      console.error(`FAIL ${name}\n${err.stack}`);
      process.exitCode = 1;
    }
  }
  console.log(`\nPopup enhancements regressions: ${passed}/${cases.length} passed`);
})();
