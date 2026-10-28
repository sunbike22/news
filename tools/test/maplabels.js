// 地図の県名・国名が、その県・国の上に出ているかを確かめる(2026-10-28)
// 名前の位置の真下にある県・国の形(<path> の <title>)と、名前の文字がちがえば NG。画面の外・かくれた名前は数えない。
// 使い方: S=<作業フォルダ> NODE_PATH=... node tools/test/maplabels.js  (localhost:8766 でアプリを出しておく)
const {chromium}=require("playwright");const fs=require("fs");const S=process.env.S;
const LIB=u=>{ if(u.includes("d3@7.9.0")) return "libs/d3-7.9.0/dist/d3.min.js";
  if(u.includes("topojson-client")) return "libs/topojson-client-3.1.0/dist/topojson-client.min.js";
  if(u.includes("countries-50m")) return "libs/world-atlas-2.0.2/countries-50m.json"; return null; };
(async()=>{
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell"});
const ctx=await b.newContext({viewport:{width:390,height:900},serviceWorkers:"block"});
const p=await ctx.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(e.message));
await p.route(/fonts\.g|gc\.zgo|p2pquake|unsplash|open-meteo|raw\.githubusercontent/,r=>r.abort());
await p.route(/cdn\.jsdelivr\.net\/npm\/(.*)/,r=>{const f=LIB(r.request().url());(f&&fs.existsSync(S+"/"+f))?r.fulfill({body:fs.readFileSync(S+"/"+f)}):r.abort();});
await p.addInitScript(()=>{localStorage.setItem("nw-onboard","1");localStorage.setItem("nw-me",JSON.stringify({onb:1,obDone:1}));localStorage.setItem("nw-look",JSON.stringify({mode:"normal",v21:1}));});
await p.goto("http://localhost:8766/");await p.waitForTimeout(1200);
await p.evaluate(()=>NW_TEST.go("map"));await p.waitForTimeout(2500);
const check=()=>p.evaluate(()=>{ const svg=document.querySelector("#map svg"); const r=svg.getBoundingClientRect(); const vb=svg.viewBox.baseVal; const k=r.width/vb.width; const bad=[]; let n=0;
  svg.querySelectorAll(".pref-l text:not(.hid)").forEach(t=>{ const m=/translate\(([-\d.]+),([-\d.]+)\)/.exec(t.getAttribute("transform")); const x=r.left+(+m[1]-vb.x)*k, y=r.top+(+m[2]-vb.y)*k;
    if(x<r.left+2||x>r.right-2||y<r.top+2||y>r.bottom-2) return; n++;
    const el=document.elementsFromPoint(x,y).find(e=>e.tagName==="path"&&e.querySelector("title")); const nm=el?el.querySelector("title").textContent:"(海)";
    if(nm.replace(/[都府県]$/,"")!==t.textContent&&nm!==t.textContent) bad.push(t.textContent+" → "+nm); });
  return {n,bad}; });
const R=[]; const run=async(lbl)=>{ await p.waitForTimeout(500); const c=await check(); R.push([c.bad.length?"NG ":"OK ",lbl,c.n+"こ"+(c.bad.length?" ちがう: "+c.bad.join("・"):"")]); };
const rg=async nm=>{ await p.evaluate(nm=>{const b=[...document.querySelectorAll("[data-rg]")].find(x=>x.textContent===nm);b&&b.click();},nm); await p.waitForTimeout(700); };
await run("日本(全体)"); for(const nm of ["北海道","東北","関東","中部","近畿","中国・四国","九州","沖縄"]){ await rg(nm); await run("日本 "+nm); }
await p.evaluate(()=>document.querySelector('[data-v="world"]').click()); await p.waitForTimeout(2500);
await run("世界(全体)"); for(const nm of ["東アジア","東南アジア","南アジア","中東","ヨーロッパ","アフリカ","北アメリカ","中南米","オセアニア"]){ await rg(nm); await run("世界 "+nm); }
R.forEach(x=>console.log(x[0],x[1],"  → "+x[2]));
console.log("\nNG:",R.filter(x=>x[0]==="NG ").length,errs.length?"/ エラー: "+errs.join(" | "):"");
await b.close();})();
