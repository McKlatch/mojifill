/* MojiFill service worker (1.3.1-lab; file added in 1.3.0-lab). Served as a real same-origin file at /sw.js, scope '/'.
   Before 1.3.0 the worker was registered from a blob: URL, which browsers reject, so offline never worked.
   - CACHE is bumped every release (build-prod.mjs swaps it to mojifill-vNN for mojifill.app). Old caches are deleted on activate.
   - HTML navigations: network-first, cache fallback (so an online user always gets the latest page).
   - Versioned static assets (?v=…): cache-first.
   - Other same-origin GETs: network-first, cache fallback.
   - Never touches /api/*, non-GET, or any cross-origin request (cross-origin requests go straight to the network).
   - skipWaiting + clients.claim: a new version takes over on the next load; HTML is network-first, so nobody is stranded. */
const CACHE='mojifill-1.3.1-lab';
const SHELL = [
  '/',
  '/terms',
  '/manifest.webmanifest?v=1.3.0',
  '/favicon-32.png?v=1.3.0',
  '/icon-192.png?v=1.3.0',
  '/icon-512.png?v=1.3.0',
  '/icon-maskable-512.png?v=1.3.0',
  '/apple-touch-icon.png?v=1.3.0'
];

/* A redirected response can't be used to answer a navigation; store a clean copy. */
function clean(res) {
  if (!res || !res.redirected) return Promise.resolve(res);
  return res.blob().then(function (body) {
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  });
}
function storable(res) {
  return res && res.ok && res.type === 'basic';
}
function put(req, res) {
  if (!storable(res)) return res;
  const copy = res.clone();
  clean(copy).then(function (c) { return caches.open(CACHE).then(function (cache) { return cache.put(req, c); }); }).catch(function () {});
  return res;
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(SHELL.map(function (u) {
        return fetch(u, { cache: 'reload', credentials: 'same-origin' }).then(function (res) {
          if (!storable(res)) throw new Error('precache ' + u + ' ' + res.status);
          return clean(res).then(function (c) { return cache.put(u, c); });
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf('mojifill-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

function navFallback(req) {
  const u = new URL(req.url);
  return caches.match(req, { ignoreSearch: true }).then(function (r) {
    if (r) return r;
    const p = u.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
    if (p === '/terms') return caches.match('/terms');
    return caches.match('/');
  });
}

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  let u;
  try { u = new URL(req.url); } catch (err) { return; }
  if (u.origin !== self.location.origin) return;           /* Stripe, anything external: not ours */
  if (u.pathname.indexOf('/api/') === 0) return;           /* /api/geo must always be live */
  if (u.pathname === '/sw.js') return;
  const nav = req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') >= 0;
  if (nav) {
    /* Store navigations under the app-shell key only ('/' or '/terms'), so ?lang= / Stripe return URLs don't pile up. */
    const p = u.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
    const key = p === '/terms' ? '/terms' : (p === '/' || p === '/index') ? '/' : null;
    e.respondWith(fetch(req).then(function (res) { return key ? put(key, res) : res; }).catch(function () {
      return navFallback(req).then(function (r) { return r || Response.error(); });
    }));
    return;
  }
  if (u.searchParams.has('v')) {
    e.respondWith(caches.match(req).then(function (r) {
      return r || fetch(req).then(function (res) { return put(req, res); });
    }));
    return;
  }
  e.respondWith(fetch(req).then(function (res) { return put(req, res); }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (r) { return r || Response.error(); });
  }));
});
