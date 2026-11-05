/**
 * YouTube Liquid Glass - glass-optics.js (REFINEMENT LAYER)
 * ---------------------------------------------------------------------------
 * Two optical properties of Liquid Glass that backdrop-filter cannot express,
 * implemented from the publicly documented technique in
 * mkj0kjay/vue-web-liquid-glass (see docs/attribution.md):
 *
 *   1. CHROMATIC ABERRATION (quang sai) - thick glass disperses light by
 *      wavelength, so slab edges show a red/blue split. One inline SVG filter
 *      splits the backdrop into R/G/B and re-blends with tiny opposing offsets
 *      (a 3-tap dispersion kernel). Static attributes only, no animation loop.
 *
 *   2. MAGNIFICATION (phong to khi hover) - the reference repo magnifying
 *      displacement map: a linear radial ramp (R=dx, G=dy, 128 neutral) applied
 *      with feDisplacementMap, so the surface reads as a convex lens that
 *      swells on hover.
 *
 * HARD RULES honoured: same-document inline SVG only (crbug 40347855); filter
 * attributes static; only feDisplacementMap scale may change and never in a
 * continuous rAF loop (crbug 359102842); purely additive - unsupported paths
 * leave the existing faux-glass look untouched. Gated by data-ylg-optics.
 */
(function () {
  "use strict";
  var root = (typeof window !== "undefined") ? window : globalThis;
  if (root.YLG_OPTICS) return;

  var NS = "http://www.w3.org/2000/svg";
  var defsSvg = null;
  var built = { aberration: false, magnify: false };
  var generation = 0, installedKey = null, installedResult = null;
  var railWatch = null, auxWatch = null;
  var railTimer = 0, auxTimer = 0, startupTimer = 0;

  // Invalidate before disconnect: even already-queued observer/timer callbacks
  // must not restore flags, filters or observers after teardown/reconfiguration.
  function stopWatching() {
    generation++;
    clearInterval(startupTimer);
    clearTimeout(railTimer);
    clearTimeout(auxTimer);
    startupTimer = railTimer = auxTimer = 0;
    try { if (railWatch) railWatch.disconnect(); } catch (e) {}
    try { if (auxWatch) auxWatch.disconnect(); } catch (e) {}
    railWatch = auxWatch = null;
  }

  function ensureSvg() {
    if (defsSvg && defsSvg.isConnected) return defsSvg;
    try {
      defsSvg = document.createElementNS(NS, "svg");
      defsSvg.setAttribute("aria-hidden", "true");
      defsSvg.setAttribute("width", "0");
      defsSvg.setAttribute("height", "0");
      defsSvg.setAttribute("color-interpolation-filters", "sRGB");
      defsSvg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
      var d = document.createElementNS(NS, "defs");
      defsSvg.appendChild(d);
      (document.body || document.documentElement).appendChild(defsSvg);
    } catch (e) { defsSvg = null; }
    return defsSvg;
  }

  function el(name, attrs) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) { if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, String(attrs[k])); }
    return n;
  }
  /* ---- Magnifying displacement map: linear radial ramp, 128 = neutral --- */
  function magnifyMapURI() {
    try {
      var w = 64, h = 64;
      var cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      var ctx = cv.getContext("2d");
      if (!ctx) return null;
      var img = ctx.createImageData(w, h);
      var d = img.data;
      var cx = w / 2, cy = h / 2;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var i = (y * w + x) * 4;
          d[i] = 128 + ((x - cx) / cx) * 127;
          d[i + 1] = 128 + ((y - cy) / cy) * 127;
          d[i + 2] = 0;
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return cv.toDataURL("image/png");
    } catch (e) { return null; }
  }

  /* ---- Chromatic aberration: 3-tap dispersion kernel ---- */
  function buildAberration(id, px) {
    var svg = ensureSvg();
    if (!svg) return false;
    var defs = svg.querySelector("defs");
    var existing = defs.querySelector("#" + id);
    if (existing) {
      var offsets = existing.querySelectorAll("feOffset");
      if (offsets.length === 2) {
        offsets[0].setAttribute("dx", String(-px));
        offsets[0].setAttribute("dy", String(-px * 0.35));
        offsets[1].setAttribute("dx", String(px));
        offsets[1].setAttribute("dy", String(px * 0.35));
      }
      return true;
    }
    try {
      var f = el("filter", { id: id, x: "-6%", y: "-6%", width: "112%", height: "112%", "color-interpolation-filters": "sRGB" });
      f.appendChild(el("feColorMatrix", { in: "SourceGraphic", type: "matrix", result: "srcR",
        values: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" }));
      f.appendChild(el("feColorMatrix", { in: "SourceGraphic", type: "matrix", result: "srcG",
        values: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" }));
      f.appendChild(el("feColorMatrix", { in: "SourceGraphic", type: "matrix", result: "srcB",
        values: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" }));
      f.appendChild(el("feOffset", { in: "srcR", dx: String(-px), dy: String(-px * 0.35), result: "rOff" }));
      f.appendChild(el("feOffset", { in: "srcB", dx: String(px), dy: String(px * 0.35), result: "bOff" }));
      f.appendChild(el("feGaussianBlur", { in: "rOff", stdDeviation: "0.4", result: "rBlur" }));
      f.appendChild(el("feGaussianBlur", { in: "bOff", stdDeviation: "0.4", result: "bBlur" }));
      f.appendChild(el("feBlend", { in: "rBlur", in2: "srcG", mode: "screen", result: "rg" }));
      f.appendChild(el("feBlend", { in: "rg", in2: "bBlur", mode: "screen" }));
      defs.appendChild(f);
      built.aberration = true;
      return true;
    } catch (e) { return false; }
  }

  function buildMagnify(id, scale) {
    var svg = ensureSvg();
    if (!svg) return false;
    var defs = svg.querySelector("defs");
    var existing = defs.querySelector("#" + id);
    if (existing) {
      var displacement = existing.querySelector("feDisplacementMap");
      if (displacement) displacement.setAttribute("scale", String(scale));
      return true;
    }
    var uri = magnifyMapURI();
    if (!uri) return false;
    try {
      var f = el("filter", { id: id, x: "-12%", y: "-12%", width: "124%", height: "124%", "color-interpolation-filters": "sRGB" });
      /* absolute px, same reason as the capsule lens: a percentage feImage is
         resolved against 100x100 and rescales the map. magnifyMapURI builds
         64x64, so the size below must stay 64 - it is the map's own size, not
         the box being filtered. */
      f.appendChild(el("feImage", { href: uri, x: "0", y: "0", width: "64", height: "64", preserveAspectRatio: "none", result: "magmap" }));
      f.appendChild(el("feDisplacementMap", { in: "SourceGraphic", in2: "magmap", scale: String(scale), xChannelSelector: "R", yChannelSelector: "G" }));
      defs.appendChild(f);
      built.magnify = true;
      return true;
    } catch (e) { return false; }
  }
  /* ---- Liquid-glass LENS: refraction + real chromatic aberration ----------
     Technique from kube.io "Liquid Glass in the Browser" (see attribution).
     Three steps:
       1. describe the bezel as a height profile. A convex squircle is used -
          y = (1 - (1-x)^4)^(1/4) - because it keeps the flat-to-curve transition
          smooth when stretched into a wide rectangle, so a pill-shaped control
          refracts evenly instead of showing a hard interior edge;
       2. integrate 127 rays through that profile with Snell's law and bake the
          result into a displacement map (R = dx, G = dy, 128 neutral), sized to
          the SVG displacement-map limit;
       3. feed the map to feDisplacementMap. Chromatic aberration is NOT faked
          with offset blending here: each colour channel is displaced with its
          own scale (red bends less than blue because n is wavelength-dependent),
          which is what real dispersion does at a thick rim.
     Static attributes only - the filter is built once and never animated, so it
     stays clear of the "no per-frame filter reconfiguration" rule. */
  /* 384 wide: the map is the only thing that carries the shape of the
     refraction, so it is sampled above the capsule's own width (346-374px on
     the live rail) and feImage stretches it back to exactly 100% x 100%.
     Anything below ~1 texel per CSS px shows its own stair-stepping. */
  var LENS_MAP = 384;
  /* Used only by the round hover well (magnifyLensURI), which is a different
     construction - see its own comment below. */
  var LENS_FALLOFF = 0.68;

  function convexSquircle(x) {
    var v = 1 - Math.pow(1 - x, 4);
    return v <= 0 ? 0 : Math.pow(v, 0.25);
  }

  /* Displacement magnitude for a ray entering the bezel at normalized distance
     `x` from the outer edge (0 = edge, 1 = end of bezel). The slope of the height
     profile is the tangent of the incidence angle; a small-angle Snell step gives
     the sideways travel. Returned as a fraction of the local radius. */
  function bezelDisplacement(x) {
    var d = 0.004;
    var x0 = Math.max(0, x - d), x1 = Math.min(1, x + d);
    var slope = (convexSquircle(x1) - convexSquircle(x0)) / (x1 - x0 || d);
    var theta = Math.atan(slope);
    // n1 = 1 (air), n2 = 1.5 (glass); refract toward the normal, then project
    var sinT2 = Math.sin(theta) / 1.5;
    var theta2 = Math.asin(Math.max(-1, Math.min(1, sinT2)));
    var bend = theta - theta2;
    return Math.sin(bend);
  }

  var lensMapCache = {};

  /* ---------------------------------------------------------------
     v1.3.5 - THE REFRACTOR IS BUILT THE WAY THE PHYSICS BUILDS IT.

     Every version up to 1.3.4 encoded the lens in the COLOUR CHANNEL
     AMPLITUDE and then guessed `scale` separately: scale = 0.8 * W, a
     number with no physical meaning. The kube.io article makes the
     contract explicit, and it is two steps:

       1. compute the displacement FIELD in pixels,
       2. divide it by its own maximum, store that ratio in the
          channels, and set scale = maximumDisplacement.

     feDisplacementMap samples at  src = p + scale * (C - 0.5). With
     C = (128 + 127*u)/255 the channel term is 0.498039*u, so a stored
     u = 1 moves the sample by 0.498039 * scale. Setting

          scale = maximumDisplacement / 0.498039

     makes one stored unit mean one pixel, on both axes, at every
     capsule width, with no gauge constant to tune. The map cannot ask
     for more than it was normalised to, so the old failure - a fold
     sitting at scale = W, i.e. at a different place on every viewport -
     is gone by construction rather than by tuning.

     The field itself has two terms, both sampled INWARD so the filter
     never reads outside the element box (an outward sample is
     transparent backdrop - the hard ring already documented):

       ZOOM    d = -k * (p - centre), isotropic in pixels.
               src = centre + (1-k)(p - centre), so the map magnifies
               by exactly M = 1/(1-k) on BOTH axes, and the gradient
               stays 1-k > 0 for every k < 1: it cannot fold, at any
               k, on any element width.

       BEZEL   the squircle/Snell profile from the article, applied
               along the inward surface normal over a band measured in
               PIXELS. This is the rim refraction that makes the
               capsule read as glass rather than as a zoomed photo.

     The two terms compete for the same gradient budget: the zoom
     spends (1-k) of it, the bezel spends more near the rim, and a
     positive total is exactly what 'not folded' means. So the bezel
     amplitude is not a taste knob, it is SOLVED: the field is rebuilt
     with a halved amplitude until the sampled gradient is positive
     everywhere. That spends whatever budget the chosen magnification
     left over and never one unit more. */
  var LENS_ENC_NEUTRAL = 128;
  var LENS_ENC_RANGE = 127;
  /* 127/255, not 127/128: the channel is compared against 0.5, not 128. */
  var LENS_ENC_GAIN = LENS_ENC_RANGE / 255;
  /* v1.3.8 - THE BAND WAS THE REASON THERE WAS NO CURVATURE FIELD.
     The rim term used to live in a 12px strip inside a 40px capsule, so the
     surface only curved in the outer 30 per cent of the height and the flat
     zoom did everything else. Measured amplitude there was 1.47px at 1.60x,
     1.03px at 2.29x and 0.59px at 4.00x - at dpr 2.5 that is a 1.5 to 3.7
     device-pixel bend, i.e. a formula that exists and an effect you cannot see.
     The dome now spans the whole half-height (h/2, 20px on the shipped rail),
     so every visible pixel of the capsule sits on a curved surface: 1.0 at the
     rim falling smoothly to 0.0 on the medial axis. The interior is a flat
     plate exactly like real glass, and the magnification is no longer uniform
     across the section. */
  var LENS_BEZEL_BAND = 12;    // thin-band model, still used by lensBezelAmp
  var LENS_BEZEL_AMP = 4;
  var LENS_CROSS_GAIN = 0.15;  // horizontal share of the doubly-curved term
  var LENS_CURVE_CEIL = 12;   // px of rim travel at the very low strengths
  var LENS_CURVE_FRACTION = 0.5;  // of the element height, i.e. the half-height
  /* How much of the gradient budget the rim may spend. 0.85 is deliberate: at
     the shipped 4x the whole budget is only 0.25, so a timid fraction leaves the
     rim under a pixel and it disappears. Spending most of it still guarantees a
     positive gradient (1-k)*(1-0.85) > 0, so the surface stays monotonic by
     construction and the rim is as visible as the magnification allows.
     MEASURED amp: 1.47px at 1.60x, 1.03px at 2.29x, 0.59px at 4.00x.
     v1.3.9 keeps 0.85 and adds a much gentler transverse term instead: measured
     on 10px stripes, a 7px horizontal bow at the edge smeared the pattern into
     arcs, while LENS_CROSS_GAIN 0.15 gives 3.2px and reads as a curve. */
  var LENS_BEZEL_BUDGET = 0.85;

  /* The amplitude is ALLOCATED from the budget, not chosen and then trimmed.
     The field is d = -k(p-c) - n*amp*profile(t), so the gradient the rim costs
     is amp*max|profile'|/band, and the gradient the zoom has already spent is
     k. Requiring 1 - k - amp*max|profile'|/band > 0 gives the closed form
     below. A fixed amplitude would mean the rim silently vanishes at high
     magnification (measured: the halving solver returned 0.5px at 4x, i.e. no
     rim at all) or tears at low magnification. */
  /* The thin-band solver, kept for the test suite: it is the model the hover
     well and the tests still describe, and it is not used by the capsule. */
  function lensBezelAmp(k, band) {
    if (!(band > 0)) return 0;
    var peak = 0, d = 0.004, i, t, x0, x1, sl;
    for (i = 0; i <= 64; i++) {
      t = i / 64;
      x0 = Math.max(0, t - d); x1 = Math.min(1, t + d);
      sl = Math.abs((bezelDisplacement(x1) - bezelDisplacement(x0)) / ((x1 - x0) || d));
      if (sl > peak) peak = sl;
    }
    if (!(peak > 0)) return 0;
    var budget = Math.max(0, 1 - k) * LENS_BEZEL_BUDGET;
    return Math.min(LENS_BEZEL_AMP, budget * band / peak);
  }

  /* Amplitude of the curvature dome, in pixels, for the remaining gradient
     budget. The profile is D(t) = (1-t)^2 for t = depth/half-height, so
     |dD/dt| peaks at 2 on the rim and the displacement slope it costs is
     2*amp/R. Requiring 1 - k - 2*amp/R > 0 gives the closed form below.
     Keeping the solver rather than hard-coding a number matters: a fixed
     amplitude either tears at low magnification or vanishes at high. */
  function lensCurveAmp(k, R) {
    if (!(R > 0)) return 0;
    var budget = Math.max(0, 1 - k) * LENS_BEZEL_BUDGET;
    return Math.min(LENS_CURVE_CEIL, budget * R / 2);
  }

  /* Signed distance to a stadium (the capsule's real outline): negative
     inside, zero on the border, positive outside. Used for both the
     bezel band and its inward normal. */
  function lensSdf(px, py, w, h) {
    var r = h / 2, hx = w / 2 - r, hy = h / 2 - r;
    var qx = Math.abs(px - w / 2) - hx;
    var qy = Math.abs(py - h / 2) - hy;
    var ox = Math.max(qx, 0), oy = Math.max(qy, 0);
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
  }

  function lensFieldRaw(w, h, k, bandPx, ampPx, MW) {
    var MH = Math.max(8, Math.round(MW * h / w));
    var dx = new Float64Array(MW * MH);
    var dy = new Float64Array(MW * MH);
    var B = Math.min(bandPx, h * 0.5);
    var maxAbs = 0;
    for (var j = 0; j < MH; j++) {
      var py = (j + 0.5) / MH * h;
      for (var i = 0; i < MW; i++) {
        var px = (i + 0.5) / MW * w;
        var vx = -k * (px - w / 2);
        var vy = -k * (py - h / 2);
        /* DOUBLY-CURVED TERM (v1.3.9).
           The dome above displaces along the SDF normal, which through the
           middle of a wide capsule is purely VERTICAL. A vertical displacement
           is invisible on vertical structure - you can slide a stripe up and
           down all day and it looks identical - so the top and bottom edges
           read as flat while the left and right ends, where the normal has an
           x-component, read as curved. That asymmetry is the bug the user
           reported as "no curvature from the top and bottom edges".
           The surface is now curved along BOTH axes: an extra horizontal
           magnification that grows toward the top and bottom edges, so any
           vertical feature bows at those edges instead of passing straight
           through. Gain is taken from the solved dome amplitude (ampPx / R), so
           the same halving solver that protects the vertical gradient protects
           this one - both fall together and neither can fold. */
        var dinY = h / 2 - Math.abs(py - h / 2);
        var tyy = B > 0 ? Math.min(1, Math.max(0, dinY / B)) : 1;
        var domeY = 1 - tyy;
        /* Same sign rule as the dome: v1.3.10 pushes OUTWARD so the horizontal
           edges shrink with the vertical ones instead of swelling. Measured: the
           inward form pegged M at 8x in the outermost pixel. */
        vx += LENS_CROSS_GAIN * k * (px - w / 2) * domeY * domeY;
        /* Keep the field mirror-symmetric about both centre axes. The old
           additive ux^2 vertical bow pushed upper and lower samples in the
           same direction, making every capsule and seek thumb sag. The SDF
           normal below supplies opposite curvature at the upper/lower rim;
           centre-line samples stay centred. */
        if (B > 0 && ampPx > 0) {
          var din = -lensSdf(px, py, w, h);
          if (din < B) {
            /* Dome profile over the full half-height: 1 at the border, 0 on the
               medial axis. Sign matters and v1.3.10 flips it OUTWARD.
               v1.3.8-v1.3.9 pushed INWARD (-=), which compresses the coordinate
               space at the rim and therefore MAGNIFIES it. Measured on the 40px
               capsule: M = 8.09x in the outermost row while the flat interior was
               1.31x - an 8x spike at the very edge, which is why the shipped lens
               read as "zoomed too far" next to the reference even though the body
               magnification was already lower than the reference's 1.5x.
               The reference tapers the other way: 1.08x at -68px falling to 0.18x
               at +84px, i.e. the rim SHRINKS. Pushing OUTWARD (+=) gives exactly
               that family: 0.71x at the border, 1.29x in the body.
               Outward is also what makes the curvature legible - the rolled edge
               is what you actually see as a curved surface. */
            var tp = 1 - Math.max(0, din) / B;
            var m = ampPx * tp * tp;
            var e = 0.5;
            var gx = lensSdf(px + e, py, w, h) - lensSdf(px - e, py, w, h);
            var gy = lensSdf(px, py + e, w, h) - lensSdf(px, py - e, w, h);
            var gl = Math.sqrt(gx * gx + gy * gy) || 1;
            vx += (gx / gl) * m;
            vy += (gy / gl) * m;
          }
        }
        var q = j * MW + i;
        dx[q] = vx; dy[q] = vy;
        var a = Math.abs(vx) > Math.abs(vy) ? Math.abs(vx) : Math.abs(vy);
        if (a > maxAbs) maxAbs = a;
      }
    }
    return { dx: dx, dy: dy, MW: MW, MH: MH, maxAbs: maxAbs };
  }

  /* d(src)/dp must stay positive on both axes or the image tears. */
  function lensFieldGradientOK(F, w, h) {
    var MW = F.MW, MH = F.MH, dx = F.dx, dy = F.dy;
    var cellX = w / MW, cellY = h / MH, i, j;
    for (j = 0; j < MH; j++) {
      var row = j * MW;
      for (i = 1; i < MW; i++) {
        if (1 + (dx[row + i] - dx[row + i - 1]) / cellX <= 0) return false;
      }
    }
    for (i = 0; i < MW; i++) {
      for (j = 1; j < MH; j++) {
        if (1 + (dy[j * MW + i] - dy[(j - 1) * MW + i]) / cellY <= 0) return false;
      }
    }
    return true;
  }

  /* Returns { uri, scale, maxPx, mag, bezelPx } or null. Cached on the
     exact capsule geometry and magnification, because every one of those
     inputs changes the map. */
  function lensMapURI(w, h, k) {
    try {
      w = Math.max(24, Number(w) || 374);
      h = Math.max(8, Number(h) || 40);
      k = Math.max(0, Math.min(0.92, Number(k) || 0));
      if (!(k > 0)) return null;
      var key = w.toFixed(1) + "x" + h.toFixed(1) + "k" + k.toFixed(4);
      if (lensMapCache[key]) return lensMapCache[key];
      var MW = LENS_MAP;
      var halfH = h * LENS_CURVE_FRACTION;
      var F = null, amp = lensCurveAmp(k, halfH);
      for (var pass = 0; pass < 6; pass++) {
        F = lensFieldRaw(w, h, k, halfH, amp, MW);
        if (lensFieldGradientOK(F, w, h)) break;
        amp *= 0.5;
      }
      if (!(F.maxAbs > 0)) return null;
      var cv = document.createElement("canvas");
      cv.width = F.MW; cv.height = F.MH;
      var ctx = cv.getContext("2d");
      if (!ctx) return null;
      var img = ctx.createImageData(F.MW, F.MH);
      var d = img.data;
      var inv = LENS_ENC_RANGE / F.maxAbs;
      for (var q = 0, n = F.MW * F.MH; q < n; q++) {
        var o = q * 4;
        d[o] = Math.max(0, Math.min(255, Math.round(LENS_ENC_NEUTRAL + F.dx[q] * inv)));
        d[o + 1] = Math.max(0, Math.min(255, Math.round(LENS_ENC_NEUTRAL + F.dy[q] * inv)));
        d[o + 2] = LENS_ENC_NEUTRAL;
        d[o + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      var out = {
        uri: cv.toDataURL("image/png"),
        scale: F.maxAbs / LENS_ENC_GAIN,
        maxPx: F.maxAbs,
        mag: 1 / (1 - k),
        bezelPx: amp
      };
      // Slider/viewport changes used to retain every PNG indefinitely.
      var cacheKeys = Object.keys(lensMapCache);
      if (cacheKeys.length >= 32) delete lensMapCache[cacheKeys[0]];
      lensMapCache[key] = out;
      return out;
    } catch (e) { return null; }
  }

  /* Hover magnifier: a radial ramp that GROWS the backdrop under the cursor.
     Applied to a pseudo-element over a control, so the control itself never
     moves - geometry, hit areas and pointer routing stay exactly as shipped. */
  /* v1.3.3 - the hover well used to be a pure magnifier: one smooth pull toward
     the centre, no bezel. That is why the "selection" felt flat compared with the
     capsules: at the rim the displacement fell to zero, so the edge of the well
     had no warp at all and the pill read as a painted oval.
     It now has the same two-term structure as the capsule lens - a BEZEL band
     that bends hard right at the edge, plus the magnifier body - so the selection
     shares the material language of the surface it sits in. Both terms sample
     inward (toward the centre), which is what keeps them safe inside the pseudo
     element's own box: an outward sample would read transparent backdrop and
     paint a hard ring, the failure mode already documented for the capsules. */
  function magnifyLensURI() {
    try {
      var S = 96;
      var cv = document.createElement("canvas");
      cv.width = S; cv.height = S;
      var ctx = cv.getContext("2d");
      if (!ctx) return null;
      var img = ctx.createImageData(S, S);
      var d = img.data;
      var band = 0.55;          // fraction of the half-axis that refracts
      var bezelGain = 1.15;     // rim bend, in units of the local radius
      var bodyGain = 0.55;      // smooth magnifier pull over the rest
      for (var y = 0; y < S; y++) {
        for (var x = 0; x < S; x++) {
          var i = (y * S + x) * 4;
          var u = (x / (S - 1)) * 2 - 1;
          var v = (y / (S - 1)) * 2 - 1;
          var len = Math.sqrt(u * u + v * v) || 1;
          var r = Math.min(1, len);
          /* distance from the rim, 0 at the edge and 1 at the centre */
          var edge = 1 - r;
          /* body: the original smooth magnifier, always present */
          var fall = 1 - r;
          var e = fall * fall * (3 - 2 * fall) * bodyGain;
          /* bezel: strong in the outermost band, zero once past it */
          if (edge < band) {
            var xn = edge / band;                    // 0 at rim, 1 at band end
            var m = Math.pow(bezelDisplacement(xn) * bezelGain, LENS_FALLOFF);
            e += Math.min(1, m);
          }
          d[i] = Math.max(0, Math.min(255, 128 - (u / len) * e * 127));
          d[i + 1] = Math.max(0, Math.min(255, 128 - (v / len) * e * 127));
          d[i + 2] = 0;
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return cv.toDataURL("image/png");
    } catch (e2) { return null; }
  }

  /* Chrome is a shallow edge lens, not a magnifier across the entire bar. */
  function chromeEdgeOffset(x, y, w, h, k) {
    var band = 16;
    var amp = 3 * Math.min(1, Math.max(0, k) / 0.23);
    if (w < 2 * band) amp = Math.min(amp, 0.9 * w / (2 * Math.PI));
    if (h < 2 * band) amp = Math.min(amp, 0.9 * h / (2 * Math.PI));
    function axis(p, length) {
      if (p <= 0 || p >= length) return 0;
      // Opposing bands overlap on the short axis. A smooth signed sine keeps
      // the centre continuous and reaches the requested 3px without a fold.
      if (length < 2 * band) return Math.sin(2 * Math.PI * p / length);
      // Rounded tent: 1px shoulders, bounded slope3/7 at the default3px
      // displacement. The rounded shoulders keep the edge transition smooth.
      function bump(d) {
        var t = Math.min(d, band - d), half = band / 2;
        if (t < 1) return t * t / 2 / (half - 1);
        if (t <= half - 1) return (t - 0.5) / (half - 1);
        return (half - 1 - Math.pow(half - t, 2) / 2) / (half - 1);
      }
      if (p < band) return bump(p);
      if (p > length - band) return -bump(length - p);
      return 0;
    }
    var dx = amp * axis(x, w), dy = amp * axis(y, h);
    var norm = Math.hypot(dx, dy);
    if (norm > 3) { dx *= 3 / norm; dy *= 3 / norm; }
    return { dx: dx, dy: dy };
  }
  var chromeMapCache = {};
  function chromeEdgeMapURI(w, h, k) {
    var key = w + "x" + h + "k" + k;
    if (chromeMapCache[key]) return chromeMapCache[key];
    var cv = document.createElement("canvas");
    cv.width = Math.min(2048, Math.max(24, Math.ceil(w)));
    cv.height = Math.min(256, Math.max(8, Math.ceil(h)));
    var ctx = cv.getContext("2d");
    if (!ctx) return null;
    var img = ctx.createImageData(cv.width, cv.height), scale = 6;
    for (var y = 0; y < cv.height; y++) {
      for (var x = 0; x < cv.width; x++) {
        var p = chromeEdgeOffset((x + 0.5) * w / cv.width, (y + 0.5) * h / cv.height, w, h, k);
        var i = (y * cv.width + x) * 4;
        img.data[i] = Math.round(127.5 + p.dx / scale * 255);
        img.data[i + 1] = Math.round(127.5 + p.dy / scale * 255);
        img.data[i + 2] = 128; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    var map = { uri: cv.toDataURL("image/png"), scale: scale, maxPx: 3, mag: 1, bezelPx: 16 };
    if (Object.keys(chromeMapCache).length >= 8) chromeMapCache = {};
    chromeMapCache[key] = map;
    return map;
  }

  // Bounds cover the measured displacement plus raster/blur clearance. The
  // historical 220% x 700% box reserved 15.4 surface areas even for tiny lenses.
  // Pixel units avoid percentage amplification on wide rails and tall chrome.
  function lensFilterBounds(w, h, maxPx) {
    var pad = Math.ceil(Math.max(0, Number(maxPx) || 0)) + 32;
    return { filterUnits: "userSpaceOnUse", x: String(-pad), y: String(-pad),
      width: String(w + 2 * pad), height: String(h + 2 * pad) };
  }

  function buildLens(id, opts) {
    var svg = ensureSvg();
    if (!svg) return false;
    var defs = svg.querySelector("defs");
    /* Rebuilding must actually REBUILD. The early return below made every call
       with the same id a no-op, which silently pinned the lab (and anything that
       changes w/h/k for an existing id) to the first geometry it ever built -
       measured: four different lensPx values all reported 1.299x. The guard is
       now conditional on the requested geometry actually matching what is
       already there, so unchanged calls stay cheap and changed ones take. */
    var prev = defs.querySelector("#" + id);
    if (prev) {
      var pw = Number(prev.getAttribute("data-ylg-lens-w"));
      var ph = Number(prev.getAttribute("data-ylg-lens-h"));
      var pk = Number(prev.getAttribute("data-ylg-lens-k"));
      var sameW = opts && opts.w !== undefined ? Math.abs(pw - Number(opts.w)) < 0.5 : true;
      var sameH = opts && opts.h !== undefined ? Math.abs(ph - Number(opts.h)) < 0.5 : true;
      var sameK = opts && opts.k !== undefined ? Math.abs(pk - Number(opts.k)) < 1e-4 : true;
      var profile = opts && opts.edgeOnly ? "chrome-edge" : "capsule";
      var sameProfile = (prev.getAttribute("data-ylg-lens-profile") || "capsule") === profile;
      if (sameW && sameH && sameK && sameProfile) return true;
      try { prev.parentNode.removeChild(prev); } catch (e0) {}
    }
    opts = opts || {};
    var w = Number(opts.w) || 374;
    var h = Number(opts.h) || 40;
    var k = (opts.k === undefined) ? 0 : Number(opts.k);
    var map = opts.edgeOnly ? chromeEdgeMapURI(w, h, k) : lensMapURI(w, h, k);
    if (!map) return false;
    try {
      /* THE LENS IS A SINGLE feDisplacementMap. Everything else was measured and
         removed, because each extra primitive was a separate colour artefact.

         What the shipped version used to be: a base displacement, a colour
         matrix stripping blue out of the base, a blue-only copy, a second
         displacement for that copy, and a screen blend to recombine them. That
         chain produced a hard lime band across the lower half of the capsule at
         every scale above 200 - reproduced at 200, 250, 299, 330 and 345, with
         and without ambient light, on a grey ramp and on video.

         The cause is exactly the second displacement. Its input is a blue-only
         image, so red and green are already zero; displaced a little further
         than the base, its samples fall outside the map and its offset
         multiplies by an alpha of 0. Blue therefore reads 0 in a horizontal
         stripe while red and green (from the untouched base) are still ~174:
         rgb(174,174,0) is lime. A neutral feFlood under the map fixes the
         colour but also flattens the map, and the lens measured 1.00x with it.

         The single displacement below has none of those failure modes:
             px 299 -> 2.12x    px 345 -> 3.40x    yellow pixels 0.00% at both
         measured on a 374px rail at 4x capture over a grey ramp, before and
         after in the same paused frame.

         The cost is the chromatic split. It is not free, but it is the correct
         trade: no blue branch means no blue-only samples to fall outside the
         map, and the lens is unconditional instead of tearing on some frames.

         v1.3.5 note: the geometry of these two primitives is unchanged and
         still load-bearing. What changed is only the NUMBERS - `scale` is now
         derived from the field's own maximum (see lensMapURI) instead of being
         guessed from the capsule width. The map also now covers exactly the
         element box, which is why the region can stay generous. */
      /* THE feImage SIZE MUST BE ABSOLUTE PIXELS, NOT "100%".
         feDisplacementMap was the primitive the reference article names, and it
         was already correct - the map was simply never reaching it intact.
         feImage percentages resolve against 100x100, NOT against the element box
         and NOT against the filter region, so a 384x41 map was squashed into
         100x40 and the primitive then stretched that back over 374x40. The field
         survived only as a coarse diagonal smear, and the lens measured 1.00x at
         EVERY strength: an inert filter that still painted, which is why it
         looked like a soft blur instead of a magnifier.
         Measured A/B on a 10px stripe backdrop, same map, same scale 281.72:
             width="100%" height="100%"  -> 20px stripe period = 1.00x
             width="374"  height="40"    -> 80px stripe period = 4.00x  <- shipped
         The element box must therefore be known when the filter is built, which
         is why w/h are measured from the rail and baked in. */
      var f = el("filter", Object.assign({ id: id, "color-interpolation-filters": "sRGB" }, lensFilterBounds(w, h, map.maxPx)));
      f.appendChild(el("feImage", { href: map.uri, x: "0", y: "0",
        width: String(w), height: String(h),
        preserveAspectRatio: "none", result: "map" }));
      f.appendChild(el("feDisplacementMap", { in: "SourceGraphic", in2: "map", scale: String(map.scale),
        xChannelSelector: "R", yChannelSelector: "G" }));
      f.setAttribute("data-ylg-lens-k", String(k));
      f.setAttribute("data-ylg-lens-profile", opts.edgeOnly ? "chrome-edge" : "capsule");
      f.setAttribute("data-ylg-lens-w", String(w));
      f.setAttribute("data-ylg-lens-h", String(h));
      f.setAttribute("data-ylg-lens-mag", map.mag.toFixed(3));
      f.setAttribute("data-ylg-lens-maxpx", map.maxPx.toFixed(2));
      defs.appendChild(f);
      return true;
    } catch (e) { return false; }
  }

  function buildHoverLens(id, px) {
    var svg = ensureSvg();
    if (!svg) return false;
    var defs = svg.querySelector("defs");
    var existingHover = defs.querySelector("#" + id);
    if (existingHover) {
      var displacement = existingHover.querySelector("feDisplacementMap");
      if (displacement) displacement.setAttribute("scale", String(px));
      var bounds = lensFilterBounds(32, 32, Math.abs(px) / 2);
      Object.keys(bounds).forEach(function (key) { existingHover.setAttribute(key, bounds[key]); });
      return true;
    }
    var uri = magnifyLensURI();
    if (!uri) return false;
    try {
      /* SAME GEOMETRY AND SAME PRIMITIVE COUNT AS THE CAPSULE LENS:
         feImage sized in absolute pixels, then one feDisplacementMap. The
         hover lens never had the blue branch, which is why it never showed the
         lime band - it is the capsule lens that has now been reduced to match
         it. The neutral flood is gone because with a single displacement there
         is no second, blue-only image whose samples can fall outside the map
         and multiply their offset by an alpha of zero. */
      var f = el("filter", Object.assign({ id: id, "color-interpolation-filters": "sRGB" }, lensFilterBounds(32, 32, Math.abs(px) / 2)));
      /* 32x32 is the measured size of the ::before well in glass-player.css.
         Absolute px for the same reason as the capsule lens - a "100%" feImage
         is 100x100 and silently rescales the map. */
      f.appendChild(el("feImage", { href: uri, x: "0", y: "0", width: "32", height: "32",
        preserveAspectRatio: "none", result: "mmap" }));
      f.appendChild(el("feDisplacementMap", { in: "SourceGraphic", in2: "mmap", scale: String(px),
        xChannelSelector: "R", yChannelSelector: "G" }));
      defs.appendChild(f);
      return true;
    } catch (e) { return false; }
  }

  /* backdrop-filter with an SVG url() is a Chrome/Edge capability that @supports
     reports optimistically, so it is probed at runtime and the CSS is gated on
     the resulting attribute. When it is unavailable the player chrome keeps its
     previous blur-only material rather than losing its filter entirely. */
  function backdropFilterURLOK() {
    try {
      if (!window.CSS || !CSS.supports) return false;
      return CSS.supports("backdrop-filter", "url(#ylg-lens-probe)") ||
             CSS.supports("-webkit-backdrop-filter", "url(#ylg-lens-probe)");
    } catch (e) { return false; }
  }

  /* Height / width of the capsule the lens is painted on. The rail is
     display:flex and its width depends on how many controls YouTube decided to
     render, so this is measured, never assumed. Falls back to the historical
     40/346 when the rail is not on screen yet (Shorts, embed, first paint). */
  function measureRailSize() {
    try {
      var rail = document.querySelector(".ytp-chrome-bottom .ytp-right-controls");
      if (!rail) return null;
      var r = rail.getBoundingClientRect();
      if (!(r.width > 40 && r.height > 8)) return null;
      return { w: r.width, h: r.height };
    } catch (e) { return null; }
  }

  /* MAGNIFICATION IS NOW AN INPUT, NOT A CONSEQUENCE OF WIDTH.

     Everything above measured the OLD ramp, whose magnification was
     M = 1/(1 - 0.996*scale/W): it moved with the viewport and folded at
     scale = W. Measured on a 374px rail: 300 -> 1.70x, 315 -> 2.82x,
     330 -> 5.55x, 345 -> 10.72x, 360 -> 53.6x, 375 -> -18.3x (folded,
     and 375 IS that rail's width). Those numbers are kept because they
     are the evidence that the old parameterisation was unstable.

     In v1.3.5 the map carries the magnification: M = 1/(1-k), isotropic,
     with the gradient 1-k > 0 for every k < 1. Width no longer appears
     in the formula at all, so there is nothing left to drift. The
     slider keeps its 0..300 range and its stored value; it is read as a
     strength and mapped to k = lensPx/400, so the shipped default of 300
     is k = 0.75, i.e. exactly 4.0x on both axes. */
  /* ---- PER-BOX LENS GEOMETRY (v1.3.15) ---------------------------------
     feImage is sized in ABSOLUTE pixels, so a map baked for one box cannot be
     reused on another box of a different width: the primitive samples the map
     in the element's own coordinate space, which means a 40x40 control only
     ever sees the left 40px flank of a 214px rail map. Measured on the live
     player before this change: one filter, data-ylg-lens-w=214 data-ylg-lens-h=40,
     applied to a 214x40 rail, a 135x40 time capsule, and 40x40 buttons - the
     capsule and every button were sampling one bezel flank instead of a
     symmetric rim.

     The fix is one map per measured box family:
        #ylg-lens-player   the right rail (already dynamic, keep the id)
        #ylg-lens-capsule  the time display
        #ylg-lens-well     one control / the volume well
     Each is rebuilt when its own box changes (duration text grows the capsule
     from 135 to 176px, for example). If any of them cannot be built the
     document flag data-ylg-lens-split stays off and the CSS falls back to the
     single rail map, so the failure mode is the old behaviour, never a missing
     url() reference that would drop the backdrop filter entirely. */
  function measureBox(sel) {
    try {
      var el = document.querySelector(sel);
      if (!el) return null;
      var r = el.getBoundingClientRect();
      if (!(r.width >= 8 && r.height >= 8)) return null;
      return { w: Math.round(r.width), h: Math.round(r.height) };
    } catch (e) { return null; }
  }

  var AUX_BOXES = {
    // Volume uses the CSS-only material in interaction-performance.css.
    // Observing its opening width rebuilt an unused SVG displacement map
    // after hover, also refreshing unrelated interface lenses.
    "ylg-lens-capsule": ".ytp-chrome-bottom .ytp-time-display"
  };

  function syncOne(id, sel, px, ab) {
    var box = measureBox(sel);
    if (!box) return false;
    var k = playerLensKFor(px);
    if (!(k > 0)) return false;
    var f = defsSvg && defsSvg.querySelector("#" + id);
    if (f) {
      var haveK = Number(f.getAttribute("data-ylg-lens-k"));
      var haveW = Number(f.getAttribute("data-ylg-lens-w"));
      var haveH = Number(f.getAttribute("data-ylg-lens-h"));
      if (Math.abs(haveK - k) < 1e-4 && Math.abs(haveW - box.w) < 1 && Math.abs(haveH - box.h) < 1) return true;
      try { f.parentNode.removeChild(f); } catch (e) {}
    }
    return buildLens(id, { k: k, aberration: ab, w: box.w, h: box.h });
  }

  function syncAuxLenses(px, ab) {
    var all = true;
    for (var id in AUX_BOXES) {
      if (!Object.prototype.hasOwnProperty.call(AUX_BOXES, id)) continue;
      var ok = false;
      try { ok = syncOne(id, AUX_BOXES[id], px, ab); } catch (e) { ok = false; }
      if (!ok) all = false;
    }
    try {
      if (all) document.documentElement.setAttribute("data-ylg-lens-split", "1");
      else document.documentElement.removeAttribute("data-ylg-lens-split");
    } catch (e2) {}
    return all;
  }

  /* Same lens builder/strength as the player, measured for the chrome sampler.
     Keep readiness independent: a home page has no player auxiliary boxes. */
  function syncChromeLens(px, ab) {
    var ok = false;
    try {
      var box = measureBox("#frosted-glass");
      if (box && lensKFor(px) > 0) {
        ok = buildLens("ylg-lens-chrome", { w: box.w, h: box.h,
          k: lensKFor(px), aberration: ab, edgeOnly: true });
      }
      if (ok) document.documentElement.setAttribute("data-ylg-chrome-lens", "1");
      else document.documentElement.removeAttribute("data-ylg-chrome-lens");
    } catch (e) {
      try { document.documentElement.removeAttribute("data-ylg-chrome-lens"); } catch (_) {}
    }
    return ok;
  }
  function syncControlLens(px, ab) {
    var ok = false;
    try { ok = syncOne("ylg-lens-control", ".ytp-chrome-bottom .ytp-left-controls > .ytp-button", px, ab); } catch (e) {}
    try {
      if (ok) document.documentElement.setAttribute("data-ylg-control-lens", "1");
      else document.documentElement.removeAttribute("data-ylg-control-lens");
    } catch (e) {}
    return ok;
  }
  var interfaceSurfaces = [], interfaceKeys = {};
  function syncInterfaceLenses(px, ab) {
    // Per geometry, not one stretched map for every chip. Bound the number of
    // maps and leave CSS glass as fallback when the budget is exhausted.
    if (!document.querySelectorAll) return;
    interfaceSurfaces = interfaceSurfaces.filter(function(node) {
      if (node.isConnected !== false) return true;
      try { node.style.removeProperty("--ylg-interface-lens"); } catch (e) {}
      return false;
    });
    var surfaces = document.querySelectorAll(".ytSearchboxComponentInputBox, yt-chip-cloud-chip-renderer.ylg-glass, ytd-chip-renderer.ylg-glass");
    var k = playerLensKFor(px);
    // Batch geometry reads before SVG/style writes: alternating them forces
    // repeated style/layout flushes across the whole chip row.
    var measured = [];
    for (var i = 0; i < surfaces.length && i < 42; i++) {
      var node = surfaces[i], r = node.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      measured.push({ node: node, w: Math.round(r.width), h: Math.round(r.height) });
    }
    for (var j = 0; j < measured.length; j++) {
      var item = measured[j], node = item.node, w = item.w, h = item.h, key = w + "x" + h;
      var id = interfaceKeys[key];
      if (!id && Object.keys(interfaceKeys).length < 24) {
        id = "ylg-lens-ui-" + Object.keys(interfaceKeys).length;
        interfaceKeys[key] = id;
      }
      if (id && k > 0 && buildLens(id, { w: w, h: h, k: k, aberration: ab })) {
        var value = "url(#" + id + ")";
        if (node.style.getPropertyValue("--ylg-interface-lens") !== value) {
          node.style.setProperty("--ylg-interface-lens", value);
        }
        if (interfaceSurfaces.indexOf(node) < 0) interfaceSurfaces.push(node);
      } else {
        if (node.style.getPropertyValue("--ylg-interface-lens")) node.style.removeProperty("--ylg-interface-lens");
      }
    }
    if (k > 0) buildLens("ylg-lens-seek", { w: 44, h: 28, k: k, aberration: ab });
  }

  var LENS_K_PER_PX = 1 / 400;
  function lensKFor(px) {
    var v = Number(px);
    if (!(v > 0)) return 0;
    return Math.min(0.88, Math.max(0, v * LENS_K_PER_PX));
  }
  /* Calibrate the default dial92 from ~1.30x to exactly1.15x for player
     capsules only. Chrome retains its independent edge profile and strength. */
  function playerLensKFor(px) {
    return lensKFor(px) * ((1 - 1 / 1.15) / 0.23);
  }

  /* Rebuild only when the numbers actually baked into the filter differ
     from the ones the current capsule and slider ask for. The filter now
     records k, w and h as data attributes, so this compares the real
     state instead of re-deriving a scale and hoping it matches. */
  function syncLens(px, ab) {
    var f = defsSvg && defsSvg.querySelector("#ylg-lens-player");
    if (!f) return false;
    var m = measureRailSize();
    if (!m) return false;
    var k = playerLensKFor(px);
    if (!(k > 0)) return false;
    var haveK = Number(f.getAttribute("data-ylg-lens-k"));
    var haveW = Number(f.getAttribute("data-ylg-lens-w"));
    var haveH = Number(f.getAttribute("data-ylg-lens-h"));
    if (Math.abs(haveK - k) < 1e-4 && Math.abs(haveW - m.w) < 1 && Math.abs(haveH - m.h) < 1) return false;
    try { f.parentNode.removeChild(f); } catch (e) {}
    return buildLens("ylg-lens-player", { k: k, aberration: ab, w: m.w, h: m.h });
  }

  /* One bounded startup interval for all three box families. Observers only
     debounce resize work; no animation scheduler and no permanent polling. */
  function watchLensBoxes(px, ab) {
    var token = generation;
    var railTarget = null, auxTargets = {}, chromeTarget = null, controlTarget = null;
    function alive() { return token === generation; }
    function sync() {
      if (!alive()) return;
      if (document.documentElement.getAttribute("data-ylg-player-transition") === "1") return;
      try { syncLens(px, ab); } catch (e) {}
      try { syncAuxLenses(px, ab); } catch (e) {}
      try { syncChromeLens(px, ab); } catch (e) {}
      try { syncControlLens(px, ab); } catch (e) {}
      try { syncInterfaceLenses(px, ab); } catch (e) {}
    }
    function attach() {
      if (!alive()) return;
      try {
        var rail = document.querySelector(".ytp-chrome-bottom .ytp-right-controls");
        if (railWatch && rail !== railTarget) {
          if (railTarget) railWatch.unobserve(railTarget);
          railTarget = rail;
          if (rail) railWatch.observe(rail);
        }
        for (var id in AUX_BOXES) {
          if (!Object.prototype.hasOwnProperty.call(AUX_BOXES, id)) continue;
          var box = document.querySelector(AUX_BOXES[id]);
          if (auxWatch && box !== auxTargets[id]) {
            if (auxTargets[id]) auxWatch.unobserve(auxTargets[id]);
            auxTargets[id] = box;
            if (box) auxWatch.observe(box);
          }
        }
        var chrome = document.querySelector("#frosted-glass");
        if (auxWatch && chrome !== chromeTarget) {
          if (chromeTarget) auxWatch.unobserve(chromeTarget);
          chromeTarget = chrome;
          if (chrome) auxWatch.observe(chrome);
        }
        var control = document.querySelector(".ytp-chrome-bottom .ytp-left-controls > .ytp-button");
        if (auxWatch && control !== controlTarget) {
          if (controlTarget) auxWatch.unobserve(controlTarget);
          controlTarget = control;
          if (control) auxWatch.observe(control);
        }
      } catch (e) {}
    }
    if (typeof ResizeObserver === "function") {
      railWatch = new ResizeObserver(function () {
        if (!alive()) return;
        clearTimeout(railTimer);
        railTimer = setTimeout(function () {
          if (!alive()) return;
          railTimer = 0;
          try { syncLens(px, ab); } catch (e) {}
        }, document.documentElement.getAttribute("data-ylg-player-transition") === "1" ? 540 : 220);
      });
      auxWatch = new ResizeObserver(function () {
        if (!alive()) return;
        clearTimeout(auxTimer);
        auxTimer = setTimeout(function () {
          if (!alive()) return;
          auxTimer = 0;
          try { syncAuxLenses(px, ab); } catch (e) {}
          try { syncChromeLens(px, ab); } catch (e) {}
          try { syncControlLens(px, ab); } catch (e) {}
          try { syncInterfaceLenses(px, ab); } catch (e) {}
        }, document.documentElement.getAttribute("data-ylg-player-transition") === "1" ? 540 : 220);
      });
    }
    attach();
    var tries = 0;
    startupTimer = setInterval(function () {
      if (!alive()) return;
      attach();
      sync();
      if (++tries >= 40) {
        clearInterval(startupTimer);
        startupTimer = 0;
      }
    }, 250);
  }

  function install(opts) {
    opts = opts || {};
    var ab = (opts.aberrationPx === undefined) ? 1.6 : Number(opts.aberrationPx);
    var mag = (opts.magnifyScale === undefined) ? 18 : Number(opts.magnifyScale);
    var lensPx = (opts.lensPx === undefined) ? 26 : Number(opts.lensPx);
    var lensAb = (opts.lensAberration === undefined) ? 0.18 : Number(opts.lensAberration);
    var key = [ab, mag, lensPx, lensAb].join("|");
    if (installedKey === key && installedResult && defsSvg && defsSvg.isConnected) {
      return { aberration: installedResult.aberration, magnify: installedResult.magnify, lens: installedResult.lens };
    }
    stopWatching();
    var okA = ab > 0 ? buildAberration("ylg-optics-aberration", ab) : false;
    var okM = mag > 0 ? buildMagnify("ylg-optics-magnify", mag) : false;
    /* TWO DIFFERENT DIALS, deliberately not the same units:
       opts.lensPx       - capsule curvature. k = lensPx/400, so 300 -> 4.00x.
                           This is the strength behind the control bar.
       opts.magnifyScale - the round 32px hover well over a single button. It is
                           still a raw feDisplacementMap scale in px (default 18,
                           popup slider 0..60), which is correct there because the
                           well is a fixed 32x32 target, not a resizing rail.
     The popup labels them "Hover lens strength" and (optics section) the capsule
     dial separately, so the two never read as the same control. */
    /* The filter cannot carry dispersion (measured: any second displacement
       that travels further than the base drops a channel and paints a lime
       band). The rim gradient in glass-player.css does it instead, and this is
       the only coupling between the user's slider and that gradient. */
    try {
      document.documentElement.style.setProperty("--ylg-lens-ab", String(Math.max(0, Math.min(1, lensAb))));
    } catch (e) {}
    /* Both axes are now in PIXELS, so the capsule's aspect ratio enters the
       field directly instead of being approximated by a constant. It still has
       to be MEASURED rather than assumed: the rail is 346px on one load and
       374px on the next, depending on the viewport, on how many controls
       YouTube has rendered, and on other extensions injecting buttons. The
       field is rebuilt from the live box, and watchLensBoxes re-runs it when
       that box changes. */
    var lensRail = measureRailSize();
    var lensK = playerLensKFor(lensPx);
    var lensOK = (lensPx > 0 && lensK > 0 && backdropFilterURLOK()) ?
      buildLens("ylg-lens-player", { k: lensK, aberration: lensAb,
        w: lensRail ? lensRail.w : 374, h: lensRail ? lensRail.h : 40 }) : false;
    /* Per-box maps, built only when the rail map succeeded: if the runtime
       url() probe failed there is no point building siblings that reference
       the same broken path. */
    var auxOK = lensOK ? syncAuxLenses(lensPx, lensAb) : false;
    if (lensOK) { syncChromeLens(lensPx, lensAb); syncControlLens(lensPx, lensAb); syncInterfaceLenses(lensPx, lensAb); }
    else {
      document.documentElement.removeAttribute("data-ylg-chrome-lens");
      document.documentElement.removeAttribute("data-ylg-control-lens");
    }
    var hoverOK = lensOK && mag > 0 ? buildHoverLens("ylg-lens-hover", mag) : false;
    try {
      document.documentElement.setAttribute("data-ylg-optics", (okA || okM || lensOK) ? "on" : "off");
      document.documentElement.setAttribute("data-ylg-optics-aberration", okA ? "1" : "0");
      document.documentElement.setAttribute("data-ylg-optics-magnify", okM ? "1" : "0");
      document.documentElement.setAttribute("data-ylg-lens", lensOK ? "1" : "0");
      document.documentElement.setAttribute("data-ylg-lens-hover", hoverOK ? "1" : "0");
    } catch (e) {}
    if (lensOK) watchLensBoxes(lensPx, lensAb);
    else {
      try { document.documentElement.removeAttribute("data-ylg-lens-split"); } catch (e) {}
    }
    installedKey = key;
    installedResult = { aberration: okA, magnify: okM, lens: lensOK };
    return { aberration: okA, magnify: okM, lens: lensOK };
  }

  function teardown() {
    stopWatching();
    installedKey = installedResult = null;
    try { if (defsSvg && defsSvg.parentNode) defsSvg.parentNode.removeChild(defsSvg); } catch (e) {}
    defsSvg = null;
    interfaceSurfaces.forEach(function (node) { try { node.style.removeProperty("--ylg-interface-lens"); } catch (e) {} });
    interfaceSurfaces = []; interfaceKeys = {};
    built = { aberration: false, magnify: false };
    try {
      document.documentElement.style.removeProperty("--ylg-lens-ab");
      document.documentElement.removeAttribute("data-ylg-optics");
      document.documentElement.removeAttribute("data-ylg-optics-aberration");
      document.documentElement.removeAttribute("data-ylg-optics-magnify");
      document.documentElement.removeAttribute("data-ylg-lens");
      document.documentElement.removeAttribute("data-ylg-lens-hover");
      document.documentElement.removeAttribute("data-ylg-chrome-lens");
      document.documentElement.removeAttribute("data-ylg-control-lens");
      document.documentElement.removeAttribute("data-ylg-lens-split");
    } catch (e2) {}
  }

  root.YLG_OPTICS = {
    install: install,
    teardown: teardown,
    supported: function () { return built; },
    /* exposed for the test suite: the map must satisfy scale = maxPx/0.498039
       and the field must stay monotonic on both axes */
    lensKFor: lensKFor,
    lensFilterBounds: lensFilterBounds,
    playerLensKFor: playerLensKFor,
    refreshPlayer: function () {
      if (!installedKey || document.documentElement.getAttribute("data-ylg-lens") !== "1") return;
      var values = installedKey.split("|");
      var px = Number(values[2]), ab = Number(values[3]);
      syncLens(px, ab);
      syncAuxLenses(px, ab);
      syncControlLens(px, ab);
    },
    refreshInterface: function () {
      if (document.documentElement.getAttribute("data-ylg-lens") !== "1" || !installedKey) return;
      var values = installedKey.split("|");
      syncInterfaceLenses(Number(values[2]), Number(values[3]));
    },
    lensBezelAmp: lensBezelAmp,
    lensCurveAmp: lensCurveAmp,
    lensFieldRaw: lensFieldRaw,
    lensFieldGradientOK: lensFieldGradientOK,
    lensMapURI: lensMapURI,
    buildLens: buildLens,
    lensSdf: lensSdf,
    chromeEdgeOffset: chromeEdgeOffset,
    LENS_ENC_GAIN: LENS_ENC_GAIN,
    LENS_MAP: LENS_MAP
  };
})();
