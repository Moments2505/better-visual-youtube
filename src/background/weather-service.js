/* Optional, credential-free weather. One shared persistent cache across tabs.
 * Requests contain only chosen coordinates/city, never YouTube URLs or settings. */
(function () {
  "use strict";
  var HOSTS = ["https://api.open-meteo.com/*", "https://geocoding-api.open-meteo.com/*"];
  var pending = new Map(), searchAt = 0;
  var TTL = 15 * 60 * 1000, BACKOFF = 5 * 60 * 1000;
  async function json(url) {
    var abort = new AbortController();
    var timeout = setTimeout(function () { abort.abort(); }, 8000);
    try {
      var response = await fetch(url, { signal: abort.signal, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
      if (!response.ok) throw new Error("Weather service unavailable");
      return await response.json();
    } finally { clearTimeout(timeout); }
  }
  async function allowed() { return chrome.permissions.contains({ origins: HOSTS }); }
  async function weather() {
    var saved = await chrome.storage.local.get("ylgSettings");
    var settings = YLG_SETTINGS.normalizeSettings(saved.ylgSettings), sky = settings.daylightBackground;
    if (!settings.enabled || !sky.enabled || !sky.liveWeather || sky.scene !== "auto") return { status: "disabled" };
    if (!await allowed()) return { status: "permission" };
    var place = sky.location, key = place.latitude.toFixed(4) + "," + place.longitude.toFixed(4);
    if (pending.has(key)) return pending.get(key);
    var task = load(place, key);
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  }
  async function load(place, key) {
    var now = Date.now(), stored = await chrome.storage.local.get(["ylgWeatherCache", "ylgWeatherAttempt"]);
    var cache = stored.ylgWeatherCache, attempt = stored.ylgWeatherAttempt;
    var valid = cache && cache.key === key && Number.isFinite(cache.fetchedAt) && cache.fetchedAt <= now &&
      YLG_SKY_ENV.parseWeather(cache.payload, now);
    if (valid && now - cache.fetchedAt < TTL) return { status: "current", weather: valid, nextRefreshAt: cache.fetchedAt + TTL };
    if (attempt && attempt.key === key && attempt.at <= now && now - attempt.at < BACKOFF)
      return { status: valid ? "stale" : "offline", weather: valid || null, nextRefreshAt: attempt.at + BACKOFF };
    await chrome.storage.local.set({ ylgWeatherAttempt: { key: key, at: now } });
    try {
      var url = "https://api.open-meteo.com/v1/forecast?latitude=" + place.latitude + "&longitude=" + place.longitude +
        "&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m&timeformat=unixtime&timezone=GMT&forecast_days=1";
      var payload = await json(url), parsed = YLG_SKY_ENV.parseWeather(payload, Date.now());
      if (!parsed) throw new Error("Invalid weather data");
      await chrome.storage.local.set({ ylgWeatherCache: { key: key, fetchedAt: now, payload: { current: payload.current } } });
      return { status: "current", weather: parsed, nextRefreshAt: now + TTL };
    } catch (_) {
      return { status: valid ? "stale" : "offline", weather: valid || null, nextRefreshAt: now + BACKOFF };
    }
  }
  async function search(name) {
    if (typeof name !== "string" || name.trim().length < 2 || name.length > 100) return { status: "invalid", places: [] };
    if (!await allowed()) return { status: "permission", places: [] };
    if (Date.now() - searchAt < 1000) return { status: "busy", places: [] };
    searchAt = Date.now();
    var data = await json("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(name.trim()) + "&count=5&language=vi&format=json");
    return { status: "current", places: (Array.isArray(data.results) ? data.results : []).filter(YLG_SKY_ENV.validLocation).slice(0,5).map(function (p) {
      return { name: [p.name, p.admin1, p.country].filter(Boolean).join(", ").slice(0,160), latitude: p.latitude, longitude: p.longitude };
    }) };
  }
  chrome.runtime.onMessage.addListener(function (message, sender, reply) {
    if (sender.id !== chrome.runtime.id || !message) return;
    var popup = sender.url === chrome.runtime.getURL("src/popup/popup.html");
    var page = false;
    try { var url = new URL(sender.url); page = url.origin === "https://www.youtube.com" && (url.pathname === "/" || url.pathname === "/results") && sender.frameId === 0; } catch (_) {}
    if (message.type === "ylg:weather" && (popup || page)) weather().then(reply, function () { reply({ status: "offline" }); });
    else if (message.type === "ylg:city-search" && popup) search(message.name).then(reply, function () { reply({ status: "offline", places: [] }); });
    else return;
    return true;
  });
})();
