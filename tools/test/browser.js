// テストで使うブラウザ(chromium の headless shell)の場所を探す。
// 作業環境によって入っている版(chromium_headless_shell-1194 / -1243 …)やフォルダ名が変わるので、決め打ちにしない(2026-11-03)。
// 環境変数 PW_EXE があればそれを使う。
const fs=require("fs"), path=require("path");
function exe(){
  if(process.env.PW_EXE&&fs.existsSync(process.env.PW_EXE)) return process.env.PW_EXE;
  const roots=[process.env.PLAYWRIGHT_BROWSERS_PATH,"/opt/pw-browsers",path.join(process.env.HOME||"","/.cache/ms-playwright")].filter(Boolean);
  const names=["headless_shell","chrome-headless-shell","chrome"];
  const found=[];
  for(const r of roots){ if(!fs.existsSync(r)) continue;
    const isDir=p=>{ try{ return fs.statSync(p).isDirectory(); }catch(e){ return false; } };
    for(const d of fs.readdirSync(r)){ if(!/chromium/.test(d)) continue; const base=path.join(r,d); if(!isDir(base)) continue;
      for(const sub of fs.readdirSync(base)){ if(!isDir(path.join(base,sub))) continue; for(const n of names){ const f=path.join(base,sub,n); if(fs.existsSync(f)) found.push({f,shell:/headless/.test(d)?0:1,v:+(d.match(/\d+/)||[0])[0]}); } } } }
  if(!found.length) throw new Error("ブラウザが見つかりません(/opt/pw-browsers に chromium がない)。PW_EXE で場所を指定してください");
  found.sort((a,b)=>a.shell-b.shell||b.v-a.v); // headless shell を優先、新しい版を優先
  return found[0].f; }
module.exports={exe};
