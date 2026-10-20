// サイトのデータが更新されたら、ntfy(無料の通知サービス)に「朝・夕方のまとめ」を1通送る。
// 個人の情報は送らない(見出しだけ)。FORCE=1 のときは時間に関係なく送る(テスト用)。
const fs = require("fs");
global.window = {};
eval(fs.readFileSync("data.js", "utf8"));
const D = window.NEWS_DATA;
const TOPIC = "mainichi-news-sb22-q7k4";
const h = (new Date().getUTCHours() + 9) % 24;
const slot = h >= 6 && h < 10 ? "朝" : h >= 17 && h < 21 ? "夕方" : null;
if (!slot && process.env.FORCE !== "1") { console.log("通知の時間帯ではないので送りません", h); process.exit(0); }
const top = (D.top10 || []).slice(0, 3).map((n, i) => `${i + 1}. ${n.icon || ""} ${n.title}`).join("\n");
const w = D.weather ? `\n🌤️ ${D.weather.place} ${D.weather.sky} ${D.weather.hi}°/${D.weather.lo}° ${D.weather.umbrella}` : "";
const body = {
  topic: TOPIC,
  title: `まいにちニュース帳(${slot || "テスト"}のまとめ)`,
  message: `${top}${w}\n🐣 クイズでペットにごはんをあげよう`,
  tags: ["newspaper"],
  click: "https://sunbike22.github.io/news/",
  priority: 3
};
fetch("https://ntfy.sh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  .then(r => r.text().then(t => { console.log(r.status, t.slice(0, 200)); if (!r.ok) process.exit(1); }))
  .catch(e => { console.error(e); process.exit(1); });
