"use strict";
// Execute production renderer with an instrumented WebGL API. These tests prove
// bounded work and disposal, not shader pixels, GPU duration or visible FPS.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {makeEl}=require("./dom-fixture");
const read=f=>fs.readFileSync(path.join(__dirname,"..",f),"utf8");
let count=0;function test(name,fn){fn();count++;console.log("PASS "+name);}
function world({noGL=false,compile=true}={}){
  const host=makeEl("div"),html=makeEl("html"),body=makeEl("body");html.appendChild(body);body.appendChild(host);
  const timers=new Map(),events=new Map(),shaders=[],work={draws:0,programs:0,deletedPrograms:0,buffers:0,deletedBuffers:0,readbacks:0,contextsLost:0};
  let serial=0,now=0;
  const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,ARRAY_BUFFER:5,STATIC_DRAW:6,FLOAT:7,TRIANGLES:8,
    createShader:type=>({type}),shaderSource:(s,code)=>shaders.push(code),compileShader(){},getShaderParameter:()=>compile,deleteShader(){},
    createProgram(){work.programs++;return{};},attachShader(){},linkProgram(){},getProgramParameter:()=>true,useProgram(){},
    createBuffer(){work.buffers++;return{};},bindBuffer(){},bufferData(){},getAttribLocation:()=>0,enableVertexAttribArray(){},vertexAttribPointer(){},
    getUniformLocation:(_,name)=>name,uniform1f(){},uniform2f(){},viewport(){},drawArrays(){work.draws++;},
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
  return {renderer,ctx,document,host,html,timers,events,work,shaders,getCanvas:()=>canvas,
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
});
console.log(count+" renderer lifecycle groups passed (WebGL API model, not a GPU/pixel test).");
