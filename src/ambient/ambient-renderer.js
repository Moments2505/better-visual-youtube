/**
 * YouTube Liquid Glass - ambient-renderer.js (A6 scope, Lead-executed)
 * Canvas-based video color sampler + renderer.
 *
 * TWO PATHS, decided by a one-time taint probe per video element:
 *  - UNTAINTED: drawImage -> ONE getImageData on a tiny canvas (<= 64x36) ->
 *    grid-average colors -> temporal smoothing -> paint cells to the visible
 *    canvas (CSS blur diffuses them). ~2KB readback/frame max.
 *  - TAINTED (cross-origin/DRM/protected - getImageData throws or yields
 *    black): drawImage ONLY to the visible small canvas; CSS blur/saturation
 *    does the entire diffusion. No pixel readback ever. No security bypass.
 *
 * Scheduling: ONE requestAnimationFrame loop per controller; frame-gated to
 * fpsLimit via an accumulator; video.requestVideoFrameCallback is used as the
 * wake signal when available (fallback: rAF ticks). Pauses on video pause/end,
 * document.hidden; destroys cleanly (cancelAnimationFrame + rVFC cancel).
 */
(function () {
  "use strict";
  var root = (typeof window !== "undefined") ? window : globalThis;
  if (root.YLG_AMBIENT_RENDERER) return;

  var PERF = root.YLG_AMBIENT_PERF;

  /* ---- taint probe (cached per video element) ---- */
  var taintCache = new WeakMap();
  function isTainted(video) {
    if (!video) return true;
    if (taintCache.has(video)) return taintCache.get(video);
    var tainted = true;
    try {
      var c = document.createElement("canvas");
      c.width = 8; c.height = 8;
      var ctx = c.getContext("2d", { willReadFrequently: false });
      if (ctx) {
        ctx.drawImage(video, 0, 0, 8, 8);
        var d = ctx.getImageData(0, 0, 8, 8).data;
        var allBlack = true;
        for (var i = 0; i < d.length; i += 4) {
          if (d[i] !== 0 || d[i + 1] !== 0 || d[i + 2] !== 0) { allBlack = false; break; }
        }
        // all-black could be a legitimately black frame; only treat as
        // protected if the video also reports DRM in use.
        var drm = false;
        try { drm = !!(video.mediaKeys || (video.onencrypted !== undefined && video.currentSrc === "")); }
        catch (e2) { drm = false; }
        tainted = allBlack ? drm : false;
      }
    } catch (e) {
      tainted = true; // SecurityError -> tainted path
    }
    try { taintCache.set(video, tainted); } catch (e3) {}
    return tainted;
  }

  /* ---- renderer factory ---- */
  function createRenderer() {
    var visibleCanvas = null;
    var vctx = null;
    var workCanvas = null;
    var wctx = null;
    var video = null;
    var profile = PERF ? PERF.resolveProfile("auto", false) : { sampleW: 48, sampleH: 27, fps: 12, blurScale: 1, grid: [4, 3] };
    var settings = { intensity: 0.55, blur: 60, spread: 75, saturation: 1.1, brightness: 1.0, smoothing: 0.7, fpsLimit: 12 };
    var taint = true;
    var cells = [];              // smoothed colors [r,g,b] per cell
    var rafId = 0;
    var rvfcId = 0;
    var running = false;
    var lastDraw = 0;
    var costWindow = [];
    var avgCost = 0;
    var stats = { draws: 0, avgFrameMs: 0, tainted: true, profile: profile.name };

    function allocate() {
      var w = profile.sampleW, h = profile.sampleH;
      if (!visibleCanvas || visibleCanvas.width !== w || visibleCanvas.height !== h) {
        if (visibleCanvas) { visibleCanvas.width = w; visibleCanvas.height = h; }
        else {
          visibleCanvas = document.createElement("canvas");
          visibleCanvas.className = "ylg-ambient-canvas";
          visibleCanvas.setAttribute("aria-hidden", "true");
          visibleCanvas.width = w; visibleCanvas.height = h;
        }
        vctx = visibleCanvas.getContext("2d");
      }
      if (!workCanvas) {
        workCanvas = document.createElement("canvas"); // reused, never attached
      }
      workCanvas.width = w; workCanvas.height = h;
      wctx = workCanvas.getContext("2d", { willReadFrequently: true });
      var g = profile.grid;
      cells = new Array(g[0] * g[1]);
      for (var i = 0; i < cells.length; i++) cells[i] = [18, 18, 24];
    }

    function sampleFrame() {
      if (!video || video.readyState < 2) return;
      var t0 = performance.now();
      var w = workCanvas.width, h = workCanvas.height;
      try { wctx.drawImage(video, 0, 0, w, h); }
      catch (e) { return; } // video not paintable this tick
      if (taint) { paintTainted(); }
      else { paintSampled(w, h); }
      stats.draws++;
      var cost = performance.now() - t0;
      if (PERF) {
        avgCost = PERF.rollingAvg(costWindow, cost);
        stats.avgFrameMs = Math.round(avgCost * 100) / 100;
      }
    }

    function paintTainted() {
      // No readback: the small canvas content IS the ambient source.
      // Slight fade of previous frame for smoothness handled by CSS transition.
      // (drawImage already happened onto workCanvas; blit to visible)
      try { vctx.drawImage(workCanvas, 0, 0); } catch (e) {}
    }

    function paintSampled(w, h) {
      var data;
      try { data = wctx.getImageData(0, 0, w, h).data; }
      catch (e) { taint = true; paintTainted(); return; } // mid-session taint
      var g = profile.grid, cols = g[0], rows = g[1];
      var alpha = 0.08 + (1 - settings.smoothing) * 0.35; // temporal softness
      var cw = w / cols, ch = h / rows;
      for (var cy = 0; cy < rows; cy++) {
        for (var cx = 0; cx < cols; cx++) {
          var sx = Math.floor(cx * cw), sy = Math.floor(cy * ch);
          var ex = Math.floor((cx + 1) * cw), ey = Math.floor((cy + 1) * ch);
          var rs = 0, gs = 0, bs = 0, n = 0;
          // sample every 2nd pixel within the cell (tiny canvas: plenty)
          for (var y = sy; y < ey; y += 2) {
            for (var x = sx; x < ex; x += 2) {
              var i = (y * w + x) * 4;
              rs += data[i]; gs += data[i + 1]; bs += data[i + 2]; n++;
            }
          }
          if (!n) continue;
          var r = rs / n, gr = gs / n, b = bs / n;
          var luma = 0.2126 * r + 0.7152 * gr + 0.0722 * b;
          var idx = cy * cols + cx;
          var prev = cells[idx];
          if (luma < 8) { // near-black cell: fade toward deep neutral, keep glow alive
            r = prev[0] * 0.9; gr = prev[1] * 0.9; b = Math.max(10, prev[2] * 0.9);
          }
          cells[idx] = [
            prev[0] + (r - prev[0]) * alpha,
            prev[1] + (gr - prev[1]) * alpha,
            prev[2] + (b - prev[2]) * alpha
          ];
        }
      }
      // paint smoothed cells
      var vw = visibleCanvas.width, vh = visibleCanvas.height;
      var cwv = vw / cols, chv = vh / rows;
      for (var k = 0; k < cells.length; k++) {
        var c = cells[k];
        vctx.fillStyle = "rgb(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + ")";
        vctx.fillRect(Math.floor((k % cols) * cwv), Math.floor(Math.floor(k / cols) * chv), Math.ceil(cwv), Math.ceil(chv));
      }
    }

    /* ---- scheduling: single rAF loop, fps-gated ---- */
    function tick(now) {
      if (!running) return;
      rafId = requestAnimationFrame(tick);
      var minGap = 1000 / Math.max(1, Math.min(settings.fpsLimit || profile.fps, 30));
      if (now - lastDraw < minGap) return;
      lastDraw = now;
      if (video && !video.paused && !video.ended && !document.hidden) {
        sampleFrame();
      }
    }

    function start(v) {
      video = v || video;
      if (!video || !visibleCanvas) return;
      taint = isTainted(video);
      stats.tainted = taint;
      if (running) return;
      running = true;
      // rVFC as wake source when available (aligned with actual frames)
      if (video.requestVideoFrameCallback) {
        var onFrame = function () {
          if (!running) return;
          rvfcId = video.requestVideoFrameCallback(onFrame);
        };
        rvfcId = video.requestVideoFrameCallback(onFrame);
      }
      rafId = requestAnimationFrame(tick);
    }

    function stop() {
      running = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      if (video && rvfcId && video.requestVideoFrameCallback) {
        try { video.cancelVideoFrameCallback(rvfcId); } catch (e) {}
        rvfcId = 0;
      }
    }

    function setProfile(p) {
      profile = p;
      stats.profile = p.name;
      allocate();
    }

    function updateSettings(s) {
      if (!s) return;
      settings = s;
    }

    function getCanvas() { return visibleCanvas; }
    function ensureAllocated() { if (!cells.length) allocate(); }

    function destroy() {
      stop();
      visibleCanvas = null; vctx = null; workCanvas = null; wctx = null;
      cells = []; video = null; costWindow = [];
    }

    return {
      start: start, stop: stop, setProfile: setProfile, updateSettings: updateSettings,
      getCanvas: getCanvas, ensureAllocated: ensureAllocated, destroy: destroy,
      isTainted: isTainted,
      stats: function () { return stats; }
    };
  }

  root.YLG_AMBIENT_RENDERER = {
    createRenderer: createRenderer,
    isTainted: isTainted
  };
})();
