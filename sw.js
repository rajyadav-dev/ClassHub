/* ClassHub service worker. Two jobs:
   1) Share target: when you tap Share in WhatsApp and pick ClassHub, Android sends the text and
      file here. We keep it in a small private cache on this phone, then open the app, which fills
      the "New notice" form. Nothing is cached for offline use.
   2) Push notifications: shows a notification when a new notice is posted, even if the app is closed. */
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

/* ---------- push notifications ---------- */
/* The payload is treated as plain text only, and a tap always opens the app itself
   (never a link taken from the payload), so a fake push cannot send anyone to another site. */
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  var title = (typeof d.title === 'string' && d.title) ? d.title.slice(0, 100) : 'ClassHub';
  var opts = {
    body: typeof d.body === 'string' ? d.body.slice(0, 200) : '',
    icon: 'icon-192.png',
    badge: 'icon-192.png'
  };
  if (typeof d.tag === 'string' && d.tag) opts.tag = d.tag.slice(0, 60);
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil((async function () {
    var all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (var i = 0; i < all.length; i++) {
      if (all[i].url.indexOf(self.registration.scope) === 0 && 'focus' in all[i]) return all[i].focus();
    }
    return self.clients.openWindow('./');
  })());
});
