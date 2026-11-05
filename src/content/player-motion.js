/* Native normal/theater change with a temporary player-wrapper FLIP and a
   clipped slide of the real recommendations column. No video/progress style,
   playback state or native event is rewritten; all temporary styles release. */
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  if (root.YLG_PLAYER_MOTION) return;
  var active = false, frame = 0, animation = null, generation = 0;
  var DURATION = 460;
  var sidebarAnimation = null, sidebarCleanup = null;
  function clearSidebar() {
    var previous = sidebarAnimation;
    sidebarAnimation = null;
    if (previous) { previous.onfinish = previous.oncancel = null; previous.cancel(); }
    if (sidebarCleanup) { var restore = sidebarCleanup; sidebarCleanup = null; restore(); }
  }
  function sidebarMotion(exiting) {
    var node = document.querySelector("#secondary");
    if (!node || !node.style || typeof node.animate !== "function") return;
    var rect = node.getBoundingClientRect(), viewport = root.innerHeight;
    if (!(rect.width > 0 && rect.height > 0 && viewport > rect.top && rect.top >= 0)) return;
    var distance = viewport - rect.top + 16;
    if (exiting) {
      // Keep the real column painted at its old viewport position while native
      // theater CSS hides/reflows it. Clip to the visible slice, never clone a
      // long thumbnail list or delay the native mode change.
      var values = { position: "fixed", left: rect.left + "px", top: rect.top + "px",
        width: rect.width + "px", height: Math.min(rect.height, viewport - rect.top) + "px",
        "min-height": "0px", "max-height": "none", "max-width": "none", margin: "0px",
        "box-sizing": "border-box", overflow: "hidden", display: "block", visibility: "visible",
        "z-index": "100", "pointer-events": "none" };
      var saved = [];
      Object.keys(values).forEach(function (key) {
        var old = node.style.getPropertyValue(key), priority = node.style.getPropertyPriority(key);
        node.style.setProperty(key, values[key], "important");
        saved.push({ key: key, old: old, priority: priority, ours: node.style.getPropertyValue(key) });
      });
      sidebarCleanup = function () {
        saved.forEach(function (item) {
          // Preserve any native inline update that replaced our value meanwhile.
          if (node.style.getPropertyValue(item.key) !== item.ours ||
              node.style.getPropertyPriority(item.key) !== "important") return;
          if (item.old) node.style.setProperty(item.key, item.old, item.priority);
          else node.style.removeProperty(item.key);
        });
      };
    }
    try {
      var run = node.animate(exiting ? [
        { translate: "0 0" }, { translate: "0 " + distance + "px" }
      ] : [{ translate: "0 " + distance + "px" }, { translate: "0 0" }],
      { duration: 420, easing: "cubic-bezier(0.4,0,0.2,1)", fill: exiting ? "forwards" : "none" });
      sidebarAnimation = run;
      run.onfinish = run.oncancel = function () { if (sidebarAnimation === run) clearSidebar(); };
    } catch (_) { clearSidebar(); }
  }
  function eligible() {
    var de = document.documentElement;
    return de.getAttribute("data-ylg-enabled") === "true" &&
      de.getAttribute("data-ylg-motion") === "on" && !document.fullscreenElement &&
      !(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function cancel() {
    if (frame) root.cancelAnimationFrame(frame);
    frame = 0;
    var previous = animation;
    animation = null;
    if (previous) { previous.onfinish = previous.oncancel = null; previous.cancel(); }
    clearSidebar();
    document.documentElement.removeAttribute("data-ylg-player-transition");
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
    if (!flexy || !player || typeof player.animate !== "function" || flexy.hasAttribute("miniplayer")) return;
    var before = player.getBoundingClientRect();
    if (before.width <= 0 || before.height <= 0) return;
    var theater = flexy.hasAttribute("theater"), token = ++generation;
    cancel();
    if (!theater) sidebarMotion(true);
    document.documentElement.setAttribute("data-ylg-player-transition", "1");
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
      var after = player.getBoundingClientRect();
      if (after.width <= 0 || after.height <= 0) { cancel(); return; }
      if (theater) sidebarMotion(false);
      var dx = before.left - after.left, dy = before.top - after.top;
      var sx = before.width / after.width, sy = before.height / after.height;
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(sx - 1) + Math.abs(sy - 1) < .01) {
        document.documentElement.removeAttribute("data-ylg-player-transition");
        return;
      }
      try {
        var run = player.animate([
          { transformOrigin: "0 0", transform: "translate(" + dx + "px," + dy + "px) scale(" + sx + "," + sy + ")" },
          { transformOrigin: "0 0", transform: "translate(0px,0px) scale(1,1)" }
        ], { duration: DURATION, easing: "cubic-bezier(0.4,0,0.2,1)", fill: "none" });
        animation = run;
        run.onfinish = run.oncancel = function () {
          if (animation === run) {
            animation = null;
            try { if (root.YLG_OPTICS && root.YLG_OPTICS.refreshPlayer) root.YLG_OPTICS.refreshPlayer(); }
            catch (_) { /* restore full material even if a late player vanished */ }
            finally { document.documentElement.removeAttribute("data-ylg-player-transition"); }
          }
        };
      } catch (_) { cancel(); }
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
