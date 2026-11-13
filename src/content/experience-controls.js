/**
 * YouTube Liquid Glass - experience-controls.js
 * Implements Feature #7 (Immersive Cinema idle dimming) and Feature #8
 * (Quick Hotkeys Alt+A / Alt+S / Alt+D with compositor-only Glass HUD Toast).
 * Exposes window.YLG_EXPERIENCE: updateSettings(s), teardown(), stats().
 */
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  if (root.YLG_EXPERIENCE) return;

  var S = root.YLG_SETTINGS;
  var PROFILE_ORDER = ["crystal", "frosted", "cinema", "eco"];
  var IDLE_DELAY_MS = 3500;
  var TOAST_HIDE_MS = 1400;
  var ACTIVITY_THROTTLE_MS = 250;

  var current = null;
  var cinemaActive = false;
  var hotkeysActive = false;
  var idleTimer = null;
  var lastActivityAt = 0;
  var unsubNav = null;
  var boundVideo = null;
  var lastNavUrl = "";
  var toastEl = null;
  var toastTimer = null;

  function t(key, fallback) {
    return S && typeof S.t === "function" ? S.t(key, fallback) : fallback;
  }

  function isEditable(el) {
    if (!el || el === document || el === root) return false;
    var tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (el.isContentEditable) return true;
    if (typeof el.getAttribute === "function" && el.getAttribute("contenteditable") === "true") return true;
    if (typeof el.closest === "function" && el.closest('[contenteditable="true"], [role="textbox"]')) return true;
    return false;
  }

  function activeVideo() {
    var direct = document.querySelector("ytd-watch-flexy:not([hidden]) video.html5-main-video, #movie_player video.html5-main-video, #movie_player video");
    if (direct) return direct;
    if (root.YLG_NAV && root.YLG_NAV.getPlayer) {
      try {
        var p = root.YLG_NAV.getPlayer();
        if (p && p.video) return p.video;
      } catch (e) {}
    }
    return null;
  }

  function isWatchRoute() {
    var path = (root.location && root.location.pathname) || "";
    if (path.indexOf("/watch") === 0) return true;
    return !!document.querySelector("ytd-watch-flexy");
  }

  function setCinemaIdle(on) {
    var de = document.documentElement;
    if (!de) return;
    if (on) {
      de.setAttribute("data-ylg-cinema-idle", "true");
    } else if (de.removeAttribute) {
      de.removeAttribute("data-ylg-cinema-idle");
    }
  }

  function setCinemaArmed(on) {
    var de = document.documentElement;
    if (!de) return;
    if (on) {
      de.setAttribute("data-ylg-cinema-armed", "true");
    } else if (de.removeAttribute) {
      de.removeAttribute("data-ylg-cinema-armed");
    }
  }

  function clearIdleTimer() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function armIdleTimer() {
    clearIdleTimer();
    if (!cinemaActive || document.hidden || !isWatchRoute()) return;
    idleTimer = setTimeout(function () {
      idleTimer = null;
      if (!cinemaActive || document.hidden || document.fullscreenElement || !isWatchRoute()) return;
      var v = activeVideo();
      if (!v || v.paused || v.ended) return;
      setCinemaIdle(true);
    }, IDLE_DELAY_MS);
  }

  function currentUrlKey() {
    var loc = root.location;
    if (!loc) return "";
    var pathSearch = String(loc.pathname || "") + String(loc.search || "");
    if (pathSearch) return pathSearch;
    return typeof loc.href === "string" ? loc.href : "";
  }

  function isCinemaIdleNow() {
    var de = document.documentElement;
    return !!(de && de.getAttribute && de.getAttribute("data-ylg-cinema-idle") === "true");
  }

  function bindWatchVideoEvents() {
    var v = activeVideo();
    if (v === boundVideo && boundVideo && boundVideo.isConnected !== false) return false;
    unbindWatchVideoEvents();
    boundVideo = v;
    if (!v || !v.addEventListener) return false;
    v.addEventListener("pause", onVideoPause, { passive: true });
    v.addEventListener("ended", onVideoPause, { passive: true });
    v.addEventListener("play", onVideoPlay, { passive: true });
    return true;
  }

  function unbindWatchVideoEvents() {
    if (boundVideo && boundVideo.removeEventListener) {
      boundVideo.removeEventListener("pause", onVideoPause, false);
      boundVideo.removeEventListener("ended", onVideoPause, false);
      boundVideo.removeEventListener("play", onVideoPlay, false);
    }
    boundVideo = null;
  }

  function onVideoPause() {
    setCinemaIdle(false);
    clearIdleTimer();
  }

  function onVideoPlay() {
    if (cinemaActive) armIdleTimer();
  }

  function noteActivity() {
    if (!cinemaActive) return;
    var de = document.documentElement;
    var wasIdle = !!(de && de.hasAttribute && de.hasAttribute("data-ylg-cinema-idle"));
    var now = Date.now();
    if (!wasIdle && now - lastActivityAt < ACTIVITY_THROTTLE_MS) return;
    lastActivityAt = now;
    if (wasIdle) setCinemaIdle(false);
    bindWatchVideoEvents();
    armIdleTimer();
  }

  function onNavEvent(info) {
    if (!cinemaActive) return;
    var reason = info && info.reason;
    var nextUrl = currentUrlKey();
    var urlChanged = nextUrl !== lastNavUrl;
    if (urlChanged) lastNavUrl = nextUrl;

    var newlyBound = bindWatchVideoEvents();

    if (reason === "fullscreenchange") {
      if (document.fullscreenElement) {
        setCinemaIdle(false);
        clearIdleTimer();
      } else if (idleTimer === null && !isCinemaIdleNow()) {
        armIdleTimer();
      }
      return;
    }

    if (reason === "schedule" && !urlChanged) {
      if (newlyBound && idleTimer === null && !isCinemaIdleNow()) {
        var v = boundVideo;
        if (v && !v.paused && !v.ended) {
          armIdleTimer();
        }
      }
      return;
    }

    setCinemaIdle(false);
    armIdleTimer();
  }

  function enableCinema() {
    if (cinemaActive) {
      setCinemaArmed(true);
      lastNavUrl = currentUrlKey();
      bindWatchVideoEvents();
      armIdleTimer();
      return;
    }
    cinemaActive = true;
    setCinemaArmed(true);
    lastNavUrl = currentUrlKey();
    lastActivityAt = Date.now();
    document.addEventListener("pointermove", noteActivity, { passive: true });
    document.addEventListener("pointerdown", noteActivity, { passive: true });
    document.addEventListener("wheel", noteActivity, { passive: true });
    document.addEventListener("keydown", noteActivity, { passive: true });
    if (root.YLG_NAV && root.YLG_NAV.onNavigation && !unsubNav) {
      unsubNav = root.YLG_NAV.onNavigation(onNavEvent);
    }
    bindWatchVideoEvents();
    armIdleTimer();
  }

  function disableCinema() {
    cinemaActive = false;
    clearIdleTimer();
    setCinemaIdle(false);
    setCinemaArmed(false);
    unbindWatchVideoEvents();
    lastNavUrl = "";
    if (unsubNav) {
      try { unsubNav(); } catch (e) {}
      unsubNav = null;
    }
    document.removeEventListener("pointermove", noteActivity, false);
    document.removeEventListener("pointerdown", noteActivity, false);
    document.removeEventListener("wheel", noteActivity, false);
    document.removeEventListener("keydown", noteActivity, false);
  }

  function ensureToast() {
    if (toastEl && toastEl.isConnected !== false) return toastEl;
    if (!document.body) return null;
    var el = document.createElement("div");
    el.id = "ylg-hud-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
    toastEl = el;
    return el;
  }

  function showToast(message) {
    var el = ensureToast();
    if (!el) return;
    el.textContent = message;
    el.setAttribute("data-ylg-visible", "true");
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastTimer = null;
      if (toastEl && toastEl.removeAttribute) toastEl.removeAttribute("data-ylg-visible");
    }, TOAST_HIDE_MS);
  }

  function profileLabel(id) {
    if (id === "crystal") return t("profileCrystal", "Crystal Clear");
    if (id === "frosted") return t("profileFrosted", "Tahoe Frosted");
    if (id === "cinema") return t("profileCinema", "Cinema Glow");
    return t("profileEco", "Eco Minimal");
  }

  function onHotkeyKeydown(e) {
    if (!hotkeysActive || !current || !S) return;
    if (!e || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return;
    if (isEditable(e.target)) return;

    var code = e.code;
    if (code !== "KeyA" && code !== "KeyS" && code !== "KeyD") return;
    if (e.preventDefault) e.preventDefault();

    var next = null;
    var label = "";

    if (code === "KeyA") {
      var nextAmbOn = !(current.ambientLight && current.ambientLight.enabled);
      next = S.normalizeSettings(Object.assign({}, current, {
        ambientLight: Object.assign({}, current.ambientLight, { enabled: nextAmbOn })
      }));
      label = nextAmbOn ? t("toastAmbientOn", "Ambient Light: On") : t("toastAmbientOff", "Ambient Light: Off");
    } else if (code === "KeyS" && typeof S.applyStyleProfile === "function") {
      var activeProf = typeof S.matchStyleProfile === "function" ? S.matchStyleProfile(current) : null;
      var idx = PROFILE_ORDER.indexOf(activeProf);
      var targetProf = PROFILE_ORDER[(idx + 1) % PROFILE_ORDER.length];
      next = S.applyStyleProfile(current, targetProf);
      label = t("toastProfilePrefix", "Profile: ") + profileLabel(targetProf);
    } else if (code === "KeyD") {
      var nextCinema = !current.immersiveCinema;
      next = S.normalizeSettings(Object.assign({}, current, { immersiveCinema: nextCinema }));
      label = nextCinema ? t("toastCinemaOn", "Immersive Cinema: On") : t("toastCinemaOff", "Immersive Cinema: Off");
    }

    if (!next) return;
    current = next;
    showToast(label);
    if (typeof S.saveSettings === "function") {
      S.saveSettings(next);
    }
  }

  function enableHotkeys() {
    if (hotkeysActive) return;
    hotkeysActive = true;
    document.addEventListener("keydown", onHotkeyKeydown);
  }

  function disableHotkeys() {
    hotkeysActive = false;
    document.removeEventListener("keydown", onHotkeyKeydown, false);
  }

  function updateSettings(s) {
    current = s || null;
    if (!current || current.enabled === false) {
      teardown();
      return;
    }
    if (current.immersiveCinema) {
      setCinemaIdle(false);
      if (cinemaActive) {
        setCinemaArmed(true);
        armIdleTimer();
      } else {
        enableCinema();
      }
    } else {
      disableCinema();
    }

    if (current.hotkeys !== false) enableHotkeys();
    else disableHotkeys();
  }

  function teardown() {
    disableCinema();
    disableHotkeys();
    if (toastTimer !== null) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (toastEl && toastEl.parentNode && toastEl.parentNode.removeChild) {
      toastEl.parentNode.removeChild(toastEl);
    }
    toastEl = null;
    current = null;
  }

  root.YLG_EXPERIENCE = {
    updateSettings: updateSettings,
    teardown: teardown,
    showToast: showToast,
    stats: function () {
      var de = document.documentElement;
      return {
        cinemaActive: cinemaActive,
        cinemaArmed: !!(de && de.getAttribute && de.getAttribute("data-ylg-cinema-armed") === "true"),
        cinemaIdle: !!(de && de.getAttribute && de.getAttribute("data-ylg-cinema-idle") === "true"),
        hotkeysActive: hotkeysActive,
        hasToast: !!(toastEl && toastEl.isConnected !== false)
      };
    }
  };
})();
