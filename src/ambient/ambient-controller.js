/**
 * YouTube Liquid Glass - ambient-controller.js (A6 scope, Lead-executed)
 * Controller + facade. Controller API (contract):
 *   createAmbientController(options) -> { mount, updateSettings, pause, resume, destroy }
 * Facade (called by bootstrap.js):
 *   YLG_AMBIENT.init() / updateSettings(fullSnapshot) / teardown() / stats()
 *
 * Positioning contract: the ambient host is inserted as a SIBLING BEFORE the
 * player container in its parent - NEVER inside #movie_player. If the parent
 * is statically positioned, a layout-neutral position:relative is applied to
 * it and the original inline value is restored on destroy. The host paints
 * below the player (DOM order + z-index), never intercepts pointer events.
 *
 * Mode gates: normal/theater mount per settings.modes; fullscreen and shorts
 * are unmounted (fullscreen host is outside the fullscreen element anyway;
 * documented limitation v1.1).
 *
 * YouTube native ambient compatibility: custom engine ON adds
 * html[data-ylg-ambient="on"] CSS suppression of the native cinematic layer
 * (ambient.css, documented, UNVERIFIED selectors); the attribute is removed
 * by the settings layer when ambient is off - no persisted YouTube setting
 * is touched.
 */
(function () {
  "use strict";
  var root = (typeof window !== "undefined") ? window : globalThis;
  if (root.YLG_AMBIENT) return;

  var PERF = root.YLG_AMBIENT_PERF;
  var RENDERER = root.YLG_AMBIENT_RENDERER;

  function defaults() {
    return {
      enabled: true, quality: "auto", intensity: 0.55, blur: 60, spread: 75,
      saturation: 1.1, brightness: 1.0, smoothing: 0.7, fpsLimit: 12,
      modes: { normal: true, theater: true, fullscreen: false, shorts: false }
    };
  }

  /* ==========================================================================
     VIDEO-LOCAL GLOW ENVELOPE  (clear mode only, A6 scope, Lead-approved)
     --------------------------------------------------------------------------
     Measured defect (real Edge, clear mode ON): the masthead computed fully
     transparent (no fill, no blur, no shadow) yet its rows still measured
     ~rgb(120,130,140); hiding `.ambientlight__container` turned the same rows
     pure black. So the haze was the bundled engine's decorative glow painting
     the whole page behind transparent chrome.

     This confines that glow to a soft envelope anchored to the MEASURED video
     box, and it deliberately avoids the four P2 mistakes:
       - no persisted setting is written (no storage access at all);
       - `.ambientlight__container` keeps opacity 1 - we mask paint, not alpha,
         and we never touch the container element;
       - surroundingContentFillOpacity / ShadowSize are untouched;
       - no matte fill is added anywhere.
     It is additionally gated on `html[data-ylg-fill="none"]`, i.e. it only
     exists while the glass has NO fill at all. At every nonzero opacity the
     engine keeps its original page-wide falloff, so the backdrop that glass
     panels sample is byte-for-byte what P0/P1/P2 restored.

     Why the mask lives on `.ambientlight__filter` and not on the container:
       - the container also paints the page background (`--ytal-page-background`)
         and the debanding layer; masking it would clip those too. Filtering the
         decorative projector wrapper leaves the page background intact, which
         is exactly what a transparent panel must show;
       - it is the outermost wrapper of the decorative projectors, and it is the
         element that can carry the engine's CSS blur, so CSS's own order
         (filter -> clip-path -> mask) clips the BLURRED output, not the input.
     Per CSS Masking, mask-image on one element applies after that element's
     filter, so both axis gradients clip the final blurred glow.
     ========================================================================== */
  var ENV_ATTR = "data-ylg-ambient-envelope";
  var ENV_VARS = ["--ylg-env-x", "--ylg-env-y", "--ylg-env-w", "--ylg-env-h",
    "--ylg-env-x0", "--ylg-env-x1", "--ylg-env-y0", "--ylg-env-y1"];
  // Read-only chrome obstacles, in fallback order. These are measured, never
  // restyled; an obstacle only counts when it really is on that side of the
  // video, so a missing/relocated node degrades to "no obstacle" instead of a
  // wrong envelope.
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

  /* Distance from a video edge to the nearest chrome edge on that side.
     Infinity means "no obstacle" (nothing there to wash). All distances are
     VIEWPORT deltas on purpose: it makes the result correct for a page-anchored
     container and for the engine's `[data-ambientlight-fixed]` viewport-anchored
     one without branching, because each side is measured against chrome in the
     same coordinate space the mask is drawn in. */
  function envBudget(side, v) {
    var names = ENV_CHROME[side] || [];
    for (var i = 0; i < names.length; i++) {
      var el = null;
      try { el = document.querySelector(names[i]); } catch (e) { el = null; }
      var r = envRect(el);
      if (!r) continue;
      // Only a node that is genuinely outside that edge may bound the glow.
      if (side === "top" || side === "bottom") {
        if (r.right <= v.left + 1 || r.left >= v.right - 1) continue;
      } else if (r.bottom <= v.top + 1 || r.top >= v.bottom - 1) continue;
      var gap = envGap(side, r, v);
      if (gap !== null) return Math.max(0, gap);
    }
    return Infinity;
  }

  /* How far the bundled engine actually paints beyond the video box.
     Derived from its own projector maths (content-main.js):
       levels = max(2, round(spread/edge) + innerStrength + 1), innerStrength = 2
       each level scales by edge/100, and the last level's overshoot is
       (edge/100) * round(spread/edge) ~= spread/100 of HALF the long side.
     The y scale factor is multiplied by the aspect ratio exactly so that the
     pixel overshoot matches the x axis, so one number covers both axes.
     Blur adds its visible reach: the engine blurs by
     round(videoHeight * 0.0025 * blur2) and the bridge maps our pixel dial to
     blur2 = blur / 1.275, so a Gaussian of radius R is visible out to ~R. */
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
      // Variables first, attribute last: the CSS rule must never be active for
      // a frame without geometry (its fallbacks are 0px, which would mask the
      // glow away entirely).
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

  /* Full resolution: state gates + node lookup. Three-way result. "off" means a
     gate says no (cheap, final). "pending" means the page wants the envelope but
     the bundled engine has not created its glow nodes yet - it builds them
     asynchronously after `start()`, so one state signal can arrive first.
     "armed" means the nodes exist and can be measured. Only state/nav/resize
     signals run this; detectPlayer() is too costly for a scroll burst. */
  function envResolve() {
    var st = currentSettings;
    var de = document.documentElement;
    var amb = (st && st.ambientLight) || {};
    if (!st || st.enabled === false || amb.enabled === false) return "off";
    // Clear mode only. Any nonzero opacity keeps the original page-wide glow,
    // because that glow is the backdrop the glass panels refract.
    if (de.getAttribute("data-ylg-fill") !== "none") return "off";
    var p = detectPlayer();
    // No player yet is "off", not "pending": navigation, lifecycle and engine
    // state signals all re-run the full resolve, so waiting here would only add
    // timers to pages that have no video.
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
    // Room left inside the mask box, per side; a band can never leave it.
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
      // min(reach the engine paints, room in the box, distance to real chrome)
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
    env.retries = 0; // a real measurement resets the bounded wait
    if (env.filter && env.filter !== g.filter) envClearNode(env.filter);
    env.filter = g.filter;
    env.container = g.container;
    envWriteNode(g.filter, g);
    env.active = true;
    env.last = g;
    envListen(true);
  }

  /* Bounded wait for the bundled engine's nodes, NOT a polling loop: at most
     ENV_RETRY_MAX attempts, each re-scheduled through the same coalescing timer,
     and every attempt is generation-guarded. If the engine never builds them the
     wait simply expires and the glow keeps its original page-wide falloff. */
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
    } catch (e) { /* listeners are an optimisation, not a requirement */ }
  }

  /* One coalesced task, never an animation frame: geometry is read at most once
     per burst, and a pending task is never re-armed (first signal wins) - except
     that an immediate request may pre-empt a pending scroll debounce, so a state
     change never waits behind it. */
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
  /* Scroll matters because the masthead is fixed: its document position moves,
     so the top band does, and the engine's `[data-ambientlight-fixed]` layout
     anchors everything to the viewport. Geometry only - detectPlayer() is not
     cheap enough to run inside a scroll burst. */
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

  function createAmbientController(options) {
    options = options || {};
    var settings = defaults();
    var lowFx = !!options.lowFx;
    var profile = PERF ? PERF.resolveProfile(settings.quality, lowFx) : null;
    var renderer = RENDERER ? RENDERER.createRenderer() : null;
    var host = null;
    var mountedVideo = null;
    var onResize = null;
    var canvas = null;
    var mountedFor = null; // mode string the host is mounted for
    var restoredParentStyle = null;
    var parentEl = null;
    var paused = false;
    var destroyed = false;
    var costWindow = [];

    function cssVars(amb) {
      return {
        "--ylg-ambient-intensity": String(amb.intensity),
        "--ylg-ambient-blur": Math.round(amb.blur) + "px",
        "--ylg-ambient-blur-scale": String(profile ? profile.blurScale : 1),
        "--ylg-ambient-sat": String(amb.saturation),
        "--ylg-ambient-bri": String(amb.brightness),
        "--ylg-ambient-spread": String(Math.round(amb.spread))
      };
    }

    function applyVars(amb) {
      if (!host) return;
      var vars = cssVars(amb);
      for (var k in vars) {
        try { host.style.setProperty(k, vars[k]); } catch (e) {}
      }
    }

    function positionHost() {
      if (!host || !host.parentNode || !mountedVideo) return;
      try {
        var vRect = mountedVideo.getBoundingClientRect();
        var pRect = host.parentNode.getBoundingClientRect();
        if (!vRect || vRect.width < 8 || vRect.height < 8) return;
        var spread = Number((settings && settings.spread) || 0);
        var grow = Math.round(vRect.width * Math.min(0.45, Math.max(0, spread) / 100));
        host.style.left = (vRect.left - pRect.left - grow) + "px";
        host.style.top = (vRect.top - pRect.top - grow) + "px";
        host.style.width = (vRect.width + grow * 2) + "px";
        host.style.height = (vRect.height + grow * 2) + "px";
        host.style.inset = "auto";
        host.setAttribute("data-ylg-anchored", "video");
      } catch (e) {}
    }

    function modeAllowed(mode) {
      if (mode === "miniplayer") return false;
      var m = (mode === "theater" || mode === "fullscreen" || mode === "shorts") ? mode : "normal";
      return !!(settings.enabled && settings.modes && settings.modes[m]);
    }

    function unmount() {
      if (renderer) renderer.stop();
      if (onResize) {
        window.removeEventListener("resize", onResize, false);
        window.removeEventListener("scroll", onResize, true);
        onResize = null;
      }
      if (host && host.parentNode) { try { host.parentNode.removeChild(host); } catch (e) {} }
      if (restoredParentStyle !== null && parentEl) {
        try {
          if (restoredParentStyle === "") parentEl.style.removeProperty("position");
          else parentEl.style.setProperty("position", restoredParentStyle);
        } catch (e) {}
      }
      restoredParentStyle = null;
      parentEl = null;
      host = null;
      mountedVideo = null;
      canvas = null;
      mountedFor = null;
    }

    function mount(video, container, mode) {
      if (destroyed || !renderer || !video || !container) return false;
      if (!modeAllowed(mode)) { unmount(); return false; }
      if (host && mountedVideo === video && mountedFor === mode && canvas && canvas.isConnected) {
        applyVars(settings); // refresh vars on remount requests
        return true;
      }
      unmount();
      var parent = container.parentNode;
      if (!parent) return false;
      // Prefer the outermost stable player wrapper: inserting a sibling inside
      // the player's internal container (#container) can disrupt YouTube's
      // player bootstrap on /watch pages.
      var anchor = container;
      try {
        var outer = container.closest ? container.closest("ytd-player") : null;
        if (outer && outer.parentNode && outer.parentNode.id !== "movie_player") {
          anchor = outer;
          parent = outer.parentNode;
        }
      } catch (eOuter) {}

      host = document.createElement("div");
      host.className = "ylg-ambient-host";
      host.setAttribute("data-ylg-ambient-host", "1");
      host.setAttribute("aria-hidden", "true");
      renderer.ensureAllocated(); // allocate first so getCanvas() returns the real sampling canvas
      canvas = renderer.getCanvas() || document.createElement("canvas");
      canvas.className = "ylg-ambient-canvas";
      host.appendChild(canvas);
      applyVars(settings);

      // layout-neutral positioning guarantee for the parent
      try {
        var computed = window.getComputedStyle(parent).position;
        restoredParentStyle = (parent.style && parent.style.position) ? parent.style.position : "";
        if (computed === "static") parent.style.setProperty("position", "relative");
      } catch (e) { restoredParentStyle = null; }

      parent.insertBefore(host, anchor); // before outer player wrapper => paints below
      parentEl = parent;
      mountedVideo = video;
      mountedFor = mode;
      // Anchor the host to the VIDEO box measured in the host's own containing
      // block. Percentage insets resolved against an arbitrary ancestor made the
      // glow spill across the entire page (verified defect in live Edge).
      positionHost();
      if (!onResize) {
        onResize = function () { positionHost(); };
        try { window.addEventListener("resize", onResize, { passive: true }); } catch (eR) {}
        try { window.addEventListener("scroll", onResize, { passive: true, capture: true }); } catch (eS) {}
      }

      renderer.ensureAllocated();
      renderer.setProfile(profile);
      positionHost();
      renderer.updateSettings({
        intensity: settings.intensity, blur: settings.blur, spread: settings.spread,
        saturation: settings.saturation, brightness: settings.brightness,
        smoothing: settings.smoothing, fpsLimit: settings.fpsLimit
      });
      renderer.start(video);
      return true;
    }

    function updateSettings(fullSettings) {
      if (destroyed) return;
      var amb = (fullSettings && fullSettings.ambientLight) ? fullSettings.ambientLight : fullSettings;
      if (!amb || typeof amb !== "object") return;
      var qualityChanged = amb.quality !== settings.quality;
      settings.enabled = amb.enabled !== false;
      settings.quality = amb.quality || "auto";
      settings.intensity = clampNum(amb.intensity, 0, 1, 0.55);
      settings.blur = clampNum(amb.blur, 0, 140, 60);
      settings.spread = clampNum(amb.spread, 0, 200, 75);
      settings.saturation = clampNum(amb.saturation, 0, 2, 1.1);
      settings.brightness = clampNum(amb.brightness, 0, 2, 1.0);
      settings.smoothing = clampNum(amb.smoothing, 0, 1, 0.7);
      settings.fpsLimit = Math.round(clampNum(amb.fpsLimit, 1, 30, 12));
      settings.modes = Object.assign({ normal: true, theater: true, fullscreen: false, shorts: false }, amb.modes || {});

      if (qualityChanged || !profile) {
        profile = PERF ? PERF.resolveProfile(settings.quality, lowFx) : profile;
        if (renderer) renderer.setProfile(profile);
        costWindow = [];
      }
      applyVars(settings);
      if (renderer) {
        renderer.updateSettings({
          intensity: settings.intensity, blur: settings.blur, spread: settings.spread,
          saturation: settings.saturation, brightness: settings.brightness,
          smoothing: settings.smoothing, fpsLimit: settings.fpsLimit
        });
      }
    }

    function clampNum(v, min, max, def) {
      v = (typeof v === "number" && isFinite(v)) ? v : def;
      return Math.min(max, Math.max(min, v));
    }

    function pause() { if (!destroyed && renderer) { paused = true; renderer.stop(); } }
    function resume() {
      if (destroyed || !renderer || !host) return;
      paused = false;
      var v = options.getVideo ? options.getVideo() : null;
      if (v) renderer.start(v);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      unmount();
      if (renderer) renderer.destroy();
    }

    function stats() {
      var rs = renderer ? renderer.stats() : {};
      return {
        mounted: !!host, mode: mountedFor, paused: paused,
        profile: profile ? profile.name : null, tainted: rs.tainted,
        draws: rs.draws || 0, avgFrameMs: rs.avgFrameMs || 0
      };
    }

    return {
      mount: mount, updateSettings: updateSettings, pause: pause,
      resume: resume, destroy: destroy, stats: stats, reposition: positionHost
    };
  }

  /* ---------------- Facade (singleton, navigation-aware) ---------------- */
  var controller = null;
  var currentSettings = null;
  var generation = 0;
  var started = false;
  var unsubNav = null;
  var lowFx = false;
  var syncTimer = null;
  var unsubVendor = null;

  function detectPlayer() {
    try {
      var NAV = root.YLG_NAV;
      if (NAV && NAV.getPlayer) return NAV.getPlayer();
    } catch (e) {}
    // feature-detected fallback discovery
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
    // Clear-mode envelope: re-resolve on every state/nav/mode signal. It is
    // independent of which engine paints (vendor or native), so it runs before
    // the ownership branches below.
    envSchedule(0, true);
    var g = generation;
    var p = detectPlayer();
    // Ownership is isolated-world runtime state, never a page-writable DOM
    // attribute or an optimistic storage flag. Reserve pending/error too: the
    // legacy loader may still be importing, so native fallback is not safe.
    var vendor = root.YLG_AMBIENT_VENDOR;
    if (vendor) {
      if (vendor.refreshMode) vendor.refreshMode(p.mode);
      if (vendor.ownsRenderer && vendor.ownsRenderer()) {
        if (controller) { controller.destroy(); controller = null; }
        return;
      }
    }
    if (g !== generation) return;
    var amb = currentSettings.ambientLight || {};
    var want = !!(currentSettings.enabled !== false && amb.enabled !== false);
    if (!want || !p.video || !p.container || p.mode === "fullscreen" || p.mode === "shorts" || p.mode === "miniplayer" ||
        (p.mode && amb.modes && amb.modes[p.mode] === false)) {
      if (controller) { controller.destroy(); controller = null; }
      return;
    }
    if (!controller) controller = createAmbientController({ lowFx: lowFx, getVideo: function () { return detectPlayer().video; } });
    controller.updateSettings(currentSettings);
    controller.mount(p.video, p.container, p.mode || "normal");
  }

  function scheduleSync(ms) {
    var g = generation;
    if (syncTimer !== null) clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      syncTimer = null;
      if (g === generation && started) sync();
    }, ms || 0);
  }

  function init() {
    if (started) return;
    started = true;
    try {
      lowFx = (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 4) <= 4;
    } catch (e) { lowFx = false; }
    var NAV = root.YLG_NAV;
    if (NAV && NAV.onNavigation) {
      unsubNav = NAV.onNavigation(function (info) {
        if (info && info.generation !== undefined) { /* gen-checked in sync */ }
        scheduleSync(250);
      });
    }
    var vendor = root.YLG_AMBIENT_VENDOR;
    if (vendor && vendor.onStateChanged) unsubVendor = vendor.onStateChanged(function () { scheduleSync(0); });
    var lifecycle = root.YLG_AMBIENT_LIFECYCLE;
    if (lifecycle) lifecycle.start({
      getPlayer: detectPlayer,
      onPlayerChanged: function () { scheduleSync(0); },
      onPageHide: function () { if (controller) controller.pause(); },
      onPageShow: function () { if (controller) controller.resume(); scheduleSync(0); }
    });
    document.addEventListener("fullscreenchange", onFsChange, true);
    document.addEventListener("visibilitychange", onVisibility, true);
    envSchedule(0, true);
  }

  var fsGen = 0;
  function onFsChange() {
    if (fsGen !== generation) { fsGen = generation; }
    scheduleSync(120);
  }
  function onVisibility() {
    if (document.hidden) { if (controller) controller.pause(); }
    else { if (controller) controller.resume(); }
  }

  function updateSettings(fullSnapshot) {
    currentSettings = fullSnapshot;
    scheduleSync(0);
    // Opacity crossing 0 (data-ylg-fill) and clear-mode-exit must re-evaluate
    // the envelope immediately, not one navigation later.
    envSchedule(0, true);
  }

  function teardown() {
    generation++;
    started = false;
    // Removes the envelope attribute, its geometry variables and both listeners
    // from the vendor node before anything else is torn down.
    envStop();
    if (syncTimer !== null) { clearTimeout(syncTimer); syncTimer = null; }
    if (unsubVendor) { unsubVendor(); unsubVendor = null; }
    if (root.YLG_AMBIENT_LIFECYCLE) root.YLG_AMBIENT_LIFECYCLE.stop();
    if (unsubNav) { try { unsubNav(); } catch (e) {} unsubNav = null; }
    document.removeEventListener("fullscreenchange", onFsChange, true);
    document.removeEventListener("visibilitychange", onVisibility, true);
    if (controller) { try { controller.destroy(); } catch (e) {} controller = null; }
    currentSettings = null;
  }

  function stats() {
    var result = controller ? controller.stats() : { mounted: false };
    // Diagnostics for QA: the measured envelope, when one is applied.
    result.envelope = envStats();
    var vendor = root.YLG_AMBIENT_VENDOR;
    if (vendor && vendor.stats) result.vendor = vendor.stats();
    return result;
  }

  root.YLG_AMBIENT = {
    init: init,
    updateSettings: updateSettings,
    teardown: teardown,
    stats: stats,
    createAmbientController: createAmbientController
  };
})();
