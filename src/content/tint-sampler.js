/**
 * YouTube Liquid Glass - tint-sampler (Lead-owned).
 * Samples the ACTIVE video frame (or the first visible thumbnail off the watch
 * page) and derives one usable surface colour for the glass tint.
 *
 * Contract: window.YLG_TINT
 *   init(settings)   install / reconfigure; idempotent
 *   teardown()       cancel every timer/observer/listener
 *   sample()         force one sample now (returns {r,g,b} or null)
 *   color()          last adjusted colour {r,g,b} or null
 *
 * It writes NOTHING to storage and never styles the video. The caller decides
 * what to do with the colour; bootstrap mirrors it into the tint custom
 * property. Sampling fails closed (returns null) for protected media and for
 * cross-origin images whose canvas read throws.
 */
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  if (root.YLG_TINT) return;

  var W = 24, H = 14;
  var active = false;
  var timer = null;
  var observer = null;
  var video = null;
  var rvfcId = null;
  var last = null;
  var lastRun = 0;
  var canvas = null;
  var ctx = null;
  var MIN_INTERVAL = 700;      // ≤ ~1.4 Hz; a colour wash does not need more
  var firstVisibleThumb = function () {
    var list = document.querySelectorAll(
      "ytd-rich-item-renderer ytd-thumbnail img, ytd-video-renderer ytd-thumbnail img, " +
      "ytd-compact-video-renderer ytd-thumbnail img, ytd-grid-video-renderer ytd-thumbnail img"
    );
    for (var i = 0; i < list.length; i++) {
      var img = list[i];
      if (!img.complete || !img.naturalWidth) continue;
      var r = img.getBoundingClientRect ? img.getBoundingClientRect() : null;
      if (r && (r.width < 40 || r.height < 24)) continue;
      if (r && (r.bottom < 0 || r.top > (root.innerHeight || 800))) continue;
      return img;
    }
    return null;
  };

  function surface() {
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      ctx = canvas.getContext("2d", { willReadFrequently: true });
    }
    return ctx;
  }

  /** Ignore frames that carry no usable colour signal. */
  function usable(r, g, b) {
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luma < 12 || luma > 244) return false;      // black / blown-out frame
    if (max - min < 6 && luma > 200) return false;  // near-white flat frame
    return true;
  }

  /** Keep text readable: clamp the colour into a mid band and lift it slightly. */
  function adjust(r, g, b) {
    var lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    var target = 74;                       // readable against white glyphs
    var k = lum > 1 ? target / lum : 1;
    k = Math.max(0.55, Math.min(1.35, k));
    var clamp = function (v) { return Math.max(0, Math.min(255, Math.round(v * k))); };
    return { r: clamp(r), g: clamp(g), b: clamp(b) };
  }

  function readFrom(el, isVideo) {
    var c = surface();
    if (!c) return null;
    try {
      c.clearRect(0, 0, W, H);
      c.drawImage(el, 0, 0, W, H);
      var data = c.getImageData(0, 0, W, H).data;
    } catch (e) {
      return null;                        // tainted canvas / protected media
    }
    var r = 0, g = 0, b = 0, n = 0;
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 8) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    if (!n) return null;
    r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
    if (!usable(r, g, b)) return null;
    return adjust(r, g, b);
  }

  function publish(color) {
    last = color;
    try { root.dispatchEvent(new CustomEvent("ylg-tint", { detail: color })); } catch (e) {}
  }

  function sample() {
    if (!active) return null;
    var now = Date.now();
    // rVFC can call this at the video's frame rate. Bound every attempt,
    // including skipped hover/seeking samples, so direct manipulation never
    // turns the global selector into per-frame work. The last colour remains
    // visible; decorative tint resumes within the next sampling interval.
    if (now - lastRun < MIN_INTERVAL) return last;
    lastRun = now;
    // Canvas video readback may synchronize with the GPU. Retain the last
    // surface colour during hover previews as well as dragging. This gate is
    // independent of Motion effects: even a stationary UI can be seeking.
    if ((video && video.seeking) || document.querySelector(
      '.ytp-progress-bar-container:hover, .ytp-volume-area:hover, [data-ylg-dragging="1"]')) return last;
    var color = null;
    if (video && video.readyState >= 2 && !video.paused && !video.ended) {
      color = readFrom(video, true);
    }
    if (!color && !video) {
      var img = firstVisibleThumb();
      if (img) color = readFrom(img, false);
    }
    // A rejected frame keeps the previous colour rather than flashing grey.
    if (color) publish(color);
    return color;
  }

  function currentVideo() {
    if (root.YLG_NAV && root.YLG_NAV.getPlayer) {
      try {
        var p = root.YLG_NAV.getPlayer();
        if (p && p.video) return p.video;
      } catch (e) {}
    }
    return document.querySelector("video.html5-main-video, #movie_player video");
  }

  function bindVideo() {
    var next = currentVideo();
    if (next === video) return;
    unbindVideo();
    video = next;
    if (video && video.requestVideoFrameCallback) {
      var tick = function () {
        rvfcId = null;
        if (!active || !video) return;
        sample();
        if (!document.hidden && video && !video.paused) rvfcId = video.requestVideoFrameCallback(tick);
      };
      rvfcId = video.requestVideoFrameCallback(tick);
    }
  }

  function unbindVideo() {
    if (video && rvfcId !== null && video.cancelVideoFrameCallback) {
      try { video.cancelVideoFrameCallback(rvfcId); } catch (e) {}
    }
    rvfcId = null;
    video = null;
  }

  function onVisibility() {
    if (!document.hidden) sample();
  }

  function init(settings) {
    var wanted = !!(settings && settings.enabled !== false && settings.tint === "media");
    if (!wanted) { teardown(); return; }
    if (active) { bindVideo(); sample(); return; }
    active = true;
    bindVideo();
    // Slow safety net: covers pause/seek/thumbnail pages and browsers without
    // rVFC. It never draws more than once per MIN_INTERVAL.
    timer = setInterval(function () {
      if (document.hidden) return;
      bindVideo();
      sample();
    }, 1200);
    document.addEventListener("visibilitychange", onVisibility);
    // The existing 1200ms safety timer already rebinds recycled video nodes.
    // Do not rediscover the player (including visibility/layout reads) for
    // every caption, time label, seek preview or volume mutation on the page.
    sample();
  }

  function teardown() {
    active = false;
    if (timer !== null) { clearInterval(timer); timer = null; }
    if (observer) { observer.disconnect(); observer = null; }
    try { document.removeEventListener("visibilitychange", onVisibility); } catch (e) {}
    unbindVideo();
    last = null;
    lastRun = 0;
  }

  root.YLG_TINT = {
    init: init,
    teardown: teardown,
    sample: sample,
    color: function () { return last; }
  };
})();
