// 読み上げる文の一覧を、アプリ自身の関数(NW_TEST.ttsPlan)で作る。アプリと同じ文になるので、音声ファイルのしるしが必ず合う。
// 使い方: node tools/tts/plan.js http://localhost:8766/ plan.json
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const url = process.argv[2] || "http://localhost:8766/", out = process.argv[3] || "plan.json";
  const b = await chromium.launch();
  const pg = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await pg.addInitScript(() => { try { localStorage.setItem("nw-onboard", "1"); } catch (_) {} });
  await pg.goto(url, { waitUntil: "domcontentloaded" });
  await pg.waitForFunction(() => window.NW_TEST && window.NW_TEST.ttsPlan, null, { timeout: 30000 });
  await pg.waitForTimeout(3500); // yomi.js(読み方の辞書)を読みこむのを待つ
  const plan = await pg.evaluate(() => window.NW_TEST.ttsPlan().map(t => [window.NW_TEST.ttsKey(t), t]));
  fs.writeFileSync(out, JSON.stringify(plan));
  console.log("plan", plan.length, "chunks", plan.reduce((a, x) => a + x[1].length, 0), "chars");
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
