/* Optional host permission is requested only from an explicit user action. */
(function () {
  "use strict";
  var hosts = ["https://api.open-meteo.com/*", "https://geocoding-api.open-meteo.com/*"];
  var get, update, flush, generation = 0, statusRevision = 0;
  function t(key, fallback) {
    return (window.YLG_SETTINGS && typeof window.YLG_SETTINGS.t === "function")
      ? window.YLG_SETTINGS.t(key, fallback)
      : fallback;
  }
  function el(id) { return document.getElementById(id); }
  function status(message) {
    var node = el("ylg-sky-status");
    if (node) node.textContent = message;
  }
  function available() { return !!(window.chrome && chrome.permissions && chrome.runtime && chrome.runtime.sendMessage); }
  function request() { return chrome.permissions.request({ origins: hosts }); }
  function summary(s) {
    statusRevision++;
    var version = el("ylg-sky-build");
    if (version && window.chrome && chrome.runtime && chrome.runtime.getManifest) {
      version.textContent = t("skyBuildPrefix", "Extension ") + chrome.runtime.getManifest().version;
    }
    var place = el("ylg-sky-location");
    if (place) place.textContent = s.daylightBackground.location.name;
    var toggle = el("ylg-sky-live");
    if (toggle) toggle.checked = s.daylightBackground.liveWeather;
    if (!s.daylightBackground.liveWeather) status(t("skyWeatherOff", "Weather is off. The procedural sky still follows the sun in Auto."));
    else if (s.daylightBackground.scene !== "auto") status(t("skyChooseAuto", "Choose Auto to follow the sun and weather."));
    else if (!s.enabled || !s.daylightBackground.enabled) status(t("skyEnableToShow", "Enable sky background to show live conditions."));
    else {
      status(t("skyCheckingAccess", "Checking weather access…"));
      var token = ++statusRevision;
      if (available() && typeof chrome.permissions.contains === "function") chrome.permissions.contains({ origins: hosts }, function (allowed) {
        if (token !== statusRevision || !get() || !get().daylightBackground.liveWeather) return;
        status(allowed
          ? t("skyLiveActive", "Live sky follows this city. Weather refreshes about every 15 minutes.")
          : t("skyAccessMissing", "Weather access is missing. Click Allow weather access below."));
      });
    }
  }
  function bind(options) {
    get = options.get; update = options.update; flush = options.flush;
    var toggle = el("ylg-sky-live"), search = el("ylg-sky-search"), input = el("ylg-sky-city");
    if (!toggle || !search || !input) return;
    toggle.addEventListener("change", async function () {
      if (!get() || toggle.disabled) return;
      var on = toggle.checked, token = ++generation;
      if (on) {
        if (!available()) {
          toggle.checked = false;
          status(t("skyRequiresExtension", "Live weather requires the installed extension."));
          return;
        }
        // Permission prompts may close the action popup. Save the user's choice
        // BEFORE opening one; the worker still gates all fetches on permission.
        update({ liveWeather: true, scene: "auto" }); flush();
        try {
          if (!await request()) {
            if (token === generation) { update({ liveWeather: false }); flush(); }
            status(t("skyAccessDenied", "Weather access was not granted. You can enable it again."));
            return;
          }
        } catch (error) {
          status(t("skyAccessError", "Weather access could not be requested. Reload the updated extension, then use Allow weather access."));
          return;
        }
      }
      if (token !== generation || !get().enabled || !get().daylightBackground.enabled) return;
      update({ liveWeather: on, scene: on ? "auto" : get().daylightBackground.scene }); flush();
      status(on
        ? t("skyLiveEnabled", "Live sun and weather enabled. Weather refreshes about every 15 minutes.")
        : t("skyLiveDisabled", "Live weather is off."));
    });
    var allow = el("ylg-sky-allow");
    if (allow) allow.addEventListener("click", function () {
      if (!available() || !get() || allow.disabled) return;
      var token = ++generation;
      update({ liveWeather: true, scene: "auto" }); flush();
      // Invoke directly in the click handler to retain the browser user gesture.
      request().then(function (granted) {
        if (token === generation) {
          update(granted ? { liveWeather: true, scene: "auto" } : { liveWeather: false });
          flush();
        }
        status(granted
          ? t("skyAccessGranted", "Weather access granted. Live weather is now active.")
          : t("skyAccessNotGranted", "Weather access was not granted."));
      }, function () {
        status(t("skyPermFailed", "Permission request failed. Check that the updated extension was reloaded."));
      });
    });
    async function find() {
      if (!get() || search.disabled) return;
      var name = input.value.trim();
      if (name.length < 2 || name.length > 100) {
        status(t("skyCityLength", "Enter a city name (2–100 characters)."));
        return;
      }
      if (!available()) {
        status(t("skyCityRequiresExt", "City search requires the installed extension."));
        return;
      }
      var token = ++generation;
      try {
        if (!await request()) {
          status(t("skyCityNeedsAccess", "City search needs optional weather access."));
          return;
        }
        status(t("skySearching", "Searching…"));
        var result = await chrome.runtime.sendMessage({ type: "ylg:city-search", name: name });
        if (token !== generation || !get().enabled || !get().daylightBackground.enabled) return;
        var list = el("ylg-sky-results"); list.replaceChildren();
        if (!result || !result.places || !result.places.length) {
          status(t("skyNoResults", "No results. Try the city and country, or try again shortly."));
          return;
        }
        result.places.forEach(function (place) {
          var button = document.createElement("button"); button.type = "button"; button.textContent = place.name;
          button.addEventListener("click", function () {
            if (!get().enabled || !get().daylightBackground.enabled) return;
            generation++; update({ location: place }); flush(); list.replaceChildren();
            status(t("skyLocationSaved", "Location saved: ") + place.name);
          });
          list.appendChild(button);
        });
        status(t("skySelectLocation", "Select a location."));
      } catch (_) {
        if (token === generation) status(t("skySearchUnavailable", "City search is unavailable. Your saved location is unchanged."));
      }
    }
    search.addEventListener("click", find);
    input.addEventListener("keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); find(); } });
    window.addEventListener("pagehide", function () { generation++; });
  }
  window.YLG_SKY_UI = { bind: bind, render: summary };
})();
