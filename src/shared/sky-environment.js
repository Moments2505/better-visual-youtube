/* Pure solar geometry and weather validation. No network, DOM or frame loop.
 * Approximate NOAA fractional-year equations; decorative, not navigation data.
 * https://www.gml.noaa.gov/grad/solcalc/solareqns.PDF */
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var radians = Math.PI / 180;
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function validLocation(v) {
    return !!v && typeof v.latitude === "number" && Number.isFinite(v.latitude) && Math.abs(v.latitude) <= 90 &&
      typeof v.longitude === "number" && Number.isFinite(v.longitude) && Math.abs(v.longitude) <= 180;
  }
  function solarAt(date, location) {
    if (!validLocation(location) || !Number.isFinite(date.getTime())) return null;
    var year = date.getUTCFullYear();
    var day = Math.floor((Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) - Date.UTC(year, 0, 1)) / 86400000) + 1;
    var days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
    var hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
    var g = 2 * Math.PI / days * (day - 1 + (hour - 12) / 24);
    var eq = 229.18 * (.000075 + .001868*Math.cos(g) - .032077*Math.sin(g) - .014615*Math.cos(2*g) - .040849*Math.sin(2*g));
    var decl = .006918 - .399912*Math.cos(g) + .070257*Math.sin(g) - .006758*Math.cos(2*g) + .000907*Math.sin(2*g) - .002697*Math.cos(3*g) + .00148*Math.sin(3*g);
    var minutes = ((hour * 60 + eq + 4 * location.longitude) % 1440 + 1440) % 1440;
    var angle = minutes / 4 - 180, lat = location.latitude * radians;
    var elevation = Math.asin(clamp(Math.sin(lat)*Math.sin(decl) + Math.cos(lat)*Math.cos(decl)*Math.cos(angle*radians), -1, 1)) / radians;
    var scene = elevation < -6 ? "night" : elevation < 12 ? (angle < 0 ? "morning" : "sunset") : "day";
    return { elevation: elevation, hourAngle: angle, scene: scene,
      x: clamp(50 + angle / 180 * 70, 8, 92), y: clamp(82 - Math.max(0, elevation) / 90 * 72, 10, 82),
      daylight: clamp((elevation + 6) / 18, 0, 1), stars: 1 - clamp((elevation + 12) / 12, 0, 1) };
  }
  function weatherKind(code) {
    if (code === 0) return "clear";
    if ([1,2,3].indexOf(code) >= 0) return "cloudy";
    if ([45,48].indexOf(code) >= 0) return "fog";
    if ([71,73,75,77,85,86].indexOf(code) >= 0) return "snow";
    if ([95,96,99].indexOf(code) >= 0) return "storm";
    if ([51,53,55,56,57,61,63,65,66,67,80,81,82].indexOf(code) >= 0) return "rain";
    return null;
  }
  function parseWeather(payload, now) {
    var c = payload && payload.current;
    if (!c || !Number.isFinite(c.time) || Math.abs(now - c.time * 1000) > 7200000 || !weatherKind(c.weather_code) ||
      !Number.isFinite(c.cloud_cover) || c.cloud_cover < 0 || c.cloud_cover > 100 ||
      !Number.isFinite(c.temperature_2m) || !Number.isFinite(c.wind_speed_10m)) return null;
    return { time: c.time * 1000, kind: weatherKind(c.weather_code), code: c.weather_code,
      cloud: c.cloud_cover / 100, temperature: c.temperature_2m, wind: clamp(c.wind_speed_10m, 0, 200) };
  }
  root.YLG_SKY_ENV = { solarAt: solarAt, validLocation: validLocation, weatherKind: weatherKind, parseWeather: parseWeather };
})();
