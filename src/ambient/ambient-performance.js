/**
 * YouTube Liquid Glass - ambient-performance.js (A6 scope, Lead-executed)
 * Quality profiles + measured adaptation. Pure math; no DOM.
 *
 * Profile fields: sampleW/sampleH (sampling canvas), fps (ambient updates/s),
 * blurScale (multiplier on user blur), grid [cols, rows] for cell averaging.
 *
 * AUTO adapts from MEASURED render cost (rolling window), never from a single
 * device heuristic: step down when avg frame cost stays high, step up (max
 * balanced) when consistently cheap. User-selected high/eco are honored as-is.
 *
 * API: YLG_AMBIENT_PERF.resolveProfile(quality, lowFx) -> profile
 *      YLG_AMBIENT_PERF.adapt(profile, avgFrameMs) -> profile|same
 */
(function () {
  "use strict";
  var root = (typeof window !== "undefined") ? window : globalThis;
  if (root.YLG_AMBIENT_PERF) return;

  var PROFILES = {
    eco:      { name: "eco",      sampleW: 32, sampleH: 18, fps: 6,  blurScale: 0.8,  grid: [4, 3] },
    balanced: { name: "balanced", sampleW: 48, sampleH: 27, fps: 12, blurScale: 1.0,  grid: [4, 3] },
    high:     { name: "high",     sampleW: 64, sampleH: 36, fps: 20, blurScale: 1.15, grid: [6, 4] }
  };
  var ORDER = ["eco", "balanced", "high"];

  function resolveProfile(quality, lowFx) {
    var q = (quality === "eco" || quality === "balanced" || quality === "high") ? quality : "auto";
    if (q === "auto") q = "balanced";              // conservative AUTO start
    if (lowFx && q !== "eco") q = "eco";           // weak devices cap at eco
    return PROFILES[q];
  }

  /**
   * Measured adaptation. avgFrameMs: rolling average of per-frame cost.
   * Returns same profile or a step-down/up decision (AUTO only steps up to
   * balanced; explicit user picks are never silently downgraded here).
   */
  function adapt(profile, avgFrameMs) {
    if (!profile) return resolveProfile("auto", false);
    if (profile.name === "high") return profile;   // explicit high stays high
    if (avgFrameMs > 6 && profile.name !== "eco") return PROFILES.eco;
    if (avgFrameMs < 1.5 && profile.name === "eco" && profile.__autoUp === true) {
      return PROFILES.balanced;                    // only AUTO ever steps up
    }
    return profile;
  }

  /** Rolling average helper used by the renderer. */
  function rollingAvg(window, value) {
    window.push(value);
    if (window.length > 30) window.shift();
    var sum = 0;
    for (var i = 0; i < window.length; i++) sum += window[i];
    return sum / window.length;
  }

  root.YLG_AMBIENT_PERF = {
    PROFILES: PROFILES,
    ORDER: ORDER,
    resolveProfile: resolveProfile,
    adapt: adapt,
    rollingAvg: rollingAvg
  };
})();
