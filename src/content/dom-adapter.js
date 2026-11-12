/**
 * YouTube Liquid Glass - dom-adapter.js (A3 scope, Lead-executed)
 * Tags EXISTING YouTube elements with glass hooks. Philosophy: "glass the
 * container, never the content." No DOM rewriting, no listeners on YouTube's
 * own handlers, nothing inside the player.
 *
 * Guarantees:
 *  - Idempotent: applyAll() twice == once (data-ylg-tagged marker + Set).
 *  - Budgeted: <= 8 refraction surfaces, <= 60 cards per pass (resumable).
 *  - Player-safe: anything inside #movie_player / .html5-video-player, or
 *    <video>, or ambient artifacts (.ambientlight) is skipped.
 *  - Fully reversible: teardown() removes exactly what was added.
 *
 * API: YLG_ADAPTER.init() / applyAll() / teardown() / stats()
 */
(function () {
  "use strict";
  var root = (typeof window !== "undefined") ? window : globalThis;
  if (root.YLG_ADAPTER) return;

  var SEL = null;
  var NAV = null;
  var tagged = new Set();      // elements we touched (for teardown)
  var refractCount = 0;        // this pass
  var cardCursor = 0;          // resumable card budget across passes
  var passes = 0;
  var generation = 0;
  var started = false;
  var unsubNav = null;
  var navApplyTimer = null;
  var metadataWatch = null, metadataTarget = null;

  // YouTube may replace metadata.className while retaining our data markers.
  // Observe only that known node's class; never rescan the document on hover.
  function watchMetadata(el) {
    if (metadataTarget === el) return;
    if (metadataWatch) metadataWatch.disconnect();
    metadataWatch = null;
    metadataTarget = el;
    if (!el || typeof MutationObserver !== "function") return;
    var token = generation;
    metadataWatch = new MutationObserver(function () {
      if (!started || token !== generation || metadataTarget !== el || el.isConnected === false) return;
      if (tagged.has(el) && !el.classList.contains("ylg-glass")) addClass(el, "ylg-glass");
    });
    metadataWatch.observe(el, { attributes: true, attributeFilter: ["class"] });
  }

  var CLASSES_ADDED = ["ylg-glass", "ylg-card", "ylg-chip"];
  var ATTRS_ADDED = ["data-ylg-level", "data-ylg-refract", "data-ylg-tagged", "data-ylg-interactive", "data-ylg-search-focus"];

  function untag(el) {
    try {
      for (var i = 0; i < CLASSES_ADDED.length; i++) el.classList.remove(CLASSES_ADDED[i]);
      for (var j = 0; j < ATTRS_ADDED.length; j++) el.removeAttribute(ATTRS_ADDED[j]);
    } catch (e) {}
  }

  function pruneDetached() {
    tagged.forEach(function (el) {
      if (el.isConnected === false) {
        // Restore hooks before releasing: recycled nodes can be tagged on return.
        untag(el);
        tagged.delete(el);
      }
    });
  }

  function isSafe(el) {
    if (!el || el.nodeType !== 1) return false;
    var tn = el.tagName;
    if (tn === "VIDEO" || tn === "HTML") return false;
    try {
      if (el.closest && el.closest("#movie_player, .html5-video-player")) return false;
      // ambient engine artifacts (v1.1 contract): never touch
      if (el.closest && el.closest(".ambientlight")) return false;
      if (el.classList && (el.classList.contains("ylg-ambient") || el.classList.contains("ylg-glass-defs"))) return false;
    } catch (e) { return false; }
    return true;
  }

  function addClass(el, cls) { try { el.classList.add(cls); } catch (e) {} }
  function setAttr(el, k, v) { try { el.setAttribute(k, v); } catch (e) {} }

  /** Tag one element as a glass surface. level: hero|panel|floating|chip */
  function tag(el, level, opts) {
    opts = opts || {};
    if (!isSafe(el)) return false;
    if (el.getAttribute && el.getAttribute("data-ylg-tagged") === "1") {
      // A marker does not guarantee YouTube preserved our classes.
      var repaired = !el.classList.contains("ylg-glass");
      if (repaired) addClass(el, "ylg-glass");
      if (level === "chip" && !el.classList.contains("ylg-chip")) addClass(el, "ylg-chip");
      return repaired;
    }
    addClass(el, "ylg-glass");
    if (level === "chip") addClass(el, "ylg-chip");
    setAttr(el, "data-ylg-level", level);
    if (opts.refract && refractCount < 8) {
      setAttr(el, "data-ylg-refract", "1");
      refractCount++;
    }
    if (opts.interactive) setAttr(el, "data-ylg-interactive", "1");
    setAttr(el, "data-ylg-tagged", "1");
    tagged.add(el);
    return true;
  }

  function tagCards() {
    var cards = SEL.queryAll("videoCard");
    var budget = 60;
    var done = 0;
    // resume from cursor so later passes tag freshly-loaded rows
    for (var i = cardCursor; i < cards.length && done < budget; i++) {
      var card = cards[i];
      if (!isSafe(card)) continue;
      if (card.getAttribute("data-ylg-tagged") === "1") continue;
      addClass(card, "ylg-card");
      setAttr(card, "data-ylg-tagged", "1");
      tagged.add(card);
      done++;
    }
    cardCursor = i < cards.length ? i : 0;
    // thumbs inherit radius via CSS descendant selectors - no tagging needed
    var thumbs = SEL.queryAll("thumb");
    for (var j = 0; j < thumbs.length && j < 80; j++) {
      var th = thumbs[j];
      if (isSafe(th) && th.getAttribute && th.getAttribute("data-ylg-tagged") !== "1") {
        setAttr(th, "data-ylg-tagged", "1");
        tagged.add(th);
      }
    }
  }

  function applyAll() {
    if (!SEL) return;
    var g = generation;
    pruneDetached();
    SEL.invalidate(); // fresh queries each pass (DOM changes under us)
    refractCount = 0;
    passes++;

    // --- P0: header + search + sidebar + chips ---
    var masthead = SEL.query("masthead");
    if (masthead) tag(masthead, "hero", { refract: true });
    var search = SEL.query("searchBoxContainer") || SEL.query("searchForm");
    if (search) tag(search, "hero", { refract: true, interactive: true });
    var guideContent = SEL.query("guideContent") || SEL.query("guide");
    if (guideContent) tag(guideContent, "hero", { refract: true });

    var chips = SEL.queryAll("chip");
    for (var c = 0; c < chips.length && c < 40; c++) tag(chips[c], "chip");

    // --- P1: watch page + cards + popovers ---
    var watchInfo = SEL.query("watchInfo");
    if (watchInfo) tag(watchInfo, "panel", { refract: true });
    watchMetadata(watchInfo);
    var secondary = SEL.query("secondary");
    if (secondary) tag(secondary, "panel", { refract: true });
    var playlist = SEL.query("playlist");
    if (playlist && !secondary) tag(playlist, "panel", { refract: true });
    var comments = SEL.query("comments");
    if (comments) tag(comments, "panel"); // container only; rows stay native

    tagCards();

    var popovers = SEL.queryAll("popovers");
    for (var p = 0; p < popovers.length && p < 10; p++) tag(popovers[p], "floating");
    var toasts = SEL.queryAll("toasts");
    for (var t = 0; t < toasts.length && t < 4; t++) tag(toasts[t], "floating");
    try { if (root.YLG_OPTICS && root.YLG_OPTICS.refreshInterface) root.YLG_OPTICS.refreshInterface(); } catch (e) {}

    return g === generation; // false if torn down mid-pass
  }

  /* ---- search focus glow (delegated, no YouTube handler interference) ---- */
  function onFocusIn(e) {
    if (generation !== startGen) return;
    try {
      var t = e.target;
      if (t && t.closest && t.closest("ytd-searchbox, #search-container, form#search-form")) {
        var host = SEL && (SEL.query("searchBoxContainer") || SEL.query("searchForm"));
        if (host) host.setAttribute("data-ylg-search-focus", "1");
      }
    } catch (err) {}
  }
  function onFocusOut(e) {
    if (generation !== startGen) return;
    try {
      var host = SEL && (SEL.query("searchBoxContainer") || SEL.query("searchForm"));
      if (host && (!e.relatedTarget || !host.contains(e.relatedTarget))) {
        host.removeAttribute("data-ylg-search-focus");
      }
    } catch (err) {}
  }
  var startGen = 0;

  function init() {
    SEL = root.YLG_SELECTORS || null;
    NAV = root.YLG_NAV || null;
    if (started || !SEL) return;
    started = true;
    startGen = generation;
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    if (NAV && NAV.onNavigation) {
      // NAV owns a different generation counter. Capture OUR activation, not
      // its notification generation or the mutable startGen of a later init.
      var activeGeneration = generation;
      unsubNav = NAV.onNavigation(function () {
        if (!started || generation !== activeGeneration) return;
        if (navApplyTimer !== null) return;
        // after SPA nav: re-run the pass (chips/cards/popovers are new nodes)
        navApplyTimer = setTimeout(function () {
          navApplyTimer = null;
          function applyWhenReleased() {
            navApplyTimer = null;
            if (!started || generation !== activeGeneration) return;
            if (document.querySelector('[data-ylg-dragging="1"]')) {
              navApplyTimer = setTimeout(applyWhenReleased, 220);
              return;
            }
            applyAll();
          }
          applyWhenReleased();
        }, 220);
      });
    }
    applyAll();
  }

  function teardown() {
    generation++;
    started = false;
    if (metadataWatch) metadataWatch.disconnect();
    metadataWatch = null;
    metadataTarget = null;
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("focusout", onFocusOut, true);
    if (unsubNav) { try { unsubNav(); } catch (e) {} unsubNav = null; }
    if (navApplyTimer !== null) { clearTimeout(navApplyTimer); navApplyTimer = null; }
    tagged.forEach(untag);
    tagged.clear();
    if (SEL && SEL.invalidate) SEL.invalidate();
    cardCursor = 0;
  }

  function stats() {
    return { tagged: tagged.size, refractionSurfaces: refractCount, passes: passes };
  }

  root.YLG_ADAPTER = { init: init, applyAll: applyAll, teardown: teardown, stats: stats };
})();
