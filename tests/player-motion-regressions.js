"use strict";
const assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs");
const source = fs.readFileSync(require("node:path").join(__dirname, "../src/content/player-motion.js"), "utf8");
function world({ sidebar = false } = {}) {
  const attrs = new Map([["data-ylg-enabled", "true"], ["data-ylg-motion", "on"]]);
  const listeners = new Map(), raf = new Map(), runs = [];
  let id = 0, theater = false, reduced = false;
  const target = { closest: s => s === ".ytp-size-button" ? target : null };
  const flexy = { hasAttribute: k => k === "theater" && theater };
  const player = { isConnected: true, getBoundingClientRect: () => theater ?
    { left: 0, top: 56, width: 1200, height: 600 } : { left: 24, top: 80, width: 700, height: 394 },
    animate(keyframes, options) { const a = { keyframes, options, cancel() { this.cancelled = true; this.oncancel?.(); } }; runs.push(a); return a; } };
  const styles = new Map(), priorities = new Map(), sideRuns = [];
  const secondary = { style: {
    getPropertyValue: k => styles.get(k) || "", getPropertyPriority: k => priorities.get(k) || "",
    setProperty(k,v,p="") { styles.set(k,v);priorities.set(k,p); },
    removeProperty(k) { styles.delete(k);priorities.delete(k); }
  }, getBoundingClientRect: () => ({left:800,top:80,width:360,height:3000}),
    animate(keyframes, options) { const a={keyframes,options,cancel(){this.cancelled=true;this.oncancel?.();}};sideRuns.push(a);return a; } };
  const root = { document: { fullscreenElement: null, documentElement: {
    getAttribute: k => attrs.get(k), setAttribute: (k,v) => attrs.set(k,v), removeAttribute: k => attrs.delete(k)
  }, querySelector: s => s === "ytd-watch-flexy" ? flexy : s === "ytd-player#ytd-player" ? player : s === "#secondary" && sidebar ? secondary : null,
    addEventListener: (k,f) => listeners.set(k,f), removeEventListener: (k,f) => { if(listeners.get(k)===f)listeners.delete(k); } },
    requestAnimationFrame: f => { raf.set(++id,f); return id; }, cancelAnimationFrame: i => raf.delete(i),
    matchMedia: () => ({matches:reduced}), addEventListener(){}, removeEventListener(){} };
  root.innerHeight = 900;
  root.window = root; vm.runInNewContext(source, root); root.YLG_PLAYER_MOTION.init();
  return { root, attrs, runs, raf, player, listeners, target, secondary, styles, sideRuns, toggle(){theater=!theater}, reduce(){reduced=true},
    event(k="click",extra={}) { listeners.get(k)?.({type:k,target,key:"t",...extra}); },
    frame(){const callbacks=[...raf.values()];raf.clear();callbacks.forEach(f=>f());} };
}
let passed=0;
function test(name, fn) { fn(); console.log("PASS "+name); passed++; }
test("native event is not consumed; mode change gets one temporary transform animation",()=>{
  const w=world();let refreshed=false;w.root.YLG_OPTICS={refreshPlayer(){assert.equal(w.attrs.get("data-ylg-player-transition"),"1");refreshed=true;}};
  w.event();w.toggle();w.frame();assert.equal(w.runs.length,1);
  assert.equal(w.runs[0].options.duration,460);assert.equal(w.runs[0].options.fill,"none");
  assert.match(w.runs[0].keyframes[0].transform,/scale\(0\.583/);
  w.runs[0].onfinish();assert.equal(refreshed,true);assert.equal(w.attrs.has("data-ylg-player-transition"),false);
});
test("optics refresh failure cannot leave temporary light material enabled",()=>{
  const w=world();w.root.YLG_OPTICS={refreshPlayer(){throw new Error("detached player")}};
  w.event();w.toggle();w.frame();assert.doesNotThrow(()=>w.runs[0].onfinish());
  assert.equal(w.attrs.has("data-ylg-player-transition"),false);
});
test("sidebar remains painted, slides fully below viewport, then releases original layout",()=>{
  const w=world({sidebar:true});w.secondary.style.setProperty("margin","12px");w.event();
  assert.equal(w.styles.get("position"),"fixed");assert.equal(w.styles.get("display"),"block");
  assert.equal(w.styles.get("height"),"820px");assert.equal(w.sideRuns[0].keyframes[1].translate,"0 836px");
  assert.equal(w.sideRuns[0].options.fill,"forwards");
  w.toggle();w.frame();assert.equal(w.runs[0].options.duration,460);
  w.sideRuns[0].onfinish();assert.equal(w.styles.get("margin"),"12px");assert.equal(w.styles.has("position"),false);
});
test("sidebar reversal restores exit styles before entering; native inline updates survive cleanup",()=>{
  const w=world({sidebar:true});w.event();w.toggle();w.frame();const old=w.sideRuns[0];
  w.event();w.toggle();w.frame();assert.equal(old.cancelled,true);assert.equal(w.styles.has("position"),false);
  assert.equal(w.sideRuns[1].keyframes[0].translate,"0 836px");
  w.root.YLG_PLAYER_MOTION.teardown();assert.equal(w.sideRuns[1].cancelled,true);
  const a=world({sidebar:true});a.event();a.secondary.style.setProperty("display","none");
  a.root.YLG_PLAYER_MOTION.teardown();assert.equal(a.styles.get("display"),"none");
});
test("unchanged mode cancels after three frames without animating",()=>{
  const w=world();w.event();w.frame();w.frame();w.frame();assert.equal(w.runs.length,0);assert.equal(w.raf.size,0);assert.equal(w.attrs.has("data-ylg-player-transition"),false);
});
test("rapid reverse cancels old animation and stale completion cannot clear new marker",()=>{
  const w=world();w.event();w.toggle();w.frame();const old=w.runs[0],finish=old.onfinish;
  w.event();w.toggle();w.frame();assert.equal(old.cancelled,true);assert.equal(w.runs.length,2);
  finish();assert.equal(w.attrs.get("data-ylg-player-transition"),"1");
});
test("editing, modified/repeat keys, reduced motion, Motion off and fullscreen skip work",()=>{
  for (const extra of [{repeat:true},{ctrlKey:true},{target:{closest:()=>true}}]) {const w=world();w.event("keydown",extra);assert.equal(w.raf.size,0);}
  const a=world();a.reduce();a.event();assert.equal(a.raf.size,0);
  const b=world();b.attrs.set("data-ylg-motion","off");b.event();assert.equal(b.raf.size,0);
  const c=world();c.root.document.fullscreenElement={};c.event();assert.equal(c.raf.size,0);
});
test("explicit system-motion opt-out permits player motion without bypassing Motion off",()=>{
  const w=world();w.reduce();w.attrs.set("data-ylg-system-motion","ignore");
  w.event();w.toggle();w.frame();assert.equal(w.runs.length,1);
  w.attrs.set("data-ylg-motion","off");w.event();assert.equal(w.raf.size,0);
});

test("teardown cancels frames/animations, removes listeners and guards queued callbacks",()=>{
  const w=world();w.event();const queued=[...w.raf.values()][0];w.root.YLG_PLAYER_MOTION.teardown();w.toggle();queued();
  assert.equal(w.runs.length,0);assert.equal(w.listeners.size,0);assert.equal(w.attrs.has("data-ylg-player-transition"),false);
  w.root.YLG_PLAYER_MOTION.init();w.event();w.toggle();w.frame();w.root.YLG_PLAYER_MOTION.teardown();assert.equal(w.runs[0].cancelled,true);
});
console.log(`${passed} player motion regressions passed (VM; no rendered-frame claim).`);
