/* DevTools expression: run on a visible, settled YouTube Home/Search page.
 * Produces local scheduling/long-task measurements, not GPU presented FPS.
 * Temporarily changes only the sky's data-moving attribute and restores it.
 * No storage, network, video capture or persisted globals. */
(async function () {
  "use strict";
  var sky = document.querySelector("#ylg-daylight-background");
  if (!sky || !["/", "/results"].includes(location.pathname)) return { error:"No eligible sky background" };
  var build = document.documentElement.getAttribute("data-ylg-build"), route = location.pathname;
  var originalMoving = sky.getAttribute("data-moving");
  var trials = [], phases = ["running", "paused", "paused", "running"];
  function trial(phase) {
    return new Promise(function (resolve) {
      var intervals=[], tasks=[], previous=null, start=null, warmup=12, raf=null, timeout=null;
      var invalid=document.hidden, focusAtStart=document.hasFocus(), observer=null, finished=false;
      function visibility() { invalid=true; finish("visibility changed"); }
      function finish(reason) {
        if (finished) return; finished=true;
        if(raf!==null) cancelAnimationFrame(raf); if(timeout!==null) clearTimeout(timeout);
        document.removeEventListener("visibilitychange",visibility);
        if(observer){ tasks.push.apply(tasks,observer.takeRecords().map(function(e){return e.duration;})); observer.disconnect(); }
        var sorted=intervals.slice().sort(function(a,b){return a-b;});
        function p(q){return sorted.length?Number(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*q))].toFixed(2)):null;}
        var elapsed=intervals.reduce(function(a,b){return a+b;},0);
        var valid=!invalid && !document.hidden && route===location.pathname && sky.isConnected &&
          build===document.documentElement.getAttribute("data-ylg-build") && sky.getAttribute("data-moving")===(phase==="running"?"true":"false");
        resolve({phase:phase,valid:valid,reason:reason,focusAtStart:focusAtStart,focusAtEnd:document.hasFocus(),samples:intervals.length,
          measuredMs:Number(elapsed.toFixed(2)),rafHz:elapsed?Number((intervals.length/elapsed*1000).toFixed(2)):null,
          medianMs:p(.5),p95Ms:p(.95),p99Ms:p(.99),maxMs:p(1),
          gapsOver12_5Ms:intervals.filter(function(v){return v>12.5;}).length,
          gapsOver20Ms:intervals.filter(function(v){return v>20;}).length,
          longTaskSupported:!!observer,longTasks:tasks.length,longTaskTotalMs:Number(tasks.reduce(function(a,b){return a+b;},0).toFixed(2))});
      }
      function frame(time){
        if(document.hidden||!sky.isConnected||route!==location.pathname){invalid=true;finish("page changed");return;}
        if(warmup-->0){raf=requestAnimationFrame(frame);return;}
        if(start===null)start=time;
        if(previous!==null)intervals.push(time-previous);
        previous=time;
        if(time-start>=4000)finish("complete");else raf=requestAnimationFrame(frame);
      }
      try { if(PerformanceObserver.supportedEntryTypes.includes("longtask")){observer=new PerformanceObserver(function(list){tasks.push.apply(tasks,list.getEntries().map(function(e){return e.duration;}));});observer.observe({type:"longtask"});} } catch(_){}
      sky.setAttribute("data-moving",phase==="running"?"true":"false");
      document.addEventListener("visibilitychange",visibility);
      timeout=setTimeout(function(){invalid=true;finish("timeout");},7000);
      raf=requestAnimationFrame(frame);
    });
  }
  try {
    for(var phase of phases){var result=await trial(phase);trials.push(result);if(!result.valid)break;}
  } finally {
    if(sky.isConnected){if(originalMoving===null)sky.removeAttribute("data-moving");else sky.setAttribute("data-moving",originalMoving);}
  }
  return {build:build,route:route,at:new Date().toISOString(),method:"4s rAF samples after 12 warm-up callbacks; ABBA; temporary sky-only pause; not presented FPS/input latency",
    originalMoving:originalMoving,restoredMoving:sky.getAttribute("data-moving"),scene:sky.getAttribute("data-scene"),
    live:sky.getAttribute("data-live"),weather:sky.getAttribute("data-weather"),layers:sky.children.length,
    viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},trials:trials};
})()
