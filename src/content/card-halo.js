(function (root) {
  "use strict";

  var HOST_SELECTOR = [
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-playlist-video-renderer",
    "ytd-grid-video-renderer",
    "yt-lockup-view-model"
  ].join(", ");

  var EXCLUDED_SELECTOR = [
    "ytd-shorts",
    "#movie_player",
    "ytd-miniplayer",
    ".ytp-ce-element",
    ".ytp-endscreen-content",
    ".ytp-videowall-still"
  ].join(", ");

  var THUMB_IMG_SELECTOR = [
    "ytd-thumbnail img",
    "yt-thumbnail-view-model img",
    "a#thumbnail img",
    ".yt-thumbnail-view-model__image img",
    ".ytThumbnailViewModelImage img"
  ].join(", ");

  var AVATAR_SELECTOR = [
    "yt-avatar-shape",
    "yt-decorated-avatar-view-model",
    "#avatar-link",
    "#avatar",
    ".yt-spec-avatar-shape"
  ].join(", ");

  var active = false;
  var haloEl = null;
  var haloImg = null;
  var activeHost = null;
  var currentSrc = "";

  function isFeatureEnabled() {
    var de = document.documentElement;
    if (!de) return false;
    if (de.getAttribute("data-ylg-enabled") !== "true") return false;
    if (de.getAttribute("data-ylg-bg-suspended") === "1") return false;
    if (de.getAttribute("data-ylg-card-halo") !== "true") return false;
    if (de.getAttribute("data-ylg-hover") === "off") return false;
    if (de.getAttribute("data-ylg-lowfx") === "true") return false;
    if (de.getAttribute("data-ylg-scrubbing") === "1") return false;
    return true;
  }

  function ensureHalo() {
    if (haloEl && haloImg) return haloEl;
    var existing = document.getElementById && document.getElementById("ylg-card-halo");
    if (existing && existing.firstElementChild && existing.firstElementChild.tagName === "IMG") {
      haloEl = existing;
      haloImg = existing.firstElementChild;
      return haloEl;
    }
    haloEl = document.createElement("div");
    haloEl.id = "ylg-card-halo";
    haloEl.setAttribute("aria-hidden", "true");
    haloImg = document.createElement("img");
    haloImg.setAttribute("alt", "");
    haloImg.setAttribute("aria-hidden", "true");
    haloImg.setAttribute("decoding", "async");
    haloEl.appendChild(haloImg);
    return haloEl;
  }

  function usableSrc(img) {
    if (!img) return "";
    if (typeof img.closest === "function" && img.closest(AVATAR_SELECTOR)) return "";
    var src = img.currentSrc || (typeof img.getAttribute === "function" ? img.getAttribute("src") : "") || img.src || "";
    if (!src || src === "about:blank" || src.indexOf("data:image/gif") === 0) return "";
    return src;
  }

  function findThumbnailSrc(host) {
    if (!host || typeof host.querySelectorAll !== "function") return "";
    var candidates = host.querySelectorAll(THUMB_IMG_SELECTOR);
    var i;
    for (i = 0; i < candidates.length; i++) {
      var src = usableSrc(candidates[i]);
      if (src) return src;
    }
    var fallbackImgs = host.querySelectorAll("img");
    for (i = 0; i < fallbackImgs.length; i++) {
      var img = fallbackImgs[i];
      var fSrc = usableSrc(img);
      if (!fSrc) continue;
      if (fSrc.indexOf("ytimg.com") !== -1 || fSrc.indexOf("ggpht.com") !== -1 || (img.width || 0) >= 96) {
        return fSrc;
      }
    }
    return "";
  }

  function findCardHost(target) {
    if (!target || typeof target.closest !== "function") return null;
    if (target.closest(EXCLUDED_SELECTOR)) return null;
    var host = target.closest(HOST_SELECTOR);
    if (!host || host.isConnected === false) return null;
    if (typeof host.matches === "function" && host.matches("yt-lockup-view-model") && host.parentElement) {
      var outer = host.parentElement.closest(
        "ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-playlist-video-renderer, ytd-grid-video-renderer"
      );
      if (outer && outer.isConnected !== false) host = outer;
    }
    return host;
  }

  function clearHostAttribute(host) {
    if (host && typeof host.removeAttribute === "function") {
      host.removeAttribute("data-ylg-halo-host");
    }
  }

  function hideHalo(detach) {
    if (haloEl && typeof haloEl.removeAttribute === "function") {
      haloEl.removeAttribute("data-ylg-halo-visible");
    }
    if (detach) {
      clearHostAttribute(activeHost);
      activeHost = null;
      currentSrc = "";
      if (haloEl && haloEl.parentNode && typeof haloEl.parentNode.removeChild === "function") {
        haloEl.parentNode.removeChild(haloEl);
      }
    }
  }

  function showForHost(host) {
    if (!isFeatureEnabled()) {
      hideHalo(true);
      return;
    }
    var src = findThumbnailSrc(host);
    if (!src) {
      if (activeHost === host) hideHalo(false);
      return;
    }
    ensureHalo();
    if (activeHost && activeHost !== host) {
      clearHostAttribute(activeHost);
    }
    activeHost = host;
    host.setAttribute("data-ylg-halo-host", "1");
    if (currentSrc !== src) {
      currentSrc = src;
      haloImg.setAttribute("src", src);
    }
    if (haloEl.parentNode !== host) {
      host.appendChild(haloEl);
    }
    haloEl.setAttribute("data-ylg-halo-visible", "1");
  }

  function onPointerOver(event) {
    if (!active || !event) return;
    if (event.pointerType === "touch") return;
    if (!isFeatureEnabled()) {
      hideHalo(true);
      return;
    }
    var host = findCardHost(event.target);
    if (!host) return;
    if (host === activeHost && haloEl && haloEl.getAttribute("data-ylg-halo-visible") === "1") {
      var nextSrc = findThumbnailSrc(host);
      if (nextSrc && nextSrc !== currentSrc) {
        currentSrc = nextSrc;
        haloImg.setAttribute("src", nextSrc);
      }
      return;
    }
    showForHost(host);
  }

  function onPointerOut(event) {
    if (!active || !activeHost) return;
    var related = event && event.relatedTarget;
    if (related && typeof activeHost.contains === "function" && activeHost.contains(related)) return;
    hideHalo(false);
  }

  function onScroll() {
    if (!activeHost && !(haloEl && haloEl.getAttribute("data-ylg-halo-visible") === "1")) return;
    hideHalo(false);
  }

  function onNavigateStart() {
    hideHalo(true);
  }

  function onVisibilityChange() {
    if (document.hidden) hideHalo(false);
  }

  function onWindowBlur() {
    hideHalo(false);
  }

  function init() {
    if (active) {
      if (!isFeatureEnabled()) teardown();
      return;
    }
    if (typeof document === "undefined" || !document.addEventListener) return;
    active = true;
    document.addEventListener("pointerover", onPointerOver, { passive: true });
    document.addEventListener("pointerout", onPointerOut, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange, { passive: true });
    document.addEventListener("yt-navigate-start", onNavigateStart, { passive: true });
    if (root.addEventListener) {
      root.addEventListener("scroll", onScroll, { passive: true });
      root.addEventListener("blur", onWindowBlur, { passive: true });
    }
  }

  function teardown() {
    if (typeof document !== "undefined" && document.removeEventListener) {
      document.removeEventListener("pointerover", onPointerOver, { passive: true });
      document.removeEventListener("pointerout", onPointerOut, { passive: true });
      document.removeEventListener("visibilitychange", onVisibilityChange, { passive: true });
      document.removeEventListener("yt-navigate-start", onNavigateStart, { passive: true });
    }
    if (root.removeEventListener) {
      root.removeEventListener("scroll", onScroll, { passive: true });
      root.removeEventListener("blur", onWindowBlur, { passive: true });
    }
    hideHalo(true);
    haloEl = null;
    haloImg = null;
    active = false;
  }

  function stats() {
    return {
      active: active,
      hasNode: Boolean(haloEl),
      hostTag: activeHost ? activeHost.tagName : "",
      visible: Boolean(haloEl && haloEl.getAttribute("data-ylg-halo-visible") === "1"),
      src: currentSrc
    };
  }

  root.YLG_CARD_HALO = {
    init: init,
    teardown: teardown,
    stats: stats
  };
})(typeof window !== "undefined" ? window : this);
