"use strict";
// Deterministic runtime/service tests: no external API, browser or FPS claims.
const assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs"), path = require("node:path");
const read = name => fs.readFileSync(path.join(__dirname,"..",name),"utf8");
const cases=[]; function test(name,run){cases.push({name,run});}
const noon=Date.parse("2026-06-21T05:00:00Z");
const seed={enabled:true,daylightBackground:{enabled:true,liveWeather:true,scene:"auto",location:{name:"Hà Nội",latitude:21.0285,longitude:105.8542}}};
const payload=()=>({current:{time:Math.floor(noon/1000),temperature_2m:31.2,weather_code:61,cloud_cover:80,wind_speed_10m:12}});
function worker({permission=true,settings=seed,cache={},failure=false}={}){
  let handler,now=noon,requests=[],permitted=permission,broken=failure; const store={ylgSettings:settings,...cache};
  class Clock extends Date {constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
  const ctx={console,Date:Clock,URL,AbortController,setTimeout,clearTimeout,
    fetch:async(url,options)=>{requests.push({url,options});if(broken)throw Error("offline");return{ok:true,json:async()=>payload()};},
    chrome:{runtime:{id:"test",getURL:p=>"chrome-extension://test/"+p,onMessage:{addListener:f=>handler=f}},
      permissions:{contains:async()=>permitted},storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,store[k]])),set:async patch=>Object.assign(store,patch)}}}};
  vm.createContext(ctx);
  for(const f of ["src/shared/settings.js","src/shared/sky-environment.js","src/background/weather-service.js"])vm.runInContext(read(f),ctx,{filename:f});
  const popup={id:"test",url:"chrome-extension://test/src/popup/popup.html"};
  return {ctx,store,requests,setNow:v=>now=v,setFailure:v=>broken=v,setPermission:v=>permitted=v,
    send(message={type:"ylg:weather"},sender=popup){return new Promise(resolve=>{if(handler(message,sender,resolve)!==true)resolve({ignored:true});});}};
}
test("solar UTC geometry follows selected longitude rather than the computer timezone",()=>{
  const h=worker(),E=h.ctx.YLG_SKY_ENV;
  const day=E.solarAt(new Date(noon),seed.daylightBackground.location);
  const night=E.solarAt(new Date(noon+12*3600000),seed.daylightBackground.location);
  assert.equal(day.scene,"day");assert.ok(day.elevation>85&&day.elevation<90);assert.equal(night.scene,"night");
  assert.equal(E.solarAt(new Date(noon),{latitude:21.0285,longitude:105.8542-180}).scene,"night");
  assert.equal(E.solarAt(new Date(NaN),seed.daylightBackground.location),null);
  assert.equal(E.solarAt(new Date(noon),{latitude:91,longitude:0}),null);
});
test("solar remains finite at poles, leap day and date line; equatorial sunrise is near 06 solar time",()=>{
  const E=worker().ctx.YLG_SKY_ENV;
  for(const lat of [-90,0,90])for(const lon of [-180,0,180])for(const time of ["2024-02-29T00:00Z","2026-12-21T12:00Z"]){
    const v=E.solarAt(new Date(time),{latitude:lat,longitude:lon});
    assert.ok(Number.isFinite(v.elevation)&&v.stars>=0&&v.stars<=1);
  }
  const dawn=E.solarAt(new Date("2026-03-20T06:00Z"),{latitude:0,longitude:0});
  assert.ok(Math.abs(dawn.elevation)<3);assert.equal(dawn.scene,"morning");
});
test("settings migrate without network opt-in and sanitize copied locations",()=>{
  const S=worker().ctx.YLG_SETTINGS;
  assert.equal(S.normalizeSettings({}).daylightBackground.liveWeather,false);
  const invalid=S.normalizeSettings({daylightBackground:{liveWeather:true,location:{latitude:NaN,longitude:Infinity}}});
  assert.equal(invalid.daylightBackground.location.latitude,21.0285);
  const input={latitude:0,longitude:0,name:"<script>"};
  const s=S.normalizeSettings({daylightBackground:{location:input}});input.latitude=90;
  assert.equal(s.daylightBackground.location.latitude,0);assert.equal(s.daylightBackground.location.name,"<script>");
  const defaults=JSON.parse(read("default-settings.json"));
  assert.deepEqual(defaults.daylightBackground,JSON.parse(JSON.stringify(S.DEFAULT_SETTINGS.daylightBackground)));
});
test("disabled, manual-scene, no-opt-in and denied permission make zero requests",async()=>{
  for(const settings of [{enabled:false},{...seed,daylightBackground:{...seed.daylightBackground,enabled:false}},
    {...seed,daylightBackground:{...seed.daylightBackground,liveWeather:false}},
    {...seed,daylightBackground:{...seed.daylightBackground,scene:"night"}}]){
    const h=worker({settings});assert.equal((await h.send()).status,"disabled");assert.equal(h.requests.length,0);
  }
  const h=worker({permission:false});assert.equal((await h.send()).status,"permission");assert.equal(h.requests.length,0);
});
test("many tabs coalesce into one request and a fresh persisted cache survives worker restart",async()=>{
  const h=worker();const replies=await Promise.all(Array.from({length:12},()=>h.send()));
  assert.equal(h.requests.length,1);assert.ok(replies.every(r=>r.status==="current"&&r.weather.kind==="rain"));
  await h.send();assert.equal(h.requests.length,1);
  const resumed=worker({cache:h.store});assert.equal((await resumed.send()).weather.cloud,.8);assert.equal(resumed.requests.length,0);
  const r=h.requests[0];assert.equal(new URL(r.url).hostname,"api.open-meteo.com");
  assert.equal(r.options.credentials,"omit");assert.equal(r.options.referrerPolicy,"no-referrer");
  assert.ok(!r.url.includes("youtube"));assert.ok(!r.url.includes("name="));
});
test("offline cache is labelled stale, expires, and persisted failures prevent retry storms",async()=>{
  const h=worker();await h.send();h.setNow(noon+16*60000);h.setFailure(true);
  assert.equal((await h.send()).status,"stale");const n=h.requests.length;
  for(let i=0;i<8;i++)assert.equal((await h.send()).status,"stale");assert.equal(h.requests.length,n);
  const resumed=worker({cache:h.store,failure:true});resumed.setNow(noon+17*60000);
  assert.equal((await resumed.send()).status,"stale");assert.equal(resumed.requests.length,0);
  h.setNow(noon+121*60000);assert.equal((await h.send()).status,"offline");
});
test("malformed, stale and unexpected weather codes are not displayed as current conditions",()=>{
  const E=worker().ctx.YLG_SKY_ENV;
  for(const patch of [{cloud_cover:-1},{cloud_cover:101},{time:noon/1000-7201},{weather_code:400},{temperature_2m:"31"},{wind_speed_10m:null}]){
    const p=payload();Object.assign(p.current,patch);assert.equal(E.parseWeather(p,noon),null);
  }
  for(const [code,kind]of [[0,"clear"],[3,"cloudy"],[48,"fog"],[75,"snow"],[99,"storm"]])assert.equal(E.weatherKind(code),kind);
});
test("sender boundary rejects other origins, subframes and page attempts to use city search",async()=>{
  const h=worker();for(const sender of [{id:"other",url:"https://www.youtube.com/",frameId:0},{id:"test",url:"https://evil.test/",frameId:0},
    {id:"test",url:"https://www.youtube.com/",frameId:1},{id:"test",url:"https://www.youtube.com/watch?v=x",frameId:0}])assert.equal((await h.send(undefined,sender)).ignored,true);
  assert.equal((await h.send({type:"ylg:city-search",name:"Hanoi"},{id:"test",url:"https://www.youtube.com/",frameId:0})).ignored,true);
  assert.equal(h.requests.length,0);
  assert.equal((await h.send(undefined,{id:"test",url:"https://www.youtube.com/results?search_query=test",frameId:0})).status,"current");
});
test("changing city ignores the previous cached location and geocoding is explicit and bounded",async()=>{
  const h=worker();await h.send();
  h.store.ylgSettings={...seed,daylightBackground:{...seed.daylightBackground,location:{name:"Tokyo",latitude:35.68,longitude:139.69}}};
  await h.send();assert.equal(h.requests.length,2);assert.ok(h.requests[1].url.includes("latitude=35.68"));
  const n=h.requests.length;await h.send({type:"ylg:city-search",name:"a"});assert.equal(h.requests.length,n);
  await h.send({type:"ylg:city-search",name:"Hà Nội"});assert.equal(new URL(h.requests.at(-1).url).hostname,"geocoding-api.open-meteo.com");
  await h.send({type:"ylg:city-search",name:"Tokyo"});assert.equal(h.requests.length,n+1);
});
(async()=>{for(const t of cases){try{await t.run();console.log("PASS "+t.name);}catch(e){console.error("FAIL "+t.name+"\n"+e.stack);process.exitCode=1;}}console.log("Sky/weather: "+cases.length+" cases");})();
