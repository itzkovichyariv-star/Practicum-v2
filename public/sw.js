// Bump CACHE on every meaningful change so old caches are purged on activate.
const CACHE = 'practicum-v2-cache-v1.42.1+build.120.965e01a2';
const PRECACHE = ['/'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// A hashed build asset (immutable) — JS/CSS/fonts/images under /_astro or by extension.
function isAsset(url) {
  return url.pathname.startsWith('/_astro/')
    || /\.(js|mjs|css|woff2?|ttf|png|jpe?g|svg|webp|ico)$/i.test(url.pathname);
}
// Cloudflare Pages answers a MISSING file with its 404 page — as HTTP 200, HTML body.
// So `res.ok` is NOT sufficient to decide something is cacheable: during the seconds a
// deploy is propagating, a not-yet-uploaded chunk returns 200+HTML, and caching that
// under a .js URL makes every later module import fail ("Failed to fetch dynamically
// imported module") and the page render blank — permanently, because cache-first then
// keeps serving the HTML. This hit production on 2026-07-20 (v1.28.1): the /cv-update
// island went blank for anyone who loaded during the deploy window.
function isHtml(res) {
  return (res.headers.get('content-type') || '').toLowerCase().includes('text/html');
}
// The freshness poll hits /?_v=<timestamp> every couple of seconds. Caching each one
// grew the cache by hundreds of useless entries per session — never store those.
function isFreshnessProbe(url) {
  return url.searchParams.has('_v');
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Network-only for API calls (with an offline JSON fallback).
  if (url.hostname.includes('supabase') || url.hostname.includes('googleapis')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response(JSON.stringify({ error: 'offline' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 503,
      }))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // NETWORK-FIRST for navigations / HTML documents — the app shell must always be
  // fresh so a new deploy is picked up immediately (no stale build after a deploy).
  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request, { cache: 'reload' })
        .then(res => {
          if (res.ok && !isFreshnessProbe(url)) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then(c => c || caches.match('/')))
    );
    return;
  }

  // CACHE-FIRST for hashed static assets (immutable — a new build means a new
  // filename, so this never serves stale JS/CSS).
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request);

    if (cached) {
      // SELF-HEAL: an HTML body stored under an asset URL is a poisoned entry from a
      // deploy window (see isHtml). Drop it and re-fetch, so an already-broken client
      // repairs itself on the next load instead of staying blank until the next
      // version bump renames the cache.
      if (isAsset(url) && isHtml(cached)) {
        await cache.delete(e.request);
      } else {
        return cached;
      }
    }

    const res = await fetch(e.request);
    // Only store a genuinely valid asset response.
    if (res.ok && !isFreshnessProbe(url) && !(isAsset(url) && isHtml(res))) {
      cache.put(e.request, res.clone());
    }
    return res;
  })());
});
