/**
 * YouTube Liquid Glass - bootstrap (Lead-owned).
 * Orchestrates: settings -> document attrs -> glass engine -> ambient engine.
 * Glass and Ambient are toggled INDEPENDENTLY; master 'enabled' gates both.
 * Load order (manifest): settings -> glass-refraction -> ambient modules ->
 * selectors -> adapter -> nav -> bootstrap. Idempotent; safe at document_start.
 */
(function () {
  "use strict";
  var root = (typeof window !== "undefined") ? window : globalThis;
  if (root.__YLG_BOOTSTRAPPED__) return;
  root.__YLG_BOOTSTRAPPED__ = true;

  var S = root.YLG_SETTINGS;
  var R = root.YLG_REFRACTION;
  var AMB = root.YLG_AMBIENT;          // ambient lifecycle facade (A6)
  var ADAPTER = root.YLG_ADAPTER;
  var NAV = root.YLG_NAV;
  var doc = document;
  var de = doc.documentElement;

  /* Stamp the running build on the document.
     Diagnosing "the extension is updated but the page still looks wrong" wasted
     a full round: reloading an unpacked extension re-injects the content
     SCRIPTS, but a page that is already open keeps the CSS that was applied when
     it loaded, so a stale stylesheet can be live while storage already holds the
     new settings. With this attribute the two states are distinguishable in one
     look: data-ylg-build must equal the manifest version. */
  function stampBuild() {
    try {
      var v = root.chrome && root.chrome.runtime && root.chrome.runtime.getManifest
        ? root.chrome.runtime.getManifest().version : "";
      if (v) de.setAttribute("data-ylg-build", v);
    } catch (e) { /* diagnostics only: never break the page */ }
  }

  function detectLowFx() {
    try {
      var nav = root.navigator;
      var lowCores = !!(nav && typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4);
      var lowMem = !!(nav && typeof nav.deviceMemory === "number" && nav.deviceMemory > 0 && nav.deviceMemory <= 4);
      if (lowCores || lowMem) de.setAttribute("data-ylg-lowfx", "true");
      else de.removeAttribute("data-ylg-lowfx");
    } catch (e) { /* never break the page over heuristics */ }
  }

  var advancedOk = null;
  /* Advanced refraction (SVG displacement) is gated on the REFRACTION VALUE, not
     on the removed `renderMode` setting. Old behaviour: standard mode never set
     data-ylg-advanced-ok, so the Refraction slider was inert in the default
     configuration and the CSS fallback painted the same surface at every value.
     New rule, in every mode: enabled && refraction > 0 && the capability probe
     passes. At exactly 0 the attribute is removed and the filter defs are
     disposed, so "no refraction" is both visually and computationally free.
     The probe is still one-shot: it can only turn the path off, never retry. */
  function evaluateAdvancedMode(settings) {
    var refraction = (typeof settings.refraction === "number" && isFinite(settings.refraction))
      ? settings.refraction : 0;
    if (!settings.enabled || refraction <= 0 || de.getAttribute("data-ylg-lowfx") === "true") {
      de.removeAttribute("data-ylg-advanced-ok");
      if (R && R.dispose) R.dispose();
      return;
    }
    if (advancedOk === null) {
      try { advancedOk = !!(R && R.probeSupported && R.probeSupported()); }
      catch (e) { advancedOk = false; }
    }
    if (advancedOk) {
      de.setAttribute("data-ylg-advanced-ok", "1");
      try {
        if (R && R.ensureFilterDefs) R.ensureFilterDefs(doc);
        if (R && R.setIntensity) R.setIntensity(refraction);
      } catch (e) {
        de.removeAttribute("data-ylg-advanced-ok");
      }
    } else {
      de.removeAttribute("data-ylg-advanced-ok");
    }
  }

  /** Ambient engine: independent of glass styling, gated by master toggle. */
  function applyAmbient(s) {
    var want = !!(s.enabled && s.ambientLight && s.ambientLight.enabled);
    try {
      if (want && AMB && AMB.init) {
        AMB.init();
        if (AMB.updateSettings) AMB.updateSettings(s); // full snapshot (master + modes)
      } else if (AMB && AMB.teardown) {
        AMB.teardown();
      }
    } catch (e) { /* ambient must never break the page */ }
  }

  var lastApplied = null;
  var themeObserver = null;
  var tintListener = null;
  function syncThemeObserver(settings) {
    if (!settings.enabled || settings.theme !== "auto") {
      if (themeObserver) themeObserver.disconnect();
      themeObserver = null;
      return;
    }
    if (themeObserver || typeof MutationObserver !== "function") return;
    themeObserver = new MutationObserver(function () {
      if (lastApplied && lastApplied.enabled && lastApplied.theme === "auto") {
        S.applyThemeToDocument(doc, "auto");
      }
    });
    // Only YouTube's Appearance flag: do not observe extension attributes or subtree.
    themeObserver.observe(de, { attributes: true, attributeFilter: ["dark"] });
  }
  function applySettings(settings) {
    var s = S.normalizeSettings(settings);
    lastApplied = s;
    S.applySettingsToDocument(doc, s); // sets data-ylg-enabled + data-ylg-ambient + vars
    syncThemeObserver(s);
    detectLowFx();
    evaluateAdvancedMode(s);

    // Layer 6 optics (chromatic aberration + hover magnification). Additive:
    // if the filters cannot be built the surface keeps the five-layer look.
    try {
      var OPT = root.YLG_OPTICS;
      if (OPT) {
        var opt = s.optics || {};
        if (s.enabled !== false && opt.enabled !== false) {
          OPT.install({
            aberrationPx: (opt.aberration === false) ? 0 : opt.aberrationPx,
            magnifyScale: (s.motion === false || s.hoverEffects === false || opt.magnify === false) ? 0 : opt.magnifyScale,
            lensPx: opt.lensPx,
            lensAberration: opt.aberration === false ? 0 : opt.lensAberration * (opt.aberrationPx / 1.6)
          });
        } else {
          OPT.teardown();
        }
      }
    } catch (eOpt) {}

    // Ambient engine ownership: mirror our toggles into the bundled upstream
    // engine's option keys and publish which engine paints this page.
    try {
      var VB = root.YLG_AMBIENT_VENDOR;
      if (VB && VB.reconcile) {
        // Bridge serializes latest snapshots and migrates before vendor startup.
        // Call synchronously so disable takes ownership before native init.
        VB.reconcile(s).catch(function () {});
      }
    } catch (eVB) {}

    // Optional colour-follow mode & Ambient-Reactive Glass Rim (#3): sample the
    // playing video (or a thumbnail off the watch page when tint=media).
    try {
      var TINT = root.YLG_TINT;
      var syncAmbRim = !!(s.enabled !== false && s.ambientLight && s.ambientLight.enabled && s.ambientLight.glassSync);
      var wantTint = !!(s.enabled !== false && (s.tint === "media" || syncAmbRim));
      if (!syncAmbRim && S.setAmbientRim) S.setAmbientRim(doc, null);
      if (TINT) {
        if (wantTint) {
          TINT.init(s);
          var sampled = TINT.color && TINT.color();
          if (sampled) {
            if (s.tint === "media" && S.setMediaTint) S.setMediaTint(doc, sampled);
            if (syncAmbRim && S.setAmbientRim) S.setAmbientRim(doc, sampled);
          }
          if (!tintListener) {
            tintListener = function (e) {
              try {
                if (!e || !e.detail || !lastApplied) return;
                if (lastApplied.tint === "media" && S.setMediaTint) S.setMediaTint(doc, e.detail);
                if (lastApplied.ambientLight && lastApplied.ambientLight.enabled && lastApplied.ambientLight.glassSync && S.setAmbientRim) {
                  S.setAmbientRim(doc, e.detail);
                }
              } catch (e2) {}
            };
            root.addEventListener("ylg-tint", tintListener);
          }
        } else {
          TINT.teardown();
          if (tintListener) { root.removeEventListener("ylg-tint", tintListener); tintListener = null; }
        }
      }
    } catch (eTint) {}

    if (s.enabled) {
      try { ADAPTER && ADAPTER.init && ADAPTER.init(); } catch (e) {}
      try { NAV && NAV.init && NAV.init(); } catch (e) {}
      try {
        if (root.YLG_PLAYER_MOTION) root.YLG_PLAYER_MOTION[s.motion ? "init" : "teardown"]();
        if (root.YLG_MICRO) root.YLG_MICRO.init();
        if (root.YLG_DESCRIPTION_MOTION) root.YLG_DESCRIPTION_MOTION[s.motion ? "init" : "teardown"]();
        if (root.YLG_PANEL_HOVER) root.YLG_PANEL_HOVER[s.motion && s.hoverEffects && s.optics.enabled && s.optics.magnify ? "init" : "teardown"]();
      } catch (e) {}
      scheduleApply(0);
      if (doc.readyState === "loading") {
        doc.addEventListener("DOMContentLoaded", function onDCL() {
          doc.removeEventListener("DOMContentLoaded", onDCL);
          scheduleApply(0);
        });
      }
    } else {
      try { root.YLG_MICRO && root.YLG_MICRO.teardown(); } catch (e) {}
      try { root.YLG_PANEL_HOVER && root.YLG_PANEL_HOVER.teardown(); } catch (e) {}
      try { root.YLG_DESCRIPTION_MOTION && root.YLG_DESCRIPTION_MOTION.teardown(); } catch (e) {}
      try { root.YLG_PLAYER_MOTION && root.YLG_PLAYER_MOTION.teardown(); } catch (e) {}
      try { ADAPTER && ADAPTER.teardown && ADAPTER.teardown(); } catch (e) {}
      try { NAV && NAV.teardown && NAV.teardown(); } catch (e) {}
      if (R && R.dispose) R.dispose();
      advancedOk = null;
    }
    applyAmbient(s); // runs in all four master/ambient combinations
    // The decorative sky is independent of video ambient and UI motion.
    // Its controller gates itself to home/search and pauses hidden pages.
    try {
      if (root.YLG_DAYLIGHT) {
        if (s.enabled && s.daylightBackground.enabled) {
          root.YLG_DAYLIGHT.init();
          root.YLG_DAYLIGHT.updateSettings(s);
        } else root.YLG_DAYLIGHT.teardown();
      }
    } catch (eDaylight) {}
    try {
      if (root.YLG_EXPERIENCE) {
        if (s.enabled) root.YLG_EXPERIENCE.updateSettings(s);
        else root.YLG_EXPERIENCE.teardown();
      }
    } catch (eExp) {}
  }

  var applyTimer = null;

  function scheduleApply(delayMs) {
    if (applyTimer !== null) return;
    applyTimer = setTimeout(function () {
      applyTimer = null;
      if (!lastApplied || !lastApplied.enabled) return;
      try { ADAPTER && ADAPTER.applyAll && ADAPTER.applyAll(); } catch (e) {}
    }, delayMs || 0);
  }

  function init() {
    if (!S) return;
    stampBuild();
    S.onSettingsChanged(function (next) { applySettings(next); });
    S.getStoredSettings(function (stored) { applySettings(stored); });
  }

  init();
})();
