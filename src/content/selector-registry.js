/**
 * YouTube Liquid Glass - selector-registry.js (A3 scope, Lead-executed)
 * Defensive ordered-candidate selector registry. For each logical element an
 * array of CSS selectors is tried in order; the first match wins. Every
 * querySelector call is wrapped so an invalid selector can never throw and
 * never break the page. Selectors verified against desktop YouTube DOM as of
 * 2025-2026; candidates listed in priority order. Unverifiable candidates are
 * safe: they simply miss.
 *
 * API: YLG_SELECTORS.query(name, scope?) -> Element|null (scoped queries bypass cache)
 *      YLG_SELECTORS.queryAll(name, fresh?) -> Element[] (fresh bypasses cache)
 *      YLG_SELECTORS.invalidate()   (call on SPA navigation)
 *      YLG_SELECTORS.names
 */
(function () {
  "use strict";
  var root = (typeof window !== "undefined") ? window : globalThis;
  if (root.YLG_SELECTORS) return;

  var REGISTRY = {
    masthead: ["ytd-masthead", "#masthead"],
    mastheadContainer: ["#masthead-container", "ytd-masthead-holder"],
    searchForm: ["ytd-searchbox", "form#search-form"],
    searchInput: ["input#search", "input[name=\"search_query\"]"],
    searchBoxContainer: ["#search-container", "ytd-searchbox#search-form", "ytd-searchbox"],
    guide: ["#guide", "tp-yt-app-drawer#guide"],
    guideContent: ["#guide-inner-content", "#content-container"],
    guideEntries: ["ytd-guide-entry-renderer"],
    chipsBar: ["ytd-feed-filter-chip-bar-renderer", "#chips-wrapper", "yt-chip-cloud-renderer"],
    chip: ["yt-chip-cloud-chip-renderer", "ytd-chip-renderer"],
    homeGrid: ["ytd-rich-grid-renderer"],
    videoCard: ["ytd-rich-item-renderer", "ytd-video-renderer", "ytd-grid-video-renderer"],
    thumb: ["a#thumbnail", "#thumbnail"],
    // Player discovery stays centralized; combined candidates include recycled players.
    watchPage: ["ytd-watch-flexy"],
    player: ["#movie_player, .html5-video-player"],
    playerContainer: ["ytd-watch-flexy #player-container"],
    miniplayer: ["ytd-miniplayer"],
    playerVideo: ["video.html5-main-video", "video.video-stream", "video"],
    watchColumns: ["ytd-watch-flexy #columns"],
    watchPrimary: ["ytd-watch-flexy #primary", "#primary"],
    watchInfo: ["ytd-watch-metadata", "#below ytd-watch-metadata"],
    watchActions: ["#actions", "ytd-menu-renderer#actions"],
    comments: ["ytd-comments#comments", "ytd-comments-entry-point-header-renderer"],
    commentThread: ["ytd-comment-thread-renderer", "ytd-comment-view-model"],
    secondary: ["ytd-watch-flexy #secondary", "#secondary"],
    playlist: ["ytd-playlist-panel-renderer", "#playlist"],
    searchResults: ["ytd-search #contents", "ytd-item-section-renderer"],
    shortsPanel: ["ytd-shorts #page-navigation-container", "ytd-shorts"],
    popovers: ["ytd-popup-container tp-yt-iron-dropdown", "tp-yt-iron-dropdown", "ytd-popup-container .ytd-popup-container"],
    toasts: ["yt-notification-action-renderer-renderer"]
  };

  var cache = {}; // name -> Element|null (valid until invalidate())
  var cacheAll = {}; // name -> Element[]

  function safeQuery(selector, scope) {
    try { return (scope || document).querySelector(selector); }
    catch (e) { return null; } // invalid selector must never throw
  }
  function safeQueryAll(selector) {
    try { return Array.prototype.slice.call(document.querySelectorAll(selector)); }
    catch (e) { return []; }
  }

  function query(name, scope) {
    var candidates = REGISTRY[name];
    if (!candidates) return null;
    if (!scope && name in cache && cache[name] && cache[name].isConnected) return cache[name];
    for (var i = 0; i < candidates.length; i++) {
      var el = safeQuery(candidates[i], scope);
      if (el) { if (!scope) cache[name] = el; return el; }
    }
    if (!scope) cache[name] = null;
    return null;
  }

  function queryAll(name, fresh) {
    var candidates = REGISTRY[name];
    if (!candidates) return [];
    var valid = (cacheAll[name] || []).filter(function (el) { return el.isConnected; });
    if (!fresh && valid.length) return valid;
    var out = [];
    for (var i = 0; i < candidates.length; i++) {
      out = safeQueryAll(candidates[i]);
      if (out.length) break; // first candidate with hits wins
    }
    cacheAll[name] = out;
    return out;
  }

  function invalidate() {
    cache = {};
    cacheAll = {};
  }

  root.YLG_SELECTORS = {
    names: Object.keys(REGISTRY),
    query: query,
    queryAll: queryAll,
    invalidate: invalidate
  };
})();
