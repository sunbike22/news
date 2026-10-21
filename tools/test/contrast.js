// 9色 × 明るい/暗い で、文字と背景のコントラスト比を測る
const {chromium}=require("playwright");const fs=require("fs");const S=process.env.S;
const LIB=u=>{ if(u.includes("d3@7.9.0")) return "libs/d3-7.9.0/dist/d3.min.js";
  if(u.includes("topojson-client")) return "libs/topojson-client-3.1.0/dist/topojson-client.min.js";
  if(u.includes("countries-50m")) return "libs/world-atlas-2.0.2/countries-50m.json";
  if(u.includes("chart.js")) return "chart.umd.js"; return null; };
const COLORS=["blue","red","green","yellow","purple","orange","pink","teal","mono"];
const TABS=["today","explain","search","plan","my"];

const probe=`(()=>{
  const px=v=>{const m=/rgba?\\(([^)]+)\\)/.exec(v);if(!m)return null;const a=m[1].split(",").map(Number);
    return {r:a[0],g:a[1],b:a[2],a:a.length>3?a[3]:1};};
  const over=(f,b)=>({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
  const lum=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
    return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);};
  const ratio=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);};
  const bgOf=el=>{ let n=el, acc=null;
    while(n&&n!==document.documentElement){ const c=px(getComputedStyle(n).backgroundColor);
      if(c&&c.a>0){ acc=acc?over(acc,c):c; if(acc.a>=1||c.a>=1) return acc; }
      n=n.parentElement; }
    const html=px(getComputedStyle(document.documentElement).backgroundColor)||{r:255,g:255,b:255,a:1};
    return acc?over(acc,html):html; };
  const out=[];
  document.querySelectorAll("button, .tab, .chip, .fchip, a, .badge-ok, .badge-one, summary, h2, h3, b, .num").forEach(el=>{
    if(!el.offsetParent&&getComputedStyle(el).position!=="fixed") return;
    const r=el.getBoundingClientRect(); if(r.width<6||r.height<6) return;
    const t=(el.textContent||"").trim(); if(!t) return;
    // 自分の文字だけ(子に文字があるものは子にまかせる)
    const own=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
    if(!own) return;
    const cs=getComputedStyle(el); const fg=px(cs.color); if(!fg) return;
    const bg=bgOf(el); const f=over(fg,bg);
    const size=parseFloat(cs.fontSize), w=parseInt(cs.fontWeight)||400;
    const large=size>=24||(size>=18.66&&w>=700);
    const need=large?3:4.5;
    const cr=ratio(f,bg);
    if(cr<need) out.push({t:t.slice(0,18),cls:(el.className||"")+"".slice(0,26),tag:el.tagName,
      cr:Math.round(cr*100)/100,need,size:Math.round(size*10)/10,w,
      fg:cs.color,bg:"rgb("+Math.round(bg.r)+","+Math.round(bg.g)+","+Math.round(bg.b)+")"});
  });
  return out;
})()`;

(async()=>{
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell"});
const all={};
for(const dark of [false,true]) for(const col of COLORS){
  const ctx=await b.newContext({viewport:{width:390,height:900},serviceWorkers:"block",colorScheme:dark?"dark":"light"});
  const p=await ctx.newPage();
  await p.route(/fonts\.g|gc\.zgo|p2pquake|unsplash|open-meteo/,r=>r.abort());
  await p.route(/cdn\.jsdelivr\.net\/npm\/(.*)/,r=>{const f=LIB(r.request().url());(f&&fs.existsSync(S+"/"+f))?r.fulfill({body:fs.readFileSync(S+"/"+f)}):r.abort();});
  await p.route(/raw\.githubusercontent/,r=>r.fulfill({body:fs.readFileSync(S+"/alert_real.json"),contentType:"application/json"}));
  await p.addInitScript(c=>{ localStorage.setItem("nw-onboard","1");
    localStorage.setItem("nw-look",JSON.stringify({v2:1,v3:1,v4:1,v5:1,v6:1,v7:1,v8:1,v9:1,v10:1,v11:1,mode:"normal",color:c,season:"off",density:"normal",len:"short"}));
    localStorage.setItem("nw-me",JSON.stringify({days:["2026-10-20","2026-10-21"],words:["原油","消費税"],pet:{food:9},gv:{eco:5},kw:["台風"],pref:"東京都"})); },col);
  await p.goto("http://localhost:8766/");await p.waitForTimeout(2200);
  for(const t of TABS){
    await p.evaluate(t=>{const e=document.getElementById("tab-"+t);e&&e.click();},t);
    await p.waitForTimeout(600);
    const res=await p.evaluate(probe);
    res.forEach(x=>{ const k=x.tag+"."+String(x.cls).split(" ").slice(0,2).join(".")+" | "+x.t;
      all[k]=all[k]||{n:0,min:99,where:new Set(),ex:x};
      all[k].n++; all[k].min=Math.min(all[k].min,x.cr); all[k].where.add((dark?"暗":"明")+col); });
  }
  // 設定の吹き出し(黒い背景の中のボタン)も測る
  await p.evaluate(()=>document.getElementById("setBtn").click()); await p.waitForTimeout(300);
  (await p.evaluate(probe)).forEach(x=>{ const k=x.tag+"."+String(x.cls).split(" ").slice(0,2).join(".")+" | "+x.t+" (設定)";
    all[k]=all[k]||{n:0,min:99,where:new Set(),ex:x}; all[k].n++; all[k].min=Math.min(all[k].min,x.cr); all[k].where.add((dark?"暗":"明")+col); });
  await ctx.close();
}
const rows=Object.entries(all).sort((a,b)=>a[1].min-b[1].min);
console.log("=== 読みにくいところ(低い順) ===");
rows.slice(0,40).forEach(([k,v])=>console.log("  "+String(v.min).padStart(5)+" (必要"+v.ex.need+")  "+k
  +"\n        "+[...v.where].slice(0,10).join(" ")+(v.where.size>10?" …計"+v.where.size:"")+"  文字"+v.ex.fg+" / 背景"+v.ex.bg));
console.log("\n種類:",rows.length);
await b.close();
})();
