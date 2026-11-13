/* Offline app shell. Bump CACHE whenever an asset below changes. */
var CACHE = 'bts-v2.8.1';
var ASSETS = [
  './',
  'index.html',
  'roles.html',
  'manifest.webmanifest',
  'roles.webmanifest',
  'css/app.css',
  'js/geometry.js',
  'js/state.js',
  'js/render.js',
  'js/ui.js',
  'js/roles.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/roles-192.png',
  'icons/roles-512.png',
  'icons/roles-maskable-512.png',
  'icons/roles-apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  // {cache:'reload'} is the point here: a plain addAll() is allowed to take
  // responses from the browser's HTTP cache, and GitHub Pages serves these
  // with max-age=600. Without it a install minutes after a deploy can store a
  // mix of new and stale files.
  var fresh = ASSETS.map(function (url) { return new Request(url, { cache: 'reload' }); });
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(fresh); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* Cache-first: the board must open with no network at all.
   Navigations fall back to the cached shell. */
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        if (req.mode === 'navigate') return caches.match('index.html');
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});
