/**
 * YouTube Liquid Glass - ambient-controller.js
 * Coordinates player layout mode signals (`YLG_AMBIENT_VENDOR.refreshMode`) and
 * the clear-mode video-local glow envelope (`.ambientlight__filter[data-ylg-ambient-envelope="1"]`)
 * for the bundled ambient engine.
 *
 * Facade (called by bootstrap.js):
 *   YLG_AMBIENT.init() / updateSettings(fullSnapshot) / teardown() / stats()
 */
(function () {
  "use strict";
  var root = (typeof window !== "undefined") ? window : globalThis;
  if (root.YLG_AMBIENT) return;

  /* ==========================================================================
     VIDEO-LOCAL GLOW ENVELOPE  (clear mode only)
     --------------------------------------------------------------------------
     Confines the bundled engine's decorative glow to a soft envelope anchored
     to the measured video box ONLY while `html[data-ylg-fill="none"]`:
       - no persisted setting is written (no storage access);
       - `.ambientlight__container` keeps opacity 1;
       - surroundingContentFillOpacity / ShadowSize are untouched;
       - at every nonzero opacity the engine keeps its page-wide falloff so
         glass panels sample the full ambient backdrop.
     ========================================================================== */
  var ENV_ATTR = "data-ylg-ambient-envelope";
  var ENV_VARS = ["--ylg-env-x", "--ylg-env-y", "--ylg-env-w", "--ylg-env-h",
    "--ylg-env-x0", "--ylg-env-x1", "--ylg-env-y0", "--ylg-env-y1"];
  var ENV_CHROME = {
    top: ["#masthead-container", "ytd-masthead", "#masthead"],
    bottom: ["ytd-watch-metadata", "#primary-inner", "#below"],
    left: ["#guide", "ytd-guide-renderer"],
    right: ["#secondary", "#secondary-inner"]
  };
  var env = {
    active: false, video: null, mode: null, container: null, filter: null,
    timer: null, timerDelay: 0, pendingFull: false, retries: 0, listening: false, last: null
  };

  function envClamp(v, min, max, def) {
    v = (typeof v === "number" && isFinite(v)) ? v : def;
    return Math.min(max, Math.max(min, v));
  }

  function envRect(el) {
    if (!el || el.isConnected === false) return null;
    var r = null;
    try { r = el.getBoundingClientRect(); } catch (e) { return null; }
    if (!r || r.width < 2 || r.height < 2) return null;
    try {
      var cs = root.getComputedStyle(el);
      if (!cs) return null;
      if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return null;
    } catch (e2) { /* no computed style: keep the rect */ }
    return r;
  }

  function envGap(side, r, v) {
    if (side === "top") return r.bottom <= v.top + 1 ? v.top - r.bottom : null;
    if (side === "bottom") return r.top >= v.bottom - 1 ? r.top - v.bottom : null;
    if (side === "left") return r.right <= v.left + 1 ? v.left - r.right : null;
    return r.left >= v.right - 1 ? r.left - v.right : null;
  }

  function envBudget(side, v) {
    var names = ENV_CHROME[side] || [];
    for (var i = 0; i < names.length; i++) {
      var el = null;
      try { el = document.querySelector(names[i]); } catch (e) { el = null; }
      var r = envRect(el);
      if (!r) continue;
      if (side === "top" || side === "bottom") {
        if (r.right <= v.left + 1 || r.left >= v.right - 1) continue;
      } else if (r.bottom <= v.top + 1 || r.top >= v.bottom - 1) continue;
      var gap = envGap(side, r, v);
      if (gap !== null) return Math.max(0, gap);
    }
    return Infinity;
  }

  function envReach(w, h, amb) {
    var spread = envClamp(Number(amb && amb.spread), 0, 200, 75);
    var spreadReach = (spread / 100) * Math.max(w, h) / 2;
    var blur2 = Math.min(100, envClamp(Number(amb && amb.blur), 0, 140, 60) / 1.275);
    return spreadReach + Math.round(h * 0.0025 * blur2);
  }

  function envClearNode(node) {
    if (!node) return;
    try { node.removeAttribute(ENV_ATTR); } catch (e) {}
    try {
      for (var i = 0; i < ENV_VARS.length; i++) node.style.removeProperty(ENV_VARS[i]);
    } catch (e2) {}
  }

  function envWriteNode(node, g) {
    try {
      node.style.setProperty("--ylg-env-x", g.x + "px");
      node.style.setProperty("--ylg-env-y", g.y + "px");
      node.style.setProperty("--ylg-env-w", g.w + "px");
      node.style.setProperty("--ylg-env-h", g.h + "px");
      node.style.setProperty("--ylg-env-x0", g.x0 + "px");
      node.style.setProperty("--ylg-env-x1", g.x1 + "px");
      node.style.setProperty("--ylg-env-y0", g.y0 + "px");
      node.style.setProperty("--ylg-env-y1", g.y1 + "px");
      node.setAttribute(ENV_ATTR, "1");
    } catch (e) {}
  }

  function envResolve() {
    var st = currentSettings;
    var de = document.documentElement;
    var amb = (st && st.ambientLight) || {};
    if (!st || st.enabled === false || amb.enabled === false) return "off";
    if (de.getAttribute("data-ylg-fill") !== "none") return "off";
    var p = detectPlayer();
    if (!p || !p.video || !p.container) return "off";
    if (p.mode === "fullscreen" || p.mode === "shorts" || p.mode === "miniplayer") return "off";
    if (p.mode && amb.modes && amb.modes[p.mode] === false) return "off";
    var container = null;
    try { container = document.querySelector(".ambientlight__container"); } catch (e) { container = null; }
    if (!container) return "pending";
    var filter = null;
    try { filter = container.querySelector(".ambientlight__filter"); } catch (e2) { filter = null; }
    if (!filter) return "pending";
    env.video = p.video;
    env.mode = p.mode || "normal";
    env.container = container;
    env.filter = filter;
    return "armed";
  }

  function envNodesAlive() {
    if (!env.video || env.video.isConnected === false) return false;
    if (!env.container || env.container.isConnected === false) return false;
    if (!env.filter || env.filter.isConnected === false) {
      var filter = null;
      try { filter = env.container.querySelector(".ambientlight__filter"); } catch (e) { filter = null; }
      if (!filter) return false;
      env.filter = filter;
    }
    return true;
  }

  function envMeasure() {
    if (!envNodesAlive()) return null;
    var amb = (currentSettings && currentSettings.ambientLight) || {};
    var c = null, v = null;
    try {
      c = env.container.getBoundingClientRect();
      v = env.video.getBoundingClientRect();
    } catch (e) { return null; }
    if (!c || !v || c.width < 8 || c.height < 8) return null;
    if (!v.width || !v.height || v.width < 8 || v.height < 8) return null;

    var x = Math.round(v.left - c.left);
    var y = Math.round(v.top - c.top);
    var w = Math.round(v.width);
    var h = Math.round(v.height);
    var cw = Math.round(c.width);
    var ch = Math.round(c.height);
    var reach = envReach(w, h, amb);
    var avail = {
      left: Math.max(0, x),
      top: Math.max(0, y),
      right: Math.max(0, cw - (x + w)),
      bottom: Math.max(0, ch - (y + h))
    };
    var bands = {};
    var sides = ["left", "right", "top", "bottom"];
    for (var i = 0; i < sides.length; i++) {
      var side = sides[i];
      bands[side] = Math.round(Math.max(0, Math.min(reach, avail[side], envBudget(side, v))));
    }
    return {
      filter: env.filter, container: env.container,
      x: x, y: y, w: w, h: h,
      x0: bands.left, x1: bands.right, y0: bands.top, y1: bands.bottom,
      reach: Math.round(reach)
    };
  }

  function envRun(full) {
    if (full) {
      var state = envResolve();
      if (state === "off") { envStop(); return; }
      if (state === "pending") { envWaitForNodes(); return; }
    }
    var g = envMeasure();
    if (!g) { envStop(); return; }
    env.retries = 0;
    if (env.filter && env.filter !== g.filter) envClearNode(env.filter);
    env.filter = g.filter;
    env.container = g.container;
    envWriteNode(g.filter, g);
    env.active = true;
    env.last = g;
    envListen(true);
  }

  var ENV_RETRY_MAX = 6;
  var ENV_RETRY_MS = 350;
  function envWaitForNodes() {
    if (env.retries >= ENV_RETRY_MAX) { env.retries = 0; return; }
    env.retries++;
    envSchedule(ENV_RETRY_MS, true);
  }

  function envListen(on) {
    if (on === env.listening) return;
    env.listening = on;
    try {
      if (on) {
        root.addEventListener("resize", envOnResize, { passive: true });
        root.addEventListener("scroll", envOnScroll, { passive: true, capture: true });
      } else {
        root.removeEventListener("resize", envOnResize, false);
        root.removeEventListener("scroll", envOnScroll, true);
      }
    } catch (e) {}
  }

  function envSchedule(delay, full) {
    if (full) env.pendingFull = true;
    var wait = delay || 0;
    if (env.timer !== null) {
      if (wait === 0 && env.timerDelay > 0) {
        clearTimeout(env.timer);
        env.timer = null;
      } else { return; }
    }
    var g = generation;
    env.timerDelay = wait;
    env.timer = setTimeout(function () {
      env.timer = null;
      env.timerDelay = 0;
      if (g !== generation) return;
      var runFull = env.pendingFull;
      env.pendingFull = false;
      try { envRun(runFull); } catch (e) {}
    }, wait);
  }

  function envOnResize() { envSchedule(0, true); }
  function envOnScroll() { envSchedule(120, false); }

  function envStop() {
    if (env.timer !== null) { clearTimeout(env.timer); env.timer = null; }
    env.timerDelay = 0;
    env.pendingFull = false;
    env.retries = 0;
    if (env.filter) envClearNode(env.filter);
    env.filter = null;
    env.container = null;
    env.video = null;
    env.mode = null;
    env.active = false;
    env.last = null;
    envListen(false);
  }

  function envStats() {
    if (!env.active || !env.last) return { active: false };
    var g = env.last;
    return {
      active: true, x: g.x, y: g.y, w: g.w, h: g.h,
      bands: { left: g.x0, right: g.x1, top: g.y0, bottom: g.y1 },
      reach: g.reach, mode: env.mode
    };
  }

  /* ---------------- Facade (singleton, navigation-aware) ---------------- */
  var currentSettings = null;
  var generation = 0;
  var started = false;
  var unsubNav = null;
  var syncTimer = null;
  var unsubVendor = null;

  function detectPlayer() {
    try {
      var NAV = root.YLG_NAV;
      if (NAV && NAV.getPlayer) return NAV.getPlayer();
    } catch (e) {}
    try {
      var container = document.querySelector("#movie_player") || document.querySelector("ytd-watch-flexy #player-container");
      var video = (container && (container.querySelector("video.html5-main-video") || container.querySelector("video.video-stream") || container.querySelector("video"))) ||
        document.querySelector("video.html5-main-video") || document.querySelector("video.video-stream") ||
        document.querySelector("ytd-app video.html5-main-video") || document.querySelector("ytd-app video.video-stream");
      var flexy = document.querySelector("ytd-watch-flexy");
      var mode = location.pathname.indexOf("/shorts") === 0 ? "shorts"
        : document.fullscreenElement ? "fullscreen"
        : (flexy && flexy.hasAttribute("theater")) ? "theater"
        : (flexy || video) ? "normal" : null;
      return { video: video, container: container, mode: mode };
    } catch (e2) { return { video: null, container: null, mode: null }; }
  }

  function sync() {
    if (!currentSettings) return;
    envSchedule(0, true);
    var p = detectPlayer();
    var vendor = root.YLG_AMBIENT_VENDOR;
    if (vendor && vendor.refreshMode) {
      vendor.refreshMode(p.mode);
    }
  }

  function scheduleSync(ms) {
    var g = generation;
    if (syncTimer !== null) clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      syncTimer = null;
      if (g === generation && started) sync();
    }, ms || 0);
  }

  function onFsChange() {
    scheduleSync(120);
  }

  function onPageShow() {
    scheduleSync(0);
  }

  function init() {
    if (started) return;
    started = true;
    var NAV = root.YLG_NAV;
    if (NAV && NAV.onNavigation) {
      unsubNav = NAV.onNavigation(function () {
        scheduleSync(250);
      });
    }
    var vendor = root.YLG_AMBIENT_VENDOR;
    if (vendor && vendor.onStateChanged) {
      unsubVendor = vendor.onStateChanged(function () { scheduleSync(0); });
    }
    document.addEventListener("fullscreenchange", onFsChange, true);
    root.addEventListener("pageshow", onPageShow);
    envSchedule(0, true);
  }

  function updateSettings(fullSnapshot) {
    currentSettings = fullSnapshot;
    scheduleSync(0);
    envSchedule(0, true);
  }

  function teardown() {
    generation++;
    started = false;
    envStop();
    if (syncTimer !== null) { clearTimeout(syncTimer); syncTimer = null; }
    if (unsubVendor) { unsubVendor(); unsubVendor = null; }
    if (unsubNav) { try { unsubNav(); } catch (e) {} unsubNav = null; }
    document.removeEventListener("fullscreenchange", onFsChange, true);
    root.removeEventListener("pageshow", onPageShow);
    currentSettings = null;
  }

  function stats() {
    var vendor = root.YLG_AMBIENT_VENDOR;
    var vendorStats = (vendor && vendor.stats) ? vendor.stats() : null;
    return {
      mounted: !!(vendorStats && vendorStats.state === "upstream"),
      envelope: envStats(),
      vendor: vendorStats
    };
  }

  root.YLG_AMBIENT = {
    init: init,
    updateSettings: updateSettings,
    teardown: teardown,
    stats: stats
  };
})();
