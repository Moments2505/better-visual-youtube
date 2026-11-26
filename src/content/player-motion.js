/* Native normal/theater change with lightweight post-toggle geometry and optics
   synchronization. No video/player FLIP scale or layout-thrashing sidebar overrides. */
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  if (root.YLG_PLAYER_MOTION) return;
  var active = false, frame = 0, settleTimer = 0, generation = 0;
  var SETTLE_DELAY_MS = 48;

  function eligible() {
    var de = document.documentElement;
    return de.getAttribute("data-ylg-enabled") === "true" &&
      de.getAttribute("data-ylg-motion") === "on" && !document.fullscreenElement &&
      (de.getAttribute("data-ylg-system-motion") === "ignore" || !(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches));
  }

  function cancel() {
    if (frame) root.cancelAnimationFrame(frame);
    frame = 0;
    if (settleTimer) (root.clearTimeout || clearTimeout)(settleTimer);
    settleTimer = 0;
  }

  function prepare(event) {
    if (!active || !eligible()) return;
    var target = event.target;
    if (event.type === "keydown") {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
          String(event.key).toLowerCase() !== "t" ||
          (target && target.closest && target.closest("input,textarea,select,[contenteditable],[role=textbox]"))) return;
    } else if (!target || !target.closest || !target.closest(".ytp-size-button")) return;
    var flexy = document.querySelector("ytd-watch-flexy");
    var player = document.querySelector("ytd-player#ytd-player");
    if (!flexy || !player || flexy.hasAttribute("miniplayer")) return;
    var theater = flexy.hasAttribute("theater"), token = ++generation;
    cancel();
    var attempts = 0;
    function settle() {
      frame = 0;
      if (!active || token !== generation) return;
      if (!eligible() || player.isConnected === false) { cancel(); return; }
      if (flexy.hasAttribute("theater") === theater) {
        if (++attempts < 3) frame = root.requestAnimationFrame(settle);
        else cancel();
        return;
      }
      settleTimer = (root.setTimeout || setTimeout)(function () {
        settleTimer = 0;
        if (!active || token !== generation || !eligible() || player.isConnected === false) return;
        try { if (root.YLG_AMBIENT_VENDOR && root.YLG_AMBIENT_VENDOR.syncGeometry) root.YLG_AMBIENT_VENDOR.syncGeometry(); } catch (_) {}
        try { if (root.YLG_OPTICS && root.YLG_OPTICS.refreshPlayer) root.YLG_OPTICS.refreshPlayer(); } catch (_) {}
      }, SETTLE_DELAY_MS);
    }
    frame = root.requestAnimationFrame(settle);
  }

  function onNavigation() { generation++; cancel(); }
  function onVisibility() { if (document.hidden) onNavigation(); }
  function init() {
    if (active) return;
    active = true;
    document.addEventListener("click", prepare, true);
    document.addEventListener("keydown", prepare, true);
    document.addEventListener("yt-navigate-start", onNavigation, true);
    document.addEventListener("fullscreenchange", onNavigation, true);
    document.addEventListener("visibilitychange", onVisibility, true);
    root.addEventListener("pagehide", onNavigation);
  }
  function teardown() {
    active = false; generation++; cancel();
    document.removeEventListener("click", prepare, true);
    document.removeEventListener("keydown", prepare, true);
    document.removeEventListener("yt-navigate-start", onNavigation, true);
    document.removeEventListener("fullscreenchange", onNavigation, true);
    document.removeEventListener("visibilitychange", onVisibility, true);
    root.removeEventListener("pagehide", onNavigation);
  }
  root.YLG_PLAYER_MOTION = { init: init, teardown: teardown };
})();
