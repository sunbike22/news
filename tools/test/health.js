// 定期の不具合チェック: いろいろな状態でページを開き、エラー・横はみ出し・開きっぱなし・ペットの絵の崩れを見る。
// 使い方: S=<しらべもの用フォルダ> NODE_PATH=/tmp/node_modules node tools/test/health.js  → 最後に "NG: 0" なら合格
const {chromium}=require("playwright");const fs=require("fs");const S=process.env.S;
const LIB=u=>{ if(u.includes("d3@7.9.0")) return "libs/d3-7.9.0/dist/d3.min.js"; if(u.includes("topojson-client")) return "libs/topojson-client-3.1.0/dist/topojson-client.min.js";
  if(u.includes("countries-50m")) return "libs/world-atlas-2.0.2/countries-50m.json"; if(u.includes("chart.js")) return "chart.umd.js"; return null; };
const IGN=/WebSocket|proxy|net::ERR_FAILED|net::ERR_ABORTED|Failed to load resource|favicon/;
const NG=[]; const ok=(name,cond,info)=>{ if(!cond) NG.push(name+(info?" → "+info:"")); console.log((cond?"OK  ":"NG  ")+name+(info?"  → "+info:"")); };
const ME_NORMAL={days:["2026-10-19","2026-10-20","2026-10-21"],pet:{fed:3,food:2},gv:{eco:3},interests:{it:true},topics:{baseball:true,anime:true},words:["原油"],pref:"大阪府"};
const ME_MASTER={days:Array.from({length:30},(_,i)=>"2026-09-"+String(i+1).padStart(2,"0")),pet:{fed:70,food:3},readEx:{a:"2026-10-01",b:"2026-10-02",c:"2026-10-03"},words:["a"]};
(async()=>{
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell"});
async function open(opt){ const ctx=await b.newContext({viewport:{width:opt.w||390,height:844},serviceWorkers:"block",colorScheme:opt.dark?"dark":"light"}); const p=await ctx.newPage(); const errs=[];
  p.on("pageerror",e=>errs.push("JS: "+e.message)); p.on("console",m=>{ if(m.type()==="error"&&!IGN.test(m.text())) errs.push("console: "+m.text().slice(0,120)); }); p.on("dialog",d=>d.accept());
  await p.route(/fonts\.g|gc\.zgo|p2pquake|unsplash|open-meteo|jma\.go|cyberjapan|disaportal/,r=>r.abort());
  await p.route(/cdn\.jsdelivr\.net\/npm\/(.*)/,r=>{ const f=LIB(r.request().url()); (f&&fs.existsSync(S+"/"+f))?r.fulfill({body:fs.readFileSync(S+"/"+f)}):r.abort(); });
  await p.route(/raw\.githubusercontent/,r=>r.fulfill({body:fs.readFileSync(S+"/alert_real.json"),contentType:"application/json"}));
  await p.addInitScript(o=>{ if(!o.fresh){ localStorage.setItem("nw-onboard","1"); localStorage.setItem("nw-look",JSON.stringify(Object.assign({v15:1,mode:o.mode||"normal"},o.look||{}))); localStorage.setItem("nw-me",JSON.stringify(o.me||{})); } window.WebSocket=class{constructor(){} close(){}}; },opt);
  await p.goto("http://localhost:8766/"); await p.waitForTimeout(2200); return {ctx,p,errs}; }
const sw=async p=>p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1);

// 1. はじめての人(案内を通る)
{ const {ctx,p,errs}=await open({fresh:true}); let steps=0; for(let i=0;i<8;i++){ const nx=await p.$(".ob #obNext"); if(!nx) break; await nx.click(); steps++; await p.waitForTimeout(250); }
  ok("はじめての案内を最後まで進める", steps>=3&&!(await p.$(".ob")), "step "+steps);
  ok("はじめての人は かんたん", (await p.evaluate(()=>document.documentElement.dataset.mode))==="easy");
  ok("はじめての人: 開きっぱなしなし", (await p.evaluate(()=>document.querySelectorAll("details[open]").length))===0);
  ok("はじめての人: エラーなし", !errs.length, errs.slice(0,2).join(" | ")); await ctx.close(); }

// 2. ふつう・かんたん × 明暗 × 幅 で全タブ+主な画面
for(const [mode,dark,w] of [["normal",false,390],["normal",true,390],["easy",false,390],["normal",false,1280]]){
  const {ctx,p,errs}=await open({mode,dark,w,me:ME_NORMAL}); let wide=true, openCnt=0;
  for(const t of ["today","explain","search","plan","my"]){ await p.evaluate(t=>{const e=document.getElementById("tab-"+t);e&&e.click();},t); await p.waitForTimeout(500); if(!(await sw(p))) wide=false; openCnt+=await p.evaluate(()=>document.querySelectorAll("details[open]").length); }
  // 画面をいくつか開く
  const opens=[["おたのしみ→おすすめ",()=>p.evaluate(()=>{document.getElementById("tab-today").click();const f=document.querySelector('[data-fun="picks"]');f&&f.click();})],
    ["防災",()=>p.evaluate(()=>{const f=document.querySelector(".qk-open");f&&f.click();})],["雨雲",()=>p.evaluate(()=>{const f=document.querySelector("[data-radar]");f&&f.click();})],
    ["好きなこと",()=>p.evaluate(()=>{const f=document.querySelector("[data-topics]");f&&f.click();})],["送る",()=>p.evaluate(()=>{document.getElementById("tab-today").click();const f=document.querySelector("[data-share]");f&&f.click();})],
    ["解説",()=>p.evaluate(()=>{document.getElementById("tab-explain").click();const f=document.querySelector("[data-ex]");f&&f.click();})]];
  for(const [n,f] of opens){ await f(); await p.waitForTimeout(700); if(!(await sw(p))) wide=false; await p.evaluate(()=>{ const sh=document.getElementById("sheet"); if(sh&&!sh.hidden){ const x=sh.querySelector(".bar .iconbtn"); x&&x.click(); } const ov=document.getElementById("shareOv"); if(ov){ const x=ov.querySelector("[data-shx],.sh-x,button"); x&&x.click(); } }); await p.waitForTimeout(200); }
  // さがす:「もっと見る」を最後まで押しても横にずれない(長い札で画面が横に動いた=2026-10-28)
  await p.evaluate(()=>{const e=document.getElementById("tab-search");e&&e.click();}); await p.waitForTimeout(400);
  for(let i=0;i<60;i++){ const more=await p.evaluate(()=>{const b=[...document.querySelectorAll("button")].find(x=>/もっと見る/.test(x.textContent)&&x.offsetParent&&x.closest(".view"));if(!b)return false;b.click();return true;}); if(!more) break; await p.waitForTimeout(120); }
  if(!(await sw(p))) { wide=false; console.log("   (さがすの もっと見る で横にはみ出し)"); }
  const tag=`${mode}/${dark?"暗":"明"}/${w}`;
  ok(tag+": 横にはみ出さない", wide); ok(tag+": 開いたとき開きっぱなしなし", openCnt===0, "open="+openCnt); ok(tag+": エラーなし", !errs.length, errs.slice(0,2).join(" | "));
  await ctx.close(); }

// 3. ペット: 種類×段階×気分×服 の絵がこわれていない。名人→新しいたまご
{ const {ctx,p,errs}=await open({me:ME_MASTER});
  const r=await p.evaluate(()=>{ const T=window.NW_TEST; if(!T) return {noHook:true}; const bad=[]; const chk=(svg,n)=>{ const d=new DOMParser().parseFromString(svg,"image/svg+xml"); if(d.querySelector("parsererror")||!svg.includes("<svg")) bad.push(n); };
    for(const k of Object.keys(T.PET_KINDS)) for(let st=0;st<=5;st++) for(const m of ["happy","hungry","sulk"]) chk(T.petSVG(st,m,st>=3?"glasses":null,60,null,k),k+st+m);
    for(const w of T.WEAR) for(const k of Object.keys(T.PET_KINDS)) chk(T.petSVG(3,"happy",null,60,w[0],k),"wear:"+w[0]+k);
    return {bad,kinds:Object.keys(T.PET_KINDS).length,wear:T.WEAR.length,stage:T.petStage().name}; });
  ok("ペット: テスト用の手がかりがある", !r.noHook); if(!r.noHook){ ok("ペット: 絵がこわれていない(種類×段階×気分×服)", !r.bad.length, (r.bad||[]).slice(0,3).join(",")); ok("ペット: 7種類・服19以上", r.kinds>=7&&r.wear>=19, r.kinds+"/"+r.wear); ok("ペット: 名人になれる", r.stage==="ニュース名人", r.stage); }
  await p.evaluate(()=>document.getElementById("tab-my").click()); await p.waitForTimeout(600);
  const hasBtn=await p.$("#petRestart"); ok("名人: 「新しいたまご」のボタンが出る", !!hasBtn);
  if(hasBtn){ await hasBtn.click(); await p.waitForTimeout(700); const a=await p.evaluate(()=>{const T=window.NW_TEST;return {st:T.petStage().i,hall:T.petHall().length,gen:T.ME.pet.gen};}); ok("名人: 新しいたまごになり、前の子は殿堂へ", a.st===0&&a.hall===1&&a.gen===2, JSON.stringify(a)); }
  ok("ペット画面: エラーなし", !errs.length, errs.slice(0,2).join(" | ")); await ctx.close(); }

// 4. データの形
{ const {ctx,p,errs}=await open({me:ME_NORMAL});
  const d=await p.evaluate(()=>{ const D=window.NEWS_DATA, P=window.NEWS_PICKS; return {top10:(D.top10||[]).length,three:(D.three||[]).length,news:(D.news||[]).length,en:D.en?[D.en.top10.length,D.en.three.length]:null,picks:!!(P&&P.g),upd:D.updated}; });
  ok("データ: ニュース10が10件・3行が3つ", d.top10===10&&d.three===3, JSON.stringify([d.top10,d.three])); ok("データ: 英語版の数がそろっている", !d.en||(d.en[0]===d.top10&&d.en[1]===d.three), JSON.stringify(d.en));
  ok("データ: おすすめが読める", d.picks); ok("データ: 更新が3日以内", d.upd&&(Date.now()-Date.parse(d.upd))<3*864e5, d.upd); await ctx.close(); }
await b.close();
console.log("\nNG: "+NG.length+(NG.length?"\n  - "+NG.join("\n  - "):""));
process.exit(NG.length?1:0);
})();
