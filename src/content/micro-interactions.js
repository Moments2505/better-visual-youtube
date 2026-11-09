/* Delegated, disposable interaction hooks. Native clicks, seek and volume
   coordinates remain untouched; only our own visual state is annotated. */
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  if (root.YLG_MICRO) return;
  var started = false, dragging = null, iconAnimation = null;
  function allowed() {
    var de = document.documentElement;
    return de.getAttribute("data-ylg-enabled") === "true" && de.getAttribute("data-ylg-motion") === "on" &&
      (de.getAttribute("data-ylg-system-motion") === "ignore" || !(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches));
  }
  function release() {
    if (dragging) dragging.removeAttribute("data-ylg-dragging");
    dragging = null;
    document.documentElement.removeAttribute("data-ylg-scrubbing");
  }
  function down(e) {
    if (document.documentElement.getAttribute("data-ylg-enabled") !== "true" || (e.button !== undefined && e.button !== 0)) return;
    var node = e.target && e.target.closest && e.target.closest(".ytp-progress-bar-container, .ytp-volume-panel");
    if (!node) return;
    release(); dragging = node; node.setAttribute("data-ylg-dragging", "1");
    if (e.target.closest(".ytp-progress-bar-container")) document.documentElement.setAttribute("data-ylg-scrubbing", "1");
  }
  function click(e) {
    if (!allowed()) return;
    var button = e.target && e.target.closest && e.target.closest(".ytp-play-button");
    var svg = button && button.querySelector("svg");
    if (!svg || typeof svg.animate !== "function") return;
    if (iconAnimation) iconAnimation.cancel();
    var run = svg.animate([{ scale: ".90" }, { scale: "1" }],
      { duration: 140, easing: "cubic-bezier(.22,.61,.36,1)" });
    iconAnimation = run;
    run.onfinish = run.oncancel = function () { if (iconAnimation === run) iconAnimation = null; };
  }
  function hidden() { if (document.hidden) release(); }
  function init() {
    if (started) return; started = true;
    document.addEventListener("pointerdown", down, { passive: true, capture: true });
    document.addEventListener("click", click, true);
    document.addEventListener("visibilitychange", hidden);
    document.addEventListener("yt-navigate-start", release, true);
    root.addEventListener("pointerup", release, true);
    root.addEventListener("pointercancel", release, true);
    root.addEventListener("blur", release);
    root.addEventListener("pagehide", release);
  }
  function teardown() {
    started = false; release();
    document.removeEventListener("pointerdown", down, true);
    document.removeEventListener("click", click, true);
    document.removeEventListener("visibilitychange", hidden);
    document.removeEventListener("yt-navigate-start", release, true);
    root.removeEventListener("pointerup", release, true);
    root.removeEventListener("pointercancel", release, true);
    root.removeEventListener("blur", release);
    root.removeEventListener("pagehide", release);
    if (iconAnimation) iconAnimation.cancel(); iconAnimation = null;
  }
  root.YLG_MICRO = { init: init, teardown: teardown };
})();
