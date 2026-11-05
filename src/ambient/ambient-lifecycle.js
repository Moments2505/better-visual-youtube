/** Scoped, disposable player replacement and BFCache lifecycle hooks. */
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  if (root.YLG_AMBIENT_LIFECYCLE) return;
  var observer = null;
  var timer = null;
  var onHide = null;
  var onShow = null;
  var generation = 0;

  function stop() {
    generation++;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (observer) { observer.disconnect(); observer = null; }
    if (onHide) root.removeEventListener("pagehide", onHide);
    if (onShow) root.removeEventListener("pageshow", onShow);
    onHide = onShow = null;
  }
  function start(options) {
    stop();
    options = options || {};
    var current = generation;
    function schedule() {
      if (timer !== null) return;
      timer = setTimeout(function () {
        timer = null;
        if (current === generation && options.onPlayerChanged) options.onPlayerChanged();
      }, 300);
    }
    try {
      // Use the shared discovery contract. Only older standalone consumers fall
      // back to direct discovery; never add a document-wide mutation observer.
      var nav = root.YLG_NAV;
      var player = options.getPlayer ? options.getPlayer() : (nav && nav.getPlayer ? nav.getPlayer() : null);
      var target = player ? player.container : document.querySelector("#movie_player");
      if (target) {
        observer = new MutationObserver(schedule);
        observer.observe(target, { childList: true, subtree: true, attributes: false });
      }
    } catch (error) { observer = null; }
    onHide = function () { if (options.onPageHide) options.onPageHide(); };
    onShow = function () { if (options.onPageShow) options.onPageShow(); };
    root.addEventListener("pagehide", onHide);
    root.addEventListener("pageshow", onShow);
  }
  root.YLG_AMBIENT_LIFECYCLE = { start: start, stop: stop };
})();
