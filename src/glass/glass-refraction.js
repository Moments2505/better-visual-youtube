/**
 * YouTube Liquid Glass - glass-refraction.js (Layer 1: REFRACTION engine)
 * ---------------------------------------------------------------------------
 * Technique (reimplemented from publicly documented math; see
 * docs/reference-audit.md - attribution to kube.io and mkj0kjay/vue-web-liquid-glass):
 *   1. Rasterize a DISPLACEMENT MAP on a small offscreen canvas (256x256):
 *      rounded-rect signed-distance field -> 1-D Snell-like edge-bending
 *      profile (strong at edges, neutral at center). Encoded R=X, G=Y,
 *      128 = neutral (feDisplacementMap convention).
 *   2. Rasterize a RIM-LIGHT SPECULAR map: white edge falloff, transparent
 *      center (the layer that distinguishes liquid glass from plain blur).
 *   3. Inject ONE hidden same-document inline <svg> with two filters
 *      (hero / panel). Chain per filter:
 *        feImage(map) -> feGaussianBlur(SourceGraphic) -> feDisplacementMap
 *        -> rim feImage -> feComposite(in) -> feBlend(screen).
 *      Filter regions are PINNED (x/y/width/height) per A1 audit guidance.
 *
 * HARD RULES (from docs/reference-audit.md):
 *   - Same-document inline <svg> only. External .svg#filter refs are broken
 *     in Chromium (crbug 40347855). Never reference via ::backdrop
 *     (crash: crbug 411598594).
 *   - Never animate filter attributes except feDisplacementMap scale, and
 *     never as a continuous loop (crbug 359102842).
 *   - Maps are cached by intensity step; rebuilds throttled (>=150ms).
 *   - probeSupported() is a conservative heuristic; @supports CANNOT detect
 *     url() backdrop rendering (parse != render). The faux-refraction CSS
 *     path remains the default; advanced path is opt-in via
 *     html[data-ylg-advanced-ok="1"] set by bootstrap only when probe passes.
 *   - Content-script-injected same-document filter references: UNVERIFIED in
 *     a real browser until QA prototypes on live YouTube.
 */
(function () {
  "use strict";
  var root = (typeof window !== "undefined") ? window : globalThis;
  if (root.YLG_REFRACTION) return; // idempotent

  var MAP_SIZE = 256;          // displacement map resolution (cap 512)
  var EDGE_BAND = 0.42;        // normalized bend depth from edge inward
  var CORNER_RADIUS = 0.30;    // normalized slab corner radius
  var INTENSITY_STEP = 0.05;   // quantization for map caching
  var REBUILD_MIN_MS = 150;    // throttle for map regeneration

  var defsEl = null;
  var mapCache = {};           // quantized intensity -> {map, rim} data URIs
  var lastRebuild = 0;
  var currentIntensity = null;

  /* ---- Signed-distance field for the glass slab -------------------------- */
  function slabSDF(u, v) {
    // u,v in [-1,1]; returns negative inside, 0 at edge, positive outside.
    var ax = Math.abs(u), ay = Math.abs(v);
    var qx = ax - (1 - CORNER_RADIUS);
    var qy = ay - (1 - CORNER_RADIUS);
    var mx = Math.max(qx, 0), my = Math.max(qy, 0);
    return Math.min(Math.max(qx, qy), 0) + Math.sqrt(mx * mx + my * my) - CORNER_RADIUS;
  }

  /* ---- Displacement + rim maps (canvas -> PNG data URI) ------------------ */
  function buildMaps(intensity) {
    var size = MAP_SIZE;
    var cv = document.createElement("canvas");
    cv.width = size; cv.height = size;
    var ctx = cv.getContext("2d");
    if (!ctx) return null;
    var img = ctx.createImageData(size, size);
    var rim = ctx.createImageData(size, size);
    var d = img.data, r = rim.data;
    var half = size / 2;
    var strength = 0.34 + intensity * 0.42; // max outward sampling fraction

    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var u = (x + 0.5) / half - 1;
        var v = (y + 0.5) / half - 1;
        var sd = slabSDF(u, v);
        // t: 0 at edge -> 1 deep inside
        var t = Math.min(1, Math.max(0, -sd / EDGE_BAND));
        // edge-bending magnitude (Snell-like: bend concentrates at edges)
        var m = Math.pow(1 - t, 1.8) * strength;
        // outward normal via numeric SDF gradient
        var e = 1.5 / half;
        var gx = slabSDF(u + e, v) - slabSDF(u - e, v);
        var gy = slabSDF(u, v + e) - slabSDF(u, v - e);
        var gl = Math.sqrt(gx * gx + gy * gy) || 1;
        var nx = (gx / gl) * m, ny = (gy / gl) * m;
        var i = (y * size + x) * 4;
        d[i]     = Math.max(0, Math.min(255, Math.round(128 + nx * 127)));
        d[i + 1] = Math.max(0, Math.min(255, Math.round(128 + ny * 127)));
        d[i + 2] = 128;
        d[i + 3] = 255;
        // rim-light: bright at the very edge, fading fast inward
        var rimA = Math.pow(1 - t, 3.2) * 255 * (0.5 + intensity * 0.5);
        r[i] = 255; r[i + 1] = 255; r[i + 2] = 255;
        r[i + 3] = Math.max(0, Math.min(255, Math.round(rimA)));
      }
    }
    ctx.putImageData(img, 0, 0);
    var mapURI = cv.toDataURL("image/png");
    ctx.putImageData(rim, 0, 0);
    var rimURI = cv.toDataURL("image/png");
    return { map: mapURI, rim: rimURI };
  }

  function getMaps(intensity) {
    var q = Math.round(intensity / INTENSITY_STEP) * INTENSITY_STEP;
    if (mapCache[q]) return mapCache[q];
    var now = Date.now();
    var wait = Math.max(0, REBUILD_MIN_MS - (now - lastRebuild));
    // synchronous throttle: reuse the nearest cached map when rebuilding
    // faster than REBUILD_MIN_MS; live scale updates never wait on this.
    if (wait > 0) {
      var nearest = mapCache[nearestKey(q)];
      if (nearest) return nearest;
    }
    lastRebuild = now;
    var maps = buildMaps(q) || buildMaps(0.5) || null;
    if (maps) {
      if (Object.keys(mapCache).length > 8) mapCache = {}; // bounded cache
      mapCache[q] = maps;
    }
    return maps;
  }
  function nearestKey(q) {
    var keys = Object.keys(mapCache);
    var best = null, bestD = Infinity;
    for (var i = 0; i < keys.length; i++) {
      var dd = Math.abs(parseFloat(keys[i]) - q);
      if (dd < bestD) { bestD = dd; best = keys[i]; }
    }
    return best;
  }

  function filterMarkup(id, scale, maps) {
    return '<filter id="' + id + '" x="-20%" y="-20%" width="140%" height="140%" ' +
      'color-interpolation-filters="sRGB">' +
      '<feImage href="' + maps.map + '" x="0" y="0" width="100%" height="100%" ' +
      'preserveAspectRatio="none" result="map"></feImage>' +
      '<feGaussianBlur in="SourceGraphic" stdDeviation="0.6" result="soft"></feGaussianBlur>' +
      '<feDisplacementMap in="soft" in2="map" scale="' + scale + '" ' +
      'xChannelSelector="R" yChannelSelector="G" result="disp"></feDisplacementMap>' +
      '<feImage href="' + maps.rim + '" x="0" y="0" width="100%" height="100%" ' +
      'preserveAspectRatio="none" result="rim"></feImage>' +
      '<feComposite in="rim" in2="disp" operator="in" result="rimClip"></feComposite>' +
      '<feBlend in="disp" in2="rimClip" mode="screen"></feBlend>' +
      '</filter>';
  }

  /* ---- Public API --------------------------------------------------------- */
  function ensureFilterDefs(doc) {
    try {
      if (defsEl && defsEl.ownerDocument === doc) return defsEl;
      var existing = doc.getElementById("ylg-glass-defs");
      if (existing) { defsEl = existing; return defsEl; }
      var maps = getMaps(currentIntensity == null ? 0.5 : currentIntensity);
      if (!maps) return null;
      var svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("id", "ylg-glass-defs");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      svg.setAttribute("width", "0");
      svg.setAttribute("height", "0");
      svg.style.position = "absolute";
      svg.style.width = "0";
      svg.style.height = "0";
      svg.style.pointerEvents = "none";
      // scale set by setIntensity() right after ensure; neutral start:
      var heroScale = 6 + (currentIntensity == null ? 0.5 : currentIntensity) * 42;
      svg.innerHTML =
        filterMarkup("ylg-refract-hero", Math.round(heroScale), maps) +
        filterMarkup("ylg-refract-panel", Math.round(heroScale * 0.6), maps);
      doc.documentElement.appendChild(svg);
      defsEl = svg;
      return defsEl;
    } catch (e) {
      return null; // never throw into bootstrap
    }
  }

  function setIntensity(v) {
    try {
      var i = Math.min(1, Math.max(0, Number(v)));
      if (i === currentIntensity) return;
      currentIntensity = i;
      if (!defsEl) return;
      var heroScale = Math.round(6 + i * 42);       // 6..48 px displacement
      var panelScale = Math.round(4 + i * 24);      // 4..28 px
      var hero = defsEl.querySelector("#ylg-refract-hero feDisplacementMap");
      var panel = defsEl.querySelector("#ylg-refract-panel feDisplacementMap");
      if (hero) hero.setAttribute("scale", String(heroScale));
      if (panel) panel.setAttribute("scale", String(panelScale));
    } catch (e) { /* attribute updates must never throw */ }
  }

  function filterIdFor(kind) {
    return kind === "hero" ? "ylg-refract-hero" : "ylg-refract-panel";
  }

  function dispose() {
    try {
      if (defsEl && defsEl.parentNode) defsEl.parentNode.removeChild(defsEl);
    } catch (e) { /* ignore */ }
    defsEl = null;
    currentIntensity = null; // maps stay cached (pure data)
  }

  function probeSupported() {
    try {
      var css = root.CSS;
      if (!css || !css.supports) return false;
      var blurOK = css.supports("backdrop-filter", "blur(2px)") ||
                   css.supports("-webkit-backdrop-filter", "blur(2px)");
      if (!blurOK) return false;
      if (!css.supports("filter", "url(#x)")) return false;
      var m = (navigator.userAgent || "").match(/Chrom(?:e|ium)\/([0-9]+)/);
      var ver = m ? parseInt(m[1], 10) : 0;
      return ver >= 110; // conservative floor (url() backdrop era, per audit)
    } catch (e) {
      return false;
    }
  }

  root.YLG_REFRACTION = {
    ensureFilterDefs: ensureFilterDefs,
    setIntensity: setIntensity,
    filterIdFor: filterIdFor,
    dispose: dispose,
    probeSupported: probeSupported,
    /** QA/test hook: force-generate maps and return their byte lengths. */
    _buildMapsForTest: function (i) { var m = buildMaps(i); return m && { map: m.map.length, rim: m.rim.length }; }
  };
})();
