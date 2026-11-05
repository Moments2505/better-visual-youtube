/**
 * YouTube Liquid Glass - popup.js (A4 scope, Lead-executed)
 * Wires every control to YLG_SETTINGS (shared contract). Saves the FULL
 * normalized snapshot (150ms input debounce, immediate committed changes);
 * the master toggle gates the glass sections; the ambient enable switch gates
 * the ambient sliders. chrome.storage persistence + live content-script sync
 * happen inside settings.js / storage.onChanged.
 *
 * Control inventory: master switch, Theme, Blur strength, Opacity, Colour
 * (Auto | Black | White | Thumbnail | Custom + inline colour input/swatches),
 * Refraction, Corner radius, Highlight, Motion effects, Optics, Ambient Light,
 * Reset to Defaults, status line.
 */
(function () {
  "use strict";
  var S = window.YLG_SETTINGS;
  if (!S) return;

  var $ = function (id) { return document.getElementById(id); };
  var current = null;
  var saveTimer = null;
  var statusTimer = null;
  var systemTheme = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

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
      status(err ? "Save failed" : (successMessage || "Saved"));
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
   * written, 0..0.85, i.e. percent * 0.85.
   * ---------------------------------------------------------------------- */
  var ALPHA_MAX = 0.85;

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
    var t = (s && typeof s.tint === "string" && s.tint) ? s.tint : "auto";
    if (t === "custom") return "custom";
    if (!TINT_CUSTOM_SUPPORTED && customIntent) return "custom";
    return t;
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

  // State-only synchronization never replaces controls or rewrites a focused range.
  function syncState(s) {
    document.documentElement.setAttribute("data-ylg-motion", s.motion ? "on" : "off");
    var amb = s.ambientLight || {};
    syncPopupTheme(s.theme);
    applyDisabledStates(s);
    setSegmented("ylg-theme", s.theme);
    setSegmented("ylg-tint", uiTint(s));
    setSegmented("ylg-ambient-quality", amb.quality);
    syncColour(s);
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
    var a = s.ambientLight || {};
    setChecked("ylg-ambient-enabled", a.enabled);
    setSlider("ylg-amb-blur", "ylg-amb-blur-v", a.blur, px);
    setSlider("ylg-amb-spread", "ylg-amb-spread-v", a.spread, pct);
    setSlider("ylg-amb-saturation", "ylg-amb-saturation-v", Math.round(a.saturation * 100), pct);
    setSlider("ylg-amb-brightness", "ylg-amb-brightness-v", Math.round(a.brightness * 100), pct);
    setSlider("ylg-amb-fps", "ylg-amb-fps-v", a.fpsLimit, function (v) { return v + "fps"; });
    var o = s.optics || {};
    setChecked("ylg-optics-enabled", o.enabled !== false);
    setSlider("ylg-optics-lens", "ylg-optics-lens-v", o.lensPx, function(v) { return v === 0 ? "Off" : (1 / (1 - v / 400 * ((1 - 1/1.15)/0.23))).toFixed(2) + "×"; });
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
      // Removed controls are gone from the markup, so this loop only ever sees
      // the ids that still exist; an absent element simply never appears here.
      el.disabled = !s.enabled ||
        (ambientChild && !amb.enabled) ||
        (opticsChild && !optics.enabled) ||
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
    inp.addEventListener("input", function () {
      if (inp.disabled || !current) return;
      var raw = parseFloat(inp.value);
      var out = $(valId);
      if (out) out.textContent = fmt ? fmt(raw) : String(raw);
      fn(raw);
    });
  }

  // Close/hidden flush is best-effort; committed range changes and all discrete
  // controls dispatch their storage write immediately, without relying on teardown.
  window.addEventListener("pagehide", function () { flushSave(); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) flushSave();
  });

  document.addEventListener("DOMContentLoaded", function () {
    var loadingControls = document.querySelectorAll("input, button");
    for (var i = 0; i < loadingControls.length; i++) loadingControls[i].disabled = true;
    S.getStoredSettings(function (s) {
      var master = $("ylg-enabled"), reset = $("ylg-reset");
      if (master) master.disabled = false;
      if (reset) reset.disabled = false;
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
    document.addEventListener("change", function () { flushSave(); });

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
    for (var i = 0; i < swatches.length; i++) {
      swatches[i].addEventListener("click", function () {
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
    bindSlider("ylg-optics-lens", "ylg-optics-lens-v", function(v) { updateOptics({ lensPx: v }); }, function(v) { return v === 0 ? "Off" : (1 / (1 - v / 400 * ((1 - 1/1.15)/0.23))).toFixed(2) + "×"; });
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
        flushSave("Defaults restored");
      });
    }
  });
})();
