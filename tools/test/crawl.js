// 2回目: DOMを壊さずに(閉じるボタンだけで閉じて)クリックし、エラーは stack ごと記録する
const {chromium}=require("playwright");const fs=require("fs");const S=process.env.S;
const LIB=u=>{ if(u.includes("d3@7.9.0")) return "libs/d3-7.9.0/dist/d3.min.js";
  if(u.includes("topojson-client")) return "libs/topojson-client-3.1.0/dist/topojson-client.min.js";
  if(u.includes("countries-50m")) return "libs/world-atlas-2.0.2/countries-50m.json";
  if(u.includes("chart.js")) return "chart.umd.js"; return null; };
(async()=>{
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell"});
const ctx=await b.newContext({viewport:{width:390,height:900},serviceWorkers:"block"});
const p=await ctx.newPage(); const errs=[];
p.on("pageerror",e=>errs.push({m:e.message,s:(e.stack||"").split("\n").slice(1,3).join(" ").replace(/https?:\/\/[^\/]+\//g,"")}));
p.on("console",m=>{ if(m.type()==="error"){ const t=m.text(); if(!/Failed to load resource|net::ERR/.test(t)) errs.push({m:"console: "+t.slice(0,140),s:""}); } });
p.on("dialog",d=>{ errs.push({m:"DIALOG "+d.type()+": "+d.message().slice(0,50),s:""}); d.dismiss().catch(()=>{}); });
await p.route(/fonts\.g|gc\.zgo|p2pquake|unsplash|open-meteo|googleapis|accounts\.google/,r=>r.abort());
await p.route(/cdn\.jsdelivr\.net\/npm\/(.*)/,r=>{ const f=LIB(r.request().url());
  (f&&fs.existsSync(S+"/"+f))?r.fulfill({body:fs.readFileSync(S+"/"+f)}):r.abort(); });
await p.route(/raw\.githubusercontent/,r=>r.fulfill({body:fs.readFileSync(S+"/alert_real.json"),contentType:"application/json"}));
await p.addInitScript(()=>{ localStorage.setItem("nw-onboard","1");
  localStorage.setItem("nw-me",JSON.stringify({days:["2026-10-19","2026-10-20","2026-10-21"],words:["消費税","法案","原油","衛星"],
   readEx:{tax:"2026-10-20T00:00:00Z"},pet:{food:12,fed:9},gv:{eco:6,it:4,spo:3},kw:["台風"],pref:"東京都"})); });
const go=t=>p.evaluate(t=>{const e=document.getElementById("tab-"+t)||document.querySelector(`.jump [data-tab="${t}"]`);e&&e.click();},t);
// 本物の「閉じる」だけで閉じる(innerHTMLは壊さない)
const close=async()=>{ for(let i=0;i<4;i++){
   const did=await p.evaluate(()=>{ const sh=document.getElementById("sheet"); const st=document.getElementById("story");
     if(st&&!st.hidden){ const x=[...st.querySelectorAll("button")].find(b=>/もどる|閉じる|×|✕/.test(b.textContent)||b.getAttribute("aria-label")==="閉じる"); if(x){x.click();return true;} st.hidden=true; return true; }
     if(sh&&!sh.hidden){ const x=sh.querySelector(".bar button"); if(x){x.click();return true;} return false; }
     return false; });
   if(!did) break; await p.waitForTimeout(260); }
  await p.evaluate(()=>{ document.querySelectorAll(".toast").forEach(e=>e.remove()); try{speechSynthesis.cancel();}catch(_){} }); };

await p.goto("http://localhost:8766/");await p.waitForTimeout(2300);
const hits=[];
for(const t of ["today","explain","search","plan","my","map","numbers","words"]){
  await close(); await go(t); await p.waitForTimeout(700);
  const n=await p.evaluate(()=>{ window.__q=[...document.querySelectorAll("main button, main [role=button], main summary")].filter(e=>e.offsetParent!==null); return window.__q.length; });
  for(let i=0;i<n;i++){
    const info=await p.evaluate(i=>{ const e=window.__q[i]; if(!e||!e.isConnected) return null;
      return {t:(e.textContent||e.getAttribute("aria-label")||"").trim().replace(/\s+/g," ").slice(0,22)}; },i);
    if(!info) continue;
    const n0=errs.length;
    await p.evaluate(i=>{ const e=window.__q[i]; if(e&&e.isConnected) e.click(); },i).catch(()=>{});
    await p.waitForTimeout(400);
    if(errs.length>n0) hits.push([t,info.t,errs.slice(n0).map(x=>x.m+(x.s?"  @"+x.s:"")).join(" ‖ ")]);
    await close(); await go(t); await p.waitForTimeout(300);
    await p.evaluate(()=>{ window.__q=[...document.querySelectorAll("main button, main [role=button], main summary")].filter(e=>e.offsetParent!==null); });
  }
}
console.log("=== エラーが出た操作 ===");
if(!hits.length) console.log("  なし");
hits.forEach(x=>console.log("  ["+x[0]+"] "+x[1]+"\n      "+x[2]));
console.log("\n=== 出たエラーの種類 ===");
[...new Map(errs.map(e=>[e.m,e])).values()].forEach(e=>console.log("  "+e.m+(e.s?"\n      @"+e.s:"")));
await b.close();
})();
