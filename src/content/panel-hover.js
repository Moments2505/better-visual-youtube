/* Stable hit testing for the three watch-page panels. Enlarging a panel must
   not enlarge the region that selects it or trap the pointer over a neighbour.
   Native input events and DOM layout stay untouched. */
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  if (root.YLG_PANEL_HOVER) return;
  var SELECTOR = "ytd-watch-metadata, ytd-comments, #secondary";
  var BLOCKED = "#masthead-container, #guide, #guide-inner-content, ytd-popup-container, tp-yt-paper-dialog, [role=dialog], .ytp-popup";
  var started = false, frame = 0, generation = 0, panels = [], selected = null, point = null;
  var keyboard = false, dirty = true, resizeObserver = null, modeObserver = null;
  var leaving = new Map();
  var reduced = root.matchMedia ? root.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function allowed() {
    var de = document.documentElement;
    return started && !document.hidden && !document.fullscreenElement &&
      de.getAttribute("data-ylg-enabled") === "true" && de.getAttribute("data-ylg-motion") === "on" &&
      de.getAttribute("data-ylg-hover") === "on" && de.getAttribute("data-ylg-optics") === "on" &&
      de.getAttribute("data-ylg-optics-magnify") !== "0" && de.getAttribute("data-ylg-player-transition") !== "1" &&
      (de.getAttribute("data-ylg-system-motion") === "ignore" || !(reduced && reduced.matches));
  }
  function side() {
    var value = selected ? (selected.id === "secondary" ? "secondary" : "primary") : "none";
    if (value !== "primary") leaving.forEach(function (_, panel) {
      if (panel.id !== "secondary") value = "leaving-primary";
    });
    // A departing left panel stays below the newly selected right panel.
    document.documentElement.setAttribute("data-ylg-panel-side", value);
  }
  function finish(panel) {
    if (leaving.has(panel)) root.clearTimeout(leaving.get(panel));
    leaving.delete(panel);
    panel.removeAttribute("data-ylg-panel-leaving");
    side();
  }
  function select(next) {
    if (next === selected) return; // Pointer traffic cannot restart an animation.
    var previous = selected;
    selected = next;
    if (previous) {
      previous.removeAttribute("data-ylg-panel-active");
      previous.setAttribute("data-ylg-panel-leaving", "1");
      var timer = root.setTimeout(function () {
        if (started && leaving.get(previous) === timer) finish(previous);
      }, 460);
      leaving.set(previous, timer);
    }
    if (next) {
      finish(next);
      next.setAttribute("data-ylg-panel-active", "1");
    }
    side();
  }
  function clear() {
    generation++;
    if (frame) root.cancelAnimationFrame(frame);
    frame = 0;
    if (selected) selected.removeAttribute("data-ylg-panel-active");
    selected = null;
    leaving.forEach(function (timer, panel) {
      root.clearTimeout(timer); panel.removeAttribute("data-ylg-panel-leaving");
    });
    leaving.clear();
    document.documentElement.removeAttribute("data-ylg-panel-side");
  }
  function refresh() {
    dirty = false;
    if (resizeObserver) resizeObserver.disconnect();
    var watch = document.querySelector("ytd-watch-flexy:not([hidden])");
    panels = watch ? Array.prototype.slice.call(watch.querySelectorAll(SELECTOR), 0, 3) : [];
    if (selected && panels.indexOf(selected) < 0) clear();
    Array.from(leaving.keys()).forEach(function (panel) { if (panels.indexOf(panel) < 0) finish(panel); });
    if (resizeObserver) panels.forEach(function (panel) { resizeObserver.observe(panel); });
  }
  function inside(panel, x, y) {
    if (panel.isConnected === false) return false;
    var rect = panel.getBoundingClientRect();
    var width = panel.offsetWidth, height = panel.offsetHeight;
    if (!(width > 0 && height > 0 && rect.width > 0 && rect.height > 0)) return false;
    // CSS anchors left panels at top-left and recommendations at top-right.
    // Those corners do not move during scale, so layout dimensions recover
    // the original box even halfway through an interrupted transition.
    var left = panel.id === "secondary" ? rect.right - width : rect.left;
    return x >= left && x < left + width && y >= rect.top && y < rect.top + height;
  }
  function tick() {
    frame = 0;
    if (!allowed()) { clear(); return; }
    if (dirty || panels.some(function (panel) { return panel.isConnected === false; })) refresh();
    var next = null;
    // Batch the bounded geometry reads before changing any panel attributes.
    if (point) {
      for (var i = 0; i < panels.length; i++) {
        if (inside(panels[i], point.x, point.y)) { next = panels[i]; break; }
      }
    } else if (keyboard && document.activeElement) {
      var focused = document.activeElement;
      if (focused.matches && focused.matches(":focus-visible")) {
        var owner = focused.closest(SELECTOR);
        if (panels.indexOf(owner) >= 0) next = owner;
      }
    }
    if (next && next.querySelector("#description-inline-expander[is-expanded]")) next = null;
    select(next);
  }
  function schedule() {
    if (started && !frame) {
      var token = generation;
      frame = root.requestAnimationFrame(function () { if (token === generation) tick(); });
    }
  }
  function move(event) {
    if (event.pointerType === "touch") return;
    keyboard = false;
    var target = event.target;
    if (target && target.closest && target.closest(BLOCKED)) { point = null; schedule(); return; }
    point = { x: event.clientX, y: event.clientY };
    var owner = target && target.closest && target.closest(SELECTOR);
    if (owner && panels.indexOf(owner) < 0) dirty = true;
    if (!owner && !selected && !dirty) return;
    schedule();
  }
  function key(event) {
    if (event.key !== "Tab" && !/^Arrow/.test(event.key)) return;
    keyboard = true; point = null; schedule();
  }
  function pointerDown() { keyboard = false; }
  function focus() { if (keyboard) schedule(); }
  function leave(event) { if (!event.relatedTarget) { keyboard = false; point = null; schedule(); } }
  function reset() { point = null; keyboard = false; clear(); }
  function navigation() {
    reset(); panels = []; dirty = true;
    if (resizeObserver) resizeObserver.disconnect();
  }
  function changed() { dirty = true; schedule(); }
  function modeChanged() {
    if (!allowed()) clear();
    else changed();
  }
  function ended(event) {
    if (event.propertyName === "transform" && event.target !== selected && leaving.has(event.target)) finish(event.target);
  }
  function visibility() { if (document.hidden) reset(); }
  function init() {
    if (started) return;
    started = true; dirty = true;
    document.documentElement.setAttribute("data-ylg-panel-controller", "on");
    document.addEventListener("pointermove", move, { passive: true, capture: true });
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("pointerout", leave, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("focusin", focus, true);
    document.addEventListener("focusout", focus, true);
    document.addEventListener("transitionend", ended, true);
    document.addEventListener("yt-navigate-start", navigation, true);
    document.addEventListener("yt-navigate-finish", changed, true);
    document.addEventListener("scroll", schedule, { passive: true, capture: true });
    document.addEventListener("visibilitychange", visibility);
    root.addEventListener("resize", changed);
    root.addEventListener("blur", reset);
    root.addEventListener("pagehide", reset);
    if (reduced && reduced.addEventListener) reduced.addEventListener("change", modeChanged);
    if (typeof root.ResizeObserver === "function") resizeObserver = new root.ResizeObserver(schedule);
    if (typeof root.MutationObserver === "function") {
      modeObserver = new root.MutationObserver(modeChanged);
      modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ylg-player-transition", "data-ylg-system-motion"] });
    }
    schedule();
  }
  function teardown() {
    started = false; reset(); panels = []; dirty = true;
    if (resizeObserver) resizeObserver.disconnect(); resizeObserver = null;
    if (modeObserver) modeObserver.disconnect(); modeObserver = null;
    document.documentElement.removeAttribute("data-ylg-panel-controller");
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerdown", pointerDown, true);
    document.removeEventListener("pointerout", leave, true);
    document.removeEventListener("keydown", key, true);
    document.removeEventListener("focusin", focus, true);
    document.removeEventListener("focusout", focus, true);
    document.removeEventListener("transitionend", ended, true);
    document.removeEventListener("yt-navigate-start", navigation, true);
    document.removeEventListener("yt-navigate-finish", changed, true);
    document.removeEventListener("scroll", schedule, true);
    document.removeEventListener("visibilitychange", visibility);
    root.removeEventListener("resize", changed);
    root.removeEventListener("blur", reset);
    root.removeEventListener("pagehide", reset);
    if (reduced && reduced.removeEventListener) reduced.removeEventListener("change", modeChanged);
  }
  root.YLG_PANEL_HOVER = { init: init, teardown: teardown };
})();
