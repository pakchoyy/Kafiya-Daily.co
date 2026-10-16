const CACHE = 'kafiya-v27';
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'assets/logo-mark.png', 'assets/logo-full.png', 'icons/icon-192.png',
  'js/app.js', 'js/db.js', 'js/parser.js', 'js/logo.js', 'js/label.js', 'js/ocr.js', 'js/jpg.js', 'js/barcode.js', 'js/shopee.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== 'kafiya-share').map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  // "Bagikan ke Kafiya" dari aplikasi lain: simpan file di cache, lalu buka halaman Pesanan baru.
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/share')) {
    e.respondWith((async () => {
      const files = (await req.formData()).getAll('files');
      const c = await caches.open('kafiya-share');
      await Promise.all(files.map((f, i) => c.put(`shared-${Date.now()}-${i}`,
        new Response(f, { headers: { 'content-type': f.type, 'x-name': encodeURIComponent(f.name || 'file') } }))));
      return Response.redirect(new URL('./#/baru?shared=1', self.registration.scope).href, 303);
    })());
    return;
  }
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
