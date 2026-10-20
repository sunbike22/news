// 入力・切りかえ・保存など「押すだけでは出ない」動きを試す
const {chromium}=require("playwright");const fs=require("fs");const S=process.env.S;
const LIB=u=>{ if(u.includes("d3@7.9.0")) return "libs/d3-7.9.0/dist/d3.min.js";
  if(u.includes("topojson-client")) return "libs/topojson-client-3.1.0/dist/topojson-client.min.js";
  if(u.includes("countries-50m")) return "libs/world-atlas-2.0.2/countries-50m.json";
  if(u.includes("chart.js")) return "chart.umd.js"; return null; };
const R=[]; const ok=(n,v,d)=>R.push([v?"OK ":"NG ",n,d||""]);

async function mk(b,url,me){
  const ctx=await b.newContext({viewport:{width:390,height:900},serviceWorkers:"block"});
  const p=await ctx.newPage(); const errs=[];
  p.on("pageerror",e=>errs.push(e.message));
  p.on("dialog",d=>{errs.push("DIALOG "+d.message().slice(0,50));d.dismiss().catch(()=>{});});
  await p.route(/fonts\.g|gc\.zgo|p2pquake|unsplash|open-meteo|googleapis|accounts\.google/,r=>r.abort());
  await p.route(/cdn\.jsdelivr\.net\/npm\/(.*)/,r=>{ const f=LIB(r.request().url());
    (f&&fs.existsSync(S+"/"+f))?r.fulfill({body:fs.readFileSync(S+"/"+f)}):r.abort(); });
  await p.route(/raw\.githubusercontent/,r=>r.fulfill({body:fs.readFileSync(S+"/alert_real.json"),contentType:"application/json"}));
  await p.addInitScript(m=>{ localStorage.setItem("nw-onboard","1"); if(m) localStorage.setItem("nw-me",m); },me||"");
  await p.goto(url||"http://localhost:8766/");await p.waitForTimeout(2300);
  return {p,ctx,errs};
}
const go=(p,t)=>p.evaluate(t=>{const e=document.getElementById("tab-"+t)||document.querySelector(`.jump [data-tab="${t}"]`);e&&e.click();},t);
const shut=p=>p.evaluate(()=>{["sheet","story"].forEach(id=>{const e=document.getElementById(id);if(e){e.hidden=true;e.innerHTML="";}});document.querySelectorAll(".toast").forEach(e=>e.remove());});

(async()=>{
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell"});
const ME=JSON.stringify({days:["2026-10-19","2026-10-20","2026-10-21"],words:["消費税","法案","原油","衛星"],
  readEx:{tax:"2026-10-20T00:00:00Z"},pet:{food:12,fed:9},gv:{eco:6,it:4,spo:3},kw:["台風"],pref:"東京都"});
let {p,ctx,errs}=await mk(b,null,ME);

// 1 さがすの入力
await go(p,"search"); await p.waitForTimeout(600);
const inp=await p.$("#view input[type=search], #view input[type=text], main input");
if(inp){ await inp.fill("原油"); await p.waitForTimeout(700);
  ok("さがす: ことばを打つと結果が出る", await p.evaluate(()=>/原油/.test(document.querySelector("main").textContent)&&document.querySelectorAll("main li,main .srow,main .card").length>0));
  await inp.fill("ぜったいにないことば"); await p.waitForTimeout(700);
  ok("さがす: 見つからないときの案内", await p.evaluate(()=>/見つか|ありません|0件|ヒット/.test(document.querySelector("main").textContent)));
  await inp.fill(""); await p.waitForTimeout(400);
} else ok("さがす: 入力欄がある", false);

// 2 ニュース10の 短く/くわしく を往復
await go(p,"today"); await p.waitForTimeout(700);
const seg=async()=>p.evaluate(()=>({short:!!document.querySelector("ol.ten.short"),press:[...document.querySelectorAll("[data-len]")].map(x=>x.dataset.len+":"+x.getAttribute("aria-pressed")).join(",")}));
const s0=await seg(); await p.evaluate(()=>document.querySelector('[data-len="full"]').click()); await p.waitForTimeout(400);
const s1=await seg(); await p.evaluate(()=>document.querySelector('[data-len="short"]').click()); await p.waitForTimeout(400);
const s2=await seg();
ok("ニュース10: 短く⇄くわしくが往復する", s0.short&&!s1.short&&s2.short, JSON.stringify([s0.press,s1.press,s2.press]));

// 3 天気の くわしく/とじる を往復 + 記憶
const wx=async()=>p.evaluate(()=>document.getElementById("wxCard").classList.contains("open"));
await p.evaluate(()=>document.querySelector("[data-wxtg]").click()); await p.waitForTimeout(400);
const w1=await wx();
await p.reload(); await p.waitForTimeout(2300);
const w2=await wx();
await p.evaluate(()=>document.querySelector("[data-wxtg]").click()); await p.waitForTimeout(400);
ok("天気: くわしくが次に開いても残る", w1&&w2&&!(await wx()));

// 4 おたのしみ 開閉 + タブ往復後も残る
const fun=async()=>p.evaluate(()=>{let n=0;document.querySelectorAll("#funSec .fun-t").forEach(e=>{if(e.getBoundingClientRect().height>4)n++;});return n;});
const f0=await fun(); await p.evaluate(()=>document.getElementById("funMore").click()); await p.waitForTimeout(400);
const f1=await fun(); await go(p,"my"); await p.waitForTimeout(400); await go(p,"today"); await p.waitForTimeout(600);
const f2=await fun(); await p.evaluate(()=>document.getElementById("funMore").click()); await p.waitForTimeout(400);
const f3=await fun();
ok("おたのしみ: 開く→タブ往復でも開いたまま→閉じる", f1>f0&&f2===f1&&f3===f0, [f0,f1,f2,f3].join("→"));

// 5 クイズに答える
await go(p,"today"); await p.waitForTimeout(600);
const qz=await p.evaluate(()=>{ const q=document.querySelector("section[aria-label='今日のクイズ']"); if(!q) return "なし";
  const b=[...q.querySelectorAll("button")].filter(x=>x.offsetParent); if(!b.length) return "ボタンなし"; const t0=q.textContent.length; b[0].click();
  return new Promise(r=>setTimeout(()=>r(q.textContent.length!==t0?"変わった":"変わらない"),400)); });
ok("クイズ: 答えると反応する", qz==="変わった", String(qz));

// 6 ペットにごはん
await go(p,"my"); await p.waitForTimeout(800);
const f0n=await p.evaluate(()=>(document.getElementById("petFood")||{}).textContent||"");
await p.evaluate(()=>{ const b=document.querySelector(".pet-feed"); b&&b.click(); });
await p.waitForTimeout(1700);
const f1n=await p.evaluate(()=>(document.getElementById("petFood")||{}).textContent||"");
ok("ペット: ごはんをあげると減る", f0n&&f1n&&(+f1n===+f0n-1), f0n+"→"+f1n);

// 7 ことばカードめくり
const flip=await p.evaluate(()=>{ const b=[...document.querySelectorAll("main button")].find(x=>/記録/.test(x.textContent)); b&&b.click();
  return new Promise(r=>setTimeout(()=>{ const c=document.querySelector(".wcard"); if(!c) return r("カードなし"); c.click();
    setTimeout(()=>r(c.classList.contains("flip")?"めくれた":"めくれない"),400); },600)); });
ok("ことばカード: タップでめくれる", flip==="めくれた", String(flip));

// 8 かんたんモードに切りかえて戻す
await shut(p); await go(p,"my"); await p.waitForTimeout(600);
const mode=await p.evaluate(()=>{ const b=[...document.querySelectorAll("main button")].find(x=>/設定/.test(x.textContent)&&x.offsetParent); b&&b.click();
  return new Promise(r=>setTimeout(()=>{ const e=[...document.querySelectorAll("main button,[data-mode]")].find(x=>/かんたん/.test(x.textContent)); r(e?"あり":"なし"); },600)); });
ok("設定: かんたんモードのボタンが出る", mode==="あり", String(mode));
if(mode==="あり"){
  await p.evaluate(()=>{ const e=[...document.querySelectorAll("main button,[data-mode]")].find(x=>/かんたん/.test(x.textContent)); e&&e.click(); });
  await p.waitForTimeout(900);
  const easy=await p.evaluate(()=>({tabs:document.querySelectorAll("#tabs .tab").length, body:document.querySelector("main").textContent.length}));
  await p.evaluate(()=>{ const e=[...document.querySelectorAll("main button,[data-mode]")].find(x=>/ふつう/.test(x.textContent)); e&&e.click(); });
  await p.waitForTimeout(900);
  const norm=await p.evaluate(()=>({tabs:document.querySelectorAll("#tabs .tab").length}));
  ok("かんたん⇄ふつうが往復する", easy.tabs>0&&norm.tabs>0, "かんたん"+easy.tabs+"タブ / ふつう"+norm.tabs+"タブ");
}
console.log("errs1:",[...new Set(errs)].join(" | ")||"なし");
await ctx.close();

// 9 共有リンク(?vs= ?pv=)
for(const q of ["?vs=3","?pv=2","?vs=abc","?pv=999"]){
  const r=await mk(b,"http://localhost:8766/"+q,ME);
  await r.p.waitForTimeout(1500);
  ok("共有リンク "+q, r.errs.length===0, r.errs.join("|").slice(0,90)||"エラーなし");
  await r.ctx.close();
}
// 10 記録がからっぽの新しい人
{ const r=await mk(b,null,JSON.stringify({}));
  await r.p.waitForTimeout(1200);
  for(const t of ["today","explain","search","plan","my","map","numbers"]){ await go(r.p,t); await r.p.waitForTimeout(500); }
  ok("はじめての人(記録なし)で全タブ", r.errs.length===0, r.errs.join("|").slice(0,120)||"エラーなし");
  await r.ctx.close(); }

console.log("");
R.forEach(x=>console.log(x[0],x[1],x[2]?("  → "+x[2]):""));
console.log("\nNG の数:",R.filter(x=>x[0]==="NG ").length);
await b.close();
})();
