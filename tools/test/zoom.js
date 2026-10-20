// 指での拡大縮小・移動をためす
const {chromium}=require("playwright");const fs=require("fs");const S=process.env.S;
const LIB=u=>{ if(u.includes("d3@7.9.0")) return "libs/d3-7.9.0/dist/d3.min.js";
  if(u.includes("topojson-client")) return "libs/topojson-client-3.1.0/dist/topojson-client.min.js";
  if(u.includes("countries-50m")) return "libs/world-atlas-2.0.2/countries-50m.json";
  if(u.includes("chart.js")) return "chart.umd.js"; return null; };
const R=[];const ok=(n,v,d)=>R.push([v?"OK ":"NG ",n,d||""]);
// 2本指でひろげる(CDPのtouch)
let CDP=null;
async function pinch(p,sel,from,to){
  const cdp=CDP||(CDP=await p.context().newCDPSession(p));
  const r=await p.evaluate(s=>{const e=document.querySelector(s);const b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};},sel);
  const send=(type,pts)=>cdp.send("Input.dispatchTouchEvent",{type,touchPoints:pts});
  const pt=(id,dx)=>({x:r.x+dx,y:r.y,id});
  await send("touchStart",[pt(1,-from/2),pt(2,from/2)]);
  for(let i=1;i<=6;i++){ const d=from+(to-from)*i/6; await send("touchMove",[pt(1,-d/2),pt(2,d/2)]); await p.waitForTimeout(40); }
  await send("touchEnd",[]);
}
(async()=>{
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell"});
const ctx=await b.newContext({viewport:{width:390,height:900},serviceWorkers:"block",hasTouch:true,isMobile:true});
const p=await ctx.newPage(); const errs=[];
p.on("pageerror",e=>errs.push(e.message));
p.on("console",m=>{if(m.type()==="error"){const t=m.text();if(!/Failed to load resource|net::ERR/.test(t))errs.push("console: "+t.slice(0,110));}});
await p.route(/fonts\.g|gc\.zgo|p2pquake|unsplash|open-meteo/,r=>r.abort());
await p.route(/cdn\.jsdelivr\.net\/npm\/(.*)/,r=>{const f=LIB(r.request().url());(f&&fs.existsSync(S+"/"+f))?r.fulfill({body:fs.readFileSync(S+"/"+f)}):r.abort();});
await p.route(/raw\.githubusercontent/,r=>r.fulfill({body:fs.readFileSync(S+"/alert_real.json"),contentType:"application/json"}));
await p.addInitScript(()=>{localStorage.setItem("nw-onboard","1");localStorage.setItem("nw-me",JSON.stringify({days:["2026-10-20","2026-10-21"],pet:{food:5},gv:{eco:4},pref:"東京都"}));});
await p.goto("http://localhost:8766/");await p.waitForTimeout(2300);

// --- ニュースの地図
await p.evaluate(()=>{const e=document.getElementById("tab-search");e&&e.click();});
await p.waitForTimeout(600);
await p.evaluate(()=>{const e=document.getElementById("tab-map")||document.querySelector('.jump [data-tab="map"]')||[...document.querySelectorAll("button")].find(x=>/地図/.test(x.textContent));e&&e.click();});
await p.waitForTimeout(2800);
if(!(await p.$("#map"))){ console.log("地図タブを開けなかった"); await b.close(); process.exit(1); }
const t0=await p.evaluate(()=>{const s=document.querySelector("#map svg");return s?s.style.transform:"なし";});
await pinch(p,"#map",60,240);
const t1=await p.evaluate(()=>{const s=document.querySelector("#map svg");return s?s.style.transform:"なし";});
const sc=t=>{const m=/scale\(([\d.]+)\)/.exec(t||"");return m?+m[1]:0;};
ok("世界地図: 2本指でひろげると大きくなる", sc(t1)>sc(t0)+0.2, sc(t0)+"→"+sc(t1).toFixed(2));
// 1本指で動く
await p.waitForTimeout(500);
const before=await p.evaluate(()=>document.querySelector("#map svg").style.transform);
await p.evaluate(()=>{const w=document.getElementById("map");const r=w.getBoundingClientRect();
  const mk=(t,x,y)=>w.dispatchEvent(new PointerEvent(t,{pointerId:9,clientX:x,clientY:y,bubbles:true,isPrimary:true,pointerType:"touch"}));
  mk("pointerdown",r.left+60,r.top+60); mk("pointermove",r.left+120,r.top+100); mk("pointerup",r.left+120,r.top+100);});
await p.waitForTimeout(250);
const after=await p.evaluate(()=>document.querySelector("#map svg").style.transform);
ok("世界地図: 大きいとき1本指で動かせる", before!==after, after.slice(0,42));
// ⟲ でもどる
await p.evaluate(()=>document.querySelector("[data-zre]").click()); await p.waitForTimeout(250);
ok("世界地図: ⟲で元の大きさにもどる", sc(await p.evaluate(()=>document.querySelector("#map svg").style.transform))<=1.01);
// 等倍のときページがスクロールできるか(touch-action)
ok("世界地図: 等倍ならページをスクロールできる", (await p.evaluate(()=>getComputedStyle(document.getElementById("map")).touchAction))!=="none");
// 丸をタップしたら今までどおり選べる
const pick=await p.evaluate(()=>{const n=document.querySelector("#map .pin");if(!n)return "丸なし";const b=document.getElementById("mapList").innerHTML.length;n.dispatchEvent(new MouseEvent("click",{bubbles:true}));
  return new Promise(r=>setTimeout(()=>r(document.getElementById("mapList").innerHTML.length!==b||document.querySelector("#map .pin.on")?"選べた":"選べない"),500));});
ok("世界地図: 丸をタップして選べる(今までどおり)", pick==="選べた", String(pick));

// --- 日本地図
await p.evaluate(()=>{const b=document.querySelector('[data-v="japan"]');b&&b.click();}); await p.waitForTimeout(2200);
await pinch(p,"#map",60,220);
ok("日本地図: 2本指でひろげると大きくなる", sc(await p.evaluate(()=>{const s=document.querySelector("#map svg");return s?s.style.transform:"";}))>1.2);

// --- 捜査ボード
await p.evaluate(()=>{const b=document.querySelector('[data-v="board"]');b&&b.click();}); await p.waitForTimeout(2600);
const z0=await p.evaluate(()=>{const b=document.getElementById("board");return b?b.style.transform:"なし";});
await pinch(p,"#bdWrap",60,230);
const z1=await p.evaluate(()=>{const b=document.getElementById("board");return b?b.style.transform:"なし";});
ok("捜査ボード: 2本指でひろげると大きくなる", sc(z1)>sc(z0)+0.1, sc(z0)+"→"+sc(z1).toFixed(2));
await p.evaluate(()=>{const b=[...document.querySelectorAll("#bdTools [data-z]")].find(x=>x.dataset.z==="0.75");b&&b.click();}); await p.waitForTimeout(300);
ok("捜査ボード: 小・中・大でも大きさを変えられる", Math.abs(sc(await p.evaluate(()=>document.getElementById("board").style.transform))-0.75)<0.02);
// メモを指で動かせるか(2本指と混ざらないか)
await p.evaluate(()=>{const b=document.getElementById("bdAdd");b&&b.click();}); await p.waitForTimeout(700);
const mv=await p.evaluate(()=>{const n=[...document.querySelectorAll(".bd-notes .note")].find(e=>e.onpointerdown);if(!n)return "うごかせるメモなし";const x0=n.style.left;
  const r=n.getBoundingClientRect();
  const mk=(t,x,y)=>n.dispatchEvent(new PointerEvent(t,{pointerId:3,clientX:x,clientY:y,bubbles:true,isPrimary:true,pointerType:"touch"}));
  mk("pointerdown",r.left+20,r.top+20); mk("pointermove",r.left+70,r.top+50); mk("pointermove",r.left+90,r.top+60); mk("pointerup",r.left+90,r.top+60);
  return new Promise(r2=>setTimeout(()=>r2(n.style.left!==x0?"動かせた":"動かない("+x0+")"),400));});
ok("捜査ボード: メモを指で動かせる(今までどおり)", mv==="動かせた", String(mv));

// --- 全国の天気の地図
await p.evaluate(()=>{const e=document.getElementById("tab-today");e&&e.click();}); await p.waitForTimeout(900);
await p.evaluate(()=>document.querySelector("[data-wxmap]").click()); await p.waitForTimeout(2600);
console.log("天気地図の状態:",JSON.stringify(await p.evaluate(()=>{const box=document.getElementById("wxMapBox");
 if(!box) return {box:false};
 window.__wl=[]; ["pointerdown","pointermove"].forEach(t=>box.addEventListener(t,e=>{ if(window.__wl.length<6) window.__wl.push(t+" "+e.pointerType); },true));
 const r=box.getBoundingClientRect();
 return {zc:(box.parentNode.querySelector(".zc")||{querySelectorAll:()=>[]}).querySelectorAll("button").length, zin:!!box.querySelector("svg.zin"), x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2), top:Math.round(r.top)};})));
const w0=await p.evaluate(()=>{const s=document.querySelector("#wxMapBox svg");return s?s.style.transform:"なし";});
await pinch(p,"#wxMapBox",60,220);
console.log("うけとったイベント:",(await p.evaluate(()=>window.__wl||[])).join(" | ")||"なし");
const w1=await p.evaluate(()=>{const s=document.querySelector("#wxMapBox svg");return s?s.style.transform:"なし";});
ok("全国の天気: 2本指でひろげると大きくなる", sc(w1)>sc(w0)+0.2, sc(w0)+"→"+sc(w1).toFixed(2));
await p.evaluate(()=>document.querySelectorAll(".toast").forEach(t=>t.remove()));
await p.screenshot({path:S+"/zoom_wx.png"});

console.log("");
R.forEach(x=>console.log(x[0],x[1],x[2]?("  → "+x[2]):""));
console.log("\nNG:",R.filter(x=>x[0]==="NG ").length,"/ エラー:",[...new Set(errs)].join(" | ")||"なし");
await b.close();
})();
