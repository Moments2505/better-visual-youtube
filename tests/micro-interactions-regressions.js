"use strict";
const assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
function world(){
  const events=new Map(),attrs=new Map([["data-ylg-enabled","true"],["data-ylg-motion","on"]]),dragAttrs=new Map(),runs=[];
  const listen=(k,f)=>{if(!events.has(k))events.set(k,new Set());events.get(k).add(f)},unlisten=(k,f)=>events.get(k)?.delete(f);
  const drag={setAttribute:(k,v)=>dragAttrs.set(k,v),removeAttribute:k=>dragAttrs.delete(k)};
  const svg={animate(frames,opts){const r={frames,opts,cancel(){this.cancelled=true;this.oncancel?.()}};runs.push(r);return r}};
  const button={querySelector:()=>svg};let reduced=false;
  const document={hidden:false,documentElement:{getAttribute:k=>attrs.get(k)},addEventListener:listen,removeEventListener:unlisten};
  const root={document,matchMedia:()=>({matches:reduced}),addEventListener:listen,removeEventListener:unlisten};root.window=root;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../src/content/micro-interactions.js"),"utf8"),root);root.YLG_MICRO.init();
  return{root,document,attrs,dragAttrs,runs,events,reduce(){reduced=true},emit(k,extra={}){for(const f of [...events.get(k)||[]])f({button:0,target:{closest:s=>s===".ytp-play-button"?button:drag},...extra})}};
}
let count=0;function test(name,fn){fn();count++;console.log("PASS "+name)}
test("drag releases on up/cancel/blur/navigation/hidden page without consuming events",()=>{
  for(const k of ["pointerup","pointercancel","blur","yt-navigate-start","pagehide","visibilitychange"]){const w=world();w.emit("pointerdown");assert.equal(w.dragAttrs.get("data-ylg-dragging"),"1");w.document.hidden=true;w.emit(k);assert.equal(w.dragAttrs.size,0)}
});
test("motion off, disabled, reduced motion and secondary buttons do not start drag",()=>{
  for(const key of ["data-ylg-enabled","data-ylg-motion"]){const w=world();w.attrs.set(key,"off");w.emit("pointerdown");assert.equal(w.dragAttrs.size,0)}
  const a=world();a.reduce();a.emit("pointerdown");assert.equal(a.dragAttrs.size,0);
  const b=world();b.emit("pointerdown",{button:2});assert.equal(b.dragAttrs.size,0);
});
test("play icon feedback is bounded, restarts safely and leaves native transform alone",()=>{
  const w=world();w.emit("click");const old=w.runs[0];w.emit("click");assert.equal(old.cancelled,true);assert.equal(w.runs[1].opts.duration,140);assert.equal(Object.hasOwn(w.runs[1].frames[0],"transform"),false);
  w.root.YLG_MICRO.teardown();assert.equal(w.runs[1].cancelled,true);
});
test("init is idempotent and teardown clears drag state and all listeners",()=>{
  const w=world();w.root.YLG_MICRO.init();w.emit("pointerdown");w.root.YLG_MICRO.teardown();assert.equal(w.dragAttrs.size,0);assert.equal([...w.events.values()].reduce((n,s)=>n+s.size,0),0);
});
console.log(count+" micro interaction regression groups passed (VM; no render claim)");
