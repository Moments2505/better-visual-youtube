"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
let time=1000,drag=false,hover=null,reads=0,queries=0,frame=null;const timers=new Map();
const video={readyState:4,paused:false,ended:false,seeking:false,
  requestVideoFrameCallback(callback){frame=callback;return 1;},cancelVideoFrameCallback(){frame=null;}};
const document={hidden:false,querySelector:selector=>{queries++;return drag||hover&&selector.includes(hover)?{}:null;},addEventListener(){},removeEventListener(){},
  createElement:()=>({getContext:()=>({clearRect(){},drawImage(){reads++;},getImageData:()=>({data:new Uint8ClampedArray([80,90,100,255])})})})};
const w={document,Date:{now:()=>time},YLG_NAV:{getPlayer:()=>({video})},
  setInterval(f){timers.set(1,f);return 1;},clearInterval:k=>timers.delete(k),dispatchEvent(){},CustomEvent:function(){},
  MutationObserver:class{constructor(){throw Error("global per-mutation discovery must stay removed");}}};w.window=w;
vm.runInNewContext(fs.readFileSync(require.resolve("../src/content/tint-sampler.js"),"utf8"),w);
w.YLG_TINT.init({enabled:true,tint:"media"});assert.equal(reads,1);
drag=true;time+=1000;w.YLG_TINT.sample();assert.equal(reads,1,"drag must avoid video canvas readback");
drag=false;video.seeking=true;time+=1000;w.YLG_TINT.sample();assert.equal(reads,1);
video.seeking=false;time+=1000;w.YLG_TINT.sample();assert.equal(reads,2,"sampling resumes after interaction");
for(const selector of ['.ytp-progress-bar-container:hover','.ytp-volume-area:hover']) {
  hover=selector;time+=1000;w.YLG_TINT.sample();assert.equal(reads,2,"hover must avoid GPU readback before dragging: "+selector);
}
hover=null;w.YLG_TINT.sample();assert.equal(reads,2,"leaving hover retains the previous tint until the next budget");
time+=699;w.YLG_TINT.sample();assert.equal(reads,2,"hover attempts consume the interval without consuming native input");
time+=1;w.YLG_TINT.sample();assert.equal(reads,3,"sampling resumes at the next 700ms budget after leaving hover");
const before={queries,reads};
for(let i=0;i<240;i++){time+=1000/120;frame();}
assert.ok(queries-before.queries<=3,"240 decoded frames must not run 240 global hover queries");
assert.ok(queries-before.queries>=2,"the test must span real sampling intervals");
assert.equal(queries-before.queries,reads-before.reads,"non-interacting playback queries only when a sample is due");
hover='.ytp-progress-bar-container:hover';const beforeHover={queries,reads,color:w.YLG_TINT.color()};
for(let i=0;i<240;i++){time+=1000/120;frame();}
assert.ok(queries-beforeHover.queries<=3,"continuous hover also bounds selectors across 240 decoded frames");
assert.ok(queries-beforeHover.queries>=2,"continuous hover must span sampling attempts");
assert.equal(reads,beforeHover.reads,"continuous hover never reads video pixels");
assert.equal(w.YLG_TINT.color(),beforeHover.color,"the last tint remains visible throughout hover");
hover=null;w.YLG_TINT.sample();assert.equal(reads,beforeHover.reads,"hover exit does not bypass the attempt budget");
time+=700;w.YLG_TINT.sample();assert.equal(reads,beforeHover.reads+1,"tint resumes within one normal interval after hover exit");
w.YLG_TINT.teardown();assert.equal(timers.size,0);console.log("PASS tint skips GPU readback during drag/seeking, resumes and cleans up without a global mutation observer");
