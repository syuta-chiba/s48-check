// ネット優先（毎回サーバーに確かめる）・つながらないときだけキャッシュ
const C = 'study-v3';
const FILES = ['./', 'index.html', 'app.js', 'manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'lib/qrcode.js', 'lib/jsQR.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(FILES.map(f => new Request(f, {cache: 'reload'}))))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;   // GitHub API などは触らない
  e.respondWith(fetch(req, {cache: 'no-cache'}).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(C).then(c => c.put(req, copy)); }
    return r;
  }).catch(() => caches.match(req, {ignoreSearch: true})));
});
