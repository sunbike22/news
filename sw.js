// まいにちニュース帳 — オフラインでも前回の内容を読めるようにする
const CACHE = "nw-v6"; // v6: 地図のデータを読めない形で保存していた不具合を直したので、古い保存分は消す
const SHELL = ["./", "./index.html", "./data.js", "./picks.js", "./privacy.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  const same = url.origin === location.origin;
  // 地震・警報は新しさがすべて: 保存分を使わず、そのままネットへ
  if (url.hostname === "raw.githubusercontent.com" || url.hostname === "api.p2pquake.net" || url.hostname === "api.open-meteo.com") return;
  // Googleのログイン・ドライブ(自分の記録)は、保存せずそのままネットへ
  if (req.headers.has("authorization") || /(^|\.)google(apis)?\.com$/.test(url.hostname) || url.hostname.endsWith("gstatic.com")) return;
  const fresh = same && (url.pathname.endsWith("/") || url.pathname.endsWith(".html") || url.pathname.endsWith("data.js") || url.pathname.endsWith("picks.js"));
  if (fresh) {
    // ニュースは新しさが大事: まずネット、だめなら保存分
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); return r; }).catch(() => caches.match(req).then(r => r || caches.match("./index.html"))));
  } else {
    // 画像・フォント・グラフの部品: 保存分を先に
    // 中身を読む必要がある通信(cors)には、中身の見えない保存分(opaque)は使わない
    e.respondWith(caches.match(req).then(hit => (hit && !(hit.type === "opaque" && req.mode === "cors")) ? hit : fetch(req).then(r => { if (r.ok || (r.type === "opaque" && req.mode !== "cors")) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; }).catch(() => hit || Response.error())));
  }
});
// 電波がない時にそなえて、アプリから頼まれたもの(解説の写真・グラフや地図の部品)を先に保存しておく
self.addEventListener("message", e => {
  const d = e.data || {}; if (d.type !== "warm" || !Array.isArray(d.urls)) return;
  e.waitUntil(caches.open(CACHE).then(async c => { let n = 0;
    for (const u of d.urls.slice(0, 40)) { try { const old = await c.match(u); if (old && old.type !== "opaque") { n++; continue; } const img = /images\.unsplash\.com/.test(u); const r = await fetch(u, { mode: img ? "no-cors" : "cors" }); if (r.ok || (img && r.type === "opaque")) { await c.put(u, r); n++; } } catch (_) {} }
    const cl = await self.clients.matchAll(); cl.forEach(x => x.postMessage({ type: "warmed", n, at: Date.now() })); }));
});
