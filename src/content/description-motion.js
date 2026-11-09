/* Animate real layout height, not a scaled copy over the comments. Native
   expand/collapse clicks remain untouched; temporary state always releases. */
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  if (root.YLG_DESCRIPTION_MOTION) return;
  var active = false, frame = 0, animation = null, node = null;
  function eligible() {
    var de = document.documentElement;
    return de.getAttribute("data-ylg-enabled") === "true" && de.getAttribute("data-ylg-motion") === "on" &&
      (de.getAttribute("data-ylg-system-motion") === "ignore" || !(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches));
  }
  function clear() {
    if (frame) root.cancelAnimationFrame(frame);
    frame = 0;
    var previous = animation; animation = null;
    if (previous) { previous.onfinish = previous.oncancel = null; previous.cancel(); }
    if (node) node.removeAttribute("data-ylg-description-motion");
    node = null;
  }
  function prepare(event) {
    if (!active || !eligible()) return;
    var button = event.target && event.target.closest && event.target.closest("#expand, #collapse");
    var metadata = button && button.closest("ytd-watch-metadata");
    var description = metadata && metadata.querySelector("#description");
    if (!description || !button.closest("#description-inline-expander") || typeof description.animate !== "function") return;
    // Read the currently painted height before cancelling an interrupted run.
    var before = parseFloat(root.getComputedStyle(description).height);
    clear();
    if (!(before > 0)) return;
    node = description;
    frame = root.requestAnimationFrame(function () {
      frame = 0;
      if (!active || !eligible() || description.isConnected === false) { clear(); return; }
      var after = parseFloat(root.getComputedStyle(description).height);
      if (!(after > 0) || Math.abs(after - before) < 1) { clear(); return; }
      description.setAttribute("data-ylg-description-motion", "1");
      try {
        var run = description.animate([{ height: before + "px" }, { height: after + "px" }],
          { duration: 360, easing: "cubic-bezier(0.4,0,0.2,1)", fill: "none" });
        animation = run;
        run.onfinish = run.oncancel = function () { if (animation === run) clear(); };
      } catch (_) { clear(); }
    });
  }
  function hidden() { if (document.hidden) clear(); }
  function init() {
    if (active) return; active = true;
    document.addEventListener("click", prepare, true);
    document.addEventListener("yt-navigate-start", clear, true);
    document.addEventListener("visibilitychange", hidden);
    root.addEventListener("resize", clear);
    root.addEventListener("pagehide", clear);
  }
  function teardown() {
    active = false; clear();
    document.removeEventListener("click", prepare, true);
    document.removeEventListener("yt-navigate-start", clear, true);
    document.removeEventListener("visibilitychange", hidden);
    root.removeEventListener("resize", clear);
    root.removeEventListener("pagehide", clear);
  }
  root.YLG_DESCRIPTION_MOTION = { init: init, teardown: teardown };
})();
