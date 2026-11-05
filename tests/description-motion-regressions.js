"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
function world() {
  const events = new Map(), frames = new Map(), markers = new Map(), runs = [];
  let height = 104, next = 0, reduced = false;
  const attrs = new Map([["data-ylg-enabled", "true"], ["data-ylg-motion", "on"]]);
  const listen = (k,f) => { if (!events.has(k)) events.set(k,new Set()); events.get(k).add(f); };
  const unlisten = (k,f) => events.get(k)?.delete(f);
  const description = { isConnected:true, setAttribute:(k,v)=>markers.set(k,v), removeAttribute:k=>markers.delete(k),
    animate(keyframes, options) { const r={keyframes,options,cancel(){this.cancelled=true;this.oncancel?.();}}; runs.push(r); return r; } };
  const metadata = {querySelector:()=>description};
  const button = {closest:s=>s==="ytd-watch-metadata"?metadata:{}};
  const document = {hidden:false,documentElement:{getAttribute:k=>attrs.get(k)},addEventListener:listen,removeEventListener:unlisten};
  const root = {document,matchMedia:()=>({matches:reduced}),getComputedStyle:()=>({height:String(height)}),
    addEventListener:listen,removeEventListener:unlisten,requestAnimationFrame:f=>{frames.set(++next,f);return next;},cancelAnimationFrame:i=>frames.delete(i)};
  root.window=root;
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/content/description-motion.js"),"utf8"),root);
  root.YLG_DESCRIPTION_MOTION.init();
  return {root,document,description,attrs,markers,runs,frames,events,reduce(){reduced=true;},height(v){height=v;},
    emit(k){for(const f of [...events.get(k)||[]])f({target:{closest:()=>button}});},
    flush(){const queue=[...frames.values()];frames.clear();queue.forEach(f=>f());}};
}
let count=0;
function test(name,f){f();count++;console.log("PASS "+name);}
test("native expansion/collapse animate real layout height then release temporary clipping",()=>{
  const w=world();w.emit("click");w.height(1410);w.flush();
  assert.equal(w.runs[0].keyframes[0].height,"104px");assert.equal(w.runs[0].keyframes[1].height,"1410px");
  assert.equal(w.runs[0].options.duration,360);assert.equal(w.markers.size,1);
  w.runs[0].onfinish();assert.equal(w.markers.size,0);
  w.emit("click");w.height(104);w.flush();assert.equal(w.runs[1].keyframes[0].height,"1410px");assert.equal(w.runs[1].keyframes[1].height,"104px");
});
test("rapid reversal begins at current height; navigation cancels pending and active work",()=>{
  const w=world();w.emit("click");w.height(1410);w.flush();w.height(700);w.emit("click");
  assert.equal(w.runs[0].cancelled,true);w.height(104);w.flush();assert.equal(w.runs[1].keyframes[0].height,"700px");
  w.emit("yt-navigate-start");assert.equal(w.runs[1].cancelled,true);assert.equal(w.markers.size,0);
  w.emit("click");w.emit("resize");w.flush();assert.equal(w.runs.length,2);
});
test("disabled/reduced motion and detached nodes never animate",()=>{
  for(const key of ["data-ylg-enabled","data-ylg-motion"]){const w=world();w.attrs.set(key,"off");w.emit("click");assert.equal(w.frames.size,0);}
  const w=world();w.reduce();w.emit("click");assert.equal(w.frames.size,0);
  const d=world();d.emit("click");d.height(1410);d.description.isConnected=false;d.flush();assert.equal(d.runs.length,0);
});
test("teardown clears pending frame and every listener; unchanged native height is a no-op",()=>{
  const w=world();w.emit("click");w.flush();assert.equal(w.runs.length,0);
  w.root.YLG_DESCRIPTION_MOTION.init();w.emit("click");w.root.YLG_DESCRIPTION_MOTION.teardown();
  assert.equal(w.frames.size,0);assert.equal([...w.events.values()].reduce((s,v)=>s+v.size,0),0);
});
console.log(count+" description motion regression groups passed (VM, not render performance)");
