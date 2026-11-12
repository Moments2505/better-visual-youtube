/**
 * YouTube Liquid Glass - popup.js (A4 scope, Lead-executed)
 * Wires every control to YLG_SETTINGS (shared contract). Saves the FULL
 * normalized snapshot (150ms input debounce, immediate committed changes);
 * the master toggle gates the glass sections; the ambient enable switch gates
 * the ambient sliders. chrome.storage persistence + live content-script sync
 * happen inside settings.js / storage.onChanged.
 *
 * Control inventory: master switch, Style Profiles, Theme, Blur strength,
 * Opacity, Colour (Auto | Black | White | Thumbnail | Custom + inline colour
 * input/swatches), Refraction, Corner radius, Highlight, Motion effects,
 * Optics, Ambient Light, Reset / Export / Import, status line.
 */
(function () {
  "use strict";
  var S = window.YLG_SETTINGS;
  if (!S) return;

  function t(key, fallback) {
    return (typeof S.t === "function") ? S.t(key, fallback) : fallback;
  }

  var $ = function (id) { return document.getElementById(id); };
  var current = null;
  var saveTimer = null;
  var statusTimer = null;
  var systemTheme = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  var PROFILE_BUTTONS = [
    ["crystal", "ylg-profile-crystal"],
    ["frosted", "ylg-profile-frosted"],
    ["cinema", "ylg-profile-cinema"],
    ["eco", "ylg-profile-eco"]
  ];

  function syncPopupTheme(preference) {
    var theme = preference === "dark" || preference === "light" ? preference :
      (systemTheme && systemTheme.matches ? "dark" : "light");
    document.documentElement.setAttribute("data-ylg-popup-theme", theme);
  }
  function onSystemThemeChange() {
    if (current && current.theme === "auto") syncPopupTheme("auto");
  }
  if (systemTheme && systemTheme.addEventListener) {
    systemTheme.addEventListener("change", onSystemThemeChange);
    window.addEventListener("pagehide", function () {
      systemTheme.removeEventListener("change", onSystemThemeChange);
    });
  }

  function status(msg) {
    var el = $("ylg-status");
    if (!el) return;
    el.textContent = msg;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { el.textContent = ""; }, 2200);
  }

  var dirty = false;
  var revision = 0;

  function flushSave(successMessage) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (!dirty || !current) return;
    dirty = false;
    var savedRevision = revision;
    S.saveSettings(current, function (saved, err) {
      // An older callback must not replace newer controls or status (notably reset).
      if (savedRevision !== revision) return;
      if (err) dirty = true;
      status(err ? t("statusSaveFailed", "Save failed") : (successMessage || t("statusSaved", "Saved")));
    });
  }

  function scheduleSave() {
    dirty = true;
    revision++;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 150);
  }

  function update(next) {
    current = S.normalizeSettings(Object.assign({}, current, next));
    syncState(current);
    scheduleSave();
  }

  /* ---- percent <-> stored alpha -------------------------------------------
   * Opacity is a 0..100 percent slider over the shared `opacity` alpha. The
   * shared contract may expose opacityToSlider/sliderToOpacity; those are
   * feature-detected here and never assumed: if they are missing (or return
   * something unusable) this popup falls back to the alpha range it has always
   * written, 0..1, i.e. percent / 100.
   * ---------------------------------------------------------------------- */
  var ALPHA_MAX = 1;

  function opacityToSlider(alpha) {
    var a = (typeof alpha === "number" && isFinite(alpha)) ? alpha : 0;
    var v = NaN;
    if (typeof S.opacityToSlider === "function") {
      try { v = S.opacityToSlider(a); } catch (e) { v = NaN; }
    }
    if (!(typeof v === "number" && isFinite(v))) v = Math.round((a / ALPHA_MAX) * 100);
    return Math.min(100, Math.max(0, Math.round(v)));
  }

  function sliderToOpacity(v) {
    var n = (typeof v === "number" && isFinite(v)) ? v : 0;
    var a = NaN;
    if (typeof S.sliderToOpacity === "function") {
      try { a = S.sliderToOpacity(n); } catch (e) { a = NaN; }
    }
    if (!(typeof a === "number" && isFinite(a))) a = (n / 100) * ALPHA_MAX;
    return a;
  }

  /* ---- Colour row --------------------------------------------------------
   * "Custom" is a member of the shared tint enum. It is feature-detected: a
   * settings.js that still validates tint against the old four values would
   * turn a written "custom" back into "auto" and snap the inline colour
   * controls shut. In that case the selection is kept for this session so the
   * row stays usable; `accent` always persists either way.
   * ---------------------------------------------------------------------- */
  var TINT_CUSTOM_SUPPORTED = !(S.ENUMS && S.ENUMS.tint) || S.ENUMS.tint.indexOf("custom") !== -1;
  var customIntent = false;

  function uiTint(s) {
    var tn = (s && typeof s.tint === "string" && s.tint) ? s.tint : "auto";
    if (tn === "custom") return "custom";
    if (!TINT_CUSTOM_SUPPORTED && customIntent) return "custom";
    return tn;
  }

  function accentHex(s) {
    var a = (s && typeof s.accent === "string") ? s.accent : "";
    if (/^#[0-9a-fA-F]{6}$/.test(a)) return a.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(a)) {
      return ("#" + a[1] + a[1] + a[2] + a[2] + a[3] + a[3]).toLowerCase();
    }
    return "#3ea6ff";
  }

  function syncColour(s) {
    var row = $("ylg-accent-row");
    if (row) {
      if (uiTint(s) === "custom") row.removeAttribute("hidden");
      else row.setAttribute("hidden", "");
    }
    var acc = $("ylg-accent");
    var hex = accentHex(s);
    // Only touch a control whose value actually changed: the colour picker
    // fires input while it is open and a redundant write would fight it.
    if (acc && acc.value !== hex) acc.value = hex;
  }

  function syncProfiles(s) {
    var activeKey = (typeof S.matchStyleProfile === "function") ? S.matchStyleProfile(s) : null;
    for (var i = 0; i < PROFILE_BUTTONS.length; i++) {
      var key = PROFILE_BUTTONS[i][0];
      var btn = $(PROFILE_BUTTONS[i][1]);
      if (!btn) continue;
      var active = (activeKey === key);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      btn.classList.toggle("is-active", active);
    }
  }

  // State-only synchronization never replaces controls or rewrites a focused range.
  function syncState(s) {
    document.documentElement.setAttribute("data-ylg-system-motion", s.respectReducedMotion ? "follow" : "ignore");
    document.documentElement.setAttribute("data-ylg-motion", s.motion ? "on" : "off");
    var amb = s.ambientLight || {};
    syncPopupTheme(s.theme);
    applyDisabledStates(s);
    setSegmented("ylg-theme", s.theme);
    setSegmented("ylg-tint", uiTint(s));
    setSegmented("ylg-ambient-quality", amb.quality);
    setSegmented("ylg-daylight-scene", s.daylightBackground.scene);
    syncColour(s);
    syncProfiles(s);
    if (window.YLG_SKY_UI) window.YLG_SKY_UI.render(s);
  }

  /* ---- render ---- */
  function setSegmented(id, value) {
    var box = $(id);
    if (!box) return;
    var btns = box.querySelectorAll("button[data-value]");
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute("data-value") === value;
      btns[i].setAttribute("aria-checked", on ? "true" : "false");
      btns[i].setAttribute("tabindex", on && !btns[i].disabled ? "0" : "-1");
    }
  }
  function setSlider(id, valId, value, fmt) {
    var inp = $(id), out = $(valId);
    if (!inp) return;
    inp.value = String(value);
    if (out) out.textContent = fmt ? fmt(value) : String(value);
  }
  function setChecked(id, on) {
    var el = $(id);
    if (el) el.checked = !!on;
  }
  function px(v) { return v + "px"; }
  function pct(v) { return v + "%"; }
  function fmtLens(v) {
    return v === 0 ? t("valueOff", "Off") : (1 / (1 - v / 400 * ((1 - 1 / 1.15) / 0.23))).toFixed(2) + "×";
  }

  function render(s) {
    current = s;
    customIntent = s.tint === "custom";
    setChecked("ylg-enabled", s.enabled);
    setSlider("ylg-blur", "ylg-blur-v", s.blur, px);
    setSlider("ylg-opacity", "ylg-opacity-v", opacityToSlider(s.opacity), pct);
    setSlider("ylg-refraction", "ylg-refraction-v", Math.round(s.refraction * 100), pct);
    setSlider("ylg-radius", "ylg-radius-v", s.radius, px);
    setSlider("ylg-highlight", "ylg-highlight-v", Math.round(s.highlight * 100), pct);
    setChecked("ylg-motion", s.motion);
    setChecked("ylg-system-motion", s.respectReducedMotion);
    setChecked("ylg-hover-effects", s.hoverEffects);
    setChecked("ylg-system-transparency", s.respectReducedTransparency);
    setChecked("ylg-daylight-enabled", s.daylightBackground.enabled);
    setChecked("ylg-daylight-animate", s.daylightBackground.animate);
    setChecked("ylg-daylight-rain", s.daylightBackground.rain);
    setSlider("ylg-daylight-intensity", "ylg-daylight-intensity-v", Math.round(s.daylightBackground.intensity * 100), pct);
    var a = s.ambientLight || {};
    setChecked("ylg-ambient-enabled", a.enabled);
    setSlider("ylg-amb-blur", "ylg-amb-blur-v", a.blur, px);
    setSlider("ylg-amb-spread", "ylg-amb-spread-v", a.spread, pct);
    setSlider("ylg-amb-saturation", "ylg-amb-saturation-v", Math.round(a.saturation * 100), pct);
    setSlider("ylg-amb-brightness", "ylg-amb-brightness-v", Math.round(a.brightness * 100), pct);
    setSlider("ylg-amb-fps", "ylg-amb-fps-v", a.fpsLimit, function (v) { return v + "fps"; });
    var o = s.optics || {};
    setChecked("ylg-optics-enabled", o.enabled !== false);
    setSlider("ylg-optics-lens", "ylg-optics-lens-v", o.lensPx, fmtLens);
    setChecked("ylg-optics-aberration", o.aberration !== false);
    setSlider("ylg-optics-ab", "ylg-optics-ab-v", Math.round((o.aberrationPx === undefined ? 1.6 : o.aberrationPx) * 10), function (v) { return (v / 10).toFixed(1) + "px"; });
    setChecked("ylg-optics-magnify", o.magnify !== false);
    setSlider("ylg-optics-scale", "ylg-optics-scale-v", o.magnifyScale === undefined ? 18 : o.magnifyScale, function (v) { return String(v); });
    setSlider("ylg-optics-hover", "ylg-optics-hover-v", Math.round((o.hoverScale === undefined ? 1.028 : o.hoverScale) * 100), pct);
    var modes = a.modes || {};
    setChecked("ylg-amb-normal", modes.normal);
    setChecked("ylg-amb-theater", modes.theater);
    setChecked("ylg-amb-fullscreen", modes.fullscreen);
    syncState(s);
  }

  function applyDisabledStates(s) {
    var amb = s.ambientLight || {};
    var panel = document.querySelector(".ylg-panel");
    if (panel) panel.classList.toggle("is-disabled", !s.enabled);
    if (panel) panel.classList.toggle("amb-disabled", !amb.enabled);
    var controls = document.querySelectorAll("#ylg-body input, #ylg-body button");
    var optics = s.optics || {};
    var colourOn = uiTint(s) === "custom";
    for (var i = 0; i < controls.length; i++) {
      var el = controls[i];
      var ambientChild = el.id.indexOf("ylg-amb-") === 0 || !!el.closest("#ylg-ambient-quality");
      var opticsChild = el.id.indexOf("ylg-optics-") === 0 && el.id !== "ylg-optics-enabled";
      var colourChild = !!el.closest("#ylg-accent-row");
      var daylightChild = el.id === "ylg-daylight-intensity" || el.id === "ylg-daylight-animate" || el.id === "ylg-daylight-rain" || !!el.closest("#ylg-daylight-scene") || !!el.closest("#ylg-sky-live-controls");
      // Removed controls are gone from the markup, so this loop only ever sees
      // the ids that still exist; an absent element simply never appears here.
      el.disabled = !s.enabled ||
        (ambientChild && !amb.enabled) ||
        (opticsChild && !optics.enabled) ||
        (daylightChild && !s.daylightBackground.enabled) ||
        (el.id === "ylg-optics-ab" && !optics.aberration) ||
        ((el.id === "ylg-optics-scale" || el.id === "ylg-optics-hover") && !optics.magnify) ||
        (colourChild && !colourOn);
    }
  }

  /* ---- wiring ---- */
  function bindSeg(id, fn) {
    var box = $(id);
    if (!box) return;
    box.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("button[data-value]") : null;
      if (!btn || btn.disabled || !current || !box.contains(btn)) return;
      fn(btn.getAttribute("data-value"));
      flushSave();
    });
    box.addEventListener("keydown", function (e) {
      var forward = e.key === "ArrowRight" || e.key === "ArrowDown";
      var backward = e.key === "ArrowLeft" || e.key === "ArrowUp";
      if (!forward && !backward && e.key !== "Home" && e.key !== "End") return;
      var btns = Array.prototype.slice.call(box.querySelectorAll("button[data-value]")).filter(function (b) { return !b.disabled; });
      if (!btns.length) return;
      var idx = btns.indexOf(e.target);
      if (idx < 0) idx = btns.findIndex(function (b) { return b.getAttribute("aria-checked") === "true"; });
      var next = e.key === "Home" ? 0 : e.key === "End" ? btns.length - 1 :
        (idx + (forward ? 1 : -1) + btns.length) % btns.length;
      e.preventDefault();
      btns[next].focus();
      btns[next].click();
    });
  }
  function bindSlider(id, valId, fn, fmt) {
    var inp = $(id);
    if (!inp) return;
    function applyValue(raw) {
      var out = $(valId);
      if (out) out.textContent = fmt ? fmt(raw) : String(raw);
      fn(raw);
    }
    inp.addEventListener("input", function () {
      if (inp.disabled || !current) return;
      applyValue(parseFloat(inp.value));
    });
    var wheelTarget = inp.closest(".ylg-slider-row") || inp;
    var wheelPixels = 0, wheelTime = 0;
    wheelTarget.addEventListener("wheel", function (e) {
      if (inp.disabled || !current || e.ctrlKey || e.metaKey || !e.deltaY || Math.abs(e.deltaX || 0) > Math.abs(e.deltaY)) return;
      var value = parseFloat(inp.value), min = Number(inp.getAttribute("min")), max = Number(inp.getAttribute("max"));
      var step = Number(inp.getAttribute("step")) || 1;
      var direction = e.deltaY < 0 ? 1 : -1;
      // At an end stop, scrolling may continue through the popup normally.
      if ((direction > 0 && value >= max) || (direction < 0 && value <= min)) { wheelPixels = 0; return; }
      e.preventDefault();
      var now = Date.now();
      if (now - wheelTime > 180 || Math.sign(wheelPixels) !== Math.sign(e.deltaY)) wheelPixels = 0;
      wheelTime = now;
      wheelPixels += e.deltaY;
      if (!e.deltaMode && Math.abs(wheelPixels) < 24) return;
      wheelPixels = 0;
      var next = Math.min(max, Math.max(min, min + (Math.round((value - min) / step) + direction) * step));
      next = Number(next.toFixed(8));
      inp.value = String(next);
      applyValue(next); // Uses the same normalization and 150ms save as dragging.
    }, { passive: false });
  }

  // Close/hidden flush is best-effort; committed range changes and all discrete
  // controls dispatch their storage write immediately, without relying on teardown.
  window.addEventListener("pagehide", function () { flushSave(); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) flushSave();
  });

  document.addEventListener("DOMContentLoaded", function () {
    if (typeof S.hydrateI18n === "function") {
      S.hydrateI18n(document);
    }
    var loadingControls = document.querySelectorAll("input, button");
    for (var i = 0; i < loadingControls.length; i++) loadingControls[i].disabled = true;
    S.getStoredSettings(function (s) {
      var master = $("ylg-enabled"), reset = $("ylg-reset");
      var exportBtn = $("ylg-export"), importBtn = $("ylg-import"), importFile = $("ylg-import-file");
      if (master) master.disabled = false;
      if (reset) reset.disabled = false;
      if (exportBtn) exportBtn.disabled = false;
      if (importBtn) importBtn.disabled = false;
      if (importFile) importFile.disabled = false;
      for (var p = 0; p < PROFILE_BUTTONS.length; p++) {
        var profBtn = $(PROFILE_BUTTONS[p][1]);
        if (profBtn) profBtn.disabled = false;
      }
      render(s);
    });
    // Reflect changes from other open popups/tabs. Uncommitted local edits keep
    // priority until their normal change/debounce save, avoiding range jumps.
    if (S.onSettingsChanged) {
      var stopSync = S.onSettingsChanged(function (s) {
        if (!dirty && JSON.stringify(current) !== JSON.stringify(s)) render(s);
      });
      window.addEventListener("pagehide", function () { if (stopSync) stopSync(); });
    }
    // Bubbles after the individual control updates, including native range
    // keyboard/pointer commits and toggles. No second debounce survives change.
    document.addEventListener("change", function (e) {
      if (e && e.target && e.target.id === "ylg-import-file") return;
      flushSave();
    });

    var profilesBar = $("ylg-style-profiles");
    if (profilesBar) {
      for (var pIdx = 0; pIdx < PROFILE_BUTTONS.length; pIdx++) {
        (function (profileKey, domId) {
          var btn = $(domId);
          if (!btn) return;
          btn.addEventListener("click", function () {
            if (btn.disabled || !current || typeof S.applyStyleProfile !== "function") return;
            var next = S.applyStyleProfile(current, profileKey);
            render(next);
            scheduleSave();
            flushSave(t("statusProfileApplied", "Profile applied"));
          });
        })(PROFILE_BUTTONS[pIdx][0], PROFILE_BUTTONS[pIdx][1]);
      }
    }

    var master = $("ylg-enabled");
    if (master) master.addEventListener("change", function () { update({ enabled: this.checked }); });

    bindSeg("ylg-theme", function (v) { update({ theme: v }); });
    bindSeg("ylg-tint", function (v) {
      customIntent = v === "custom";
      update({ tint: v });
    });

    bindSlider("ylg-blur", "ylg-blur-v", function (v) { update({ blur: v }); }, px);
    bindSlider("ylg-opacity", "ylg-opacity-v", function (v) { update({ opacity: sliderToOpacity(v) }); }, pct);
    bindSlider("ylg-refraction", "ylg-refraction-v", function (v) { update({ refraction: v / 100 }); }, pct);
    bindSlider("ylg-radius", "ylg-radius-v", function (v) { update({ radius: v }); }, px);
    bindSlider("ylg-highlight", "ylg-highlight-v", function (v) { update({ highlight: v / 100 }); }, pct);

    var accent = $("ylg-accent");
    if (accent) {
      accent.addEventListener("input", function () {
        // Editing the custom colour implies the Custom mode is the intent.
        customIntent = true;
        update({ tint: "custom", accent: this.value });
      });
    }
    var swatches = document.querySelectorAll(".ylg-swatch");
    for (var sIdx = 0; sIdx < swatches.length; sIdx++) {
      swatches[sIdx].addEventListener("click", function () {
        var colour = this.getAttribute("data-color");
        var acc = $("ylg-accent");
        if (acc) acc.value = colour;
        customIntent = true;
        update({ tint: "custom", accent: colour });
        flushSave();
      });
    }

    var motion = $("ylg-motion");
    if (motion) motion.addEventListener("change", function () { update({ motion: this.checked }); });
    var systemMotion = $("ylg-system-motion");
    if (systemMotion) systemMotion.addEventListener("change", function () { update({ respectReducedMotion: this.checked }); });
    var hoverEffects = $("ylg-hover-effects");
    if (hoverEffects) hoverEffects.addEventListener("change", function () { update({ hoverEffects: this.checked }); });
    var systemTransparency = $("ylg-system-transparency");
    if (systemTransparency) systemTransparency.addEventListener("change", function () {
      update({ respectReducedTransparency: this.checked });
    });

    var daylightEnabled = $("ylg-daylight-enabled");
    function updateDaylight(patch) {
      update({ daylightBackground: Object.assign({}, current.daylightBackground, patch) });
    }
    if (window.YLG_SKY_UI) window.YLG_SKY_UI.bind({ get: function () { return current; }, update: updateDaylight, flush: flushSave });
    if (daylightEnabled) daylightEnabled.addEventListener("change", function () {
      updateDaylight({ enabled: this.checked });
    });
    var daylightAnimate = $("ylg-daylight-animate");
    if (daylightAnimate) daylightAnimate.addEventListener("change", function () {
      updateDaylight({ animate: this.checked });
    });
    var daylightRain = $("ylg-daylight-rain");
    if (daylightRain) daylightRain.addEventListener("change", function () {
      if (!current || this.disabled) return;
      updateDaylight({ rain: this.checked });
    });
    bindSeg("ylg-daylight-scene", function (v) { updateDaylight({ scene: v }); });
    bindSlider("ylg-daylight-intensity", "ylg-daylight-intensity-v", function (v) {
      updateDaylight({ intensity: v / 100 });
    }, pct);

    // ambient
    var ambEnabled = $("ylg-ambient-enabled");
    if (ambEnabled) {
      ambEnabled.addEventListener("change", function () {
        update({ ambientLight: Object.assign({}, current.ambientLight, { enabled: this.checked }) });
      });
    }
    bindSeg("ylg-ambient-quality", function (v) {
      update({ ambientLight: Object.assign({}, current.ambientLight, { quality: v }) });
    });
    bindSlider("ylg-amb-blur", "ylg-amb-blur-v", function (v) {
      update({ ambientLight: Object.assign({}, current.ambientLight, { blur: v }) });
    }, px);
    bindSlider("ylg-amb-spread", "ylg-amb-spread-v", function (v) {
      update({ ambientLight: Object.assign({}, current.ambientLight, { spread: v }) });
    }, pct);
    bindSlider("ylg-amb-saturation", "ylg-amb-saturation-v", function (v) {
      update({ ambientLight: Object.assign({}, current.ambientLight, { saturation: v / 100 }) });
    }, pct);
    bindSlider("ylg-amb-brightness", "ylg-amb-brightness-v", function (v) {
      update({ ambientLight: Object.assign({}, current.ambientLight, { brightness: v / 100 }) });
    }, pct);
    bindSlider("ylg-amb-fps", "ylg-amb-fps-v", function (v) {
      update({ ambientLight: Object.assign({}, current.ambientLight, { fpsLimit: v }) });
    }, function (v) { return v + "fps"; });

    function updateOptics(patch) {
      var next = Object.assign({}, current.optics || {}, patch);
      update({ optics: next });
    }
    bindSlider("ylg-optics-lens", "ylg-optics-lens-v", function (v) { updateOptics({ lensPx: v }); }, fmtLens);
    var opticsEnabled = $("ylg-optics-enabled");
    if (opticsEnabled) opticsEnabled.addEventListener("change", function () { updateOptics({ enabled: this.checked }); });
    var aberration = $("ylg-optics-aberration");
    if (aberration) aberration.addEventListener("change", function () { updateOptics({ aberration: this.checked }); });
    bindSlider("ylg-optics-ab", "ylg-optics-ab-v", function (v) { updateOptics({ aberrationPx: v / 10 }); }, function (v) { return (v / 10).toFixed(1) + "px"; });
    var magnify = $("ylg-optics-magnify");
    if (magnify) magnify.addEventListener("change", function () { updateOptics({ magnify: this.checked }); });
    bindSlider("ylg-optics-scale", "ylg-optics-scale-v", function (v) { updateOptics({ magnifyScale: v }); });
    bindSlider("ylg-optics-hover", "ylg-optics-hover-v", function (v) { updateOptics({ hoverScale: v / 100 }); }, pct);
    var ambNormal = $("ylg-amb-normal");
    if (ambNormal) {
      ambNormal.addEventListener("change", function () {
        update({ ambientLight: Object.assign({}, current.ambientLight, { modes: Object.assign({}, current.ambientLight.modes, { normal: this.checked }) }) });
      });
    }
    var ambTheater = $("ylg-amb-theater");
    if (ambTheater) {
      ambTheater.addEventListener("change", function () {
        update({ ambientLight: Object.assign({}, current.ambientLight, { modes: Object.assign({}, current.ambientLight.modes, { theater: this.checked }) }) });
      });
    }
    var ambFullscreen = $("ylg-amb-fullscreen");
    if (ambFullscreen) {
      ambFullscreen.addEventListener("change", function () {
        update({ ambientLight: Object.assign({}, current.ambientLight, { modes: Object.assign({}, current.ambientLight.modes, { fullscreen: this.checked }) }) });
      });
    }

    var reset = $("ylg-reset");
    if (reset) {
      reset.addEventListener("click", function () {
        // Replace pending work before issuing reset; stale callbacks never render.
        var d = S.normalizeSettings(JSON.parse(JSON.stringify(S.DEFAULT_SETTINGS)));
        render(d);
        scheduleSave();
        try {
          if (S.VENDOR_RESET_KEYS && typeof chrome !== "undefined" &&
              chrome.storage && chrome.storage.local &&
              typeof chrome.storage.local.remove === "function") {
            chrome.storage.local.remove(S.VENDOR_RESET_KEYS.slice(), function () {});
          }
        } catch (eReset) {}
        flushSave(t("statusDefaultsRestored", "Defaults restored"));
      });
    }

    var exportBtn = $("ylg-export");
    if (exportBtn) {
      exportBtn.addEventListener("click", function () {
        if (exportBtn.disabled || !current || typeof S.exportSettingsPayload !== "function") return;
        var json = S.exportSettingsPayload(current);
        var href = "";
        var createdObjectUrl = false;
        try {
          if (typeof Blob === "function" && typeof URL !== "undefined" && URL && typeof URL.createObjectURL === "function") {
            var blob = new Blob([json], { type: "application/json" });
            href = URL.createObjectURL(blob);
            createdObjectUrl = true;
          }
        } catch (eBlob) {
          href = "";
        }
        if (!href) {
          href = "data:application/json;charset=utf-8," + encodeURIComponent(json);
        }
        if (document && typeof document.createElement === "function") {
          var link = document.createElement("a");
          if (link) {
            if (link.setAttribute) {
              link.setAttribute("href", href);
              link.setAttribute("download", "better-visual-youtube-settings.json");
            }
            link.href = href;
            link.download = "better-visual-youtube-settings.json";
            if (document.body && document.body.appendChild) document.body.appendChild(link);
            if (typeof link.click === "function") link.click();
            if (link.remove) link.remove();
            else if (link.parentNode && link.parentNode.removeChild) link.parentNode.removeChild(link);
          }
        }
        if (createdObjectUrl && typeof URL !== "undefined" && URL && typeof URL.revokeObjectURL === "function") {
          setTimeout(function () {
            try { URL.revokeObjectURL(href); } catch (eRevoke) {}
          }, 0);
        }
        status(t("statusExported", "Settings exported"));
      });
    }

    var importBtn = $("ylg-import");
    var importFile = $("ylg-import-file");
    if (importBtn && importFile) {
      importBtn.addEventListener("click", function () {
        if (importBtn.disabled) return;
        importFile.value = "";
        importFile.click();
      });
      importFile.addEventListener("change", function () {
        var file = importFile.files && importFile.files[0];
        if (!file) return;
        function applyImportedText(rawText) {
          var imported;
          try {
            imported = S.parseImportedSettingsPayload(rawText);
          } catch (eParse) {
            status(t("statusImportInvalid", "Invalid settings file"));
            importFile.value = "";
            return;
          }
          render(imported);
          scheduleSave();
          flushSave(t("statusImported", "Settings imported"));
          importFile.value = "";
        }
        if (typeof file.text === "function") {
          Promise.resolve(file.text()).then(applyImportedText, function () {
            status(t("statusImportInvalid", "Invalid settings file"));
            importFile.value = "";
          });
        } else if (typeof FileReader === "function") {
          var reader = new FileReader();
          reader.onload = function () {
            applyImportedText(typeof reader.result === "string" ? reader.result : "");
          };
          reader.onerror = function () {
            status(t("statusImportInvalid", "Invalid settings file"));
            importFile.value = "";
          };
          reader.readAsText(file);
        } else {
          status(t("statusImportInvalid", "Invalid settings file"));
          importFile.value = "";
        }
      });
    }
  });
})();
