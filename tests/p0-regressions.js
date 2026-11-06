"use strict";
// Standalone: node tests/p0-regressions.js. No dependencies or shared browser.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");
let passed = 0;
const cases = [];
function test(name, fn) { cases.push({ name, fn }); }
function clock() {
  let now = 0, id = 0;
  const tasks = new Map();
  return {
    setTimeout(fn, ms) { tasks.set(++id, { at: now + ms, fn }); return id; },
    clearTimeout(key) { tasks.delete(key); },
    tick(ms) {
      const until = now + ms;
      while (true) {
        const entry = [...tasks].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        now = entry[1].at; tasks.delete(entry[0]); entry[1].fn();
      }
      now = until;
    }
  };
}
// Deliberately small DOM model. Build controls/ancestry from the ACTUAL popup HTML,
// not a duplicated control list. Not a browser parser or accessibility-tree test.
function dom() {
  let doc;
  class Element {
    constructor(tag, attrs = {}, parent = null) {
      this.tagName = tag; this.attrs = attrs; this.id = attrs.id || "";
      this.parent = parent; this.children = []; this.listeners = {};
      this.disabled = false; this.checked = false; this.textContent = "";
      this.style = { setProperty() {} }; this.valueWrites = 0; this._value = "";
      const classes = new Set((attrs.class || "").split(/\s+/).filter(Boolean));
      this.classList = { toggle(k, on) { if (on) classes.add(k); else classes.delete(k); }, contains: k => classes.has(k) };
      if (parent) parent.children.push(this);
    }
    get value() { return this._value; }
    set value(v) { this.valueWrites++; this._value = String(v); }
    getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    hasAttribute(k) { return Object.hasOwn(this.attrs, k); }
    removeAttribute(k) { delete this.attrs[k]; }
    matches(s) {
      if (s[0] === "#") return this.id === s.slice(1);
      if (s[0] === ".") return this.classList.contains(s.slice(1));
      if (s === "button[data-value]") return this.tagName === "button" && this.hasAttribute("data-value");
      return this.tagName === s;
    }
    querySelectorAll(s) {
      const all = this.children.flatMap(c => [c, ...c.querySelectorAll("*")]);
      if (s === "*") return all;
      return all.filter(el => s.split(",").some(part => {
        const bits = part.trim().split(/\s+/); const last = bits.pop();
        return el.matches(last) && (!bits.length || !!el.parent?.closest(bits.join(" ")));
      }));
    }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    closest(s) { return this.matches(s) ? this : this.parent?.closest(s) || null; }
    contains(el) { return el === this || this.children.some(c => c.contains(el)); }
    addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); }
    removeEventListener(k, fn) { this.listeners[k] = (this.listeners[k] || []).filter(f => f !== fn); }
    emit(type, extra = {}) {
      const e = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (let el = this; el; el = el.parent) for (const fn of el.listeners[type] || []) fn.call(el, e);
      return e;
    }
    click() { if (!this.disabled) this.emit("click"); }
    focus() { doc.activeElement = this; }
  }
  doc = new Element("document");
  const stack = [doc];
  for (const match of source("src/popup/popup.html").matchAll(/<\/?([a-z][\w-]*)([^>]*)>/gi)) {
    const tag = match[1].toLowerCase();
    if (match[0][1] === "/") { if (stack[stack.length - 1].tagName === tag) stack.pop(); continue; }
    const attrs = {};
    for (const a of match[2].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    const el = new Element(tag, attrs, stack[stack.length - 1]);
    if (!["input", "link", "meta", "br", "img", "hr"].includes(tag)) stack.push(el);
  }
  doc.getElementById = id => doc.querySelector("#" + id);
  doc.documentElement = doc.querySelector("html"); doc.readyState = "complete";
  return doc;
}
function sandbox(doc = dom()) {
  const timer = clock(); const listeners = {};
  const context = vm.createContext({ document: doc, console, ...timer,
    navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
    addEventListener(k, fn) { (listeners[k] ||= []).push(fn); },
    removeEventListener() {},
    localStorage: { getItem() { return null; }, setItem() {} }
  });
  context.window = context;
  const load = file => vm.runInContext(source(file), context, { filename: file });
  load("src/shared/settings.js");
  return { context, load, timer, doc, fireWindow(k) { for (const fn of listeners[k] || []) fn(); } };
}
function popup(seed = {}, media) {
  const h = sandbox(); const writes = []; let getCallback;
  if (media) h.context.matchMedia = () => media;
  h.context.chrome = { runtime: {}, storage: { local: {
    get(key, cb) { getCallback = cb; },
    set(payload, cb) { writes.push({ settings: JSON.parse(JSON.stringify(payload.ylgSettings)), cb }); }
  } } };
  let storageListener, removed = false;
  h.context.chrome.storage.onChanged = {
    addListener(fn) { storageListener = fn; },
    removeListener(fn) { if (fn === storageListener) removed = true; }
  };
  h.load("src/popup/sky-controls.js"); h.load("src/popup/popup.js"); h.doc.emit("DOMContentLoaded");
  h.$ = id => h.doc.getElementById(id); h.writes = writes;
  h.resolve = () => getCallback({ ylgSettings: seed });
  h.change = (id, checked) => { h.$(id).checked = checked; h.$(id).emit("change"); };
  h.input = (id, value) => { h.$(id).value = value; h.$(id).emit("input"); };
  h.finish = (index, error) => { h.context.chrome.runtime.lastError = error; writes[index].cb(); delete h.context.chrome.runtime.lastError; };
  h.external = settings => storageListener({ ylgSettings: { newValue: settings } }, "local");
  h.syncRemoved = () => removed;
  return h;
}
function loaded(seed) { const h = popup(seed); h.resolve(); return h; }
function selected(h, id, value) {
  const buttons = h.$(id).querySelectorAll("button[data-value]");
  for (const b of buttons) {
    const on = b.getAttribute("data-value") === value;
    assert.equal(b.getAttribute("aria-checked"), String(on));
    assert.equal(b.getAttribute("tabindex"), on && !b.disabled ? "0" : "-1");
  }
}
function choose(h, id, value) { h.$(id).querySelectorAll("button[data-value]").find(b => b.getAttribute("data-value") === value).click(); }

test("popup follows external ambient updates, preserves dirty edits and unsubscribes", () => {
  const h = loaded({});
  h.external({ ambientLight: { enabled: false, brightness: 0.7 } });
  assert.equal(h.$("ylg-ambient-enabled").checked, false);
  assert.equal(h.$("ylg-amb-brightness").value, "70");
  h.change("ylg-ambient-enabled", true);
  h.input("ylg-amb-brightness", "130");
  h.external({ ambientLight: { enabled: false, brightness: 0.4 } });
  assert.equal(h.$("ylg-amb-brightness").value, "130", "unsaved local range wins");
  h.fireWindow("pagehide"); assert.equal(h.syncRemoved(), true);
});
test("Spread200 and Magnifying Glass persist and Specular Highlight shares settings", () => {
  const h = loaded({});
  assert.equal(h.$("ylg-amb-spread").getAttribute("max"), "200");
  h.input("ylg-amb-spread", "200"); h.$("ylg-amb-spread").emit("change");
  assert.equal(h.writes.at(-1).settings.ambientLight.spread, 200);
  h.input("ylg-optics-lens", "150"); h.$("ylg-optics-lens").emit("change");
  assert.equal(h.writes.at(-1).settings.optics.lensPx, 150);
  h.input("ylg-highlight", "35"); h.$("ylg-highlight").emit("change");
  assert.equal(h.writes.at(-1).settings.highlight, .35);
});

test("every popup slider commits the correct normalized setting", () => {
  const cases = [
    ["ylg-blur", 25, "blur", 25], ["ylg-opacity", 1, "opacity", null],
    ["ylg-refraction", 62, "refraction", .62], ["ylg-radius", 22, "radius", 22],
    ["ylg-highlight", 48, "highlight", .48], ["ylg-optics-lens", 140, "optics.lensPx", 140],
    ["ylg-optics-ab", 24, "optics.aberrationPx", 2.4],
    ["ylg-optics-scale", 35, "optics.magnifyScale", 35],
    ["ylg-optics-hover", 106, "optics.hoverScale", 1.06],
    ["ylg-amb-blur", 85, "ambientLight.blur", 85],
    ["ylg-amb-spread", 160, "ambientLight.spread", 160],
    ["ylg-amb-saturation", 150, "ambientLight.saturation", 1.5],
    ["ylg-amb-brightness", 125, "ambientLight.brightness", 1.25],
    ["ylg-amb-fps", 24, "ambientLight.fpsLimit", 24]
  ];
  for (const [id,value,path,expected] of cases) {
    const h=loaded({ambientLight:{enabled:true},optics:{enabled:true,magnify:true,aberration:true}});
    h.input(id,String(value));h.$(id).emit("change");
    const actual=path.split('.').reduce((v,k)=>v[k],h.writes.at(-1).settings);
    assert.equal(actual,expected===null?h.context.YLG_SETTINGS.sliderToOpacity(value):expected,id);
  }
});

test("all popup switches commit independently and preserve the other groups", () => {
  const cases = [["ylg-motion","motion"],["ylg-hover-effects","hoverEffects"],["ylg-optics-enabled","optics.enabled"],
    ["ylg-optics-aberration","optics.aberration"],["ylg-optics-magnify","optics.magnify"],
    ["ylg-ambient-enabled","ambientLight.enabled"],["ylg-amb-normal","ambientLight.modes.normal"],
    ["ylg-amb-theater","ambientLight.modes.theater"],["ylg-amb-fullscreen","ambientLight.modes.fullscreen"]];
  for(const [id,path] of cases) {
    const h=loaded({ambientLight:{enabled:true,modes:{normal:true,theater:true,fullscreen:true}},optics:{enabled:true,magnify:true,aberration:true}});
    h.change(id,false);
    const snapshot=h.writes.at(-1).settings;
    assert.equal(path.split('.').reduce((v,k)=>v[k],snapshot),false,id);
    assert.equal(snapshot.enabled,true);assert.equal(snapshot.optics.lensPx,92);
  }
});

test("wheel adjusts every slider on its native step and coalesces saves", () => {
  const ids = ["ylg-blur", "ylg-opacity", "ylg-refraction", "ylg-radius", "ylg-highlight", "ylg-optics-lens", "ylg-optics-ab", "ylg-optics-scale", "ylg-optics-hover", "ylg-amb-blur", "ylg-amb-spread", "ylg-amb-saturation", "ylg-amb-brightness", "ylg-amb-fps"];
  for (const id of ids) {
    const h = loaded(); const inp = h.$(id);
    const min = Number(inp.getAttribute("min")), step = Number(inp.getAttribute("step"));
    h.input(id, min); inp.emit("change");
    const startWrites = h.writes.length;
    assert.equal(inp.emit("wheel", { deltaY: -100 }).defaultPrevented, true, id);
    assert.equal(Number(inp.value), min + step, id);
    inp.emit("wheel", { deltaY: -100 });
    assert.equal(Number(inp.value), min + 2 * step, id);
    assert.equal(h.writes.length, startWrites, "wheel burst stays debounced");
    h.timer.tick(150); assert.equal(h.writes.length, startWrites + 1, id);
    const dragged = loaded(); dragged.input(id, min + 2 * step); dragged.$(id).emit("change");
    assert.deepEqual(h.writes.at(-1).settings, dragged.writes.at(-1).settings, "wheel saves the same setting as dragging: " + id);
  }
});

test("wheel leaves disabled sliders, zoom, horizontal scrolling and end stops alone", () => {
  const h = loaded(); const inp = h.$("ylg-blur");
  for (const extra of [{ctrlKey:true}, {metaKey:true}, {deltaX:200}, {deltaY:0}]) {
    assert.equal(inp.emit("wheel", {deltaY:-100,...extra}).defaultPrevented, false);
  }
  h.input("ylg-blur", 40); inp.emit("change");
  assert.equal(inp.emit("wheel", {deltaY:-100}).defaultPrevented, false);
  h.input("ylg-blur", 0); inp.emit("change");
  assert.equal(inp.emit("wheel", {deltaY:100}).defaultPrevented, false);
  h.change("ylg-enabled", false);
  assert.equal(inp.emit("wheel", {deltaY:-100}).defaultPrevented, false);
  const loading = popup(); assert.equal(loading.$("ylg-blur").emit("wheel", {deltaY:-100}).defaultPrevented, false);
});

test("trackpad wheel accumulates small deltas and resets on direction change", () => {
  const h = loaded(); const inp = h.$("ylg-blur");
  h.input("ylg-blur", 10); inp.emit("change");
  for (let i=0;i<3;i++) inp.emit("wheel", {deltaY:-6,deltaMode:0});
  assert.equal(inp.value,"10"); inp.emit("wheel", {deltaY:-6,deltaMode:0}); assert.equal(inp.value,"11");
  inp.emit("wheel", {deltaY:-18}); inp.emit("wheel", {deltaY:6}); assert.equal(inp.value,"11");
  inp.emit("wheel", {deltaY:18}); assert.equal(inp.value,"10");
  inp.emit("wheel", {deltaY:-1,deltaMode:1}); assert.equal(inp.value,"11");
});

test("hover off persists independently of motion and preserves static glass optics", () => {
  const h = loaded(); const S = h.context.YLG_SETTINGS;
  h.change("ylg-hover-effects", false);
  const saved = h.writes.at(-1).settings;
  assert.equal(saved.hoverEffects, false); assert.equal(saved.motion,true); assert.equal(saved.optics.magnify,true);
  assert.equal(loaded(saved).$("ylg-hover-effects").checked, false);
  let changed; const installs = [];
  const page = sandbox(); const settings = page.context.YLG_SETTINGS;
  page.context.YLG_OPTICS = {install:opts => installs.push(opts), teardown(){}};
  settings.getStoredSettings = cb => cb(settings.normalizeSettings(saved));
  settings.onSettingsChanged = cb => {changed=cb;};
  page.load("src/content/bootstrap.js");
  assert.equal(page.doc.documentElement.getAttribute("data-ylg-hover"),"off");
  assert.equal(installs.at(-1).magnifyScale,0);
  assert.equal(installs.at(-1).lensPx,saved.optics.lensPx);
  assert.equal(installs.at(-1).aberrationPx,saved.optics.aberrationPx);
  changed({...saved,hoverEffects:true});
  assert.equal(installs.at(-1).magnifyScale,saved.optics.magnifyScale);
  assert.equal(page.doc.documentElement.getAttribute("data-ylg-hover"),"on");
});

test("Motion off keeps Ambient Light on and suspends hover without losing its saved choice", () => {
  const h = loaded(); h.change("ylg-motion", false);
  const saved = h.writes.at(-1).settings;
  assert.equal(saved.motion, false); assert.equal(saved.hoverEffects, true);
  assert.equal(saved.ambientLight.enabled, true);
  assert.equal(loaded(saved).$("ylg-motion").checked, false);
  assert.equal(loaded(saved).$("ylg-hover-effects").checked, true);
  const page = sandbox(), installs = [], ambient = [], movers = [];
  const S = page.context.YLG_SETTINGS; let changed;
  page.context.YLG_OPTICS = {install: opts => installs.push(opts), teardown(){}};
  page.context.YLG_AMBIENT = {init(){}, updateSettings:s=>ambient.push(s), teardown(){}};
  for (const name of ["YLG_PLAYER_MOTION", "YLG_MICRO", "YLG_DESCRIPTION_MOTION", "YLG_PANEL_HOVER"]) {
    page.context[name] = {init(){movers.push([name,"init"]);}, teardown(){movers.push([name,"teardown"]);}};
  }
  S.getStoredSettings = cb => cb(S.normalizeSettings(saved));
  S.onSettingsChanged = cb => {changed=cb;};
  page.load("src/content/bootstrap.js");
  assert.equal(page.doc.documentElement.getAttribute("data-ylg-motion"), "off");
  assert.equal(page.doc.documentElement.getAttribute("data-ylg-hover"), "off");
  assert.equal(page.doc.documentElement.getAttribute("data-ylg-ambient"), "on");
  assert.equal(ambient.at(-1).ambientLight.enabled, true);
  assert.equal(installs.at(-1).magnifyScale, 0);
  assert.equal(installs.at(-1).lensPx, saved.optics.lensPx, "static glass stays intact");
  assert.equal(installs.at(-1).aberrationPx, saved.optics.aberrationPx);
  assert.equal(movers.length, 4); assert.ok(movers.every(c=>c[1]==="teardown"));
  changed({...saved, motion:true});
  assert.equal(page.doc.documentElement.getAttribute("data-ylg-hover"), "on");
  assert.equal(installs.at(-1).magnifyScale, saved.optics.magnifyScale);
  assert.ok(movers.slice(-4).every(c=>c[1]==="init"));
});

test("sky controls save independently, gate children and restore the selected scene", () => {
  const h = loaded();
  assert.equal(h.$("ylg-daylight-enabled").checked, false);
  assert.equal(h.$("ylg-daylight-intensity").disabled, true);
  assert.equal(h.$("ylg-daylight-animate").disabled, true);
  selected(h,"ylg-daylight-scene","auto");
  h.change("ylg-daylight-enabled",true);
  h.change("ylg-daylight-animate",false);
  assert.equal(h.$("ylg-daylight-intensity").disabled,false);
  const button = h.$("ylg-daylight-scene").querySelectorAll("button[data-value]").find(b=>b.getAttribute("data-value")==="night");
  button.emit("click");
  selected(h,"ylg-daylight-scene","night");
  const slider = h.$("ylg-daylight-intensity");
  h.input("ylg-daylight-intensity",60); slider.emit("change");
  slider.emit("wheel",{deltaY:-100}); h.timer.tick(150);
  const saved = h.writes.at(-1).settings;
  assert.equal(saved.daylightBackground.enabled,true);
  assert.equal(saved.daylightBackground.animate,false);
  assert.equal(saved.daylightBackground.scene,"night");
  assert.equal(saved.daylightBackground.intensity,.61);
  assert.equal(saved.motion,true); assert.equal(saved.ambientLight.enabled,true);
  const reopened = loaded(saved); selected(reopened,"ylg-daylight-scene","night");
  assert.equal(reopened.$("ylg-daylight-intensity").value,"61");
  assert.equal(reopened.$("ylg-daylight-animate").checked,false);
  h.change("ylg-daylight-enabled",false);
  assert.equal(h.$("ylg-daylight-intensity").disabled,true);
  assert.equal(h.writes.at(-1).settings.daylightBackground.scene,"night");
  h.change("ylg-daylight-enabled",true);
  h.change("ylg-motion",false);
  h.change("ylg-daylight-animate",true);
  assert.equal(h.writes.at(-1).settings.motion,false);
  assert.equal(h.writes.at(-1).settings.daylightBackground.animate,true,"sky motion does not re-enable interface motion");
});

test("live weather choice survives a permission popup closing and denial can be retried", async () => {
  const h=loaded({motion:false,daylightBackground:{enabled:true}});
  let resolvePermission;
  h.context.chrome.permissions={request:()=>new Promise(resolve=>resolvePermission=resolve)};
  h.context.chrome.runtime.sendMessage=()=>Promise.resolve({places:[]});
  h.change("ylg-sky-live",true);
  assert.equal(h.writes.at(-1).settings.daylightBackground.liveWeather,true,"save before permission dialog can destroy popup");
  resolvePermission(false);await new Promise(setImmediate);
  assert.equal(h.$("ylg-sky-live").checked,false);assert.equal(h.writes.at(-1).settings.daylightBackground.liveWeather,false);
  h.change("ylg-sky-live",true);resolvePermission(true);await new Promise(setImmediate);
  assert.equal(h.writes.at(-1).settings.daylightBackground.liveWeather,true);
  assert.equal(h.writes.at(-1).settings.motion,false);
  const reopened=loaded(h.writes.at(-1).settings);assert.equal(reopened.$("ylg-sky-live").checked,true);
  h.change("ylg-sky-live",false);assert.equal(h.writes.at(-1).settings.daylightBackground.liveWeather,false);
  h.change("ylg-sky-live",true);h.fireWindow("pagehide");resolvePermission(true);await new Promise(setImmediate);
  assert.equal(h.writes.at(-1).settings.daylightBackground.liveWeather,true);
});

test("RAIN persists without weather access and survives sky/master gating and popup reopen", () => {
  const location={name:"London, UK",latitude:51.5074,longitude:-.1278};
  const h=popup({motion:false,daylightBackground:{enabled:false,animate:false,scene:"night",intensity:.7,location}});
  assert.equal(h.$("ylg-daylight-rain").disabled,true,"loading controls stay disabled");
  h.context.chrome.permissions={request(){throw Error("manual rain must not request weather access");}};
  h.context.chrome.runtime.sendMessage=()=>{throw Error("manual rain must not fetch weather");};
  h.resolve();
  assert.equal(h.$("ylg-daylight-rain").checked,false);
  assert.equal(h.$("ylg-daylight-rain").disabled,true,"sky is off");
  h.change("ylg-daylight-enabled",true);
  assert.equal(h.$("ylg-daylight-rain").disabled,false,"Animate sky and interface Motion do not disable RAIN");
  h.change("ylg-daylight-rain",true);
  const saved=h.writes.at(-1).settings;
  assert.equal(saved.daylightBackground.rain,true);
  assert.equal(saved.daylightBackground.liveWeather,false);
  assert.equal(saved.daylightBackground.animate,false);
  assert.equal(saved.daylightBackground.scene,"night");
  assert.equal(saved.daylightBackground.intensity,.7);
  assert.deepEqual(saved.daylightBackground.location,location);
  assert.equal(saved.motion,false);
  assert.equal(saved.ambientLight.enabled,true);
  const reopened=loaded(saved);
  assert.equal(reopened.$("ylg-daylight-rain").checked,true);
  assert.equal(reopened.$("ylg-daylight-rain").disabled,false);
  h.change("ylg-daylight-enabled",false);
  assert.equal(h.$("ylg-daylight-rain").disabled,true);
  assert.equal(h.writes.at(-1).settings.daylightBackground.rain,true,"disabling sky keeps the rain preference");
  assert.equal(loaded(h.writes.at(-1).settings).$("ylg-daylight-rain").checked,true);
  h.change("ylg-daylight-enabled",true);
  h.change("ylg-enabled",false);
  assert.equal(h.$("ylg-daylight-rain").disabled,true);
  assert.equal(h.writes.at(-1).settings.daylightBackground.rain,true);
  h.change("ylg-enabled",true);
  assert.equal(h.$("ylg-daylight-rain").disabled,false);
  h.change("ylg-daylight-rain",false);
  assert.equal(h.writes.at(-1).settings.daylightBackground.rain,false);
  assert.equal(loaded(h.writes.at(-1).settings).$("ylg-daylight-rain").checked,false);
  h.external(saved);
  assert.equal(h.$("ylg-daylight-rain").checked,true,"storage changes refresh RAIN in an open popup");
});

test("RAIN defaults opt-in, rejects non-booleans and preserves existing sky preferences", () => {
  const S=sandbox().context.YLG_SETTINGS;
  const fixture=JSON.parse(source("default-settings.json"));
  assert.equal(fixture.daylightBackground.rain,false);
  assert.equal(S.DEFAULT_SETTINGS.daylightBackground.rain,false);
  assert.equal(S.normalizeSettings({}).daylightBackground.rain,false);
  const previous={schemaVersion:8,motion:false,opacity:.23,ambientLight:{spread:199},
    daylightBackground:{enabled:true,animate:false,liveWeather:true,scene:"sunset",intensity:.72,
      location:{name:"Tokyo, Japan",latitude:35.6762,longitude:139.6503}}};
  const migrated=JSON.parse(JSON.stringify(S.normalizeSettings(previous)));
  assert.deepEqual(migrated.daylightBackground,{...previous.daylightBackground,rain:false});
  assert.equal(migrated.motion,false);
  assert.equal(migrated.opacity,.23);
  assert.equal(migrated.ambientLight.spread,199);
  for(const [raw,expected] of [[true,true],[false,false],["true",false],[1,false],[null,false],[{},false]]) {
    const settings=JSON.parse(JSON.stringify(S.normalizeSettings({...migrated,
      daylightBackground:{...migrated.daylightBackground,rain:raw}})));
    assert.deepEqual(settings,{...migrated,daylightBackground:{...migrated.daylightBackground,rain:expected}});
  }
});

test("sky schema defaults are opt-in and validate without resetting other settings", () => {
  const h=sandbox(), S=h.context.YLG_SETTINGS;
  const old=S.normalizeSettings({motion:false,ambientLight:{spread:199}});
  assert.equal(old.daylightBackground.enabled,false);
  assert.equal(old.motion,false); assert.equal(old.ambientLight.spread,199);
  for(const [raw,expected] of [[NaN,.45],[Infinity,.45],[-1,0],[3,1],[.7,.7]]) {
    const settings=S.normalizeSettings({...old,daylightBackground:{enabled:true,scene:"bad",intensity:raw}});
    assert.equal(settings.daylightBackground.intensity,expected);
    assert.equal(settings.daylightBackground.scene,"auto");
  }
});

test("bootstrap starts sky independently of Motion and ambient, and tears down when disabled", () => {
  const h=sandbox(), S=h.context.YLG_SETTINGS, calls=[]; let changed;
  h.context.YLG_DAYLIGHT={init(){calls.push("init");},updateSettings(s){calls.push(s);},teardown(){calls.push("teardown");}};
  S.getStoredSettings=cb=>cb(S.normalizeSettings({})); S.onSettingsChanged=cb=>{changed=cb;};
  h.load("src/content/bootstrap.js"); assert.equal(calls.at(-1),"teardown");
  changed({motion:false,ambientLight:{enabled:false},daylightBackground:{enabled:true,scene:"morning"}});
  assert.equal(calls.at(-2),"init"); assert.equal(calls.at(-1).daylightBackground.scene,"morning");
  assert.equal(calls.at(-1).motion,false);
  changed({enabled:false,daylightBackground:{enabled:true}}); assert.equal(calls.at(-1),"teardown");
});

test("panel hover controller follows master, hover, motion and magnification switches", () => {
  const h = sandbox(); const calls = []; let changed;
  const S = h.context.YLG_SETTINGS;
  h.context.YLG_PANEL_HOVER = {init(){calls.push("init");},teardown(){calls.push("teardown");}};
  S.getStoredSettings = cb => cb(S.normalizeSettings({}));
  S.onSettingsChanged = cb => {changed=cb;};
  h.load("src/content/bootstrap.js"); assert.equal(calls.at(-1),"init");
  for(const settings of [{enabled:false},{hoverEffects:false},{motion:false},{optics:{enabled:false}},{optics:{magnify:false}}]) {
    changed(settings); assert.equal(calls.at(-1),"teardown");
    changed({}); assert.equal(calls.at(-1),"init");
  }
});

test("system transparency opt-in persists, restores and respects the master switch", () => {
  const h = loaded();
  assert.equal(h.$("ylg-system-transparency").checked, false);
  h.change("ylg-system-transparency", true);
  const saved = h.writes.at(-1).settings;
  assert.equal(saved.respectReducedTransparency, true);
  assert.equal(saved.opacity, h.context.YLG_SETTINGS.DEFAULT_SETTINGS.opacity);
  const reopened = loaded(saved);
  assert.equal(reopened.$("ylg-system-transparency").checked, true);
  reopened.change("ylg-enabled", false);
  assert.equal(reopened.$("ylg-system-transparency").disabled, true);
  assert.equal(reopened.writes.at(-1).settings.respectReducedTransparency, true);
  const S = h.context.YLG_SETTINGS;
  for (const [raw, expected] of [[undefined, "glass"], [false, "glass"], [true, "system"], ["true", "glass"]]) {
    S.applySettingsToDocument(h.doc, { respectReducedTransparency: raw });
    assert.equal(h.doc.documentElement.getAttribute("data-ylg-transparency"), expected);
  }
});

test("loading gates every control until storage resolves", () => {
  const h = popup(); assert.ok(h.doc.querySelectorAll("input, button").every(e => e.disabled));
  h.resolve(); assert.equal(h.$("ylg-enabled").disabled, false); assert.equal(h.$("ylg-reset").disabled, false);
  assert.equal(h.writes.length, 0);
});
test("initial radio ARIA and roving tab stops match stored settings", () => {
  // Schema 8 removed #ylg-preset and #ylg-renderMode; the tint group is the
  // remaining colour radiogroup, and "custom" is one of its five values.
  const h = loaded({ theme: "dark", tint: "custom", ambientLight: { quality: "high" } });
  for (const [id, value] of [["ylg-theme", "dark"], ["ylg-tint", "custom"], ["ylg-ambient-quality", "high"]]) selected(h, id, value);
  assert.equal(h.$("ylg-status").getAttribute("role"), "status"); assert.equal(h.$("ylg-status").getAttribute("aria-live"), "polite");
  assert.ok(h.doc.querySelectorAll("button[data-value]").every(b => b.getAttribute("role") === "radio"));
});
test("discrete updates persist immediately and synchronize selected ARIA", () => {
  const h = loaded(); choose(h, "ylg-theme", "light"); choose(h, "ylg-tint", "white"); choose(h, "ylg-ambient-quality", "eco");
  selected(h, "ylg-theme", "light"); selected(h, "ylg-tint", "white"); selected(h, "ylg-ambient-quality", "eco");
  assert.equal(h.writes.length, 3); assert.equal(h.writes[2].settings.tint, "white");
});
test("popup theme paints immediately and follows saved or external changes", () => {
  const h = loaded({ theme: "dark" });
  const theme = () => h.doc.documentElement.getAttribute("data-ylg-popup-theme");
  assert.equal(theme(), "dark");
  choose(h, "ylg-theme", "light");
  assert.equal(theme(), "light");
  assert.equal(h.writes.at(-1).settings.theme, "light");
  h.external({ theme: "dark" });
  assert.equal(theme(), "dark");
  choose(h, "ylg-theme", "auto");
  assert.equal(theme(), "light", "no matchMedia falls back to light");
});

test("popup Auto follows OS changes while explicit theme stays fixed; listener cleans up", () => {
  let callback, removed = false;
  const media = { matches: true, addEventListener(k, fn) { callback = fn; },
    removeEventListener(k, fn) { removed = fn === callback; } };
  const h = popup({ theme: "auto" }, media); h.resolve();
  const theme = () => h.doc.documentElement.getAttribute("data-ylg-popup-theme");
  assert.equal(theme(), "dark");
  media.matches = false; callback(); assert.equal(theme(), "light");
  choose(h, "ylg-theme", "dark"); callback(); assert.equal(theme(), "dark");
  choose(h, "ylg-theme", "auto"); assert.equal(theme(), "light");
  h.fireWindow("pagehide"); assert.equal(removed, true);
});

test("radio arrows wrap; Home/End select, focus and save", () => {
  const h = loaded(); const group = h.$("ylg-theme"); const buttons = group.querySelectorAll("button[data-value]");
  for (const [target, key, expected] of [[buttons[0], "ArrowLeft", "dark"], [buttons[2], "ArrowRight", "auto"], [buttons[0], "End", "dark"], [buttons[2], "Home", "auto"], [buttons[0], "ArrowDown", "light"], [buttons[1], "ArrowUp", "auto"]]) {
    assert.equal(target.emit("keydown", { key }).defaultPrevented, true); selected(h, "ylg-theme", expected);
    assert.equal(h.doc.activeElement.getAttribute("data-value"), expected);
  }
  assert.equal(h.writes.length, 6);
});
test("master disable gates body, removes tab stops, keeps reset and master operable", () => {
  const h = loaded(); h.change("ylg-enabled", false);
  assert.ok(h.$("ylg-body").querySelectorAll("input, button").every(e => e.disabled));
  assert.ok(h.doc.querySelector(".ylg-panel").classList.contains("is-disabled"));
  selected(h, "ylg-theme", h.context.YLG_SETTINGS.DEFAULT_SETTINGS.theme); assert.equal(h.$("ylg-enabled").disabled, false); assert.equal(h.$("ylg-reset").disabled, false);
  const n = h.writes.length; choose(h, "ylg-theme", "dark"); h.input("ylg-blur", 30); assert.equal(h.writes.length, n);
  h.change("ylg-enabled", true); assert.equal(h.$("ylg-blur").disabled, false); selected(h, "ylg-theme", h.context.YLG_SETTINGS.DEFAULT_SETTINGS.theme);
});
test("ambient disabled gates children but not its enable control; reenable restores", () => {
  const h = loaded(); h.change("ylg-ambient-enabled", false);
  for (const id of ["ylg-amb-blur", "ylg-amb-normal", "ylg-amb-fps"]) assert.equal(h.$(id).disabled, true);
  assert.ok(h.$("ylg-ambient-quality").querySelectorAll("button").every(b => b.disabled)); selected(h, "ylg-ambient-quality", "auto");
  assert.equal(h.$("ylg-ambient-enabled").disabled, false); assert.equal(h.$("ylg-blur").disabled, false);
  h.change("ylg-ambient-enabled", true); assert.equal(h.$("ylg-amb-fps").disabled, false); selected(h, "ylg-ambient-quality", "auto");
});
test("optics nested disable states preserve independent checkboxes", () => {
  const h = loaded(); h.change("ylg-optics-aberration", false); assert.equal(h.$("ylg-optics-ab").disabled, true);
  assert.equal(h.$("ylg-optics-scale").disabled, false); h.change("ylg-optics-magnify", false);
  assert.equal(h.$("ylg-optics-scale").disabled, true); assert.equal(h.$("ylg-optics-hover").disabled, true);
  h.change("ylg-optics-enabled", false); assert.equal(h.$("ylg-optics-aberration").disabled, true);
  assert.equal(h.$("ylg-optics-enabled").disabled, false); h.change("ylg-optics-enabled", true);
  assert.equal(h.$("ylg-optics-aberration").disabled, false); assert.equal(h.$("ylg-optics-ab").disabled, true);
});
test("range input debounces at exactly 150ms without replacing focused control", () => {
  const h = loaded(); const el = h.$("ylg-blur"); el.focus(); h.input("ylg-blur", 23); const count = el.valueWrites;
  h.timer.tick(149); assert.equal(h.writes.length, 0); h.timer.tick(1); assert.equal(h.writes.length, 1);
  h.finish(0); assert.equal(h.$("ylg-blur"), el); assert.equal(el.valueWrites, count); assert.equal(h.doc.activeElement, el);
  assert.equal(h.$("ylg-blur-v").textContent, "23px"); assert.equal(h.writes[0].settings.blur, 23);
});
test("committed range change flushes once and cancels the debounce", () => {
  const h = loaded(); h.input("ylg-opacity", 67); h.$("ylg-opacity").emit("change");
  const S = h.context.YLG_SETTINGS;
  assert.equal(h.writes.length, 1);
  // Opacity is a perceptual 0..100 percent control in schema 8: the stored value
  // is whatever the shared curve produces, not the old percent/100 linear value.
  assert.equal(h.writes[0].settings.opacity, S.sliderToOpacity(67));
  assert.notEqual(h.writes[0].settings.opacity, 0.67, "the linear percent mapping is gone");
  assert.equal(S.opacityToSlider(h.writes[0].settings.opacity), 67, "a slider position round-trips to itself");
  h.timer.tick(150); assert.equal(h.writes.length, 1);
});
test("full snapshots preserve rapid edits while stale callback cannot revert UI/status", () => {
  const h = loaded(); h.input("ylg-blur", 21); h.$("ylg-blur").emit("change"); h.input("ylg-blur", 31); h.$("ylg-blur").emit("change");
  h.finish(1); h.finish(0, { message: "old failure" });
  assert.equal(h.$("ylg-blur").value, "31"); assert.equal(h.$("ylg-status").textContent, "Saved");
  assert.equal(h.writes[0].settings.blur, 21); assert.equal(h.writes[1].settings.blur, 31);
  assert.ok(h.writes[1].settings.ambientLight.modes); assert.ok(h.writes[1].settings.optics); assert.equal(h.writes[1].settings.schemaVersion, 8);
});
test("in-flight completion cannot report Saved over a newer unsaved edit", () => {
  const h = loaded(); h.input("ylg-blur", 21); h.$("ylg-blur").emit("change"); h.input("ylg-blur", 32);
  h.finish(0); assert.equal(h.$("ylg-blur").value, "32"); assert.equal(h.$("ylg-status").textContent, "");
  h.timer.tick(150); assert.equal(h.writes.length, 2); assert.equal(h.writes[1].settings.blur, 32);
});
test("reset cancels pending range save; older completion cannot overwrite defaults/status", () => {
  const h = loaded(); h.input("ylg-blur", 35); h.$("ylg-blur").emit("change"); h.input("ylg-blur", 38); h.$("ylg-reset").click();
  assert.equal(h.writes.length, 2); h.finish(1); h.finish(0); h.timer.tick(150);
  assert.equal(h.writes.length, 2); assert.equal(h.$("ylg-blur").value, String(h.context.YLG_SETTINGS.DEFAULT_SETTINGS.blur)); assert.equal(h.$("ylg-status").textContent, "Defaults restored");
  assert.equal(h.writes[1].settings.blur, h.context.YLG_SETTINGS.DEFAULT_SETTINGS.blur); selected(h, "ylg-tint", h.context.YLG_SETTINGS.DEFAULT_SETTINGS.tint);
});
test("latest failed save reports failure and pagehide retries current snapshot", () => {
  const h = loaded(); choose(h, "ylg-theme", "dark"); h.finish(0, { message: "quota" }); assert.equal(h.$("ylg-status").textContent, "Save failed");
  h.fireWindow("pagehide"); assert.equal(h.writes.length, 2); assert.equal(h.writes[1].settings.theme, "dark");
  h.finish(1); assert.equal(h.$("ylg-status").textContent, "Saved");
});
test("pagehide and hidden visibility flush pending input exactly once", () => {
  for (const mode of ["pagehide", "hidden"]) {
    const h = loaded(); h.input("ylg-radius", 24);
    if (mode === "hidden") { h.doc.hidden = true; h.doc.emit("visibilitychange"); } else h.fireWindow("pagehide");
    assert.equal(h.writes.length, 1); assert.equal(h.writes[0].settings.radius, 24); h.timer.tick(150); assert.equal(h.writes.length, 1);
  }
});
test("Custom tint reveals the colour row and saves the full snapshot", () => {
  // Schema 8 replaced the preset picker with ONE colour concept: the Colour group
  // plus an inline colour row that only exists for the Custom tint.
  const h = loaded({ ambientLight: { enabled: false }, optics: { lensPx: 123 } });
  const row = h.$("ylg-accent-row"); const accent = h.$("ylg-accent");
  assert.equal(accent.disabled, true, "the colour controls are gated while the tint is not Custom");
  choose(h, "ylg-tint", "custom");
  selected(h, "ylg-tint", "custom");
  assert.equal(row.getAttribute("hidden"), null, "Custom must unhide the colour row");
  assert.equal(accent.disabled, false);
  h.input("ylg-accent", "#a78bfa"); h.$("ylg-accent").emit("change");
  const saved = h.writes[h.writes.length - 1].settings;
  assert.equal(saved.accent, "#a78bfa"); assert.equal(saved.tint, "custom");
  assert.equal(saved.blur, h.context.YLG_SETTINGS.DEFAULT_SETTINGS.blur);
  assert.equal(saved.ambientLight.enabled, false); assert.equal(saved.optics.lensPx, 123);
  choose(h, "ylg-tint", "white");
  assert.equal(row.getAttribute("hidden"), "", "leaving Custom must hide the row again");
  assert.equal(accent.disabled, true);
});
test("actual theme helper resolves Auto from YouTube html[dark], never OS preference", () => {
  const h = sandbox(); h.context.matchMedia = () => { throw Error("OS theme must not be consulted"); };
  const S = h.context.YLG_SETTINGS, de = h.doc.documentElement;
  for (const [dark, pref, expected] of [[false, "auto", "light"], [true, "auto", "dark"], [false, "dark", "dark"], [true, "light", "light"]]) {
    if (dark) de.setAttribute("dark", ""); else de.removeAttribute("dark");
    S.applySettingsToDocument(h.doc, { theme: pref }); assert.equal(de.getAttribute("data-ylg-theme"), expected); assert.equal(de.getAttribute("data-ylg-theme-preference"), pref);
    assert.equal(S.applyThemeToDocument(h.doc, pref), expected);
  }
});
test("bootstrap Auto observer is narrow, idempotent, disconnected on explicit/disabled settings", () => {
  const h = sandbox(); const observers = []; let changed;
  h.context.MutationObserver = class { constructor(cb) { this.cb = cb; this.active = false; observers.push(this); } observe(target, options) { this.target = target; this.options = options; this.active = true; } disconnect() { this.active = false; } };
  const S = h.context.YLG_SETTINGS;
  S.getStoredSettings = cb => cb(S.normalizeSettings({theme: "auto"})); S.onSettingsChanged = cb => { changed = cb; };
  h.load("src/content/bootstrap.js"); assert.equal(observers.length, 1);
  assert.equal(observers[0].target, h.doc.documentElement); assert.equal(JSON.stringify(observers[0].options), '{"attributes":true,"attributeFilter":["dark"]}');
  changed({ theme: "auto" }); assert.equal(observers.length, 1);
  h.doc.documentElement.setAttribute("dark", ""); observers[0].cb(); assert.equal(h.doc.documentElement.getAttribute("data-ylg-theme"), "dark");
  changed({ theme: "light" }); assert.equal(observers[0].active, false);
  changed({ enabled: false, theme: "auto" }); assert.equal(observers.filter(o => o.active).length, 0);
  observers[0].cb(); assert.equal(h.doc.documentElement.getAttribute("data-ylg-enabled"), "false");
  changed({ enabled: true, theme: "auto" }); assert.equal(observers.length, 2); assert.equal(observers[1].active, true);
  h.load("src/content/bootstrap.js"); assert.equal(observers.length, 2);
  changed({ enabled: false }); assert.equal(observers.filter(o => o.active).length, 0);
});
test("advanced refraction is gated on refraction > 0, not on a removed renderMode setting", () => {
  const h = sandbox(); let changed;
  const calls = { defs: 0, intensity: [], disposed: 0 };
  h.context.YLG_REFRACTION = {
    probeSupported() { return true; },
    ensureFilterDefs() { calls.defs++; return {}; },
    setIntensity(v) { calls.intensity.push(v); },
    dispose() { calls.disposed++; }
  };
  const S = h.context.YLG_SETTINGS, de = h.doc.documentElement;
  S.getStoredSettings = cb => cb(S.normalizeSettings({ refraction: 0.5 }));
  S.onSettingsChanged = cb => { changed = cb; };
  h.load("src/content/bootstrap.js");
  // Standard-mode gating is gone: any refraction above 0 asks for the SVG path.
  assert.equal(de.getAttribute("data-ylg-advanced-ok"), "1");
  assert.equal(calls.defs, 1);
  assert.deepEqual(calls.intensity, [0.5]);
  assert.ok(!Object.hasOwn(de.attrs, "data-ylg-render-mode"), "the removed attribute must never be written");
  // Exactly 0 turns the path off and disposes the filter defs.
  changed({ refraction: 0 });
  assert.equal(de.getAttribute("data-ylg-advanced-ok"), null);
  assert.ok(calls.disposed >= 1);
  // ...and coming back above 0 re-enables it with the new strength.
  const before = calls.defs;
  changed({ refraction: 0.8 });
  assert.equal(de.getAttribute("data-ylg-advanced-ok"), "1");
  assert.equal(calls.defs, before + 1);
  assert.equal(calls.intensity[calls.intensity.length - 1], 0.8);
  // The master toggle still wins over everything.
  changed({ refraction: 0.8, enabled: false });
  assert.equal(de.getAttribute("data-ylg-advanced-ok"), null);
});
test("the one-shot capability probe can only turn advanced refraction off", () => {
  const h = sandbox(); let changed;
  h.context.YLG_REFRACTION = {
    probeSupported() { return false; },
    ensureFilterDefs() { throw Error("defs must not be built when the probe fails"); },
    setIntensity() { throw Error("intensity must not be set when the probe fails"); },
    dispose() {}
  };
  const S = h.context.YLG_SETTINGS, de = h.doc.documentElement;
  S.getStoredSettings = cb => cb(S.normalizeSettings({ refraction: 1 }));
  S.onSettingsChanged = cb => { changed = cb; };
  h.load("src/content/bootstrap.js");
  assert.equal(de.getAttribute("data-ylg-advanced-ok"), null);
  // It is cached: a later settings change cannot retry and flip it on.
  changed({ refraction: 1 });
  assert.equal(de.getAttribute("data-ylg-advanced-ok"), null);
});
for (const file of ["vendor/ambient/content.js", "vendor/ambient/content-main.js"]) {
  test(`${file}: no configured Sentry DSN or persistent crash reporter identity path`, () => {
    const text = source(file);
    assert.doesNotMatch(text, /https?:\/\/[^\s'"`]*sentry\.(?:io|com)/i);
    assert.doesNotMatch(text, /\bdsn\s*:\s*['"`]/i);
    assert.doesNotMatch(text, /crash[-_]?reporter[-_]?id/i);
    assert.doesNotMatch(text, /(?:storage|localStorage)[^\n]{0,160}(?:reporterId|crashId)/i);
    assert.doesNotMatch(text, /new\s+(?:BrowserClient|SentryReporter)\s*\(/);
  });
  test(`${file}: actual reporter and stored opt-in setter stay local in VM`, async () => {
    const text = source(file);
    // Execute the exact shipped privacy boundary; don't execute the enormous
    // browser-only bundle or substitute a hand-written reporter implementation.
    const start = text.indexOf("  let crashOptions = null;");
    const end = text.indexOf("  SentryReporter.overflowProtection = 0;", start);
    assert.ok(start >= 0 && end > start, "shipped reporter boundary must exist");
    const logs = []; const forbidden = () => { throw Error("privacy side effect"); };
    const ctx = vm.createContext({ console: { error: ex => logs.push(ex) }, fetch: forbidden,
      crypto: { randomUUID: forbidden }, localStorage: { getItem: forbidden, setItem: forbidden },
      chrome: { storage: { local: { get: forbidden, set: forbidden } } }, setTimeout: forbidden });
    vm.runInContext(text.slice(start, end) + '\n globalThis.probe = { SentryReporter, setCrashOptions, options: () => crashOptions };', ctx);
    ctx.probe.setCrashOptions({ video: true, technical: true, crash: true });
    assert.equal(JSON.stringify(ctx.probe.options()), '{"video":false,"technical":false,"crash":false}');
    const error = new Error("fixture-local-only"); await ctx.probe.SentryReporter.captureException(error);
    assert.deepEqual(logs, [error]); assert.equal(ctx.probe.SentryReporter.init, undefined);
    assert.equal(ctx.probe.SentryReporter.client, undefined);
  });
}
(async () => {
  for (const { name, fn } of cases) {
    try { await fn(); passed++; console.log(`PASS ${name}`); }
    catch (error) { console.error(`FAIL ${name}\n${error.stack}`); process.exitCode = 1; }
  }
  console.log(`\nP0 regressions: ${passed}/${cases.length} passed`);
})();
