/**
 * YouTube Liquid Glass - shared settings contract (Lead-owned).
 * Loaded by content scripts AND the popup (plain script, no modules).
 * Exposes window.YLG_SETTINGS. v1.1: adds ambientLight subsystem
 * (independent of the Liquid Glass engine; master toggle gates both).
 */
(function () {
  "use strict";
  var root = (typeof window !== "undefined") ? window : globalThis;
  if (root.YLG_SETTINGS) return; // idempotent

  var STORAGE_KEY = "ylgSettings";
  var SCHEMA_VERSION = 8;

  // User-selected defaults captured from the installed extension on 2026-11-04.
  var DEFAULT_SETTINGS = {
    "accent": "#3ea6ff",
    "ambientLight": {
      "blur": 75,
      "brightness": 1,
      "enabled": true,
      "fpsLimit": 16,
      "intensity": 1,
      "modes": {
        "fullscreen": true,
        "normal": true,
        "shorts": false,
        "theater": true
      },
      "quality": "auto",
      "saturation": 1.1,
      "spread": 162
    },
    "blur": 1,
    "enabled": true,
    "highlight": 0.62,
    "motion": true,
    "opacity": 0.001347159213591947,
    "optics": {
      "aberration": true,
      "aberrationPx": 4,
      "enabled": true,
      "hoverScale": 1.12,
      "lensAberration": 0.17,
      "lensPx": 92,
      "magnify": true,
      "magnifyScale": 22
    },
    "radius": 14,
    "refraction": 1,
    "theme": "light",
    "tint": "media"
  };

  var RANGES = {
    /* 0 is a legitimate "no backdrop blur" state, not a broken value: it is
       written verbatim (blur(0px) is a valid filter function and renders as a
       plain transparent surface), so the slider may start at zero. */
    blur: [0, 40],
    opacity: [0, 0.85],
    refraction: [0, 1],
    radius: [6, 28],
    highlight: [0, 1]
  };

  var ENUMS = {
    theme: ["auto", "light", "dark"],
    tint: ["auto", "black", "white", "media", "custom"]
  };

  var AMBIENT_RANGES = {
    intensity: [0, 1],
    blur: [0, 140],
    spread: [0, 200],
    saturation: [0, 2],
    brightness: [0, 2],
    fpsLimit: [1, 30]
  };
  var OPTICS_RANGES = {
    aberrationPx: [0, 6],
    magnifyScale: [0, 60],
    hoverScale: [1, 1.12],
    lensPx: [0, 300],
    lensAberration: [0, 0.5]
  };
  var AMBIENT_QUALITY = ["eco", "balanced", "high", "auto"];

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  /* Slider density is deliberately gentle near zero. Stored opacity remains
     raw alpha, so existing saved settings keep their actual transparency.
     alpha = .85 * (slider/100)^1.4; the inverse preserves all integer stops.
     Decorations follow raw normalized alpha instead of boosting low values. */
  var OPACITY_MAX = 0.85;
  var OPACITY_GAMMA = 1.4;
  var FILL_GAMMA = 1;

  /** Stored alpha (0..0.85) -> integer slider position 0..100. */
  function opacityToSlider(alpha01) {
    var a = (typeof alpha01 === "number" && isFinite(alpha01)) ? alpha01 : 0;
    a = clamp(a, 0, OPACITY_MAX);
    if (a <= 0) return 0;
    if (a >= OPACITY_MAX) return 100;
    var p = Math.pow(a / OPACITY_MAX, 1 / OPACITY_GAMMA);
    return Math.round(clamp(p, 0, 1) * 100);
  }

  /** Integer slider position 0..100 -> stored alpha (0..0.85). */
  function sliderToOpacity(sliderPercent) {
    var v = (typeof sliderPercent === "number" && isFinite(sliderPercent)) ? sliderPercent : 0;
    var p = clamp(v, 0, 100) / 100;
    return OPACITY_MAX * Math.pow(p, OPACITY_GAMMA);
  }

  /** Normalized alpha drives rim, sheen and scatter continuously, without
   * amplifying the first slider step. Exact endpoints remain 0 and 1. */
  function fillStrength(alpha01) {
    var a = (typeof alpha01 === "number" && isFinite(alpha01)) ? clamp(alpha01, 0, OPACITY_MAX) : 0;
    if (a <= 0) return 0;
    if (a >= OPACITY_MAX) return 1;
    return Math.pow(a / OPACITY_MAX, FILL_GAMMA);
  }

  /* Parse the accent setting into an opaque "r, g, b" channel triplet. Accepts
     #rgb, #rgba, #rrggbb, #rrggbbaa and rgb()/rgba(); any alpha component is
     DROPPED on purpose, because both consumers (the surface tint channel and
     --ylg-accent) take an opaque colour. Returns null for anything else, and
     callers then fall back to the theme tone. */
  function parseAccentTriplet(value) {
    if (typeof value !== "string") return null;
    var v = value.replace(/^\s+|\s+$/g, "");
    var m = /^#([0-9a-fA-F]{3,8})$/.exec(v);
    var r, g, b;
    if (m) {
      var h = m[1];
      if (h.length === 3 || h.length === 4) {
        h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) +
            h.charAt(2) + h.charAt(2);
      } else if (h.length === 6 || h.length === 8) {
        h = h.substring(0, 6);
      } else {
        return null; /* 5- or 7-digit hex is not a colour */
      }
      var n = parseInt(h, 16);
      if (!isFinite(n)) return null;
      r = (n >> 16) & 255;
      g = (n >> 8) & 255;
      b = n & 255;
      return r + ", " + g + ", " + b;
    }
    m = /^rgba?\(\s*([0-9.]+%?)\s*[, ]\s*([0-9.]+%?)\s*[, ]\s*([0-9.]+%?)/i.exec(v);
    if (!m) return null;
    var toByte = function (raw) {
      var pct = raw.charAt(raw.length - 1) === "%";
      var num = parseFloat(raw);
      if (!isFinite(num)) return 0;
      return Math.round(clamp(pct ? num * 2.55 : num, 0, 255));
    };
    return toByte(m[1]) + ", " + toByte(m[2]) + ", " + toByte(m[3]);
  }

  /** Deep-normalize the ambientLight sub-object (also serves as migration
   *  for settings stored by extension v1.0 that lack it entirely). */
  function normalizeAmbient(raw) {
    var src = (raw && typeof raw === "object") ? raw : {};
    var d = DEFAULT_SETTINGS.ambientLight;
    var out = {};
    Object.keys(d).forEach(function (key) {
      var def = d[key];
      var v = src[key];
      if (key === "modes") {
        out[key] = {};
        Object.keys(def).forEach(function (m) {
          out[key][m] = (src[key] && typeof src[key][m] === "boolean") ? src[key][m] : def[m];
        });
        return;
      }
      if (key === "quality") {
        out[key] = (AMBIENT_QUALITY.indexOf(v) !== -1) ? v : def;
        return;
      }
      if (typeof def === "boolean") {
        out[key] = (typeof v === "boolean") ? v : def;
        return;
      }
      v = (typeof v === "number" && isFinite(v)) ? v : def;
      if (AMBIENT_RANGES[key]) v = clamp(v, AMBIENT_RANGES[key][0], AMBIENT_RANGES[key][1]);
      out[key] = v;
    });
    return out;
  }

  function normalizeOptics(raw) {
    var src = (raw && typeof raw === "object") ? raw : {};
    var d = DEFAULT_SETTINGS.optics;
    var out = {};
    Object.keys(d).forEach(function (key) {
      var def = d[key];
      var v = src[key];
      if (typeof def === "boolean") { out[key] = (typeof v === "boolean") ? v : def; return; }
      v = (typeof v === "number" && isFinite(v)) ? v : def;
      if (OPTICS_RANGES[key]) v = clamp(v, OPTICS_RANGES[key][0], OPTICS_RANGES[key][1]);
      out[key] = v;
    });
    return out;
  }

  function normalizeSettings(raw) {
    var src = (raw && typeof raw === "object") ? raw : {};
    var out = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
      var def = DEFAULT_SETTINGS[key];
      var v = src[key];
      if (key === "ambientLight") { out[key] = normalizeAmbient(v); return; }
      if (key === "optics") { out[key] = normalizeOptics(v); return; }
      switch (typeof def) {
        case "boolean": out[key] = (typeof v === "boolean") ? v : def; break;
        case "number":
          v = (typeof v === "number" && isFinite(v)) ? v : def;
          if (RANGES[key]) v = clamp(v, RANGES[key][0], RANGES[key][1]);
          out[key] = v;
          break;
        case "string":
          if (key === "accent") {
            out[key] = (typeof v === "string" && /^#[0-9a-fA-F]{3,8}$|^rgb\(/.test(v)) ? v : def;
          } else {
            out[key] = (ENUMS[key] && ENUMS[key].indexOf(v) !== -1) ? v : def;
          }
          break;
      }
    });
    /* v1.3.3 migration - schema 2 shipped lensPx 22 / lensAberration 0.34, and
       those numbers were WRITTEN TO STORAGE on first run, so simply raising the
       defaults in DEFAULT_SETTINGS changes nothing for anyone who already
       installed the build. The user's stated priority is distortion, so a stored
       value that still equals the OLD default is treated as "untouched" and
       lifted to the new default. Any value the user actually moved (anything
       other than the exact old default) is preserved as-is. */
    if (!(typeof src.schemaVersion === "number" && src.schemaVersion >= 4)) {
      var so = (src.optics && typeof src.optics === "object") ? src.optics : {};
      if (out.optics) {
        /* every value these builds have ever shipped is treated as "untouched";
         anything else is a deliberate user setting and is preserved */
        var OLD_LENS = [12, 22, 40, 48, 56];
        var OLD_AB = [0.34, 0.42, 0.45];
        if (OLD_LENS.indexOf(so.lensPx) !== -1) out.optics.lensPx = DEFAULT_SETTINGS.optics.lensPx;
        if (OLD_AB.indexOf(so.lensAberration) !== -1) out.optics.lensAberration = DEFAULT_SETTINGS.optics.lensAberration;
      }
    }
    /* v1.3.6 migration - v1.3.5 shipped lensPx 300 as the default and, like the
       earlier build, wrote it to storage on first run. Lowering the default alone
       would leave every existing install at 4.00x, which is exactly the strength
       being dialled back. 300 is treated as "untouched" because the capsule dial
       has no UI: the only slider in the popup controls the separate 32px hover
       well, so 300 can only have arrived from the default or from the v1.3.3
       migration above. Anything else is a deliberate value and is preserved. */
    if (!(typeof src.schemaVersion === "number" && src.schemaVersion >= 5)) {
      var so5 = (src.optics && typeof src.optics === "object") ? src.optics : {};
      if (out.optics && so5.lensPx === 300) out.optics.lensPx = DEFAULT_SETTINGS.optics.lensPx;
    }

    /* v1.3.7 migration - same shape one step further along. v1.3.6 shipped 200
       as the default and wrote it to storage, so lowering the default to 92
       would otherwise leave that build's installs at 2.00x. Chained rather than
       merged: a schema-4 install carrying 300 is already lifted to the current
       default by the block above, and this one only has to know about 200. */
    if (!(typeof src.schemaVersion === "number" && src.schemaVersion >= 6)) {
      var so6 = (src.optics && typeof src.optics === "object") ? src.optics : {};
      if (out.optics && so6.lensPx === 200) out.optics.lensPx = DEFAULT_SETTINGS.optics.lensPx;
    }

    /* v1.3.15 migration - the default surface moved from a translucent smoke
       (0.45) to fully transparent glass. Schema 6 and older builds WROTE 0.45 to
       storage on first run, so raising the floor alone would change nothing for
       existing installs. 0.45 is treated as "untouched" and lifted to the new
       default; any other value is a deliberate choice and is preserved, which is
       why the slider's floor is now 0 rather than 0.1. */
    if (!(typeof src.schemaVersion === "number" && src.schemaVersion >= 7)) {
      if (src.opacity === 0.45) out.opacity = DEFAULT_SETTINGS.opacity;
    }

    /* Schema 8 migration - `preset`, `renderMode` and ambientLight.smoothing
       are REMOVED rather than remapped: the audit showed nothing consumes them
       (preset/renderMode were dead settings, and the bundled ambient engine has
       no safe smoothing mapping). normalizeSettings() builds `out` from the key
       list of DEFAULT_SETTINGS, so a stored object that still carries them
       comes back without them - no key surgery is needed here, and there is no
       numeric default that older builds wrote to storage and would need
       lifting. Every live value (blur, opacity, optics, ...) is preserved. */

    out.schemaVersion = SCHEMA_VERSION;
    return out;
  }

  /* ---------------------------------------------------------------------
     ONE COLOUR CONCEPT (schema 8) - "accent va tint van cha ng b".

     `tint` is the single source of truth for colour. Whatever it resolves to
     feeds BOTH the surface tint channel triplet (--ylg-surface-tint-light,
     the rgba() base of every glass gradient) AND --ylg-accent (focus rings,
     emphasis), so a surface and its accents can never disagree again:

       auto    surface = theme tone (inline override REMOVED, so the
               [data-ylg-theme] token in glass-tokens.css wins)
               accent  = stored accent hex
       black   surface = 0, 0, 0        accent = stored accent hex
       white   surface = 255, 255, 255  accent = stored accent hex
       custom  surface = stored accent hex as "r, g, b"
               accent  = stored accent hex
       media   surface = sampled colour accent = sampled colour

     The black/white choice deliberately does NOT derive the accent from the
     neutral value. Choosing a near-neutral SURFACE is a statement about the
     panel's body, not about the user's accent: rewriting --ylg-accent to
     black/white would silently kill focus rings, and the user's accent hex is
     still stored and still meaningful. So the surface follows the tint, the
     accent stays the user's colour. `custom` exists precisely for the case
     where someone wants the two to be the same exact colour.

     The chrome/search scrim is derived from the same `tint` (see tintRGB), so
     the header follows the concept too.
     --------------------------------------------------------------------- */
  function applyTintChannels(de, tint, accent) {
    var setProp = function (k, v) {
      if (de.style && de.style.setProperty) de.style.setProperty(k, v);
    };
    var dropProp = function (k) {
      if (de.style && de.style.removeProperty) de.style.removeProperty(k);
    };
    // data-ylg-tint-media marks a surface whose tint came from a sampled frame.
    var setMediaAttr = function (on) {
      if (!de.setAttribute) return;
      if (on) de.setAttribute("data-ylg-tint-media", "1");
      else if (de.removeAttribute) de.removeAttribute("data-ylg-tint-media");
    };

    if (tint === "black" || tint === "white") {
      setProp("--ylg-surface-tint-light", tint === "black" ? "0, 0, 0" : "255, 255, 255");
      setProp("--ylg-accent", accent);
      setMediaAttr(false);
      return;
    }
    if (tint === "custom") {
      var triplet = parseAccentTriplet(accent);
      // Unparsable accent (should not happen after normalization): fall back to
      // the theme tone rather than painting an invalid triplet.
      if (triplet) setProp("--ylg-surface-tint-light", triplet);
      else dropProp("--ylg-surface-tint-light");
      setProp("--ylg-accent", accent);
      setMediaAttr(false);
      return;
    }
    if (tint === "media") {
      if (mediaTint) {
        var mt = mediaTint.r + ", " + mediaTint.g + ", " + mediaTint.b;
        setProp("--ylg-surface-tint-light", mt);
        setProp("--ylg-accent", "rgb(" + mt + ")");
      } else {
        // Nothing sampled yet: theme tone for the surface, user accent for
        // accents, instead of painting nothing while the first frame loads.
        dropProp("--ylg-surface-tint-light");
        setProp("--ylg-accent", accent);
      }
      setMediaAttr(true);
      return;
    }
    // auto
    dropProp("--ylg-surface-tint-light");
    setProp("--ylg-accent", accent);
    setMediaAttr(false);
  }

  /* The masthead/search scrim is derived from the SAME opacity control as the
     panels, plus the explicit tint choice. It must be recomputed whenever the
     resolved theme changes too (Auto follows YouTube Appearance), so the values
     are kept here and re-derived by applyThemeToDocument() instead of being
     written once as fixed literals. */
  var chromeState = null; // { opacity, tint, accent } mirror of the last apply
  var mediaTint = null;   // {r,g,b} sampled from the video/thumbnail, or null
  function tintRGB(theme) {
    if (chromeState && chromeState.tint === "media") {
      return mediaTint ? (mediaTint.r + ", " + mediaTint.g + ", " + mediaTint.b) : null;
    }
    if (chromeState && chromeState.tint === "custom") return parseAccentTriplet(chromeState.accent);
    if (chromeState && chromeState.tint === "white") return "255, 255, 255";
    if (chromeState && chromeState.tint === "black") return "0, 0, 0";
    return theme === "light" ? "248, 250, 252" : "22, 28, 38";
  }
  function syncChromeScrim(doc, theme) {
    if (!chromeState) return;
    var de = doc && doc.documentElement;
    if (!de || !de.style || !de.style.setProperty) return;
    var rgb = tintRGB(theme);
    // Media tint with no colour yet: fall back to the theme tone rather than
    // painting nothing while the first frame is being sampled.
    if (!rgb) rgb = theme === "light" ? "248, 250, 252" : "22, 28, 38";
    var alpha = Math.round(Math.min(1, chromeState.opacity * 1.15) * 1000) / 1000;
    de.style.setProperty("--ylg-chrome-scrim", "rgba(" + rgb + ", " + alpha + ")");
    de.style.setProperty("--ylg-search-scrim", "rgba(" + rgb + ", " + alpha + ")");
  }
  /** Feed a sampled colour in. Keeps the surface tint AND the accent in sync,
   *  so a thumbnail-tinted header also tints accents/focus rings. */
  function setMediaTint(doc, rgb) {
    mediaTint = (rgb && typeof rgb.r === "number") ? { r: rgb.r, g: rgb.g, b: rgb.b } : null;
    if (!chromeState || chromeState.tint !== "media") return;
    var de = doc && doc.documentElement;
    if (!de || !de.style) return;
    var theme = de.getAttribute ? de.getAttribute("data-ylg-theme") : "dark";
    syncChromeScrim(doc, theme);
    applyTintChannels(de, "media", chromeState.accent);
  }

  /** Resolve Auto against YouTube Appearance, not the operating system.
   * YouTube represents light mode by the absence of html[dark]. */
  function applyThemeToDocument(doc, preference) {
    var de = doc.documentElement;
    var theme = preference === "dark" || preference === "light" ? preference
      : (de.hasAttribute && de.hasAttribute("dark") ? "dark" : "light");
    de.setAttribute("data-ylg-theme-preference", preference || "auto");
    de.setAttribute("data-ylg-theme", theme);
    syncChromeScrim(doc, theme);
    return theme;
  }

  function applySettingsToDocument(doc, settings) {
    var s = normalizeSettings(settings);
    var de = doc.documentElement;
    var px = function (n) { return Math.round(n * 100) / 100 + "px"; };
    var setProp = function (k, v) { de.style.setProperty(k, v); };

    var opt = s.optics || {};
    var opticsOn = !!(s.enabled !== false && opt.enabled !== false);
    de.setAttribute("data-ylg-optics", opticsOn ? "on" : "off");
    de.setAttribute("data-ylg-optics-request-aberration", (opticsOn && opt.aberration !== false) ? "1" : "0");
    de.setAttribute("data-ylg-optics-request-magnify", (opticsOn && opt.magnify !== false) ? "1" : "0");
    setProp("--ylg-hover-scale", String(opt.hoverScale === undefined ? 1.028 : opt.hoverScale));
    // --ylg-aberration-px is intentionally NOT written any more: schema 8 audit
    // confirmed no stylesheet consumes it (the optics layer reads the
    // data-ylg-optics-request-* attributes and its own inline props instead).
    de.setAttribute("data-ylg-enabled", s.enabled ? "true" : "false");
    // data-ylg-render-mode is gone with the `renderMode` setting (schema 8):
    // advanced refraction is now driven by refraction > 0 in bootstrap.js.
    applyThemeToDocument(doc, s.theme);
    de.setAttribute("data-ylg-motion", s.motion ? "on" : "off");

    // Ambient gate is INDEPENDENT of glass styling; master toggle gates both.
    var ambOn = !!(s.enabled && s.ambientLight && s.ambientLight.enabled);
    de.setAttribute("data-ylg-ambient", ambOn ? "on" : "off");
    de.setAttribute("data-ylg-ambient-quality", s.ambientLight.quality);

    setProp("--ylg-blur", px(s.blur));
    // Blur 0 means "no backdrop blur", so the derived sizes collapse with it
    // instead of keeping their old legibility floor (a surface asked to blur by
    // 0 must not still blur by 2px through --ylg-blur-s).
    var blurS = s.blur === 0 ? 0 : Math.max(2, s.blur * 0.5);
    setProp("--ylg-blur-s", px(blurS));
    setProp("--ylg-blur-l", px(Math.min(48, s.blur * 1.5)));
    setProp("--ylg-opacity", String(s.opacity));
    // Perceptual companion of the raw alpha (see fillStrength): the additive
    // glass layer multiplies rims/sheen/scatter by this, so the surface GROWS
    // out of nothing between slider 0 and 1 instead of switching on with the
    // removal of data-ylg-fill. Exactly 0 at alpha 0, exactly 1 at 0.85.
    setProp("--ylg-fill-strength", String(Math.round(fillStrength(s.opacity) * 10000) / 10000));
    // Header/search share the panel transparency control; the resolved value is
    // (re)computed by applyThemeToDocument -> syncChromeScrim so an Auto theme
    // switch also repaints the chrome in the right tone.
    chromeState = { opacity: s.opacity, tint: s.tint, accent: s.accent };
    syncChromeScrim(doc, de.getAttribute ? de.getAttribute("data-ylg-theme") : s.theme);
    de.setAttribute("data-ylg-tint", s.tint);
    // 0 is a real, user-selectable state: no tint, no scatter, no rim. Values
    // above 0 keep the complete original material and its animation, and the
    // surface grows continuously because --ylg-fill-strength ramps from ~0.
    if (s.opacity === 0) de.setAttribute("data-ylg-fill", "none");
    else if (de.removeAttribute) de.removeAttribute("data-ylg-fill");
    // ONE colour concept: the same `tint` choice feeds the surface tint channel
    // (the rgba() base of every glass gradient) AND --ylg-accent. See
    // applyTintChannels() for the per-value contract, including why Black/White
    // change the surface but NOT the user's accent.
    applyTintChannels(de, s.tint, s.accent);
    setProp("--ylg-radius", px(s.radius));
    setProp("--ylg-radius-s", px(Math.max(4, s.radius * 0.55)));
    setProp("--ylg-radius-l", px(Math.min(36, s.radius * 1.6)));
    setProp("--ylg-refraction", String(s.refraction));
    setProp("--ylg-highlight", String(s.highlight));
    return s;
  }

  function getStoredSettings(cb) {
    try {
      if (root.chrome && root.chrome.storage && root.chrome.storage.local && root.chrome.storage.local.get) {
        root.chrome.storage.local.get(STORAGE_KEY, function (res) {
          var err = root.chrome.runtime && root.chrome.runtime.lastError;
          cb(err ? normalizeSettings(null) : normalizeSettings(res && res[STORAGE_KEY]));
        });
        return;
      }
    } catch (e) { /* fall through */ }
    try { cb(normalizeSettings(JSON.parse(root.localStorage.getItem(STORAGE_KEY)))); }
    catch (e2) { cb(normalizeSettings(null)); }
  }

  function saveSettings(settings, cb) {
    var s = normalizeSettings(settings);
    try {
      if (root.chrome && root.chrome.storage && root.chrome.storage.local && root.chrome.storage.local.set) {
        var payload = {}; payload[STORAGE_KEY] = s;
        root.chrome.storage.local.set(payload, function () {
          var err = root.chrome.runtime && root.chrome.runtime.lastError;
          if (cb) cb(err ? null : s, err);
        });
        return;
      }
    } catch (e) { /* fall through */ }
    try { root.localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e2) {}
    if (cb) cb(s, null);
  }

  function onSettingsChanged(cb) {
    try {
      if (root.chrome && root.chrome.storage && root.chrome.storage.onChanged) {
        var handler = function (changes, area) {
          if (area === "local" && changes[STORAGE_KEY]) cb(normalizeSettings(changes[STORAGE_KEY].newValue));
        };
        root.chrome.storage.onChanged.addListener(handler);
        return function () { root.chrome.storage.onChanged.removeListener(handler); };
      }
    } catch (e) { /* fall through */ }
    var lsHandler = function () {
      try { cb(normalizeSettings(JSON.parse(root.localStorage.getItem(STORAGE_KEY)))); } catch (e) {}
    };
    root.addEventListener("storage", lsHandler);
    return function () { root.removeEventListener("storage", lsHandler); };
  }

  root.YLG_SETTINGS = {
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    RANGES: RANGES,
    ENUMS: ENUMS,
    AMBIENT_RANGES: AMBIENT_RANGES,
    AMBIENT_QUALITY: AMBIENT_QUALITY,
    /* Opacity slider <-> stored alpha. Exported so the popup (and any test)
       uses this one curve instead of re-deriving the mapping. */
    opacityToSlider: opacityToSlider,   // 0..0.85 -> integer 0..100
    sliderToOpacity: sliderToOpacity,   // integer 0..100 -> 0..0.85
    normalizeSettings: normalizeSettings,
    normalizeAmbient: normalizeAmbient,
    applySettingsToDocument: applySettingsToDocument,
    setMediaTint: setMediaTint,
    applyThemeToDocument: applyThemeToDocument,
    getStoredSettings: getStoredSettings,
    saveSettings: saveSettings,
    onSettingsChanged: onSettingsChanged
  };
})();
