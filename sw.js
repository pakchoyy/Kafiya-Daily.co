const CACHE = 'kafiya-v14';
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'assets/logo-mark.png', 'assets/logo-full.png', 'icons/icon-192.png',
  'js/app.js', 'js/db.js', 'js/parser.js', 'js/logo.js', 'js/label.js', 'js/ocr.js', 'js/jpg.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Halaman dan file aplikasi sendiri: jaringan dulu supaya HTML dan JS selalu satu versi; cache hanya saat offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put('index.html', c)); return r; })
      .catch(() => caches.match('index.html')));
    return;
  }
  if (new URL(req.url).origin === location.origin) {
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)); } return r; })
      .catch(() => caches.match(req)));
    return;
  }
  // Pihak luar (font, OCR): pakai cache, perbarui di belakang.
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((r) => {
      if (r.ok || r.type === 'opaque') { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)); }
      return r;
    }).catch(() => hit);
    return hit || net;
  }));
});
