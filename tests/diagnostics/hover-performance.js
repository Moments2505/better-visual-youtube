/* Manual YouTube diagnostic. Paste into DevTools Console on a watch page.
 * Keep the tab in front. Spend about 10 seconds each idle, sweeping the seek
 * bar, adjusting volume and dragging the seek thumb. Stops after 60 seconds;
 * YLG_HOVER_BENCH.stop() stops early. Repeat with identical video, viewport,
 * refresh rate and settings for before/after or Intel/AMD/NVIDIA comparisons.
 * rAF intervals and event-to-rAF delay are scheduling proxies, NOT presented
 * GPU frames or physical mouse-to-photon latency. No network/storage writes.
 */
(function () {
  "use strict";
  if (location.hostname !== "www.youtube.com" || location.pathname !== "/watch") {
    throw new Error("Run this diagnostic on a YouTube watch page.");
  }
  if (window.YLG_HOVER_BENCH && window.YLG_HOVER_BENCH.stop) window.YLG_HOVER_BENCH.stop();
  var groups = {}, context = "idle", dragging = null, lastTime = null, lastContext = null;
  var eventTime = null, frame = 0, observer = null, longTasks = [], stopped = false;
  var wasHidden = !!document.hidden, visibilityChanges = 0, longTaskSupported = false;
  var startedAt = performance.now(), startUrl = location.href;
  var originalBuild = document.documentElement.getAttribute("data-ylg-build");
  function group(name) {
    return groups[name] || (groups[name] = { intervals: [], eventToFrame: [], moves: 0 });
  }
  function classify(target) {
    if (!target || !target.closest) return "idle";
    if (target.closest(".ytp-progress-bar-container")) return "seek";
    if (target.closest(".ytp-volume-area")) return "volume";
    return "idle";
  }
  function move(event) {
    context = dragging ? dragging + "-drag" : classify(event.target);
    group(context).moves++;
    // Coalesce pending events just as the browser coalesces pointer motion.
    // This excludes device and OS input latency before JS dispatch.
    eventTime = performance.now();
  }
  // Observe native input without capturing pointers, changing values or
  // consuming events. Drag classification does not depend on Motion effects.
  function down(event) {
    if (event.button !== undefined && event.button !== 0) return;
    var kind = classify(event.target);
    dragging = kind === "seek" || kind === "volume" ? kind : null;
    context = dragging ? dragging + "-drag" : kind;
    eventTime = null;
  }
  function release(event) {
    dragging = null; context = classify(event && event.target); eventTime = null;
  }
  function leave(event) { if (!event.relatedTarget && !dragging) { context = "idle"; eventTime = null; } }
  function visibility() {
    visibilityChanges++; wasHidden = wasHidden || !!document.hidden;
    lastTime = null; lastContext = null; eventTime = null;
    if (document.hidden) release();
  }
  var hiddenFrames = 0;
  function tick(t) {
    if (stopped) return;
    if (document.hidden) { wasHidden = true; hiddenFrames++; lastTime = null; eventTime = null; }
    else {
      var g = group(context);
      if (lastTime !== null && context === lastContext) g.intervals.push(t - lastTime);
      if (eventTime !== null) { g.eventToFrame.push(performance.now() - eventTime); eventTime = null; }
      lastTime = t; lastContext = context;
    }
    frame = requestAnimationFrame(tick);
  }
  function stats(values) {
    if (!values.length) return { samples: 0 };
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    function percentile(p) { return Number(sorted[Math.ceil((sorted.length - 1) * p)].toFixed(2)); }
    return { samples: values.length, medianMs: percentile(.5), p95Ms: percentile(.95),
      p99Ms: percentile(.99), maxMs: percentile(1),
      // 10% tolerance for timestamp rounding/jitter. These are intervals over
      // a target budget, not a count of dropped GPU/display frames.
      over120HzBudget: values.filter(function (v) { return v > 1000 / 120 * 1.1; }).length,
      over60HzBudget: values.filter(function (v) { return v > 1000 / 60 * 1.1; }).length };
  }
  function stop() {
    if (stopped) return window.YLG_HOVER_BENCH.result;
    stopped = true; cancelAnimationFrame(frame); clearTimeout(timeout);
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerdown", down, true);
    document.removeEventListener("pointerout", leave, true);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pointerup", release, true);
    window.removeEventListener("pointercancel", release, true);
    window.removeEventListener("blur", release);
    if (observer) observer.disconnect();
    var report = { build: originalBuild, durationMs: Math.round(performance.now() - startedAt),
      urlChanged: location.href !== startUrl, hiddenFrames: hiddenFrames,
      wasHidden: wasHidden, visibilityChanges: visibilityChanges,
      invalidRun: wasHidden || location.href !== startUrl,
      viewport: [innerWidth, innerHeight], devicePixelRatio: devicePixelRatio,
      motion: document.documentElement.getAttribute("data-ylg-motion"),
      ambient: document.documentElement.getAttribute("data-ylg-ambient-engine"),
      groups: {}, longTaskSupported: longTaskSupported, longTasks: stats(longTasks),
      limitations: "rAF scheduling only; not GPU-presented FPS or physical input latency. A 60 Hz display cannot validate a 120 Hz target. Discard navigated or background-tab runs." };
    Object.keys(groups).forEach(function (name) {
      report.groups[name] = { moves: groups[name].moves, frames: stats(groups[name].intervals),
        eventDispatchToFrame: stats(groups[name].eventToFrame) };
    });
    window.YLG_HOVER_BENCH.result = report;
    console.log("Better visual Youtube hover diagnostic", report);
    console.log(JSON.stringify(report, null, 2));
    return report;
  }
  try {
    observer = new PerformanceObserver(function (entries) {
      entries.getEntries().forEach(function (entry) { longTasks.push(entry.duration); });
    });
    observer.observe({ type: "longtask", buffered: false });
    longTaskSupported = true;
  } catch (_) {
    if (observer) observer.disconnect();
    observer = null;
  }
  document.addEventListener("pointermove", move, { capture: true, passive: true });
  document.addEventListener("pointerdown", down, { capture: true, passive: true });
  document.addEventListener("pointerout", leave, { capture: true, passive: true });
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pointerup", release, { capture: true, passive: true });
  window.addEventListener("pointercancel", release, { capture: true, passive: true });
  window.addEventListener("blur", release);
  window.YLG_HOVER_BENCH = { stop: stop, result: null };
  frame = requestAnimationFrame(tick);
  var timeout = setTimeout(stop, 60000);
  console.log("Hover diagnostic started: keep this watch tab visible; idle, seek hover, volume, then drag. Stops in 60 seconds.");
})();
