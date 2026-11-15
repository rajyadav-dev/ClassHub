/* ClassHub service worker.
   It does ONE job: when you tap Share in WhatsApp and pick ClassHub, Android sends the text and
   file here. We keep it in a small private cache on this phone, then open the app, which fills
   the "New notice" form. Nothing is cached for offline use and nothing is sent to any server. */
var SHARE_CACHE = 'classhub-share';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'POST') return;
  var url = new URL(req.url);
  if (!/\/share-target$/.test(url.pathname)) return;
  e.respondWith((async function () {
    try {
      var form = await req.formData();
      var cache = await caches.open(SHARE_CACHE);
      var keys = await cache.keys();
      await Promise.all(keys.map(function (k) { return cache.delete(k); }));
      var parts = [form.get('title'), form.get('text'), form.get('url')].filter(function (x) { return typeof x === 'string' && x.trim(); });
      await cache.put('text', new Response(parts.join('\n')));
      var f = form.get('file');
      if (f && typeof f !== 'string' && f.size) {
        await cache.put('file', new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Name': encodeURIComponent(f.name || '') } }));
      }
    } catch (err) { /* if anything fails the app just opens normally */ }
    return Response.redirect('./?share=1', 303);
  })());
});
