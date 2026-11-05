"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname,"..");
const read = file => fs.readFileSync(path.join(root,file),"utf8");
const survey = require("../docs/uninstall/survey.js");
let passed=0;
const cases=[];
function test(name,fn){cases.push({name,fn});}
test("worker registers a fixed HTTPS uninstall page at load, install/update and startup without extra permissions",async()=>{
  const urls=[],events={},warnings=[];
  vm.runInNewContext(read("src/background/service-worker.js"),{chrome:{runtime:{setUninstallURL(url){urls.push(url);return Promise.resolve();},onInstalled:{addListener:fn=>events.install=fn},onStartup:{addListener:fn=>events.startup=fn}}},console:{warn:message=>warnings.push(message)}});
  events.install({reason:"install"});events.install({reason:"update"});events.startup();
  assert.equal(urls.length,4);assert.equal(new Set(urls).size,1);
  const url=new URL(urls[0]);assert.equal(url.protocol,"https:");assert.equal(url.search,"");assert.equal(url.hash,"");
  assert.equal(url.hostname,"moments2505.github.io");assert.equal(url.pathname,"/better-visual-youtube/uninstall/");assert.ok(url.href.length<=1023);
  const manifest=JSON.parse(read("manifest.json"));assert.equal(manifest.background.service_worker,"src/background/service-worker.js");assert.deepEqual(manifest.permissions,["storage"]);assert.equal(warnings.length,0);
});
test("worker handles API rejection without unhandled promises",async()=>{
  let warnings=0;
  vm.runInNewContext(read("src/background/service-worker.js"),{chrome:{runtime:{setUninstallURL(){return Promise.reject(new Error("unavailable"));},onInstalled:{addListener(){}},onStartup:{addListener(){}}}},console:{warn(){warnings++;}}});
  await Promise.resolve();await Promise.resolve();assert.equal(warnings,1);
});
test("feedback supports both languages, optional fields and only known reasons",()=>{
  assert.equal(survey.buildFeedback({language:"vi",reasons:[],details:"  "}),null);
  const vi=survey.buildFeedback({language:"vi",reasons:["performance","bugs","unknown","bugs"],details:"Cột đề xuất bị giật"});
  assert.ok(vi.body.includes("Bị giật, lag hoặc tốn tài nguyên"));assert.ok(vi.body.includes("Cột đề xuất bị giật"));assert.ok(!vi.body.includes("unknown"));assert.equal(vi.body.match(/Giao diện có lỗi/g).length,1);
  const en=survey.buildFeedback({language:"anything",reasons:[],details:"Please improve smoothness"});
  assert.ok(en.body.includes("Not specified"));assert.ok(en.subject.includes("uninstall feedback"));
  assert.ok(survey.buildFeedback({reasons:["other"],details:"x".repeat(3000)}).body.endsWith("x".repeat(2000)));
});
test("mailto draft encodes answers without allowing extra recipients or headers",()=>{
  const detail="<script>alert(1)</script>\n&bcc=someone@example.invalid#fragment";
  const feedback=survey.buildFeedback({language:"vi",reasons:["other"],details:detail});const url=new URL(survey.mailtoFor(feedback));
  assert.equal(url.protocol,"mailto:");assert.equal(url.pathname,"quannguyenproducer2505@gmail.com");
  assert.deepEqual([...url.searchParams.keys()],["subject","body"]);assert.ok(url.searchParams.get("body").includes(detail));assert.equal(url.hash,"");
});
function page(language="vi-VN",clipboardWorks=true){
  function node(dataset={}){return {dataset,textContent:"",value:"",hidden:true,disabled:true,attrs:{},events:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,fn){this.events[k]=fn;},focus(){this.focused=true;},select(){this.selected=true;}};}
  const html=read("docs/uninstall/index.html"),translations=[...html.matchAll(/data-i18n="([^"]+)"/g)].map(m=>node({i18n:m[1]}));
  const languages=[node({language:"en"}),node({language:"vi"})];
  const ids=Object.fromEntries(["details","privacy-link","status","email","copy","feedback-preview"].map(id=>[id,node()]));
  const checked=[];const writes=[];let navigations=0;
  const location={set href(value){navigations++;this.last=value;}};
  const document={documentElement:{},getElementById:id=>ids[id],querySelectorAll(selector){if(selector==="[data-i18n]")return translations;if(selector==="[data-language]")return languages;if(selector==='input[name="reason"]:checked')return checked;throw Error("Unexpected selector: "+selector);}};
  const navigator={language,clipboard:{async writeText(value){if(!clipboardWorks)throw Error("clipboard denied");writes.push(value);}}};
  const context={document,navigator,location,fetch(){throw Error("No network allowed");},get localStorage(){throw Error("No storage allowed");}};context.window=context;
  vm.runInNewContext(read("docs/uninstall/survey.js"),context);
  return {document,ids,languages,translations,checked,writes,location,navigations:()=>navigations};
}
test("page loads without sending answers, local storage or identifiers; translation preserves input",()=>{
  const p=page();assert.equal(p.document.documentElement.lang,"vi");assert.equal(p.navigations(),0);assert.equal(p.writes.length,0);assert.equal(p.ids.email.disabled,false);
  for(const node of p.translations){assert.equal(typeof node.textContent,"string");assert.ok(node.textContent.length>0);assert.ok(survey.TEXT.en[node.dataset.i18n]);assert.ok(survey.TEXT.vi[node.dataset.i18n]);}
  p.ids.details.value="Góp ý của tôi";p.checked.push({value:"performance"});p.languages[0].events.click();assert.equal(p.document.documentElement.lang,"en");assert.equal(p.ids.details.value,"Góp ý của tôi");assert.equal(p.checked.length,1);
  assert.equal(p.navigations(),0);assert.equal(p.writes.length,0);
});
test("email only opens on explicit choice, and empty feedback stays on the page",()=>{
  const p=page();p.ids.email.events.click();assert.equal(p.navigations(),0);assert.ok(p.ids.status.textContent.length>0);
  p.checked.push({value:"bugs"});p.ids.email.events.click();assert.equal(p.navigations(),1);assert.ok(p.location.last.startsWith("mailto:quannguyenproducer2505@gmail.com?"));assert.equal(p.writes.length,0);
});
test("copy works on explicit choice and a clipboard failure offers manual copy",async()=>{
  const p=page();p.ids.details.value="Panel bị lỗi";await p.ids.copy.events.click();assert.equal(p.writes.length,1);assert.equal(p.navigations(),0);
  const manual=page("en-US",false);manual.ids.details.value="Please improve the panels";await manual.ids.copy.events.click();
  assert.equal(manual.ids["feedback-preview"].hidden,false);assert.equal(manual.ids["feedback-preview"].focused,true);assert.equal(manual.ids["feedback-preview"].selected,true);assert.equal(manual.navigations(),0);
});
test("hosted page has a no-submit CSP and only local scripts/styles; packaged worker is validated",()=>{
  const html=read("docs/uninstall/index.html");assert.ok(html.includes("connect-src 'none'; form-action 'none'"));assert.ok(!/<form\b|<iframe\b/i.test(html));
  for(const match of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|png))"/g)){assert.ok(!match[1].includes(":"));assert.ok(fs.existsSync(path.join(root,"docs/uninstall",match[1])));}
  assert.ok(read("scripts/package-release.py").includes('required.append(manifest["background"]["service_worker"])'));
});
(async()=>{for(const {name,fn} of cases){await fn();passed++;console.log("PASS "+name);}console.log(passed+" uninstall feedback regression groups passed (API/DOM model; no real uninstall or mail delivery performed).");})().catch(error=>{console.error(error);process.exitCode=1;});
