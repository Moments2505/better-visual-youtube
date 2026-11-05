"use strict";
// Actual controller source with transformed mock rectangles. This exercises
// event routing/lifecycle; it does not measure browser frames or GPU behaviour.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
function world() {
  let serial=0, now=0, reads=0, writes=0, isReduced=false;
  const frames=new Map(), timers=new Map(), listeners=new Map(), ros=[], mos=[];
  const on=(k,fn)=>{if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(fn);};
  const off=(k,fn)=>listeners.get(k)?.delete(fn);
  function element(id,x,y,width,height) {
    const attrs=new Map();
    return {id,x,y,offsetWidth:width,offsetHeight:height,isConnected:true,expanded:false,attrs,
      getAttribute:k=>attrs.get(k),hasAttribute:k=>attrs.has(k),
      setAttribute(k,v){if(k==="data-ylg-panel-active")writes++;attrs.set(k,String(v));}, removeAttribute:k=>attrs.delete(k),
      closest(s){return s.includes("ytd-watch-metadata")?this:null;},
      querySelector(){return this.expanded?{}:null;},
      getBoundingClientRect(){
        reads++; const scale=this.scale??(attrs.has("data-ylg-panel-active")?1.048:1);
        const left=this.id==="secondary"?this.x+this.offsetWidth*(1-scale):this.x;
        return {left,top:this.y,right:left+this.offsetWidth*scale,bottom:this.y+this.offsetHeight*scale,width:this.offsetWidth*scale,height:this.offsetHeight*scale};
      }};
  }
  const metadata=element("metadata",0,120,600,260), comments=element("comments",0,390,600,1000), secondary=element("secondary",612,120,340,1400);
  let panels=[metadata,comments,secondary];
  const de=element("html",0,0,0,0);
  for(const [k,v] of Object.entries({"data-ylg-enabled":"true","data-ylg-motion":"on","data-ylg-hover":"on","data-ylg-optics":"on","data-ylg-optics-magnify":"1"}))de.attrs.set(k,v);
  const doc={hidden:false,fullscreenElement:null,documentElement:de,activeElement:null,addEventListener:on,removeEventListener:off,
    querySelector(){return {querySelectorAll:()=>panels};}};
  const reduced={get matches(){return isReduced;},addEventListener:(k,f)=>on("media:"+k,f),removeEventListener:(k,f)=>off("media:"+k,f)};
  const root={document:doc,console,Map,Array,matchMedia:()=>reduced,
    requestAnimationFrame(fn){frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id),
    setTimeout(fn,ms){timers.set(++serial,{fn,at:now+ms});return serial;},clearTimeout:id=>timers.delete(id),
    addEventListener:on,removeEventListener:off,
    ResizeObserver:class{constructor(fn){this.fn=fn;this.targets=new Set();ros.push(this);}observe(n){this.targets.add(n);}disconnect(){this.targets.clear();}},
    MutationObserver:class{constructor(fn){this.fn=fn;this.connected=false;mos.push(this);}observe(_,opts){this.opts=opts;this.connected=true;}disconnect(){this.connected=false;}}
  };root.window=root;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../src/content/panel-hover.js"),"utf8"),root);
  const api=root.YLG_PANEL_HOVER;
  const emit=(name,e={})=>{for(const fn of [...listeners.get(name)||[]])fn(e);};
  const flush=()=>{const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();};
  api.init();flush();
  return {api,root,doc,de,metadata,comments,secondary,frames,timers,listeners,ros,mos,element,emit,flush,
    move(panel,x,y,extra={}){emit("pointermove",{target:panel,clientX:x,clientY:y,pointerType:"mouse",...extra});},
    advance(ms){now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}},
    active(){return panels.filter(n=>n.attrs.has("data-ylg-panel-active"));},
    replace(next){panels=next;},reduce(value){isReduced=value;emit("media:change");},
    stats(){return {reads,writes};}};
}
let count=0;
function test(name,fn){fn();count++;console.log("PASS "+name);}
test("enlarged metadata cannot trap pointer over comments or recommendations; reverse handoff uses original bounds",()=>{
  const w=world();
  w.move(w.metadata,500,200);w.flush();assert.deepEqual(w.active(),[w.metadata]);
  assert.ok(w.metadata.getBoundingClientRect().bottom>391);
  w.move(w.metadata,500,391);w.flush();assert.deepEqual(w.active(),[w.comments]);
  w.move(w.metadata,500,200);w.flush();
  assert.ok(w.metadata.getBoundingClientRect().right>616);
  w.move(w.metadata,616,200);w.flush();assert.deepEqual(w.active(),[w.secondary]);
  assert.ok(w.secondary.getBoundingClientRect().left<598);
  w.move(w.secondary,598,200);w.flush();assert.deepEqual(w.active(),[w.metadata]);
  assert.equal(w.de.getAttribute("data-ylg-panel-side"),"primary");
});
test("pointer bursts coalesce; staying in one panel never restarts its animation",()=>{
  const w=world();const before=w.stats();
  for(let i=0;i<200;i++)w.move(w.metadata,500,200+i%30);
  assert.equal(w.frames.size,1);w.flush();
  assert.ok(w.stats().reads-before.reads<=3);const selectedWrites=w.stats().writes;
  for(let i=0;i<60;i++){w.move(w.metadata,500,200+i%30);w.flush();}
  assert.equal(w.stats().writes,selectedWrites);assert.equal(w.timers.size,0);
});
test("rapid reversals keep exactly one active panel and bounded leaving timers",()=>{
  const w=world();const steps=[[w.metadata,500,200],[w.comments,500,500],[w.secondary,800,200]];
  for(let i=0;i<90;i++){
    const [target,x,y]=steps[i%3];w.move(target,x,y);w.flush();
    assert.deepEqual(w.active(),[target]);assert.ok(w.timers.size<=2);
  }
  assert.equal(w.de.getAttribute("data-ylg-panel-side"),"leaving-primary");
  w.advance(500);assert.equal(w.timers.size,0);assert.equal(w.de.getAttribute("data-ylg-panel-side"),"secondary");
});
test("stale exit callbacks cannot finish a newer exit on the same panel",()=>{
  const w=world();w.move(w.metadata,500,200);w.flush();w.move(w.comments,500,500);w.flush();
  const stale=[...w.timers.values()][0].fn;
  w.move(w.metadata,500,200);w.flush();w.move(w.secondary,800,200);w.flush();
  stale();assert.equal(w.metadata.hasAttribute("data-ylg-panel-leaving"),true);
  w.emit("transitionend",{target:w.metadata,propertyName:"opacity"});assert.equal(w.metadata.hasAttribute("data-ylg-panel-leaving"),true);
  w.emit("transitionend",{target:w.metadata,propertyName:"transform"});assert.equal(w.metadata.hasAttribute("data-ylg-panel-leaving"),false);
});
test("half-scaled recommendations use their fixed right edge and new geometry after scrolling",()=>{
  const w=world();w.secondary.scale=1.024;
  w.move(w.secondary,610,200);w.flush();assert.equal(w.active().length,0);
  w.move(w.secondary,613,200);w.flush();assert.deepEqual(w.active(),[w.secondary]);
  w.secondary.y=300;w.emit("scroll");w.flush();assert.equal(w.active().length,0);
});
test("mouse focus does not latch; keyboard focus works and pointer takes priority",()=>{
  const w=world();w.doc.activeElement={matches:()=>true,closest:()=>w.metadata};
  w.emit("focusin");w.flush();assert.equal(w.active().length,0);
  w.emit("keydown",{key:"Tab"});w.emit("focusin");w.flush();assert.deepEqual(w.active(),[w.metadata]);
  w.move(w.secondary,800,200);w.flush();assert.deepEqual(w.active(),[w.secondary]);
  w.move({closest:()=>null},1100,200);w.flush();assert.equal(w.active().length,0);
  w.move({closest:()=>({})},500,200);w.flush();assert.equal(w.active().length,0,"popup blocks panels underneath");
});
test("expanded description, motion/hover disable, fullscreen and reduced motion never lift",()=>{
  for(const key of ["data-ylg-enabled","data-ylg-motion","data-ylg-hover","data-ylg-optics","data-ylg-optics-magnify"]){
    const w=world();w.de.setAttribute(key,key==="data-ylg-optics-magnify"?"0":"off");w.move(w.metadata,500,200);w.flush();assert.equal(w.active().length,0,key);
  }
  const w=world();w.metadata.expanded=true;w.move(w.metadata,500,200);w.flush();assert.equal(w.active().length,0);
  w.metadata.expanded=false;w.move(w.metadata,500,200);w.flush();w.reduce(true);assert.equal(w.active().length,0);
  w.reduce(false);w.doc.fullscreenElement={};w.move(w.metadata,500,200);w.flush();assert.equal(w.active().length,0);
});
test("theater motion suspends hover and resumes after the layout settles",()=>{
  const w=world();w.move(w.metadata,500,200);w.flush();
  w.de.setAttribute("data-ylg-player-transition","1");w.mos[0].fn();assert.equal(w.active().length,0);
  w.move(w.secondary,800,200);w.flush();assert.equal(w.active().length,0);
  w.de.removeAttribute("data-ylg-player-transition");w.mos[0].fn();w.flush();assert.deepEqual(w.active(),[w.secondary]);
  assert.deepEqual(Array.from(w.mos[0].opts.attributeFilter),["data-ylg-player-transition"]);
});
test("navigation clears detached panels and discovers replacement nodes without a global observer",()=>{
  const w=world();w.move(w.metadata,500,200);w.flush();w.move(w.comments,500,500);w.flush();
  w.emit("yt-navigate-start");assert.equal(w.active().length,0);assert.equal(w.timers.size,0);assert.equal(w.ros[0].targets.size,0);
  w.metadata.isConnected=false;const next=w.element("metadata",0,120,600,260);w.replace([next,w.comments,w.secondary]);
  w.emit("yt-navigate-finish");w.move(next,500,200);w.flush();assert.deepEqual(w.active(),[next]);
  assert.equal(w.metadata.attrs.size,0);
});
test("teardown releases listeners, frames, timers and observers; stale work cannot resurrect state",()=>{
  const w=world();w.move(w.metadata,500,200);w.flush();w.move(w.comments,500,500);w.flush();
  const staleTimer=[...w.timers.values()][0].fn;w.move(w.secondary,800,200);const staleFrame=[...w.frames.values()][0];
  w.api.init();assert.equal(w.ros.length,1);
  w.api.teardown();staleTimer();staleFrame();
  assert.equal(w.frames.size,0);assert.equal(w.timers.size,0);assert.equal(w.ros[0].targets.size,0);assert.equal(w.mos[0].connected,false);
  assert.equal([...w.listeners.values()].reduce((sum,s)=>sum+s.size,0),0);
  for(const n of [w.metadata,w.comments,w.secondary])assert.equal(n.attrs.size,0);
  assert.equal(w.de.hasAttribute("data-ylg-panel-controller"),false);
  w.api.init();w.move(w.secondary,800,200);w.flush();assert.deepEqual(w.active(),[w.secondary]);
});
console.log(count+" panel hover regression groups passed (VM geometry/event model; no rendered-frame claim).");
