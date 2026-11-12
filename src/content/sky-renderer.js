/* Continuous procedural atmosphere. Original bounded WebGL shader: one canvas,
 * no image downloads, framebuffer readback, ray marching or per-star nodes.
 * Own timer caps background updates; never ties work to the UI's 120Hz loop. */
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var vertex = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  var fragment = `
precision highp float;
uniform vec2 size;
uniform vec2 sun;
uniform float daylight, warmth, night, clouds, seconds, wet, rain;
float hash(vec2 p){vec2 v=mod(p,1024.);return fract(sin(v.x*12.9898+v.y*78.233)*4375.85453);}
float valueNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float n=0.,a=.5;for(int i=0;i<5;i++){n+=valueNoise(p)*a;p=mat2(1.6,-1.2,1.2,1.6)*p+7.3;a*=.5;}return n;}
vec3 overcast(vec2 uv){
 // Thick cloud fills the whole window. No blue gaps, sun disc or stars.
 vec2 q=vec2(uv.x*size.x/size.y,uv.y);
 vec2 wind=vec2(seconds*.0018,seconds*.0004);
 float bank=fbm(q*2.5+wind),detail=fbm(q*7.1+wind*1.4+11.);
 float cover=clamp(bank*.8+detail*.2,0.,1.);
 float light=.48+.52*daylight;
 vec3 top=vec3(.037,.052,.067),bottom=vec3(.115,.137,.151);
 vec3 color=mix(bottom,top,smoothstep(-.2,1.1,uv.y));
 color+=(cover-.48)*vec3(.13,.15,.17);
 color+=vec3(.028,.030,.031)*exp(-pow((uv.y-.19)*2.7,2.));
 return max(vec3(.008),color*light);
}
vec3 atmosphere(vec2 uv){
 float aspect=size.x/size.y;
 vec2 q=vec2(uv.x*aspect,uv.y);
 vec3 zenith=mix(vec3(.009,.018,.047),vec3(.09,.36,.67),daylight);
 vec3 horizon=mix(vec3(.025,.055,.10),vec3(.64,.79,.88),daylight);
 horizon=mix(horizon,vec3(.96,.34,.13),warmth*.82);
 vec3 color=mix(horizon,zenith,pow(uv.y,.65));
 float d=length((uv-sun)*vec2(aspect,1.));
 float sunVis=daylight*(1.-wet*.92)*(1.-clouds*.75);
 color+=vec3(1.,.64,.25)*exp(-d*4.)*warmth*.42*(1.-wet*.85);
 color+=vec3(1.,.87,.56)*(.006/(d*d+.012))*sunVis*.18;
 color+=vec3(1.,.93,.76)*(1.-smoothstep(.010,.014,d))*sunVis;
 if(night>.001){
 float starVis=night*(1.-wet*.90)*(1.-clouds*.80);
 // Irregular star cells and a dusty, textured galactic band: no tiled dot art.
 vec2 starUV=uv*vec2(560.*aspect,560.);vec2 cell=floor(starUV),f=fract(starUV)-.5;
 float star=pow(max(0.,1.-length(f)*2.5),7.)*step(.995,hash(cell));
 float star2=pow(max(0.,1.-length(fract(starUV*.47)-.5)*2.8),11.)*step(.997,hash(floor(starUV*.47)+18.));
 float axis=uv.y-.17-.43*uv.x+sin(seconds*.002)*.008;
 float band=exp(-axis*axis/0.018),dust=fbm(q*10.+vec2(7.+seconds*.00001,2.));
 float galaxy=band*(.12+fbm(q*5.)*.45)*smoothstep(.24,.66,dust);
 color+=starVis*(vec3(.17,.25,.44)*galaxy+vec3(.62,.75,.95)*star*(.9+.1*sin(seconds*.3+hash(cell)*6.28))+vec3(.95,.84,.77)*star2);
 vec2 moon=vec2(.055,.34);float md=length((uv-moon)*vec2(aspect,1.));
 float disc=1.-smoothstep(.019,.0205,md);
 float crater=fbm((uv-moon)*380.);
 color+=starVis*(vec3(.74,.81,.88)*disc*(.65+.35*crater)+vec3(.20,.30,.49)*exp(-md*22.)*.14);
 }
 // Perspective-shaped layers, slow advection, fine detail and self-shading.
 vec2 wind=vec2(seconds*.0013,seconds*.00023);
 vec2 cp=vec2(q.x*3.5,(uv.y-.14)*5.)+wind;
 float base=fbm(cp),detail=fbm(cp*2.7+13.);
 float density=smoothstep(.72-clouds*.48,.94-clouds*.38,base*.8+detail*.2);
 density*=smoothstep(.02,.18,uv.y)*(1.-smoothstep(.72,1.,uv.y)*.65);
 float shade=clamp(.5+(fbm(cp+vec2(.06,.09))-base)*4.,.1,1.);
 vec3 cloud=mix(vec3(.025,.04,.075),mix(vec3(.30,.41,.53),vec3(.95,.96,.97),shade),daylight);
 cloud=mix(cloud,vec3(.83,.44,.27),warmth*shade*.65);
 cloud*=1.-wet*.36;
 color=mix(color,cloud,density*.94);
 if(wet>.001){
   color=mix(color,overcast(uv),wet*clamp(clouds*.55+.42,.55,.94));
 }
 return color;
}
// Return refraction normal, coverage and a directional rim. Cell centres and
// radii are irregular; small beads cling while larger drops creep down glass.
vec4 clingingDrops(vec2 q){
 vec2 p=q*34.,id=floor(p),f=fract(p)-.5;
 float seed=hash(id+7.1),radius=.055+.19*pow(hash(id+2.9),2.);
 vec2 centre=(vec2(hash(id+4.3),hash(id+8.7))-.5)*.48;
 vec2 v=f-centre;v.x+=sin(v.y*17.+seed*21.)*.013;
 vec2 lens=v/vec2(radius,radius*(.92+seed*.55));
 float d=length(lens),mask=(1.-smoothstep(.83,1.04,d))*step(.20,seed);
 vec2 normal=lens*mask;
 float rim=smoothstep(.50,.95,d)*mask;
 float glint=pow(max(0.,dot(normalize(lens+vec2(.0001)),normalize(vec2(-.5,.8)))),5.);
 return vec4(normal,mask,rim*(.12+glint*.88));
}
vec4 slidingDrops(vec2 q){
 vec2 p=vec2(q.x*11.,q.y*5.5+seconds*.25),id=floor(p),f=fract(p)-.5;
 float seed=hash(id+19.);
 float x=(hash(id+4.)-.5)*.56+sin(f.y*4.+seed*17.)*.025;
 float y=(hash(id+5.)-.5)*.28;
 vec2 v=f-vec2(x,y);
 float radius=.065+.10*hash(id+6.);
 vec2 lens=v/vec2(radius,radius*(1.25+seed));
 lens.x*=1.+max(0.,lens.y)*.17;
 float d=length(lens),bead=1.-smoothstep(.80,1.03,d);
 float tailWidth=radius*.15*(1.-smoothstep(.0,.65,v.y));
 float trail=(1.-smoothstep(tailWidth,tailWidth+.012,abs(v.x+sin(v.y*13.+seed*10.)*.008)))*smoothstep(.0,.10,v.y);
 float present=step(.38,seed),mask=max(bead,trail*.42)*present;
 vec2 normal=(lens*bead+vec2(sign(v.x)*trail*.25,0.))*present;
 float rim=smoothstep(.50,.96,d)*bead*present;
 float glint=pow(max(0.,dot(normalize(lens+vec2(.0001)),normalize(vec2(-.5,.8)))),4.);
 return vec4(normal,mask,rim*(.10+glint*.90)+trail*.065*present);
}
vec4 rivulets(vec2 q){
 // Sparse winding channels connect beads, with a sliding front and wet trail.
 float column=floor(q.x*15.),seed=hash(vec2(column,31.));
 float flow=fract(q.y*(1.2+seed)+seconds*(.045+seed*.025)+seed*11.);
 float path=.18+.64*hash(vec2(column,37.));
 path+=sin(q.y*8.+seed*15.)*.025+sin(q.y*19.+seed*7.)*.012;
 float x=fract(q.x*15.)-path,width=.018+seed*.018;
 float trail=(1.-smoothstep(width,width+.018,abs(x)))*smoothstep(.01,.12,flow)*(1.-smoothstep(.55,.92,flow));
 vec2 lens=vec2(x/(width*2.8),(flow-.08)/(.013+seed*.011));
 float d=length(lens),bead=1.-smoothstep(.78,1.04,d),present=step(.72,seed);
 float mask=max(bead,trail*.34)*present;
 vec2 normal=(lens*bead+vec2(sign(x)*trail*.28,0.))*present;
 float rim=(smoothstep(.55,.96,d)*bead*.55+trail*.05)*present;
 return vec4(normal,mask,rim);
}
void main(){
 vec2 uv=gl_FragCoord.xy/size;
 vec3 color;
 if(rain>.5){
   vec2 q=vec2(uv.x*size.x/size.y,uv.y);
   vec4 fine=clingingDrops(q),slide=slidingDrops(q),streams=rivulets(q);
   float mask=clamp(max(fine.z,max(slide.z,streams.z)),0.,1.);
   vec2 normal=fine.xy*.30+slide.xy*.75+streams.xy*.8;
   color=overcast(uv);
   if(mask>.002){
     // Refract the procedural sky itself, never the page, video or a texture.
     vec3 through=overcast(uv+normal*vec2(.021,.035));
     color=mix(color,through*.87,mask*.76);
     color+=vec3(.50,.60,.67)*(fine.w*.28+slide.w*.40+streams.w*.25);
     color-=vec3(.016,.021,.025)*mask*max(0.,normal.y);
   }
 }else color=atmosphere(uv);
 color+=vec3((hash(gl_FragCoord.xy)-.5)/255.);
 gl_FragColor=vec4(max(color,vec3(0.)),1.);
}`;
  function create(host) {
    var canvas = document.createElement("canvas"), gl, program, buffer, locations={}, timer=null;
    var state=null, stopped=false, failed=false, draws=0, lastCost=0, lastAt=0, adaptive=false;
    var cloudValue=null, lastCloudTime=null;
    canvas.className="ylg-sky-canvas";canvas.setAttribute("aria-hidden","true");
    function cancel(){if(timer!==null)root.clearTimeout(timer);timer=null;}
    function shader(type,code){var s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){gl.deleteShader(s);throw Error("Sky shader compile failed");}return s;}
    function cleanupGL(){if(!gl)return;if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);buffer=null;program=null;}
    function fallback(){cancel();failed=true;host.removeAttribute("data-sky-renderer");cleanupGL();if(canvas.parentNode)canvas.parentNode.removeChild(canvas);}
    function resize(){
      var small=document.documentElement.getAttribute("data-ylg-lowfx")==="true"||adaptive;
      var w=Math.max(1,root.innerWidth||960),h=Math.max(1,root.innerHeight||540);
      var scale=Math.min(1,(small?640:960)/w,(small?360:540)/h);
      var width=Math.max(1,Math.round(w*scale)),height=Math.max(1,Math.round(h*scale));
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;gl.viewport(0,0,width,height);}
    }
    function parameters(){
      var manual={morning:{elevation:4,hourAngle:-80},day:{elevation:60,hourAngle:0},sunset:{elevation:2,hourAngle:80},night:{elevation:-30,hourAngle:140}};
      var solar=state.auto&&root.YLG_SKY_ENV&&state.location?root.YLG_SKY_ENV.solarAt(new Date(),state.location):null;
      solar=solar||manual[state.scene]||manual.night;
      var e=solar.elevation,day=Math.max(0,Math.min(1,(e+6)/18));
      var weather=state.weather,raining=state.rain===true;
      return {day:day,warm:Math.max(0,1-Math.abs(e-1)/13),night:1-Math.max(0,Math.min(1,(e+12)/12)),
        x:Math.max(.05,Math.min(.95,.5+solar.hourAngle/180*.7)),y:1-Math.max(.1,Math.min(.85,.82-Math.max(0,e)/90*.72)),
        cloud:raining?Math.max(.96,weather?weather.cloud:0):(weather?weather.cloud:.24),rain:raining?1:0,
        wet:raining||(weather&&["rain","storm","fog"].indexOf(weather.kind)>=0)?1:0};
    }
    function draw(){
      cancel();if(stopped||failed||!state||document.hidden||!host.isConnected)return;
      var start=root.performance.now();
      try {
        resize();var p=parameters();gl.useProgram(program);
        var now=root.performance.now();
        if(cloudValue===null||!state.moving)cloudValue=p.cloud;
        else cloudValue+=(p.cloud-cloudValue)*(1-Math.exp(-Math.max(0,now-lastCloudTime)/15000));
        lastCloudTime=now;
        gl.uniform2f(locations.size,canvas.width,canvas.height);gl.uniform2f(locations.sun,p.x,p.y);
        gl.uniform1f(locations.daylight,p.day);gl.uniform1f(locations.warmth,p.warm);gl.uniform1f(locations.night,p.night);
        gl.uniform1f(locations.clouds,cloudValue);gl.uniform1f(locations.wet,p.wet);gl.uniform1f(locations.rain,p.rain);
        var time=state.moving?root.performance.now()/1000:lastAt;
        gl.uniform1f(locations.seconds,time);lastAt=time;
        gl.drawArrays(gl.TRIANGLES,0,3);draws++;lastCost=root.performance.now()-start;
        // Submission time is only a CPU proxy, not a GPU timing measurement.
        if(draws>3 && lastCost>6)adaptive=true;
        if(state.moving)timer=root.setTimeout(draw,adaptive?100:50);
      } catch(_){fallback();}
    }
    function lost(event){event.preventDefault();fallback();}
    try {
      gl=canvas.getContext("webgl",{alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false,powerPreference:"low-power"});
      if(!gl)return null;
      program=gl.createProgram();var vs=shader(gl.VERTEX_SHADER,vertex),fs=shader(gl.FRAGMENT_SHADER,fragment);
      gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error("Sky shader link failed");
      gl.useProgram(program);buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
      var index=gl.getAttribLocation(program,"p");gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,2,gl.FLOAT,false,0,0);
      ["size","sun","daylight","warmth","night","clouds","seconds","wet","rain"].forEach(function(name){locations[name]=gl.getUniformLocation(program,name);});
      canvas.addEventListener("webglcontextlost",lost);
      host.appendChild(canvas);host.setAttribute("data-sky-renderer","webgl");
    }catch(_){fallback();return null;}
    return {
      update:function(next){state=next;draw();},
      resize:function(){if(!state||document.hidden)return;cancel();timer=root.setTimeout(draw,100);},
      teardown:function(){if(stopped)return;stopped=true;cancel();canvas.removeEventListener("webglcontextlost",lost);cleanupGL();
        if(gl){var lose=gl.getExtension("WEBGL_lose_context");if(lose)lose.loseContext();}host.removeAttribute("data-sky-renderer");if(canvas.parentNode)canvas.parentNode.removeChild(canvas);},
      stats:function(){return {active:!failed&&!stopped,width:canvas.width,height:canvas.height,draws:draws,timerActive:timer!==null,fpsCap:adaptive?10:20,lastSubmitMs:lastCost};}
    };
  }
  root.YLG_SKY_RENDERER={create:create};
})();
