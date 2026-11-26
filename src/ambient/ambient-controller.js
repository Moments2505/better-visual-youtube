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

  function envOnResize() { sg.haloCache = null; envSchedule(0, true); }
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

  /* ==========================================================================
     FEATURE #5: SHORTS VERTICAL GLOW (GPU bilinear upscale, 0 CSS blur filter)
     ========================================================================== */
  var SG_W = 96, SG_H = 54, SG_TINY_W = 16, SG_TINY_H = 16;
  var SG_PROBE_W = 64, SG_PROBE_H = 112;
  var SG_VIDEO_EVENTS = ["play", "loadeddata", "seeked", "emptied"];
  var SG_CROP_HOST_ATTR = "data-ylg-shorts-cropped";
  var SG_CROP_VARS = [
    "--ylg-shorts-crop-top",
    "--ylg-shorts-crop-bottom",
    "--ylg-shorts-crop-left",
    "--ylg-shorts-crop-right"
  ];
  var motionQ = root.matchMedia ? root.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var colorsQ = root.matchMedia ? root.matchMedia("(forced-colors: active)") : null;
  var sg = {
    active: false, canvas: null, ctx: null,
    tiny: null, tinyCtx: null, vignette: null, vignetteKey: "",
    probe: null, probeCtx: null,
    video: null, videoHandlers: null, cropHost: null,
    lastSrc: "", lastPath: "",
    rvfcId: null, pollTimer: null, lastDraw: 0, lastCropScan: 0,
    cropScanPending: false, cropScanGen: 0,
    stableCropScans: 0, haloCache: null,
    crop: { top: 0, bottom: 0, left: 0, right: 0 }
  };

  function shortsAllowed(st) {
    if (!st || st.enabled === false) return false;
    var amb = st.ambientLight || {};
    if (amb.enabled === false || !(amb.modes && amb.modes.shorts === true)) return false;
    if (st.respectReducedMotion !== false && motionQ && motionQ.matches) return false;
    if (colorsQ && colorsQ.matches) return false;
    return true;
  }

  function safePathname() {
    try { return (typeof location !== "undefined" && location && typeof location.pathname === "string") ? location.pathname : ""; }
    catch (e) { return ""; }
  }

  function getShortsHost() {
    try { return document.querySelector("ytd-shorts") || null; }
    catch (e) { return null; }
  }

  function viewportDims() {
    var docEl = document.documentElement;
    var w = Number(root.innerWidth) || (docEl && Number(docEl.clientWidth)) || 1280;
    var h = Number(root.innerHeight) || (docEl && Number(docEl.clientHeight)) || 720;
    return { w: Math.max(100, w), h: Math.max(100, h) };
  }

  function shortsVideoVisible(v) {
    if (!v) return false;
    try {
      if (root.getComputedStyle) {
        var cs = root.getComputedStyle(v);
        if (cs && (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse" || cs.opacity === "0")) {
          return false;
        }
      }
    } catch (e) {}
    if (v.style && (v.style.display === "none" || v.style.visibility === "hidden")) return false;
    if (typeof v.getBoundingClientRect === "function") {
      try {
        var r = v.getBoundingClientRect();
        if (r && (r.width < 2 || r.height < 2)) return false;
      } catch (e2) {}
    }
    return true;
  }

  function shortsVideoPlaying(v) {
    return !!v && !v.paused && !v.ended && (typeof v.readyState !== "number" || v.readyState >= 2);
  }

  function queryShortsVideos(sel) {
    try {
      if (typeof document.querySelectorAll === "function") {
        var nl = document.querySelectorAll(sel);
        return nl ? Array.prototype.slice.call(nl) : [];
      }
      if (typeof document.querySelector === "function") {
        var one = document.querySelector(sel);
        return one ? [one] : [];
      }
    } catch (e) {}
    return [];
  }

  function scoreCenterDistance(v, vp) {
    if (typeof v.getBoundingClientRect !== "function") return 1e9;
    try {
      var r = v.getBoundingClientRect();
      if (!r || r.width < 2 || r.height < 2) return 1e12;
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var dx = cx - vp.w / 2;
      var dy = cy - vp.h / 2;
      var inView = r.right > 0 && r.bottom > 0 && r.left < vp.w && r.top < vp.h;
      return (dx * dx + dy * dy) + (inView ? 0 : 1e8);
    } catch (e) { return 1e9; }
  }

  function pickClosestToCenter(list) {
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    var vp = viewportDims();
    var best = list[0];
    var bestScore = scoreCenterDistance(best, vp);
    for (var i = 1; i < list.length; i++) {
      var s = scoreCenterDistance(list[i], vp);
      if (s < bestScore) { bestScore = s; best = list[i]; }
    }
    return best;
  }

  function findShortsVideo(fallback) {
    var i, candidates, playing = [], visible = [];
    // Priority 1: #shorts-player video (playing/visible preferred)
    candidates = queryShortsVideos("#shorts-player video");
    for (i = 0; i < candidates.length; i++) {
      if (!shortsVideoVisible(candidates[i])) continue;
      visible.push(candidates[i]);
      if (shortsVideoPlaying(candidates[i])) playing.push(candidates[i]);
    }
    if (playing.length) return pickClosestToCenter(playing);
    if (visible.length) return pickClosestToCenter(visible);

    // Priority 2: active reel renderer video
    playing = []; visible = [];
    candidates = queryShortsVideos("ytd-reel-video-renderer[is-active] video");
    for (i = 0; i < candidates.length; i++) {
      if (!shortsVideoVisible(candidates[i])) continue;
      visible.push(candidates[i]);
      if (shortsVideoPlaying(candidates[i])) playing.push(candidates[i]);
    }
    if (playing.length) return pickClosestToCenter(playing);
    if (visible.length) return pickClosestToCenter(visible);

    // Priority 3: centered visible playing video inside ytd-shorts
    playing = []; visible = [];
    candidates = queryShortsVideos("ytd-shorts video");
    for (i = 0; i < candidates.length; i++) {
      if (!shortsVideoVisible(candidates[i])) continue;
      visible.push(candidates[i]);
      if (shortsVideoPlaying(candidates[i])) playing.push(candidates[i]);
    }
    if (playing.length) return pickClosestToCenter(playing);
    if (fallback && shortsVideoVisible(fallback)) return fallback;
    if (visible.length) return pickClosestToCenter(visible);
    return fallback || null;
  }

  function clearHostCropAttrs(host) {
    if (!host) return;
    if (host.removeAttribute) { try { host.removeAttribute(SG_CROP_HOST_ATTR); } catch (e) {} }
    if (host.style && host.style.removeProperty) {
      for (var i = 0; i < SG_CROP_VARS.length; i++) {
        try { host.style.removeProperty(SG_CROP_VARS[i]); } catch (e2) {}
      }
    }
  }

  function clearShortsCrop() {
    sg.crop = { top: 0, bottom: 0, left: 0, right: 0 };
    sg.haloCache = null;
    var liveHost = getShortsHost();
    if (sg.cropHost) clearHostCropAttrs(sg.cropHost);
    if (liveHost && liveHost !== sg.cropHost) clearHostCropAttrs(liveHost);
    sg.cropHost = null;
  }

  function applyShortsCrop(crop) {
    if (!crop || (!crop.top && !crop.bottom && !crop.left && !crop.right)) {
      clearShortsCrop();
      return;
    }
    var host = getShortsHost() || sg.cropHost;
    var sameVals = sg.crop.top === crop.top && sg.crop.bottom === crop.bottom &&
      sg.crop.left === crop.left && sg.crop.right === crop.right;
    if (sameVals && host && host === sg.cropHost) return;
    sg.haloCache = null;
    if (sg.cropHost && host && sg.cropHost !== host) clearHostCropAttrs(sg.cropHost);
    sg.crop = { top: crop.top, bottom: crop.bottom, left: crop.left, right: crop.right };
    sg.cropHost = host || null;
    if (!host) return;
    if (host.setAttribute) { try { host.setAttribute(SG_CROP_HOST_ATTR, "1"); } catch (e) {} }
    if (host.style && host.style.setProperty) {
      try {
        host.style.setProperty("--ylg-shorts-crop-top", crop.top + "%");
        host.style.setProperty("--ylg-shorts-crop-bottom", crop.bottom + "%");
        host.style.setProperty("--ylg-shorts-crop-left", crop.left + "%");
        host.style.setProperty("--ylg-shorts-crop-right", crop.right + "%");
      } catch (e2) {}
    }
  }

  function isDarkBarPixel(data, idx) {
    var a = data[idx + 3];
    if (a < 20) return false;
    var r = data[idx], g = data[idx + 1], b = data[idx + 2];
    if (r + g + b > 54 || r > 22 || g > 22 || b > 22) return false;
    var maxC = r > g ? (r > b ? r : b) : (g > b ? g : b);
    var minC = r < g ? (r < b ? r : b) : (g < b ? g : b);
    return (maxC - minC) <= 8;
  }

  function isStrongContentPixel(data, idx) {
    var a = data[idx + 3];
    if (a < 20) return false;
    var r = data[idx], g = data[idx + 1], b = data[idx + 2];
    var maxC = r > g ? (r > b ? r : b) : (g > b ? g : b);
    var minC = r < g ? (r < b ? r : b) : (g < b ? g : b);
    return (r + g + b) > 72 || maxC > 30 || (maxC - minC) > 14;
  }

  function edgeSignalAt(data, w, axisLen, horizontal, crossPos, stopPos, dir) {
    var best = 0;
    for (var step = 0; step < 3; step++) {
      var p = stopPos + dir * step;
      if (p < 0 || p >= axisLen) break;
      var px = horizontal ? crossPos : p;
      var py = horizontal ? p : crossPos;
      var idx = (py * w + px) * 4;
      if (data[idx + 3] < 20) continue;
      var r = data[idx], g = data[idx + 1], b = data[idx + 2];
      var luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      var maxC = r > g ? (r > b ? r : b) : (g > b ? g : b);
      var sig = luma > maxC ? luma : maxC;
      if (sig > best) best = sig;
    }
    return best;
  }

  function scanBarAxis(data, w, h, horizontal, crossStart, crossEnd) {
    var axisLen = horizontal ? h : w;
    var crossLen = horizontal ? w : h;
    var cMin = (typeof crossStart === "number") ? Math.max(0, Math.min(crossLen - 1, crossStart)) : 0;
    var cMax = (typeof crossEnd === "number") ? Math.max(cMin, Math.min(crossLen - 1, crossEnd)) : (crossLen - 1);
    var total = cMax - cMin + 1;
    var maxDepth = Math.floor(axisLen * 0.42);
    var minSymDepth = Math.max(4, Math.round(axisLen * 0.04));
    var minAsymDepth = Math.max(6, Math.round(axisLen * 0.06));
    var tol = Math.max(3, Math.round(axisLen * 0.035));
    // Scan EVERY column/row in [cMin..cMax] (never skip outlier strokes such as baked-in top captions)
    var startDepths = new Array(total);
    var endDepths = new Array(total);
    var startLumas = new Array(total);
    var endLumas = new Array(total);
    var startMin = maxDepth, endMin = maxDepth;
    var c, k;
    for (c = cMin, k = 0; c <= cMax; c++, k++) {
      var sd = 0, sStopIdx = -1;
      while (sd < maxDepth) {
        var sx = horizontal ? c : sd;
        var sy = horizontal ? sd : c;
        var sIdx = (sy * w + sx) * 4;
        if (!isDarkBarPixel(data, sIdx)) {
          if (isStrongContentPixel(data, sIdx) || (sd + 1 >= maxDepth)) {
            sStopIdx = sIdx;
            break;
          }
          var nx = horizontal ? c : (sd + 1);
          var ny = horizontal ? (sd + 1) : c;
          if (!isDarkBarPixel(data, (ny * w + nx) * 4)) {
            sStopIdx = sIdx;
            break;
          }
        }
        sd++;
      }
      startDepths[k] = sd;
      startLumas[k] = (sd < maxDepth && sStopIdx >= 0) ? edgeSignalAt(data, w, axisLen, horizontal, c, sd, 1) : 0;
      if (sd < startMin) startMin = sd;

      var ed = 0, eStopIdx = -1;
      while (ed < maxDepth) {
        var pos = axisLen - 1 - ed;
        var ex = horizontal ? c : pos;
        var ey = horizontal ? pos : c;
        var eIdx = (ey * w + ex) * 4;
        if (!isDarkBarPixel(data, eIdx)) {
          if (isStrongContentPixel(data, eIdx) || (ed + 1 >= maxDepth)) {
            eStopIdx = eIdx;
            break;
          }
          var eNextPos = pos - 1;
          var enx = horizontal ? c : eNextPos;
          var eny = horizontal ? eNextPos : c;
          if (!isDarkBarPixel(data, (eny * w + enx) * 4)) {
            eStopIdx = eIdx;
            break;
          }
        }
        ed++;
      }
      endDepths[k] = ed;
      endLumas[k] = (ed < maxDepth && eStopIdx >= 0) ? edgeSignalAt(data, w, axisLen, horizontal, c, axisLen - 1 - ed, -1) : 0;
      if (ed < endMin) endMin = ed;
    }

    var startSupport = 0, startLumaSum = 0;
    var endSupport = 0, endLumaSum = 0;
    for (k = 0; k < total; k++) {
      if (startDepths[k] < maxDepth && startDepths[k] <= startMin + tol) {
        startSupport++;
        startLumaSum += startLumas[k];
      }
      if (endDepths[k] < maxDepth && endDepths[k] <= endMin + tol) {
        endSupport++;
        endLumaSum += endLumas[k];
      }
    }
    var startRatio = startSupport / total;
    var endRatio = endSupport / total;
    var startAvgLuma = startSupport ? (startLumaSum / startSupport) : 0;
    var endAvgLuma = endSupport ? (endLumaSum / endSupport) : 0;

    var rawStart = 0, rawEnd = 0;
    var isSymPair = startMin >= minSymDepth && startMin < maxDepth &&
      endMin >= minSymDepth && endMin < maxDepth &&
      startRatio >= 0.35 && endRatio >= 0.35 &&
      Math.abs(startMin - endMin) <= Math.max(4, Math.round(axisLen * 0.05));
    if (isSymPair) {
      rawStart = startMin;
      rawEnd = endMin;
    } else {
      var startMinSig = startRatio >= 0.80 ? 12 : 26;
      var endMinSig = endRatio >= 0.80 ? 12 : 26;
      rawStart = (startMin >= minAsymDepth && startMin < maxDepth && startRatio >= 0.50 && startAvgLuma >= startMinSig) ? startMin : 0;
      rawEnd = (endMin >= minAsymDepth && endMin < maxDepth && endRatio >= 0.50 && endAvgLuma >= endMinSig) ? endMin : 0;
    }

    var backoff = 1;
    var startPx = rawStart > backoff ? (rawStart - backoff) : 0;
    var endPx = rawEnd > backoff ? (rawEnd - backoff) : 0;
    var startPct = startPx ? Math.min(41, Math.round((startPx / axisLen) * 200) / 2) : 0;
    var endPct = endPx ? Math.min(41, Math.round((endPx / axisLen) * 200) / 2) : 0;
    if ((!startPct && !endPct) || (startPct + endPct) >= 82) {
      return { startPx: 0, endPx: 0, startPct: 0, endPct: 0 };
    }
    return { startPx: startPx, endPx: endPx, startPct: startPct, endPct: endPct };
  }

  function ensureShortsProbeCtx() {
    if (!sg.probe) {
      var p = document.createElement("canvas");
      p.width = SG_PROBE_W;
      p.height = SG_PROBE_H;
      sg.probe = p;
      sg.probeCtx = p.getContext ? p.getContext("2d", { willReadFrequently: true }) : null;
    }
    return sg.probeCtx;
  }

  function analyzeShortsProbeData(data) {
    if (!data || data.length < SG_PROBE_W * SG_PROBE_H * 4) return null;
    var globalLit = 0;
    for (var ggy = 1; ggy <= 5; ggy++) {
      var gpy = Math.min(SG_PROBE_H - 1, Math.max(0, Math.round((SG_PROBE_H * ggy) / 6)));
      for (var ggx = 1; ggx <= 5; ggx++) {
        var gpx = Math.min(SG_PROBE_W - 1, Math.max(0, Math.round((SG_PROBE_W * ggx) / 6)));
        if (!isDarkBarPixel(data, (gpy * SG_PROBE_W + gpx) * 4)) globalLit++;
      }
    }
    if (globalLit < 2) return null;
    // Single-pass by default: scan vertical across full width, then horizontal clipped inside vertical bars.
    // Conditional Pass 2 re-scans vertical only when horizontal pillarboxes exist.
    var vBars = scanBarAxis(data, SG_PROBE_W, SG_PROBE_H, true, 0, SG_PROBE_W - 1);
    var hCross0 = vBars.startPx > 0 ? vBars.startPx + 2 : 0;
    var hCross1 = vBars.endPx > 0 ? (SG_PROBE_H - 3 - vBars.endPx) : (SG_PROBE_H - 1);
    var hBars = (hCross1 - hCross0 >= 4) ? scanBarAxis(data, SG_PROBE_W, SG_PROBE_H, false, hCross0, hCross1) : { startPx: 0, endPx: 0, startPct: 0, endPct: 0 };
    if (hBars.startPx > 0 || hBars.endPx > 0) {
      var vCross0 = hBars.startPx > 0 ? hBars.startPx + 2 : 0;
      var vCross1 = hBars.endPx > 0 ? (SG_PROBE_W - 3 - hBars.endPx) : (SG_PROBE_W - 1);
      if (vCross1 - vCross0 >= 4) {
        vBars = scanBarAxis(data, SG_PROBE_W, SG_PROBE_H, true, vCross0, vCross1);
      }
    }
    if (!vBars.startPct && !vBars.endPct && !hBars.startPct && !hBars.endPct) {
      return { top: 0, bottom: 0, left: 0, right: 0 };
    }
    // Verify active interior contains visible non-bar content (reject fade-to-black frames -> hold previous crop)
    var x0 = hBars.startPx, x1 = SG_PROBE_W - 1 - hBars.endPx;
    var y0 = vBars.startPx, y1 = SG_PROBE_H - 1 - vBars.endPx;
    if (x1 - x0 < 3 || y1 - y0 < 3) return null;
    var lit = 0;
    for (var gy = 1; gy <= 5; gy++) {
      var py = Math.min(y1, Math.max(y0, Math.round(y0 + ((y1 - y0) * gy) / 6)));
      for (var gx = 1; gx <= 5; gx++) {
        var px = Math.min(x1, Math.max(x0, Math.round(x0 + ((x1 - x0) * gx) / 6)));
        if (!isDarkBarPixel(data, (py * SG_PROBE_W + px) * 4)) lit++;
      }
    }
    if (lit < 3) return null;
    return {
      top: vBars.startPct,
      bottom: vBars.endPct,
      left: hBars.startPct,
      right: hBars.endPct
    };
  }

  function detectShortsBars(v) {
    var pCtx = ensureShortsProbeCtx();
    if (!pCtx || !pCtx.drawImage || !pCtx.getImageData) return null;
    try {
      pCtx.drawImage(v, 0, 0, SG_PROBE_W, SG_PROBE_H);
      var img = pCtx.getImageData(0, 0, SG_PROBE_W, SG_PROBE_H);
      return analyzeShortsProbeData(img && img.data);
    } catch (e) {
      return null;
    }
  }

  function applyDetectedShortsCrop(detected) {
    if (!detected) return; // inconclusive/fade: preserve sg.crop AND sg.stableCropScans
    var sameCrop = sg.crop.top === detected.top && sg.crop.bottom === detected.bottom &&
      sg.crop.left === detected.left && sg.crop.right === detected.right;
    sg.stableCropScans = sameCrop ? Math.min(20, sg.stableCropScans + 1) : 0;
    applyShortsCrop(detected);
  }

  function ensureShortsVignette(cx, cy, r0, r1) {
    var key = [Math.round(cx), Math.round(cy), Math.round(r0), Math.round(r1)].join(",");
    if (sg.vignette && sg.vignetteKey === key) return sg.vignette;
    var vc = sg.vignette || document.createElement("canvas");
    vc.width = SG_W;
    vc.height = SG_H;
    var vctx = vc.getContext ? vc.getContext("2d") : null;
    if (vctx && vctx.createRadialGradient) {
      if (vctx.clearRect) vctx.clearRect(0, 0, SG_W, SG_H);
      var grad = vctx.createRadialGradient(cx, cy, Math.max(1, r0), cx, cy, Math.max(4, r1));
      grad.addColorStop(0, "rgba(0,0,0,0.95)");
      grad.addColorStop(0.58, "rgba(0,0,0,0.58)");
      grad.addColorStop(1, "rgba(0,0,0,0.06)");
      vctx.fillStyle = grad;
      vctx.fillRect(0, 0, SG_W, SG_H);
    }
    sg.vignette = vc;
    sg.vignetteKey = key;
    return vc;
  }

  function ensureShortsCanvas() {
    if (!sg.canvas) {
      var c = document.createElement("canvas");
      c.id = "ylg-shorts-glow";
      c.width = SG_W;
      c.height = SG_H;
      if (c.setAttribute) c.setAttribute("aria-hidden", "true");
      sg.canvas = c;
      sg.ctx = c.getContext ? c.getContext("2d", { willReadFrequently: false }) : null;
      if (sg.ctx) {
        sg.ctx.imageSmoothingEnabled = true;
        sg.ctx.imageSmoothingQuality = "medium";
      }
    }
    if (!sg.tiny) {
      var t = document.createElement("canvas");
      t.width = SG_TINY_W;
      t.height = SG_TINY_H;
      sg.tiny = t;
      sg.tinyCtx = t.getContext ? t.getContext("2d", { willReadFrequently: false }) : null;
    }
    var amb = (currentSettings && currentSettings.ambientLight) || {};
    var b = envClamp(Number(amb.brightness), 0, 2, 1);
    var op = Math.round(envClamp(0.45 + (b - 1) * 0.25, 0.15, 0.90, 0.68) * 100) / 100;
    if (sg.canvas.style && sg.canvas.style.setProperty) {
      sg.canvas.style.setProperty("--ylg-shorts-glow-opacity", String(op));
    }
    var host = null;
    try { host = document.querySelector("ytd-shorts") || document.body; } catch (e) { host = null; }
    if (host && sg.canvas.parentNode !== host) {
      if (host.prepend) host.prepend(sg.canvas);
      else if (host.insertBefore) host.insertBefore(sg.canvas, host.firstChild || null);
      else if (host.appendChild) host.appendChild(sg.canvas);
    }
  }

  function resolveHaloBox(v, now) {
    var ts = typeof now === "number" ? now : Date.now();
    var vp = viewportDims();
    var amb = (currentSettings && currentSettings.ambientLight) || {};
    var spread = envClamp(Number(amb.spread), 40, 300, 162) / 162;
    var crop = sg.crop || { top: 0, bottom: 0, left: 0, right: 0 };
    var cacheKey = [vp.w, vp.h, Math.round(spread * 100), crop.top, crop.bottom, crop.left, crop.right].join(",");
    if (sg.haloCache && sg.haloCache.video === v && sg.haloCache.key === cacheKey && (ts - sg.haloCache.at) < 1500) {
      return sg.haloCache.box;
    }
    var rect = null;
    try {
      var playerEl = document.querySelector("#shorts-player");
      rect = envRect(playerEl) || envRect(v);
    } catch (e) { rect = envRect(v); }
    var px, py, pw, ph;
    if (rect) {
      var cx0 = rect.left + rect.width * (crop.left / 100);
      var cx1 = rect.left + rect.width * (1 - crop.right / 100);
      var cy0 = rect.top + rect.height * (crop.top / 100);
      var cy1 = rect.top + rect.height * (1 - crop.bottom / 100);
      px = (cx0 / vp.w) * SG_W;
      py = (cy0 / vp.h) * SG_H;
      pw = Math.max(8, ((cx1 - cx0) / vp.w) * SG_W);
      ph = Math.max(8, ((cy1 - cy0) / vp.h) * SG_H);
    } else {
      pw = SG_W * 0.28;
      ph = SG_H * 0.84;
      px = (SG_W - pw) / 2;
      py = (SG_H - ph) / 2;
    }
    var cx = envClamp(px + pw / 2, 0, SG_W, SG_W / 2);
    var cy = envClamp(py + ph / 2, 0, SG_H, SG_H / 2);
    var halfW = Math.max(pw * 1.65 * spread, cx + 6, (SG_W - cx) + 6);
    var halfH = Math.max(ph * 1.15 * spread, cy + 6, (SG_H - cy) + 6);
    var box = {
      dx: cx - halfW, dy: cy - halfH, dw: halfW * 2, dh: halfH * 2,
      cx: cx, cy: cy,
      r0: Math.max(4, Math.min(pw, ph) * 0.32),
      r1: Math.max(SG_W, SG_H) * (0.52 + 0.16 * Math.min(1.5, spread))
    };
    sg.haloCache = { video: v, key: cacheKey, at: ts, box: box };
    return box;
  }

  function drawShortsFrame() {
    if (!sg.active || !sg.video || !sg.ctx || !sg.tinyCtx || document.hidden) return false;
    var v = sg.video;
    if (v.readyState < 2 || v.ended) return false;
    var amb = (currentSettings && currentSettings.ambientLight) || {};
    var fps = envClamp(Number(amb.fpsLimit), 1, 30, 16);
    var minMs = Math.round(1000 / fps);
    var now = Date.now();
    if (now - sg.lastDraw < minMs) return false;
    sg.lastDraw = now;
    if (amb.detectBarSize === true) {
      var interacting = (document.documentElement && document.documentElement.getAttribute && document.documentElement.getAttribute("data-ylg-scrubbing") === "1") ||
        !!document.querySelector('[data-ylg-dragging="1"]');
      var scanInterval = sg.stableCropScans < 3 ? 700 : (sg.stableCropScans < 6 ? 2500 : 4000);
      if (!interacting && !sg.cropScanPending && (sg.lastCropScan === 0 || (now - sg.lastCropScan >= scanInterval))) {
        sg.lastCropScan = now;
        if (typeof root.createImageBitmap === "function") {
          sg.cropScanPending = true;
          var scanGen = sg.cropScanGen;
          var scanVideo = v;
          try {
            root.createImageBitmap(v, {
              resizeWidth: SG_PROBE_W,
              resizeHeight: SG_PROBE_H,
              resizeQuality: "low"
            }).then(function (bmp) {
              sg.cropScanPending = false;
              try {
                if (sg.active && sg.video === scanVideo && scanGen === sg.cropScanGen && bmp) {
                  var pCtx = ensureShortsProbeCtx();
                  if (pCtx && pCtx.drawImage && pCtx.getImageData) {
                    pCtx.drawImage(bmp, 0, 0, SG_PROBE_W, SG_PROBE_H);
                    var img = pCtx.getImageData(0, 0, SG_PROBE_W, SG_PROBE_H);
                    applyDetectedShortsCrop(analyzeShortsProbeData(img && img.data));
                  }
                }
              } catch (eBmpDraw) {
              } finally {
                if (bmp && bmp.close) { try { bmp.close(); } catch (eClose) {} }
              }
            }, function () {
              sg.cropScanPending = false;
            });
          } catch (eBmpCall) {
            sg.cropScanPending = false;
          }
        } else {
          applyDetectedShortsCrop(detectShortsBars(v));
        }
      }
    } else if (sg.crop.top || sg.crop.bottom || sg.crop.left || sg.crop.right || sg.cropHost) {
      sg.stableCropScans = 0;
      clearShortsCrop();
    } else {
      sg.stableCropScans = 0;
    }
    try {
      var vw = Number(v.videoWidth) || 0;
      var vh = Number(v.videoHeight) || 0;
      var crop = sg.crop;
      if (crop && (crop.top || crop.bottom || crop.left || crop.right) && vw > 4 && vh > 4) {
        var sx = Math.round(vw * (crop.left / 100));
        var sy = Math.round(vh * (crop.top / 100));
        var sw = Math.max(1, vw - sx - Math.round(vw * (crop.right / 100)));
        var sh = Math.max(1, vh - sy - Math.round(vh * (crop.bottom / 100)));
        sg.tinyCtx.drawImage(v, sx, sy, sw, sh, 0, 0, SG_TINY_W, SG_TINY_H);
      } else {
        sg.tinyCtx.drawImage(v, 0, 0, SG_TINY_W, SG_TINY_H);
      }
      var halo = resolveHaloBox(v, now);
      sg.ctx.globalCompositeOperation = "source-over";
      sg.ctx.clearRect(0, 0, SG_W, SG_H);
      sg.ctx.drawImage(sg.tiny, halo.dx, halo.dy, halo.dw, halo.dh);
      var mask = ensureShortsVignette(halo.cx, halo.cy, halo.r0, halo.r1);
      sg.ctx.globalCompositeOperation = "destination-in";
      sg.ctx.drawImage(mask, 0, 0, SG_W, SG_H);
      sg.ctx.globalCompositeOperation = "source-over";
      return true;
    } catch (e) {
      return false;
    }
  }

  function detachShortsVideoListeners(v) {
    if (!v || !sg.videoHandlers || !v.removeEventListener) {
      sg.videoHandlers = null;
      return;
    }
    for (var i = 0; i < SG_VIDEO_EVENTS.length; i++) {
      var ev = SG_VIDEO_EVENTS[i];
      try { v.removeEventListener(ev, sg.videoHandlers[ev], true); } catch (e) {}
    }
    sg.videoHandlers = null;
  }

  function attachShortsVideoListeners(v) {
    if (!v || !v.addEventListener) return;
    var onRescan = function () {
      if (!sg.active || sg.video !== v) return;
      sg.lastSrc = v.currentSrc || v.src || "";
      sg.lastPath = safePathname();
      sg.lastDraw = 0;
      sg.lastCropScan = 0;
      sg.cropScanPending = false;
      sg.cropScanGen++;
      sg.stableCropScans = 0;
      sg.haloCache = null;
      drawShortsFrame();
    };
    var onEmptied = function () {
      if (sg.video !== v) return;
      sg.lastSrc = "";
      sg.lastDraw = 0;
      sg.lastCropScan = 0;
      sg.cropScanPending = false;
      sg.cropScanGen++;
      sg.stableCropScans = 0;
      sg.haloCache = null;
      clearShortsCrop();
    };
    sg.videoHandlers = {
      play: onRescan,
      loadeddata: onRescan,
      seeked: onRescan,
      emptied: onEmptied
    };
    for (var i = 0; i < SG_VIDEO_EVENTS.length; i++) {
      var ev = SG_VIDEO_EVENTS[i];
      try { v.addEventListener(ev, sg.videoHandlers[ev], true); } catch (e) {}
    }
  }

  function unbindShortsVideo() {
    if (sg.video) {
      detachShortsVideoListeners(sg.video);
      if (sg.rvfcId !== null && sg.video.cancelVideoFrameCallback) {
        try { sg.video.cancelVideoFrameCallback(sg.rvfcId); } catch (e) {}
      }
    }
    sg.rvfcId = null;
    sg.video = null;
    sg.lastSrc = "";
    sg.lastPath = "";
    sg.cropScanPending = false;
    sg.cropScanGen++;
    sg.stableCropScans = 0;
    sg.haloCache = null;
  }

  function bindShortsVideo(fallback) {
    var next = findShortsVideo(fallback);
    var src = next ? (next.currentSrc || next.src || "") : "";
    var path = safePathname();
    if (next === sg.video) {
      if (next && (src !== sg.lastSrc || path !== sg.lastPath)) {
        sg.lastSrc = src;
        sg.lastPath = path;
        sg.lastDraw = 0;
        sg.lastCropScan = 0;
        sg.cropScanPending = false;
        sg.cropScanGen++;
        sg.stableCropScans = 0;
        sg.haloCache = null;
        clearShortsCrop();
        drawShortsFrame();
      }
      return;
    }
    unbindShortsVideo();
    clearShortsCrop();
    sg.video = next;
    if (!next) return;
    sg.lastSrc = src;
    sg.lastPath = path;
    sg.lastDraw = 0;
    sg.lastCropScan = 0;
    sg.stableCropScans = 0;
    sg.haloCache = null;
    attachShortsVideoListeners(next);
    drawShortsFrame();
    if (next.requestVideoFrameCallback) {
      var tick = function () {
        sg.rvfcId = null;
        if (!sg.active || sg.video !== next) return;
        drawShortsFrame();
        if (!document.hidden) sg.rvfcId = next.requestVideoFrameCallback(tick);
      };
      sg.rvfcId = next.requestVideoFrameCallback(tick);
    }
  }

  function shortsStop() {
    sg.active = false;
    sg.lastDraw = 0;
    sg.lastCropScan = 0;
    sg.cropScanPending = false;
    sg.cropScanGen++;
    sg.stableCropScans = 0;
    sg.haloCache = null;
    if (sg.pollTimer !== null) { clearInterval(sg.pollTimer); sg.pollTimer = null; }
    unbindShortsVideo();
    clearShortsCrop();
    if (sg.canvas && sg.canvas.parentNode && sg.canvas.parentNode.removeChild) {
      sg.canvas.parentNode.removeChild(sg.canvas);
    }
  }

  function shortsSync(p) {
    if (!started || !p || p.mode !== "shorts" || !shortsAllowed(currentSettings)) {
      shortsStop();
      return;
    }
    sg.active = true;
    ensureShortsCanvas();
    bindShortsVideo(p.video);
    var amb = (currentSettings && currentSettings.ambientLight) || {};
    if (amb.detectBarSize !== true && (sg.crop.top || sg.crop.bottom || sg.crop.left || sg.crop.right || sg.cropHost)) {
      sg.stableCropScans = 0;
      clearShortsCrop();
    } else if (amb.detectBarSize === true && sg.video) {
      sg.lastCropScan = 0;
      sg.lastDraw = 0;
      sg.stableCropScans = 0;
      sg.haloCache = null;
      drawShortsFrame();
    }
    if (sg.pollTimer === null) {
      sg.pollTimer = setInterval(function () {
        if (!sg.active || document.hidden) return;
        var v = sg.video;
        if (v && v.isConnected !== false && !v.paused && !v.ended && sg.rvfcId !== null &&
            sg.canvas && sg.canvas.parentNode &&
            (v.currentSrc || v.src || "") === sg.lastSrc && safePathname() === sg.lastPath) {
          return;
        }
        var host = getShortsHost();
        if (host && sg.canvas && sg.canvas.parentNode !== host) ensureShortsCanvas();
        bindShortsVideo(null);
        if (sg.rvfcId === null || (sg.video && sg.video.paused)) {
          drawShortsFrame();
        }
      }, 1000);
    }
  }

  function shortsStats() {
    var c = sg.crop || { top: 0, bottom: 0, left: 0, right: 0 };
    return {
      active: sg.active,
      mounted: !!(sg.canvas && sg.canvas.parentNode),
      hasVideo: !!sg.video,
      crop: { top: c.top, bottom: c.bottom, left: c.left, right: c.right }
    };
  }

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
    shortsSync(p);
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
      unsubNav = NAV.onNavigation(function (info) {
        scheduleSync(info && info.reason === "player-state" ? 16 : 250);
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
    shortsStop();
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
      mounted: !!(vendorStats && vendorStats.state === "upstream") || sg.active,
      envelope: envStats(),
      shorts: shortsStats(),
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
