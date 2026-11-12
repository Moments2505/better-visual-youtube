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

  // Clean fresh-install defaults (slider 37% -> 0.37^1.4 exact round-trip).
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
        "theater": true,
        "shorts": false
      },
      "quality": "auto",
      "saturation": 1.1,
      "spread": 162
    },
    "blur": 14,
    "daylightBackground": {
      "enabled": false,
      "animate": true,
      "rain": false,
      "liveWeather": false,
      "location": { "name": "London, United Kingdom", "latitude": 51.5074, "longitude": -0.1278 },
      "scene": "auto",
      "intensity": 0.45
    },
    "enabled": true,
    "highlight": 0.62,
    "hoverEffects": true,
    "motion": true,
    "opacity": 0.24858928985262752,
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
    "respectReducedTransparency": false,
    "respectReducedMotion": true,
    "theme": "auto",
    "tint": "auto"
  };

  var RANGES = {
    /* 0 is a legitimate "no backdrop blur" state, not a broken value: it is
       written verbatim (blur(0px) is a valid filter function and renders as a
       plain transparent surface), so the slider may start at zero. */
    blur: [0, 40],
    opacity: [0, 1],
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
     alpha = (slider/100)^1.4; the inverse preserves all integer stops.
     Decorations follow raw normalized alpha instead of boosting low values. */
  var OPACITY_MAX = 1;
  var OPACITY_GAMMA = 1.4;
  var FILL_GAMMA = 1;

  /** Stored alpha (0..1) -> integer slider position 0..100. */
  function opacityToSlider(alpha01) {
    var a = (typeof alpha01 === "number" && isFinite(alpha01)) ? alpha01 : 0;
    a = clamp(a, 0, OPACITY_MAX);
    if (a <= 0) return 0;
    if (a >= OPACITY_MAX) return 100;
    var p = Math.pow(a / OPACITY_MAX, 1 / OPACITY_GAMMA);
    return Math.round(clamp(p, 0, 1) * 100);
  }

  /** Integer slider position 0..100 -> stored alpha (0..1). */
  function sliderToOpacity(sliderPercent) {
    var v = (typeof sliderPercent === "number" && isFinite(sliderPercent)) ? sliderPercent : 0;
    var p = clamp(v, 0, 100) / 100;
    return OPACITY_MAX * Math.pow(p, OPACITY_GAMMA);
  }

  /** Normalized alpha drives rim, sheen and scatter continuously, without
   * amplifying the first slider step. Exact endpoints remain 0 and 1. */
  function fillStrength(alpha01) {
    var a = (typeof alpha01 === "number" && isFinite(alpha01)) ? clamp(alpha01, 0, 0.85) : 0;
    if (a <= 0) return 0;
    if (a >= 0.85) return 1;
    return Math.pow(a / 0.85, FILL_GAMMA);
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

  function normalizeSkyLocation(value, fallback) {
    var v = value && typeof value === "object" ? value : fallback;
    if (typeof v.latitude !== "number" || !Number.isFinite(v.latitude) || Math.abs(v.latitude) > 90 ||
        typeof v.longitude !== "number" || !Number.isFinite(v.longitude) || Math.abs(v.longitude) > 180) v = fallback;
    return { name: typeof v.name === "string" && v.name.trim() ? v.name.trim().slice(0,160) : fallback.name,
      latitude: v.latitude, longitude: v.longitude };
  }

  function normalizeSettings(raw) {
    var src = (raw && typeof raw === "object") ? raw : {};
    var out = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
      var def = DEFAULT_SETTINGS[key];
      var v = src[key];
      if (key === "ambientLight") { out[key] = normalizeAmbient(v); return; }
      if (key === "optics") { out[key] = normalizeOptics(v); return; }
      if (key === "daylightBackground") {
        var daylight = v && typeof v === "object" ? v : {};
        out[key] = {
          enabled: typeof daylight.enabled === "boolean" ? daylight.enabled : def.enabled,
          animate: typeof daylight.animate === "boolean" ? daylight.animate : def.animate,
          rain: typeof daylight.rain === "boolean" ? daylight.rain : def.rain,
          liveWeather: daylight.liveWeather === true,
          location: normalizeSkyLocation(daylight.location, def.location),
          scene: ["auto", "morning", "day", "sunset", "night"].indexOf(daylight.scene) !== -1 ? daylight.scene : def.scene,
          intensity: typeof daylight.intensity === "number" && isFinite(daylight.intensity) ? clamp(daylight.intensity, 0, 1) : def.intensity
        };
        return;
      }
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
    // Ease the upper slider range into white instead of changing material at
    // exactly 100%. Smoothstep has a flat slope at both ends, so 99 -> 100
    // differs by at most one channel level even for a black starting tint.
    var whiteT = Math.max(0, Math.min(1, (chromeState.opacity - 0.6) / 0.4));
    var whiteMix = whiteT * whiteT * (3 - 2 * whiteT);
    rgb = rgb.split(",").map(function (channel) {
      return Math.round(Number(channel) + (255 - Number(channel)) * whiteMix);
    }).join(", ");
    // The reading palette is already settled before the final slider stops.
    de.setAttribute("data-ylg-opacity-pale", whiteMix >= 0.5 ? "true" : "false");
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
    // Glass is an explicit visual preference. System mode can opt into solid
    // surfaces; forced-colour palettes remain controlled by their own CSS.
    de.setAttribute("data-ylg-system-motion", s.respectReducedMotion ? "follow" : "ignore");
    de.setAttribute("data-ylg-transparency", s.respectReducedTransparency ? "system" : "glass");
    // data-ylg-render-mode is gone with the `renderMode` setting (schema 8):
    // advanced refraction is now driven by refraction > 0 in bootstrap.js.
    applyThemeToDocument(doc, s.theme);
    de.setAttribute("data-ylg-motion", s.motion ? "on" : "off");
    // Preserve the saved hover choice, but keep all hover movement dormant
    // while interface motion is off. Re-enabling motion restores that choice.
    de.setAttribute("data-ylg-hover", s.motion && s.hoverEffects ? "on" : "off");

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
    de.setAttribute("data-ylg-opacity-solid", s.opacity === 1 ? "true" : "false");
    // Low-opacity light glass can reveal a dark video-driven ambient field.
    de.setAttribute("data-ylg-light-ink", s.opacity < 0.6 ? "light" : "dark");
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

  /* ---- Curated 1-click style profiles (schema 8) ----------------------- */
  var STYLE_PROFILES = Object.freeze({
    crystal: Object.freeze({
      enabled: true,
      blur: 8,
      opacity: sliderToOpacity(18),
      radius: 18,
      refraction: 1,
      highlight: 0.72,
      tint: "auto",
      motion: true,
      hoverEffects: true,
      optics: Object.freeze({ enabled: true, aberration: true, magnify: true }),
      ambientLight: Object.freeze({ enabled: true, quality: "auto" })
    }),
    frosted: Object.freeze({
      enabled: true,
      blur: 18,
      opacity: sliderToOpacity(52),
      radius: 20,
      refraction: 0.85,
      highlight: 0.68,
      tint: "auto",
      motion: true,
      hoverEffects: true,
      optics: Object.freeze({ enabled: true, aberration: true, magnify: true }),
      ambientLight: Object.freeze({ enabled: true, quality: "balanced" })
    }),
    cinema: Object.freeze({
      enabled: true,
      theme: "dark",
      blur: 14,
      opacity: sliderToOpacity(32),
      radius: 18,
      refraction: 1,
      highlight: 0.62,
      tint: "custom",
      accent: "#f59e0b",
      motion: true,
      hoverEffects: true,
      optics: Object.freeze({ enabled: true, aberration: true, magnify: true }),
      ambientLight: Object.freeze({ enabled: true, quality: "high" })
    }),
    eco: Object.freeze({
      enabled: true,
      blur: 8,
      opacity: sliderToOpacity(40),
      radius: 14,
      refraction: 0,
      highlight: 0.35,
      tint: "auto",
      motion: false,
      hoverEffects: false,
      optics: Object.freeze({ enabled: false }),
      ambientLight: Object.freeze({ enabled: false, quality: "eco" }),
      daylightBackground: Object.freeze({ enabled: false })
    })
  });

  function applyStyleProfile(baseSettings, profileId) {
    var base = normalizeSettings(baseSettings);
    var patch = STYLE_PROFILES[profileId];
    if (!patch) return base;
    var merged = Object.assign({}, base, patch);
    if (patch.optics) merged.optics = Object.assign({}, base.optics, patch.optics);
    if (patch.ambientLight) merged.ambientLight = Object.assign({}, base.ambientLight, patch.ambientLight);
    if (patch.daylightBackground) merged.daylightBackground = Object.assign({}, base.daylightBackground, patch.daylightBackground);
    return normalizeSettings(merged);
  }

  function matchesProfilePatch(target, patch) {
    var keys = Object.keys(patch);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var expected = patch[k];
      var actual = target[k];
      if (k === "opacity") {
        if (opacityToSlider(actual) !== opacityToSlider(expected)) return false;
      } else if (expected && typeof expected === "object" && !Array.isArray(expected)) {
        if (!actual || typeof actual !== "object") return false;
        if (!matchesProfilePatch(actual, expected)) return false;
      } else if (typeof expected === "number") {
        if (typeof actual !== "number" || Math.abs(actual - expected) > 1e-6) return false;
      } else if (k === "accent" && typeof expected === "string" && typeof actual === "string") {
        if (actual.toLowerCase() !== expected.toLowerCase()) return false;
      } else {
        if (actual !== expected) return false;
      }
    }
    return true;
  }

  function matchStyleProfile(settings) {
    if (!settings || typeof settings !== "object") return null;
    var clean = normalizeSettings(settings);
    var ids = Object.keys(STYLE_PROFILES);
    for (var i = 0; i < ids.length; i++) {
      if (matchesProfilePatch(clean, STYLE_PROFILES[ids[i]])) return ids[i];
    }
    return null;
  }

  /* ---- Export / Import JSON payload helpers ---------------------------- */
  function exportSettingsPayload(settings) {
    return JSON.stringify({
      schema: "better-visual-youtube-settings",
      version: 1,
      settings: normalizeSettings(settings)
    }, null, 2);
  }

  function parseImportedSettingsPayload(rawText) {
    if (typeof rawText !== "string" || !rawText.trim()) {
      throw new Error("Invalid settings payload: expected a non-empty JSON string.");
    }
    var parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      throw new Error("Invalid settings payload: malformed JSON.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid settings payload: root JSON value must be an object.");
    }
    var candidate = parsed;
    if (Object.prototype.hasOwnProperty.call(parsed, "settings")) {
      if (!parsed.settings || typeof parsed.settings !== "object" || Array.isArray(parsed.settings)) {
        throw new Error("Invalid settings payload: 'settings' property must be an object.");
      }
      candidate = parsed.settings;
    }
    return normalizeSettings(candidate);
  }

  /* ---- Bilingual i18n helper + safe fallback hydration ----------------- */
  function translateMessage(key, fallback, substitutions, chromeLike) {
    var fb = (fallback !== undefined && fallback !== null) ? String(fallback) : String(key || "");
    if (!key || typeof key !== "string") return fb;
    var c = (chromeLike && typeof chromeLike === "object") ? chromeLike : root.chrome;
    try {
      if (c && c.i18n && typeof c.i18n.getMessage === "function") {
        var msg = substitutions !== undefined
          ? c.i18n.getMessage(key, substitutions)
          : c.i18n.getMessage(key);
        if (typeof msg === "string" && msg.length > 0) return msg;
      }
    } catch (e) { /* keep English fallback in VMs or missing catalogs */ }
    return fb;
  }

  function hydrateI18n(doc, chromeLike) {
    if (!doc || typeof doc.querySelectorAll !== "function") return;
    var c = (chromeLike && typeof chromeLike === "object") ? chromeLike : root.chrome;
    if (!c || !c.i18n || typeof c.i18n.getMessage !== "function") return;
    try {
      if (typeof c.i18n.getUILanguage === "function" && doc.documentElement && doc.documentElement.setAttribute) {
        var uiLang = c.i18n.getUILanguage();
        if (typeof uiLang === "string" && uiLang.trim()) {
          doc.documentElement.setAttribute("lang", uiLang.trim().split(/[-_]/)[0].toLowerCase());
        }
      }
    } catch (eLang) {}
    var nodes = doc.querySelectorAll("*");
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node || typeof node.getAttribute !== "function") continue;
      var textKey = node.getAttribute("data-i18n");
      if (textKey) {
        var textVal = translateMessage(textKey, "", undefined, c);
        if (textVal) node.textContent = textVal;
      }
      var titleKey = node.getAttribute("data-i18n-title");
      if (titleKey && typeof node.setAttribute === "function") {
        var titleVal = translateMessage(titleKey, "", undefined, c);
        if (titleVal) node.setAttribute("title", titleVal);
      }
      var placeholderKey = node.getAttribute("data-i18n-placeholder");
      if (placeholderKey && typeof node.setAttribute === "function") {
        var placeholderVal = translateMessage(placeholderKey, "", undefined, c);
        if (placeholderVal) node.setAttribute("placeholder", placeholderVal);
      }
      var ariaKey = node.getAttribute("data-i18n-aria-label");
      if (ariaKey && typeof node.setAttribute === "function") {
        var ariaVal = translateMessage(ariaKey, "", undefined, c);
        if (ariaVal) node.setAttribute("aria-label", ariaVal);
      }
    }
  }

  /* ---- Storage persistence (local primary + cross-device sync mirror) -- */
  var lastKnownJson = null;
  var pendingSyncHydrationJson = null;

  function makePromise(executor) {
    if (typeof Promise === "function") return new Promise(executor);
    var value;
    executor(function (v) { value = v; }, function () {});
    return { then: function (fn) { if (fn) fn(value); return this; }, catch: function () { return this; } };
  }

  function resolveChrome(chromeLike) {
    return (chromeLike && typeof chromeLike === "object") ? chromeLike : root.chrome;
  }

  function readStorageArea(area, key, runtime, done) {
    if (!area || typeof area.get !== "function") {
      done(undefined, new Error("Storage get unavailable"));
      return;
    }
    var settled = false;
    function finish(res, err) {
      if (settled) return;
      settled = true;
      if (err) {
        done(undefined, err);
        return;
      }
      var val = (res && typeof res === "object") ? res[key] : undefined;
      done(val, null);
    }
    try {
      var ret = area.get(key, function (res) {
        var err = runtime && runtime.lastError;
        finish(res, err || null);
      });
      if (!settled && ret && typeof ret.then === "function") {
        ret.then(function (res) {
          var err = runtime && runtime.lastError;
          finish(res, err || null);
        }, function (err) {
          finish(null, err || new Error("Storage read failed"));
        });
      }
    } catch (e) {
      finish(null, e);
    }
  }

  function writeStorageArea(area, payload, runtime, done) {
    if (!area || typeof area.set !== "function") {
      if (done) done(new Error("Storage set unavailable"));
      return;
    }
    var settled = false;
    function finish(err) {
      if (settled) return;
      settled = true;
      if (done) done(err || null);
    }
    try {
      var ret = area.set(payload, function () {
        var err = runtime && runtime.lastError;
        finish(err || null);
      });
      if (!settled && ret && typeof ret.then === "function") {
        ret.then(function () {
          var err = runtime && runtime.lastError;
          finish(err || null);
        }, function (err) {
          finish(err || new Error("Storage write failed"));
        });
      }
    } catch (e) {
      finish(e);
    }
  }

  function clearHydrationGuardSoon(expectedJson) {
    if (typeof Promise === "function") {
      Promise.resolve().then(function () {
        if (pendingSyncHydrationJson === expectedJson) pendingSyncHydrationJson = null;
      });
    } else if (pendingSyncHydrationJson === expectedJson) {
      pendingSyncHydrationJson = null;
    }
  }

  function getStoredSettings(cb, chromeLike) {
    var callback = (typeof cb === "function") ? cb : null;
    var c = resolveChrome((typeof cb === "object" && cb !== null) ? cb : chromeLike);
    return makePromise(function (resolve) {
      function deliver(clean) {
        lastKnownJson = JSON.stringify(clean);
        if (callback) callback(clean);
        resolve(clean);
      }
      try {
        if (c && c.storage && c.storage.local && typeof c.storage.local.get === "function") {
          readStorageArea(c.storage.local, STORAGE_KEY, c.runtime, function (localVal, localErr) {
            if (!localErr && localVal && typeof localVal === "object") {
              deliver(normalizeSettings(localVal));
              return;
            }
            if (c.storage.sync && typeof c.storage.sync.get === "function") {
              readStorageArea(c.storage.sync, STORAGE_KEY, c.runtime, function (syncVal, syncErr) {
                if (!syncErr && syncVal && typeof syncVal === "object") {
                  var fromSync = normalizeSettings(syncVal);
                  var syncJson = JSON.stringify(fromSync);
                  lastKnownJson = syncJson;
                  if (!localErr && typeof c.storage.local.set === "function") {
                    pendingSyncHydrationJson = syncJson;
                    var hydratePayload = {};
                    hydratePayload[STORAGE_KEY] = fromSync;
                    writeStorageArea(c.storage.local, hydratePayload, c.runtime, function () {
                      clearHydrationGuardSoon(syncJson);
                    });
                  }
                  deliver(fromSync);
                  return;
                }
                deliver(normalizeSettings(null));
              });
              return;
            }
            deliver(normalizeSettings(null));
          });
          return;
        }
      } catch (e) { /* fall through */ }
      try { deliver(normalizeSettings(JSON.parse(root.localStorage.getItem(STORAGE_KEY)))); }
      catch (e2) { deliver(normalizeSettings(null)); }
    });
  }

  function loadSettings(chromeLikeOrCb, maybeChromeLike) {
    if (typeof chromeLikeOrCb === "function") {
      return getStoredSettings(chromeLikeOrCb, maybeChromeLike);
    }
    return getStoredSettings(null, chromeLikeOrCb);
  }

  function saveSettings(settings, cbOrChromeLike, optionalChromeLike) {
    var s = normalizeSettings(settings);
    var cb = (typeof cbOrChromeLike === "function") ? cbOrChromeLike : null;
    var c = resolveChrome((typeof cbOrChromeLike === "object" && cbOrChromeLike !== null) ? cbOrChromeLike : optionalChromeLike);
    var savedJson = JSON.stringify(s);
    lastKnownJson = savedJson;
    return makePromise(function (resolve) {
      try {
        if (c && c.storage && c.storage.local && typeof c.storage.local.set === "function") {
          var payload = {};
          payload[STORAGE_KEY] = s;
          writeStorageArea(c.storage.local, payload, c.runtime, function (err) {
            if (cb) cb(err ? null : s, err || null);
            resolve(err ? null : s);
          });
          if (c.storage.sync && typeof c.storage.sync.set === "function") {
            var syncPayload = {};
            syncPayload[STORAGE_KEY] = s;
            writeStorageArea(c.storage.sync, syncPayload, c.runtime, function () {
              /* Best-effort sync mirror: never fail saveSettings */
            });
          }
          return;
        }
      } catch (e) { /* fall through */ }
      try { root.localStorage.setItem(STORAGE_KEY, savedJson); } catch (e2) {}
      if (cb) cb(s, null);
      resolve(s);
    });
  }

  function onSettingsChanged(cb, chromeLike) {
    var c = resolveChrome(chromeLike);
    try {
      if (c && c.storage && c.storage.onChanged) {
        var handler = function (changes, area) {
          if (!changes || !changes[STORAGE_KEY]) return;
          if (area === "local") {
            var cleanLocal = normalizeSettings(changes[STORAGE_KEY].newValue);
            var localJson = JSON.stringify(cleanLocal);
            var wasEcho = (pendingSyncHydrationJson !== null && pendingSyncHydrationJson === localJson);
            pendingSyncHydrationJson = null;
            lastKnownJson = localJson;
            if (!wasEcho) cb(cleanLocal);
            return;
          }
          if (area === "sync") {
            var rawSync = changes[STORAGE_KEY].newValue;
            if (!rawSync || typeof rawSync !== "object") return;
            var cleanSync = normalizeSettings(rawSync);
            var syncJson = JSON.stringify(cleanSync);
            if (lastKnownJson === syncJson) return;
            var st = c.storage;
            readStorageArea(st.local, STORAGE_KEY, c.runtime, function (localVal) {
              var currentLocalJson = (localVal && typeof localVal === "object")
                ? JSON.stringify(normalizeSettings(localVal))
                : null;
              lastKnownJson = syncJson;
              if (currentLocalJson === syncJson) return;
              if (st.local && typeof st.local.set === "function") {
                pendingSyncHydrationJson = syncJson;
                var syncPatch = {};
                syncPatch[STORAGE_KEY] = cleanSync;
                writeStorageArea(st.local, syncPatch, c.runtime, function () {
                  clearHydrationGuardSoon(syncJson);
                });
              }
              cb(cleanSync);
            });
          }
        };
        c.storage.onChanged.addListener(handler);
        return function () { c.storage.onChanged.removeListener(handler); };
      }
    } catch (e) { /* fall through */ }
    var lsHandler = function () {
      try { cb(normalizeSettings(JSON.parse(root.localStorage.getItem(STORAGE_KEY)))); } catch (e) {}
    };
    if (root && typeof root.addEventListener === "function") {
      root.addEventListener("storage", lsHandler);
      return function () {
        if (root && typeof root.removeEventListener === "function") root.removeEventListener("storage", lsHandler);
      };
    }
    return function () {};
  }

  var VENDOR_RESET_KEYS = Object.freeze([
    "setting-detectHorizontalBarSizeEnabled",
    "setting-detectVerticalBarSizeEnabled",
    "setting-detectVideoFillScaleEnabled",
    "setting-detectColoredHorizontalBarSizeEnabled",
    "setting-horizontalBarsClipPercentage",
    "setting-verticalBarsClipPercentage",
    "setting-headerShadowSize",
    "setting-headerFillOpacity",
    "setting-headerImagesOpacity",
    "setting-surroundingContentShadowSize",
    "setting-surroundingContentFillOpacity",
    "setting-surroundingContentImagesOpacity",
    "setting-pageBackgroundGreyness",
    "ylg-ambient-visual-baseline-v1"
  ]);

  root.YLG_SETTINGS = {
    STORAGE_KEY: STORAGE_KEY,
    VENDOR_RESET_KEYS: VENDOR_RESET_KEYS,
    SCHEMA_VERSION: SCHEMA_VERSION,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    STYLE_PROFILES: STYLE_PROFILES,
    RANGES: RANGES,
    ENUMS: ENUMS,
    AMBIENT_RANGES: AMBIENT_RANGES,
    AMBIENT_QUALITY: AMBIENT_QUALITY,
    /* Opacity slider <-> stored alpha. Exported so the popup (and any test)
       uses this one curve instead of re-deriving the mapping. */
    opacityToSlider: opacityToSlider,   // 0..1 -> integer 0..100
    sliderToOpacity: sliderToOpacity,   // integer 0..100 -> 0..1
    normalizeSettings: normalizeSettings,
    normalizeAmbient: normalizeAmbient,
    applyStyleProfile: applyStyleProfile,
    matchStyleProfile: matchStyleProfile,
    exportSettingsPayload: exportSettingsPayload,
    parseImportedSettingsPayload: parseImportedSettingsPayload,
    t: translateMessage,
    hydrateI18n: hydrateI18n,
    applySettingsToDocument: applySettingsToDocument,
    setMediaTint: setMediaTint,
    applyThemeToDocument: applyThemeToDocument,
    getStoredSettings: getStoredSettings,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    onSettingsChanged: onSettingsChanged,
    subscribeSettings: onSettingsChanged
  };
})();
