// まいにちニュース帳 — オフラインでも前回の内容を読めるようにする
const CACHE = "nw-v1";
const SHELL = ["./", "./index.html", "./data.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  const same = url.origin === location.origin;
  const fresh = same && (url.pathname.endsWith("/") || url.pathname.endsWith(".html") || url.pathname.endsWith("data.js"));
  if (fresh) {
    // ニュースは新しさが大事: まずネット、だめなら保存分
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); return r; }).catch(() => caches.match(req).then(r => r || caches.match("./index.html"))));
  } else {
    // 画像・フォント・グラフの部品: 保存分を先に
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok || r.type === "opaque") { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; })));
  }
});
