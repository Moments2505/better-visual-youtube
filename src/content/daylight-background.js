/* Clock/solar scenery. Weather is optional and cached by the service worker.
 * No UI-rate frame loop, video capture or per-frame geometry reads. */
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  if (root.YLG_DAYLIGHT) return;
  var started = false, host = null, timer = null, nextChangeAt = null, revision = 0;
  var currentScene = null, moving = false, snapshot = null;
  var renderer = null, rendererTried = false;
  var weather = null, weatherStatus = "off", weatherKey = "", weatherDue = 0, weatherPending = false, weatherRevision = 0;
  var reduced = root.matchMedia ? root.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var forced = root.matchMedia ? root.matchMedia("(forced-colors: active)") : null;
  var scenes = ["auto", "morning", "day", "sunset", "night"];

  function eligiblePage() {
    var path = root.location && root.location.pathname;
    return path === "/" || path === "/results";
  }
  function options() {
    var value = snapshot && snapshot.daylightBackground || {};
    var strength = Number(value.intensity);
    return {
      enabled: !!(snapshot && snapshot.enabled && value.enabled),
      scene: scenes.indexOf(value.scene) >= 0 ? value.scene : "auto",
      liveWeather: value.liveWeather === true && value.scene === "auto" && !!root.YLG_SKY_ENV && root.YLG_SKY_ENV.validLocation(value.location),
      location: value.location,
      intensity: Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0.45
    };
  }
  function sceneAt(date) {
    var hour = date.getHours();
    return hour < 5 || hour >= 19 ? "night" : hour < 10 ? "morning" : hour < 16 ? "day" : "sunset";
  }
  function clearTimer() {
    revision++;
    if (timer !== null) root.clearTimeout(timer);
    timer = null; nextChangeAt = null;
  }
  function scheduleBoundary(date) {
    // Local dates preserve the intended clock boundaries across DST changes.
    var boundary = new Date(date.getTime());
    var hour = date.getHours(), next = hour < 5 ? 5 : hour < 10 ? 10 : hour < 16 ? 16 : hour < 19 ? 19 : 29;
    boundary.setHours(next, 0, 0, 0);
    nextChangeAt = boundary.getTime();
    var request = revision;
    timer = root.setTimeout(function () {
      if (!started || request !== revision) return;
      timer = null; nextChangeAt = null; refresh();
    }, Math.max(1, nextChangeAt - date.getTime()));
  }
  function unmount() {
    if (renderer) renderer.teardown(); renderer=null; rendererTried=false;
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null; currentScene = null; moving = false;
    document.documentElement.removeAttribute("data-ylg-daylight");
  }
  function mount() {
    if (host || !document.body) return;
    host = document.createElement("div");
    host.id = "ylg-daylight-background";
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("role", "presentation");
    ["glow", "sun", "stars", "galaxy"].forEach(function (name) {
      var layer = document.createElement("span");
      layer.className = "ylg-daylight-" + name;
      host.appendChild(layer);
    });
    document.body.appendChild(host);
  }
  function resetWeather() {
    weatherRevision++; weather = null; weatherKey = ""; weatherDue = 0; weatherPending = false; weatherStatus = "off";
  }
  function loadWeather(value) {
    var key = value.location.latitude + "," + value.location.longitude;
    if (weatherKey !== key) { resetWeather(); weatherKey = key; }
    if (weatherPending || Date.now() < weatherDue || document.hidden) return;
    weatherDue = Date.now() + 300000;
    if (!root.chrome || !root.chrome.runtime || !root.chrome.runtime.sendMessage) { weatherStatus = "unavailable"; return; }
    weatherPending = true; weatherStatus = "loading";
    var request = weatherRevision;
    try {
      root.chrome.runtime.sendMessage({ type: "ylg:weather" }, function (reply) {
        var error = root.chrome.runtime.lastError;
        if (!started || request !== weatherRevision || !host) return;
        weatherPending = false;
        weatherStatus = error || !reply ? "offline" : reply.status;
        weather = !error && reply && reply.weather && Number.isFinite(reply.weather.time) &&
          Math.abs(Date.now() - reply.weather.time) <= 7200000 ? reply.weather : null;
        weatherDue = !error && reply && Number.isFinite(reply.nextRefreshAt) ? Math.max(Date.now() + 60000, reply.nextRefreshAt) : Date.now() + 300000;
        refresh();
      });
    } catch (_) { weatherPending = false; weatherStatus = "offline"; }
  }
  function applyLive(value, now) {
    var solar = root.YLG_SKY_ENV.solarAt(now, value.location);
    currentScene = solar.scene;
    host.setAttribute("data-live", "true");
    host.style.setProperty("--ylg-solar-x", solar.x.toFixed(2) + "vw");
    host.style.setProperty("--ylg-solar-y", solar.y.toFixed(2) + "vh");
    host.style.setProperty("--ylg-solar-stars", solar.stars.toFixed(3));
    // Only minute-scale updates repaint a static gradient; motion remains CSS.
    var daylight = solar.daylight;
    var warm = Math.max(0, 1 - Math.abs(solar.elevation - 1) / 11);
    host.style.setProperty("--ylg-live-top", "hsl(" + (220 - 20*daylight).toFixed(1) + " 52% " + (9 + 24*daylight).toFixed(1) + "%)");
    host.style.setProperty("--ylg-live-bottom", "hsl(" + (215 - 185*warm).toFixed(1) + " " + (40 + 20*warm).toFixed(1) + "% " + (17 + 30*daylight).toFixed(1) + "%)");
    loadWeather(value);
    if (weather && Math.abs(now.getTime() - weather.time) > 7200000) weather = null;
    if (!host.querySelector(".ylg-daylight-clouds")) ["clouds", "precipitation"].forEach(function (name) {
      var layer = document.createElement("span"); layer.className = "ylg-daylight-" + name; host.appendChild(layer);
    });
    host.setAttribute("data-weather", weather ? weather.kind : "unknown");
    host.style.setProperty("--ylg-cloud-cover", weather ? weather.cloud.toFixed(3) : "0");
    host.style.setProperty("--ylg-celestial-opacity", weather ? String(Math.max(.08, 1-weather.cloud*.9)) : "1");
  }
  function refresh() {
    clearTimer();
    if (!started) return;
    var value = options();
    if (!value.enabled || !eligiblePage() || (forced && forced.matches)) {
      resetWeather(); unmount(); return;
    }
    mount();
    if (!host) return; // DOMContentLoaded will retry at document_start.
    var now = new Date();
    currentScene = value.scene === "auto" ? sceneAt(now) : value.scene;
    if (value.liveWeather) applyLive(value, now);
    else {
      resetWeather(); host.removeAttribute("data-live"); host.removeAttribute("data-weather");
    }
    var continuous = value.scene === "auto" && root.YLG_SKY_RENDERER && root.YLG_SKY_ENV && root.YLG_SKY_ENV.validLocation(value.location);
    if (continuous) currentScene=root.YLG_SKY_ENV.solarAt(now,value.location).scene;
    moving = snapshot.daylightBackground.animate !== false && !(reduced && reduced.matches) && !document.hidden;
    host.setAttribute("data-scene", currentScene);
    host.setAttribute("data-moving", moving ? "true" : "false");
    host.style.setProperty("--ylg-daylight-intensity", String(value.intensity));
    document.documentElement.setAttribute("data-ylg-daylight", currentScene);
    if (!rendererTried && root.YLG_SKY_RENDERER) {
      rendererTried=true; renderer=root.YLG_SKY_RENDERER.create(host);
    }
    if (renderer) renderer.update({auto:!!continuous,location:value.location,scene:currentScene,
      weather:weather,moving:moving && value.intensity>0});
    // Hidden tabs are refreshed on return and need no clock wake-up.
    if (value.scene === "auto" && !document.hidden) {
      if (value.liveWeather || continuous) {
        nextChangeAt = Math.floor(now.getTime()/60000)*60000 + 60000;
        var request = revision;
        timer = root.setTimeout(function () {
          if (started && request === revision) refresh();
        }, Math.max(1,nextChangeAt-now.getTime()));
      } else scheduleBoundary(now);
    }
  }
  function mediaListen(query, add) {
    if (!query) return;
    if (query.addEventListener) query[add ? "addEventListener" : "removeEventListener"]("change", refresh);
    else if (query.addListener) query[add ? "addListener" : "removeListener"](refresh);
  }
  function resized() { if(renderer)renderer.resize(); }
  function navigationStart() {
    resetWeather();
    clearTimer();
    unmount();
  }
  function init() {
    if (started) return;
    started = true;
    document.addEventListener("visibilitychange", refresh);
    document.addEventListener("yt-navigate-finish", refresh);
    document.addEventListener("yt-navigate-start", navigationStart);
    document.addEventListener("DOMContentLoaded", refresh);
    root.addEventListener("popstate", refresh);
    root.addEventListener("resize", resized);
    mediaListen(reduced, true); mediaListen(forced, true);
    refresh();
  }
  function updateSettings(fullSnapshot) {
    var value = fullSnapshot && fullSnapshot.daylightBackground || {};
    // Retain only owned scalar settings; callers may reuse or mutate snapshots.
    snapshot = {
      enabled: !!(fullSnapshot && fullSnapshot.enabled),
      daylightBackground: { enabled: value.enabled === true, animate: value.animate !== false, scene: value.scene, intensity: value.intensity,
        liveWeather: value.liveWeather === true, location: value.location ? { name:value.location.name, latitude:value.location.latitude, longitude:value.location.longitude } : null }
    };
    if (!started) init();
    else refresh();
  }
  function teardown() {
    started = false;
    resetWeather();
    clearTimer(); unmount();
    document.removeEventListener("visibilitychange", refresh);
    document.removeEventListener("yt-navigate-finish", refresh);
    document.removeEventListener("yt-navigate-start", navigationStart);
    document.removeEventListener("DOMContentLoaded", refresh);
    root.removeEventListener("popstate", refresh);
    root.removeEventListener("resize", resized);
    mediaListen(reduced, false); mediaListen(forced, false);
    snapshot = null;
  }
  root.YLG_DAYLIGHT = {
    init: init, updateSettings: updateSettings, teardown: teardown,
    stats: function () {
      return { initialized: started, mounted: !!host, scene: currentScene,
        moving: moving, animationPaused: !moving, eligiblePage: eligiblePage(), nextChangeAt: nextChangeAt,
        liveWeather: options().liveWeather, weatherStatus: weatherStatus, weather: weather,
        renderer:renderer?renderer.stats():null,
        solar: options().liveWeather ? root.YLG_SKY_ENV.solarAt(new Date(), options().location) : null };
    }
  };
})();
