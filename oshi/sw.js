/* 推し活ステイ大阪 ハブページ用 Service Worker
   ・2回目以降はページ・地図・写真・フォントを端末に保存した分から即表示
   ・施設データとページ本体は「最新を取りに行き、3秒で返ってこなければ保存分を表示」
   ・内容を変えたら下の VERSION を書き換えると、古い保存分は自動で消えます */
const VERSION = "oshi-hub-v1";
const CORE = VERSION + "-core";      // ページ本体・地図
const DATA = VERSION + "-data";      // 施設データ（スプレッドシート）
const MEDIA = VERSION + "-media";    // 写真・フォント・ライブラリ
const PRECACHE = ["./", "./oshi-route-map.webp"];
const MEDIA_MAX = 120;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CORE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// 最新を取りに行き、timeout ミリ秒で返らなければ保存分を返す（あとで届いた最新は保存しておく）
function networkFirst(req, cacheName, timeout){
  return new Promise((resolve) => {
    let done = false;
    const fromCache = () => caches.match(req, { ignoreVary: true });
    const net = fetch(req).then(res => {
      if(res && res.ok){ const copy = res.clone(); caches.open(cacheName).then(c => c.put(req, copy)); }
      return res;
    });
    const timer = setTimeout(async () => {
      const hit = await fromCache();
      if(hit && !done){ done = true; resolve(hit); }
    }, timeout);
    net.then(res => { if(!done){ done = true; clearTimeout(timer); resolve(res); } })
       .catch(async () => {
         clearTimeout(timer);
         if(done) return;
         const hit = await fromCache();
         done = true;
         resolve(hit || new Response("", { status: 504, statusText: "offline" }));
       });
  });
}

async function trim(cacheName, max){
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for(let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

// 保存分があれば即返す。なければ取りに行って保存（写真は CORS で取り直して保存できる形にする）
async function cacheFirst(req, cacheName){
  const hit = await caches.match(req.url, { ignoreVary: true });
  if(hit) return hit;
  let res;
  try{
    res = await fetch(req.url, { mode: "cors", credentials: "omit" });
  }catch(e){
    return fetch(req);   // CORS 不可のものは普通に取得（保存しない）
  }
  if(res && res.ok){
    const copy = res.clone();
    caches.open(cacheName).then(c => c.put(req.url, copy)).then(() => trim(cacheName, MEDIA_MAX));
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);

  // 計測（GA4）は触らない
  if(/google-analytics\.com|googletagmanager\.com/.test(url.host)) return;

  // ページ本体
  if(req.mode === "navigate" && url.origin === location.origin){
    e.respondWith(networkFirst(req, CORE, 3000));
    return;
  }
  // 施設データ
  if(url.host === "docs.google.com" && url.pathname.includes("/gviz/")){
    e.respondWith(networkFirst(req, DATA, 3000));
    return;
  }
  // 地図など同じサイト内の画像
  if(url.origin === location.origin && /\.(webp|jpg|png|svg)$/.test(url.pathname)){
    e.respondWith(cacheFirst(req, CORE));
    return;
  }
  // 写真・フォント・CSV読み込みライブラリ
  if(/(^|\.)muscache\.com$|bstatic\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com/.test(url.host)){
    e.respondWith(cacheFirst(req, MEDIA));
  }
});
