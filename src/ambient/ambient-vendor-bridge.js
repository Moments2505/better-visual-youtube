/**
 * Isolated-world adapter for the bundled upstream engine. Storage is a startup
 * contract, NOT evidence that a renderer loaded or applied a setting. The vendor
 * loader calls waitUntilEnabled() before loading assets, and calls attach(engine)
 * after construction. Neither hook crosses into the page world.
 */
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  if (root.YLG_AMBIENT_VENDOR) return;

  var engine = null;
  var latest = null;
  var mode = "normal";
  var revision = 0;
  var state = "pending";
  var lastError = null;
  var listeners = [];
  var enabledWaiters = [];
  var queue = Promise.resolve();
  var migration = null;
  var motionQuery = root.matchMedia ? root.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var colorsQuery = root.matchMedia ? root.matchMedia("(forced-colors: active)") : null;
  // P2 seeded this exact group without provenance. Never reset partial/custom
  // groups. A user explicitly choosing the entire same group is indistinguishable;
  // the one-shot marker prevents a later identical user choice being reset again.
  var visualMigrationKey = "ylg-ambient-visual-baseline-v1";
  var p2VisualDefaults = {
    "setting-headerShadowSize": 0,
    "setting-headerFillOpacity": 100,
    "setting-headerImagesOpacity": 100,
    "setting-surroundingContentShadowSize": 0,
    "setting-surroundingContentFillOpacity": 100,
    "setting-surroundingContentImagesOpacity": 100,
    "setting-pageBackgroundGreyness": 0
  };
  // Match the bundled upstream defaults used before P0. Only missing values are
  // seeded, except for the complete P2 signature repaired once below.
  var visualDefaults = Object.assign({}, p2VisualDefaults, {
    "setting-surroundingContentShadowSize": 15,
    "setting-surroundingContentFillOpacity": 10
  });
  var keys = {
    enabled: "setting-enabled", quality: "setting-resolution",
    blur: "setting-blur2", brightness: "setting-brightness",
    saturation: "setting-saturation", fpsLimit: "setting-framerateLimit"
  };

  function number(value, min, max, fallback) {
    return typeof value === "number" && isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  }
  function clampSpread(value) { return Math.round(number(Number(value), 0, 200, 75)); }
  function ambientAllowed(settings) {
    // Motion effects controls UI movement, not video-driven ambient lighting.
    // Keep the system accessibility gates independent of that UI preference.
    return (settings && settings.respectReducedMotion === false || !(motionQuery && motionQuery.matches)) &&
      !(colorsQuery && colorsQuery.matches);
  }
  function resolution(quality) {
    if (quality === "eco") return 25;
    if (quality === "balanced") return 50;
    if (quality === "high") return 100;
    // Auto is a conservative hardware profile, not a second adaptive scheduler.
    var nav = root.navigator;
    var lowCores = !!(nav && typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4);
    var lowMem = !!(nav && typeof nav.deviceMemory === "number" && nav.deviceMemory > 0 && nav.deviceMemory <= 4);
    return (lowCores || lowMem) ? 25 : 50;
  }
  function wanted(settings, currentMode) {
    var amb = settings && settings.ambientLight;
    if (!settings || settings.enabled === false || !amb || amb.enabled === false || !ambientAllowed(settings)) return false;
    if (currentMode === "shorts" || currentMode === "miniplayer") return false;
    var modes = amb.modes || {};
    if (currentMode === "fullscreen") return modes.fullscreen === true;
    return modes[currentMode === "theater" ? "theater" : "normal"] !== false;
  }
  function toPatch(settings) {
    var amb = (settings && settings.ambientLight) || {};
    var modes = amb.modes || {};
    var views = modes.fullscreen ? (modes.normal === false ? (modes.theater === false ? 5 : 4) : 0)
      : (modes.normal === false ? 3 : (modes.theater === false ? 1 : 2));
    var patch = {};
    // Persist the master preference only. Per-tab layout state must not turn
    // ambient off in every other tab through a shared storage key.
    patch[keys.enabled] = !!(settings && settings.enabled !== false && settings.ambientLight && amb.enabled !== false);
    patch[keys.quality] = resolution(amb.quality);
    // blur2 is upstream's percentage-like reference-scale value, not pixels.
    // 1 unit produces 1.275 px at a 512px projector height. This is a reference
    // conversion; exact on-screen pixel parity varies with projector geometry.
    patch[keys.blur] = Math.round(number(amb.blur, 0, 140, 60) / 1.275 * 10) / 10;
    patch[keys.blur] = Math.min(100, patch[keys.blur]);
    patch[keys.brightness] = Math.round(number(amb.brightness, 0, 2, 1) * 100);
    patch[keys.saturation] = Math.round(number(amb.saturation, 0, 2, 1.1) * 100);
    patch[keys.fpsLimit] = Math.round(number(amb.fpsLimit, 1, 30, 12));
    patch["setting-spread"] = clampSpread(amb.spread);
    patch["setting-flickerReduction"] = Math.round(number(amb.flickerReduction, 0, 100, 0));
    var barOn = amb.detectBarSize === true;
    patch["setting-detectHorizontalBarSizeEnabled"] = barOn;
    patch["setting-detectVerticalBarSizeEnabled"] = barOn;
    var dir = (amb.directionMode === "sides" || amb.directionMode === "topArch") ? amb.directionMode : "full";
    patch["setting-directionTopEnabled"] = dir !== "sides";
    patch["setting-directionBottomEnabled"] = dir === "full";
    patch["setting-directionLeftEnabled"] = true;
    patch["setting-directionRightEnabled"] = true;
    var vShadow = Math.round(number(amb.videoShadow, 0, 100, 0));
    patch["setting-videoShadowSize"] = vShadow;
    patch["setting-videoShadowOpacity"] = vShadow > 0 ? 55 : 0;
    patch["setting-energySaver"] = amb.energySaver === true;
    patch["setting-vibrance"] = Math.round(number(amb.vibrance, 0, 2, 1) * 100);
    patch["setting-contrast"] = Math.round(number(amb.contrast, 0, 2, 1) * 100);
    patch["setting-enableInViews"] = views;
    patch["setting-enableInPictureInPicture"] = false;
    // One Appearance authority: upstream's default is forced Dark and otherwise
    // races YouTube's Light selection/reloads. YLG owns material theme only.
    patch["setting-theme"] = 0;
    return patch;
  }
  function readStorage(names) {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(names, function (values) {
          var error = chrome.runtime && chrome.runtime.lastError;
          resolve(error ? null : (values || {}));
        });
      } catch (error) { resolve(null); }
    });
  }
  function writeStorage(patch) {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.set(patch, function () {
          resolve(!(chrome.runtime && chrome.runtime.lastError));
        });
      } catch (error) { resolve(false); }
    });
  }
  function migrateLegacy() {
    if (migration) return migration;
    migration = new Promise(function (resolve) {
      try {
        chrome.storage.local.remove(["enabled", "setting-quality", "setting-fpsLimit", "setting-blur"], function () {
          var ok = !(chrome.runtime && chrome.runtime.lastError);
          resolve(ok);
        });
      } catch (error) { resolve(false); }
    }).then(function (ok) {
      // Clear after assignment, including synchronous API throws. Clearing in
      // the executor is overwritten by `migration = new Promise(...)`.
      if (!ok) migration = null;
      return ok;
    });
    return migration;
  }
  function publish(next) {
    state = next;
    try { document.documentElement.setAttribute("data-ylg-ambient-engine", next); } catch (error) {}
    listeners.slice().forEach(function (listener) { try { listener(next); } catch (error) {} });
  }

  async function applyLive(patch, settings) {
    var activeEngine = engine;
    if (!activeEngine || !activeEngine.settings || typeof activeEngine.settings.set !== "function") return false;
    var vendorSettings = activeEngine.settings;
    var changed = [];
    Object.keys(patch).forEach(function (key) {
      var name = key.slice(8); // setting-
      if (name === "enabled" || vendorSettings[name] === patch[key]) return;
      changed.push(name);
      // Do not re-save externally persisted values or dispatch page DOM events.
      vendorSettings.set(name, patch[key], true, true);
    });
    if (activeEngine.elem && activeEngine.elem.style.removeProperty) activeEngine.elem.style.removeProperty("opacity");
    if (changed.length) {
      activeEngine.sizesChanged = true;
      activeEngine.canvassesInvalidated = true;
      if (changed.indexOf("blur2") !== -1 || changed.indexOf("spread") !== -1) {
        var workaround = activeEngine.chromiumBugVideoJitterWorkaround;
        if (workaround && workaround.update) workaround.update();
      }
      if (changed.indexOf("flickerReduction") !== -1) {
        if (vendorSettings.updateBufferProjectorWebGLCtx) {
          await vendorSettings.updateBufferProjectorWebGLCtx();
        }
        activeEngine.buffersCleared = true;
      }
      if (changed.indexOf("detectHorizontalBarSizeEnabled") !== -1 || changed.indexOf("detectVerticalBarSizeEnabled") !== -1) {
        if (activeEngine.barDetection && activeEngine.barDetection.reset) {
          activeEngine.barDetection.reset();
        }
        activeEngine.buffersCleared = true;
      }
      if (changed.indexOf("vibrance") !== -1 && activeEngine.projector && activeEngine.projector.updateVibrance) {
        await activeEngine.projector.updateVibrance();
      }
      if (changed.indexOf("energySaver") !== -1) {
        if (vendorSettings.energySaver && activeEngine.calculateAverageVideoFramesDifference) {
          activeEngine.calculateAverageVideoFramesDifference();
        } else if (!vendorSettings.energySaver && activeEngine.resetAverageVideoFramesDifference) {
          activeEngine.resetAverageVideoFramesDifference();
        }
      }
      if (vendorSettings.updateVisibility) vendorSettings.updateVisibility();
      if ((changed.some(function (name) { return Object.prototype.hasOwnProperty.call(visualDefaults, "setting-" + name); }) ||
          changed.indexOf("videoShadowSize") !== -1 || changed.indexOf("videoShadowOpacity") !== -1) &&
          activeEngine.updateStyles) activeEngine.updateStyles();
    }
    var on = patch[keys.enabled];
    // toggleEnabled/disable bail out during pendingStart. Setting the flag first
    // prevents an in-flight start from considering the engine enabled; hide()
    // clears its surfaces without that early-return guard.
    if (!on) {
      vendorSettings.set("enabled", false, true, true);
      if (activeEngine.updateKeywordsToPreventTheaterScaling) activeEngine.updateKeywordsToPreventTheaterScaling();
      await activeEngine.hide();
    } else if (!vendorSettings.enabled || activeEngine.isHidden) {
      vendorSettings.set("enabled", true, true, true);
      await activeEngine.start();
    } else if (changed.length && !document.hidden && document.visibilityState !== "hidden") {
      // Paused videos may refresh once through the engine's own optional-frame
      // path. Hidden tabs never get a bridge-forced draw; upstream resumes them.
      await activeEngine.optionalFrame(true);
    }
    return engine === activeEngine && vendorSettings.enabled === on;
  }

  function reconcile(settings) {
    // Take an immutable snapshot: callers can reuse/mutate their settings object.
    latest = JSON.parse(JSON.stringify(settings || {}));
    var snapshot = latest;
    var request = ++revision;
    var patch = toPatch(snapshot);
    // Reserve ownership synchronously: native must never race an async import.
    publish("pending");
    queue = queue.catch(function () {}).then(async function () {
      if (request !== revision) return false;
      var stored = await readStorage(Object.keys(visualDefaults).concat([visualMigrationKey]));
      var storagePatch = Object.assign({}, patch);
      if (stored) {
        var repairP2 = stored[visualMigrationKey] === undefined &&
          Object.keys(p2VisualDefaults).every(function (key) { return stored[key] === p2VisualDefaults[key]; });
        Object.keys(visualDefaults).forEach(function (key) {
          // A complete old seed is repaired once; any nonmatching explicit group
          // survives, including zeros. Do not use a blanket CSS opacity override.
          patch[key] = repairP2 || stored[key] === undefined ? visualDefaults[key] : stored[key];
          if (stored[key] === undefined || patch[key] !== stored[key]) storagePatch[key] = patch[key];
        });
        if (stored[visualMigrationKey] === undefined) storagePatch[visualMigrationKey] = 1;
      }
      if (request !== revision) return false;
      if (!stored || !(await migrateLegacy()) || !(await writeStorage(storagePatch))) {
        if (request === revision) { lastError = "storage-write-failed"; publish("error"); }
        return false;
      }
      if (request !== revision) return false;
      if (snapshot.enabled !== false && snapshot.ambientLight && snapshot.ambientLight.enabled !== false) {
        enabledWaiters.splice(0).forEach(function (resolve) { resolve(); });
      }
      if (!engine) return false; // pending is deliberately NOT upstream-active
      try {
        var livePatch = Object.assign({}, patch);
        livePatch[keys.enabled] = wanted(snapshot, mode);
        var applied = await applyLive(livePatch, snapshot);
        if (request !== revision) return false;
        lastError = applied ? null : "vendor-not-applied";
        publish(applied ? (livePatch[keys.enabled] ? "upstream" : "off") : "error");
        return applied && livePatch[keys.enabled];
      } catch (error) {
        if (request === revision) { lastError = "vendor-apply-failed"; publish("error"); }
        return false;
      }
    });
    return queue;
  }
  function onMotionChange() { if (latest) reconcile(latest); }
  [motionQuery, colorsQuery].forEach(function (query) {
    if (query && query.addEventListener) query.addEventListener("change", onMotionChange);
  });
  function attach(instance) {
    engine = instance;
    return latest ? reconcile(latest) : Promise.resolve(false);
  }
  function refreshMode(nextMode) {
    nextMode = nextMode || "normal";
    if (nextMode === mode) return;
    mode = nextMode;
    if (latest) reconcile(latest);
  }
  function waitUntilEnabled() {
    return new Promise(function (resolve) {
      enabledWaiters.push(resolve);
      if (latest) { reconcile(latest); return; }
      var settings = root.YLG_SETTINGS;
      if (settings && settings.getStoredSettings) settings.getStoredSettings(reconcile);
    });
  }
  function onStateChanged(listener) {
    listeners.push(listener);
    return function () { listeners = listeners.filter(function (item) { return item !== listener; }); };
  }
  function repair() {
    // Spread compatibility repair retained for bootstrap. reconcile() removes
    // legacy keys before the loader is allowed to run its startup migrations.
    return readStorage(["setting-spread"]).then(function (values) {
      if (!values) return false;
      var value = values["setting-spread"];
      if (value == null || clampSpread(value) === value) return false;
      return writeStorage({ "setting-spread": clampSpread(value) });
    });
  }
  root.YLG_AMBIENT_VENDOR = {
    push: reconcile, reconcile: reconcile, attach: attach,
    waitUntilEnabled: waitUntilEnabled, refreshMode: refreshMode,
    onStateChanged: onStateChanged, upstreamActive: function () { return Promise.resolve(state === "upstream"); },
    // Pending/error reserve the engine slot too: the unconditional legacy loader
    // can still be running. Falling back would risk two renderers. Fail closed.
    ownsRenderer: function () { return true; },
    stats: function () { return { state: state, attached: !!engine, error: lastError, mode: mode }; },
    repair: repair, clampSpread: clampSpread, toPatch: toPatch, keys: keys
  };
})();
