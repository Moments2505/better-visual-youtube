"use strict";
// Execute production renderer with an instrumented WebGL API. These tests prove
// bounded work and disposal, not shader pixels, GPU duration or visible FPS.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {makeEl}=require("./dom-fixture");
const read=f=>fs.readFileSync(path.join(__dirname,"..",f),"utf8");
let count=0;function test(name,fn){fn();count++;console.log("PASS "+name);}
function world({noGL=false,compile=true}={}){
  const host=makeEl("div"),html=makeEl("html"),body=makeEl("body");html.appendChild(body);body.appendChild(host);
  const timers=new Map(),events=new Map(),shaders=[],uniforms=new Map(),work={draws:0,programs:0,deletedPrograms:0,buffers:0,deletedBuffers:0,readbacks:0,contextsLost:0};
  let serial=0,now=0;
  const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,ARRAY_BUFFER:5,STATIC_DRAW:6,FLOAT:7,TRIANGLES:8,
    createShader:type=>({type}),shaderSource:(s,code)=>shaders.push(code),compileShader(){},getShaderParameter:()=>compile,deleteShader(){},
    createProgram(){work.programs++;return{};},attachShader(){},linkProgram(){},getProgramParameter:()=>true,useProgram(){},
    createBuffer(){work.buffers++;return{};},bindBuffer(){},bufferData(){},getAttribLocation:()=>0,enableVertexAttribArray(){},vertexAttribPointer(){},
    getUniformLocation:(_,name)=>name,uniform1f(name,value){uniforms.set(name,value);},uniform2f(){},viewport(){},drawArrays(){work.draws++;},
    deleteProgram(){work.deletedPrograms++;},deleteBuffer(){work.deletedBuffers++;},
    readPixels(){work.readbacks++;throw Error("readback forbidden");},getExtension:()=>({loseContext(){work.contextsLost++;}})};
  let canvas;
  const document={hidden:false,documentElement:html,createElement(tag){assert.equal(tag,"canvas");canvas=makeEl(tag);
    canvas.getContext=(type,options)=>{assert.equal(type,"webgl");assert.equal(options.preserveDrawingBuffer,false);assert.equal(options.antialias,false);return noGL?null:gl;};
    canvas.addEventListener=(name,fn)=>events.set(name,fn);canvas.removeEventListener=name=>events.delete(name);return canvas;}};
  const ctx={document,innerWidth:3840,innerHeight:2160,performance:{now:()=>now},Date,Float32Array,
    setTimeout(fn,ms){timers.set(++serial,{fn,ms});return serial;},clearTimeout:id=>timers.delete(id)};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(read("src/shared/sky-environment.js"),ctx);vm.runInContext(read("src/content/sky-renderer.js"),ctx);
  const renderer=ctx.YLG_SKY_RENDERER.create(host);
  return {renderer,ctx,document,host,html,timers,events,work,shaders,uniforms,getCanvas:()=>canvas,
    tick(){const [id,t]=timers.entries().next().value;timers.delete(id);now+=t.ms;t.fn();},lose(){events.get("webglcontextlost")?.({preventDefault(){}});}};
}
const state={scene:"night",auto:true,location:{latitude:21.0285,longitude:105.8542},weather:{kind:"cloudy",cloud:.5},moving:true};
test("one bounded canvas schedules at most 20 updates/second independently of rAF",()=>{
  const w=world();w.renderer.update(state);assert.equal(w.host.children.length,1);assert.equal(w.getCanvas().width,960);assert.equal(w.getCanvas().height,540);
  for(let i=0;i<20;i++){assert.equal(w.timers.size,1);assert.ok([...w.timers.values()][0].ms>=50);w.tick();}
  assert.equal(w.work.draws,21);assert.equal(w.work.readbacks,0);
  assert.equal(w.work.programs,1);assert.equal(w.work.buffers,1);
});
test("motion off renders once, hidden cancels work, visibility update resumes",()=>{
  const w=world();w.renderer.update(state);w.renderer.update({...state,moving:false});assert.equal(w.timers.size,0);let draws=w.work.draws;
  w.document.hidden=true;w.renderer.update(state);assert.equal(w.timers.size,0);assert.equal(w.work.draws,draws);
  w.document.hidden=false;w.renderer.update(state);assert.equal(w.timers.size,1);
});
test("manual RAIN increases cloud cover and wet shading without mutating the actual weather",()=>{
  const w=world(),weather=Object.freeze({kind:"clear",cloud:0}),dry={...state,moving:false,weather,rain:false};
  w.renderer.update(dry);const cloud=w.uniforms.get("clouds");
  assert.equal(cloud,0);assert.equal(w.uniforms.get("wet"),0);
  w.renderer.update({...dry,rain:true});
  assert.ok(w.uniforms.get("clouds")>=.95,"heavy manual rain makes a clear sky overcast");
  assert.equal(w.uniforms.get("rain"),1,"glass droplets have their own rain uniform");
  assert.equal(w.uniforms.get("wet"),1,"manual rain selects the shader's darker wet atmosphere");
  assert.deepEqual(weather,{kind:"clear",cloud:0});
  assert.equal(w.host.children.length,1,"rain atmosphere adds no renderer canvas or particles");
  assert.equal(w.timers.size,0,"paused rain atmosphere renders once without a loop");
  w.renderer.update(dry);assert.equal(w.uniforms.get("clouds"),cloud);assert.equal(w.uniforms.get("wet"),0);assert.equal(w.uniforms.get("rain"),0);
});
test("RAIN on/off/on controls glass independently of actual rain, storm or snow",()=>{
  for(const kind of ["rain","storm","snow"]){
    const w=world(),weather=Object.freeze({kind,cloud:.65}),actual={...state,moving:false,weather,rain:false};
    w.renderer.update({...actual,rain:true});assert.equal(w.uniforms.get("wet"),1);assert.equal(w.uniforms.get("rain"),1);
    assert.ok(w.uniforms.get("clouds")>=.95,"RAIN on closes the cloud ceiling");
    w.renderer.update(actual);assert.equal(w.uniforms.get("rain"),0,"RAIN off removes wet glass even during actual "+kind);
    assert.equal(w.uniforms.get("clouds"),weather.cloud,"RAIN off restores actual cloud cover");
    assert.equal(w.uniforms.get("wet"),kind==="snow"?0:1,kind);
    w.renderer.update({...actual,rain:true});assert.equal(w.uniforms.get("rain"),1);
    assert.ok(w.uniforms.get("clouds")>=.95);
    assert.deepEqual(weather,{kind,cloud:.65});
  }
});
test("actual rainy weather arriving while RAIN is off does not enable glass droplets",()=>{
  const w=world(),off={...state,moving:false,weather:null,rain:false};
  w.renderer.update(off);assert.equal(w.uniforms.get("rain"),0);
  for(const kind of ["rain","storm"]){
    const weather=Object.freeze({kind,cloud:.8});
    w.renderer.update({...off,weather});assert.equal(w.uniforms.get("rain"),0,kind);
    assert.equal(w.uniforms.get("wet"),1,"actual wet weather can retain its atmospheric shading");
    assert.equal(w.uniforms.get("clouds"),weather.cloud);assert.deepEqual(weather,{kind,cloud:.8});
  }
});
test("fog darkens atmosphere without inventing glass rain, manual RAIN can override it",()=>{
  const w=world(),weather=Object.freeze({kind:"fog",cloud:.4}),fog={...state,moving:false,weather,rain:false};
  w.renderer.update(fog);assert.equal(w.uniforms.get("wet"),1);assert.equal(w.uniforms.get("rain"),0);
  w.renderer.update({...fog,rain:true});assert.equal(w.uniforms.get("rain"),1);assert.ok(w.uniforms.get("clouds")>=.95);
  w.renderer.update(fog);assert.equal(w.uniforms.get("rain"),0);assert.equal(w.uniforms.get("clouds"),.4);assert.equal(weather.kind,"fog");
});
test("rainy glass and falling beads share the existing seconds uniform and freeze without extra timers",()=>{
  const w=world(),rain={...state,weather:null,rain:true};
  w.renderer.update(rain);w.tick();const movingSeconds=w.uniforms.get("seconds");assert.ok(movingSeconds>0);
  w.renderer.update({...rain,moving:false});assert.equal(w.uniforms.get("seconds"),movingSeconds);assert.equal(w.timers.size,0);
  w.document.hidden=true;w.renderer.update(rain);assert.equal(w.uniforms.get("seconds"),movingSeconds);assert.equal(w.timers.size,0);
  w.document.hidden=false;w.renderer.update({...rain,moving:false});assert.equal(w.uniforms.get("seconds"),movingSeconds);assert.equal(w.timers.size,0);
  w.renderer.update(rain);assert.equal(w.timers.size,1);assert.equal(w.host.children.length,1);
});
test("manual RAIN without a weather response still obeys the existing background timer and visibility gate",()=>{
  const w=world(),rain={...state,rain:true,weather:null};
  w.renderer.update(rain);assert.equal(w.uniforms.get("wet"),1);
  for(let i=0;i<5;i++){assert.equal(w.timers.size,1);assert.ok([...w.timers.values()][0].ms>=50);w.tick();}
  assert.equal(w.host.children.length,1);assert.equal(w.work.readbacks,0);
  w.document.hidden=true;const draws=w.work.draws;w.renderer.update(rain);
  assert.equal(w.timers.size,0);assert.equal(w.work.draws,draws);
  w.document.hidden=false;w.renderer.update({...rain,moving:false});assert.equal(w.timers.size,0);
});
test("lowfx resolution is bounded without GPU-vendor heuristics",()=>{
  const w=world();w.html.setAttribute("data-ylg-lowfx","true");w.renderer.update(state);
  assert.equal(w.getCanvas().width,640);assert.equal(w.getCanvas().height,360);assert.ok(w.getCanvas().width*w.getCanvas().height<=230400);
});
test("context loss exposes CSS fallback and stops the timer",()=>{
  const w=world();w.renderer.update(state);w.lose();assert.equal(w.host.hasAttribute("data-sky-renderer"),false);assert.equal(w.timers.size,0);assert.equal(w.host.children.length,0);
  const n=w.work.draws;w.renderer.update(state);assert.equal(w.work.draws,n);
});
test("unavailable WebGL or failed compile leaves the existing CSS atmosphere intact",()=>{
  for(const options of [{noGL:true},{compile:false}]){const w=world(options);assert.equal(w.renderer,null);assert.equal(w.host.children.length,0);assert.equal(w.host.hasAttribute("data-sky-renderer"),false);assert.equal(w.timers.size,0);}
});
test("teardown releases context, program, buffer, canvas and event listener; late timer cannot draw",()=>{
  const w=world();w.renderer.update(state);const late=[...w.timers.values()][0].fn;
  w.renderer.teardown();late();assert.equal(w.work.draws,1);assert.equal(w.timers.size,0);assert.equal(w.host.children.length,0);assert.equal(w.events.size,0);
  assert.equal(w.work.deletedPrograms,1);assert.equal(w.work.deletedBuffers,1);assert.equal(w.work.contextsLost,1);
});
test("shipped shader is procedural and source has no image assets, JS frame loop or readback",()=>{
  const text=read("src/content/sky-renderer.js");assert.doesNotMatch(text,/requestAnimationFrame\s*\(|readPixels\s*\(|texImage2D\s*\(|fetch\s*\(|new Image\s*\(/);
  const w=world();assert.match(w.shaders[1],/uniform float daylight/);assert.match(w.shaders[1],/fbm/);assert.match(w.shaders[1],/gl_FragColor/);
  const overcastPos=w.shaders[1].indexOf("vec3 overcast(vec2 uv)"),atmoPos=w.shaders[1].indexOf("vec3 atmosphere(vec2 uv)");
  assert.ok(overcastPos>0&&overcastPos<atmoPos,"overcast() must be declared before atmosphere() for GLSL ES 1.00");
  assert.match(w.shaders[1],/if\(wet>\.001\)\{\s*color=mix\(color,overcast\(uv\)/,"wet weather blends overcast ceiling even when manual rain glass is off");
});
console.log(count+" renderer lifecycle groups passed (WebGL API model, not a GPU/pixel test).");
