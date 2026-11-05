/**
 * YouTube Liquid Glass - navigation.js (A3 scope, Lead-executed)
 * SPA lifecycle + player discovery.
 *
 * Signals used (verified patterns on desktop YouTube):
 *   yt-navigate-start, yt-navigate-finish, yt-page-data-updated
 *     -> document-level CustomEvents fired by YouTube's polymer app.
 * Fallbacks: history.pushState/replaceState wrappers (guarded against double
 * wrap), popstate, one childList/subtree MutationObserver (debounced 500ms),
 * and a 5s reconciliation interval while enabled.
 *
 * API: YLG_NAV.init() / teardown()
 *      YLG_NAV.onNavigation(cb) -> unsubscribe   (cb gets {reason})
 *      YLG_NAV.getPlayer() -> {video, container, mode}   (mode: normal|theater|fullscreen|miniplayer|shorts|null)
 * Miniplayer is discovery-only: consumers must disable ambient rendering there.
 * Mode changes use scoped attribute observation; no new polling/animation loop.
 * Everything is idempotent and generation-guarded; teardown clears every
 * listener, observer and timer, and init() can re-arm afterwards.
 */
(function () {
  "use strict";
  var root = (typeof window !== "undefined") ? window : globalThis;
  if (root.YLG_NAV) return;

  var SEL = null; // resolved lazily (load order guarantees YLG_SELECTORS)
  var callbacks = [];
  var generation = 0;
  var started = false;
  var observer = null;
  var playerObserver = null;
  var playerTargets = [];
  var reconcileTimer = null;
  var applyTimer = null;
  var wrapped = { push: false, replace: false };

  function gen() { return generation; }

  /* ---- notification plumbing ---- */
  function notify(reason) {
    if (started) bindPlayerObserver();
    var g = generation;
    for (var i = 0; i < callbacks.length; i++) {
      try { callbacks[i]({ reason: reason, generation: g }); }
      catch (e) { /* a broken listener must not break navigation */ }
    }
  }

  function scheduleApply(delayMs) {
    if (!started || applyTimer !== null) return;
    applyTimer = setTimeout(function () {
      applyTimer = null;
      if (generation !== startGeneration) return;
      notify("schedule");
    }, delayMs || 0);
  }
  var startGeneration = 0;

  /* ---- YouTube SPA events ---- */
  function onNavigateStart() {
    if (SEL) SEL.invalidate();
    notify("yt-navigate-start");
  }
  function onNavigateFinish() {
    if (SEL) SEL.invalidate();
    scheduleApply(150);
  }
  function onPageData() {
    scheduleApply(150);
  }
  function onFullscreenChange() {
    notify("fullscreenchange");
  }

  /* ---- history fallback ---- */
  function wrapHistory() {
    try {
      if (!wrapped.push && !history.pushState.__ylgWrapped) {
        var origPush = history.pushState;
        history.pushState = function () {
          var r = origPush.apply(this, arguments);
          try { if (SEL) SEL.invalidate(); scheduleApply(200); } catch (e) {}
          return r;
        };
        try { history.pushState.__ylgWrapped = true; } catch (e2) {}
        wrapped.push = true;
      }
      if (!wrapped.replace && !history.replaceState.__ylgWrapped) {
        var origReplace = history.replaceState;
        history.replaceState = function () {
          var r = origReplace.apply(this, arguments);
          try { if (SEL) SEL.invalidate(); scheduleApply(200); } catch (e) {}
          return r;
        };
        try { history.replaceState.__ylgWrapped = true; } catch (e2) {}
        wrapped.replace = true;
      }
    } catch (e) { /* history APIs unavailable in some contexts */ }
  }

  /* ---- DOM mutation fallback (single, debounced, childList only) ---- */
  function startObserver() {
    if (observer) return;
    try {
      var target = document.body || document.documentElement;
      observer = new MutationObserver(function (records) {
        // Player labels, seek previews and SVG paths do not introduce page
        // surfaces. Ignore that churn, but still reconcile replaced videos.
        var relevant = !records || records.some(function (record) {
          var target = record.target;
          var el = target && (target.nodeType === 1 ? target : target.parentElement);
          if (!el || !el.closest || !el.closest("#movie_player")) return true;
          var nodes = Array.prototype.slice.call(record.addedNodes || []).concat(
            Array.prototype.slice.call(record.removedNodes || []));
          return nodes.some(function (node) {
            return node.nodeType === 1 && (node.tagName === "VIDEO" ||
              (node.querySelector && node.querySelector("video")));
          });
        });
        if (!relevant) return;
        scheduleApply(500);
      });
      observer.observe(target, { childList: true, subtree: true, attributes: false });
    } catch (e) { observer = null; }
  }

  function startReconcile() {
    if (reconcileTimer !== null) return;
    reconcileTimer = setInterval(function () {
      if (generation !== startGeneration) return;
      scheduleApply(0); // cheap idempotent class-existence pass
    }, 5000);
  }

  /* ---- player discovery (miniplayer rendering is explicitly unsupported) ---- */
  function selectors() { return SEL || root.YLG_SELECTORS || null; }
  function all(name) {
    var registry = selectors();
    // Player nodes can be recycled without navigation; bypass connected-node caches.
    return registry ? registry.queryAll(name, true) : [];
  }
  function visible(el, inViewport) {
    if (!el || !el.isConnected) return false;
    try {
      for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
        if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
        var style = root.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" ||
            style.visibility === "collapse" || style.opacity === "0") return false;
      }
      var box = el.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return false;
      // A recycled/offscreen mini must not disable a currently visible watch player.
      return !inViewport || (box.bottom > 0 && box.right > 0 &&
        box.top < root.innerHeight && box.left < root.innerWidth);
    } catch (e) { return false; }
  }
  function contains(parent, child) {
    return !!(parent && child && (parent === child || parent.contains(child)));
  }
  function hasMiniSignal(player, watches, minis) {
    if (player.classList && player.classList.contains("ytp-player-minimized")) return true;
    for (var i = 0; i < minis.length; i++) {
      if (contains(minis[i], player)) return true;
    }
    for (var j = 0; j < watches.length; j++) {
      if (contains(watches[j], player) && watches[j].hasAttribute("miniplayer")) return true;
    }
    return false;
  }
  function getPlayer() {
    var registry = selectors();
    var players = all("player"), watches = all("watchPage"), minis = all("miniplayer");
    var container = null, flexy = null, mini = false, mode = null;
    var miniPlayer = null, fullscreenPlayer = null;
    // Fullscreen wins over stale minimized/theater flags. Shorts keeps its own gate.
    var fullscreen = document.fullscreenElement;
    for (var i = 0; i < players.length; i++) {
      var candidate = players[i];
      if (fullscreen && (contains(fullscreen, candidate) || contains(candidate, fullscreen)) &&
          visible(candidate, false)) {
        fullscreenPlayer = candidate;
      }
      var miniSignal = hasMiniSignal(candidate, watches, minis);
      var candidateVideo = registry ? registry.query("playerVideo", candidate) : null;
      if (!miniPlayer && miniSignal && visible(candidate, true) && visible(candidateVideo, true)) {
        miniPlayer = candidate;
      }
      if (!container && !miniSignal && visible(candidate, false)) {
        container = candidate;
      }
    }
    if (fullscreenPlayer) container = fullscreenPlayer;
    else if (miniPlayer) { container = miniPlayer; mini = true; }
    if (!container) {
      var fallbacks = all("playerContainer");
      for (var f = 0; f < fallbacks.length; f++) {
        // Do not revive a deliberately rejected hidden/offscreen player via its wrapper.
        var fallback = fallbacks[f];
        if (players.some(function (player) { return contains(fallback, player); })) continue;
        var fallbackMini = hasMiniSignal(fallback, watches, minis);
        if (visible(fallback, fallbackMini)) {
          container = fallback; mini = fallbackMini; break;
        }
      }
    }
    for (var w = 0; w < watches.length; w++) {
      if (contains(watches[w], container)) { flexy = watches[w]; break; }
    }
    if ((location.pathname || "").indexOf("/shorts") === 0) mode = "shorts";
    else if (fullscreen) mode = "fullscreen";
    else if (mini) mode = "miniplayer";
    else if (flexy) mode = flexy.hasAttribute("theater") ? "theater" : "normal";
    var video = registry && container ? registry.query("playerVideo", container) : null;
    return { video: video || null, container: container, mode: mode };
  }

  // Attribute-only, exact targets: never observe classes throughout the document.
  // Existing SPA/child-list signals refresh this small target set after replacement.
  function bindPlayerObserver() {
    var targets = all("player").concat(all("watchPage"), all("miniplayer"));
    if (targets.length === playerTargets.length && targets.every(function (el, i) {
      return el === playerTargets[i];
    })) return;
    if (playerObserver) playerObserver.disconnect();
    playerTargets = targets;
    if (!playerObserver) {
      try {
        var observerGeneration = generation;
        playerObserver = new MutationObserver(function () {
          if (started && generation === observerGeneration) scheduleApply(0);
        });
      } catch (e) { playerTargets = []; return; }
    }
    var watches = all("watchPage"), minis = all("miniplayer");
    targets.forEach(function (el) {
      var attrs = watches.indexOf(el) !== -1 ? ["theater", "miniplayer", "hidden", "aria-hidden"] :
        minis.indexOf(el) !== -1 ? ["class", "active", "hidden", "aria-hidden", "style"] :
        ["class", "hidden", "aria-hidden"];
      playerObserver.observe(el, { attributes: true, attributeFilter: attrs });
    });
  }

  function init() {
    SEL = root.YLG_SELECTORS || null;
    if (started) return;
    started = true;
    startGeneration = generation;
    document.addEventListener("yt-navigate-start", onNavigateStart, true);
    document.addEventListener("yt-navigate-finish", onNavigateFinish, true);
    document.addEventListener("yt-page-data-updated", onPageData, true);
    document.addEventListener("fullscreenchange", onFullscreenChange, true);
    window.addEventListener("popstate", onNavigateFinish);
    wrapHistory();
    startObserver();
    bindPlayerObserver();
    startReconcile();
  }

  function teardown() {
    generation++;
    started = false;
    document.removeEventListener("yt-navigate-start", onNavigateStart, true);
    document.removeEventListener("yt-navigate-finish", onNavigateFinish, true);
    document.removeEventListener("yt-page-data-updated", onPageData, true);
    document.removeEventListener("fullscreenchange", onFullscreenChange, true);
    window.removeEventListener("popstate", onNavigateFinish);
    if (observer) { try { observer.disconnect(); } catch (e) {} observer = null; }
    if (playerObserver) { try { playerObserver.disconnect(); } catch (e) {} playerObserver = null; }
    playerTargets = [];
    if (reconcileTimer !== null) { clearInterval(reconcileTimer); reconcileTimer = null; }
    if (applyTimer !== null) { clearTimeout(applyTimer); applyTimer = null; }
  }

  root.YLG_NAV = {
    init: init,
    teardown: teardown,
    onNavigation: function (cb) {
      if (typeof cb !== "function") return function () {};
      callbacks.push(cb);
      return function () {
        var idx = callbacks.indexOf(cb);
        if (idx !== -1) callbacks.splice(idx, 1);
      };
    },
    getPlayer: getPlayer
  };
})();
