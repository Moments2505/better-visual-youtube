"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
let time=1000,drag=false,reads=0;const timers=new Map();
const video={readyState:4,paused:false,ended:false,seeking:false};
const document={hidden:false,querySelector:()=>drag?{}:null,addEventListener(){},removeEventListener(){},
  createElement:()=>({getContext:()=>({clearRect(){},drawImage(){reads++;},getImageData:()=>({data:new Uint8ClampedArray([80,90,100,255])})})})};
const w={document,Date:{now:()=>time},YLG_NAV:{getPlayer:()=>({video})},
  setInterval(f){timers.set(1,f);return 1;},clearInterval:k=>timers.delete(k),dispatchEvent(){},CustomEvent:function(){},
  MutationObserver:class{constructor(){throw Error("global per-mutation discovery must stay removed");}}};w.window=w;
vm.runInNewContext(fs.readFileSync(require.resolve("../src/content/tint-sampler.js"),"utf8"),w);
w.YLG_TINT.init({enabled:true,tint:"media"});assert.equal(reads,1);
drag=true;time+=1000;w.YLG_TINT.sample();assert.equal(reads,1,"drag must avoid video canvas readback");
drag=false;video.seeking=true;time+=1000;w.YLG_TINT.sample();assert.equal(reads,1);
video.seeking=false;time+=1000;w.YLG_TINT.sample();assert.equal(reads,2,"sampling resumes after interaction");
w.YLG_TINT.teardown();assert.equal(timers.size,0);console.log("PASS tint skips GPU readback during drag/seeking, resumes and cleans up without a global mutation observer");
