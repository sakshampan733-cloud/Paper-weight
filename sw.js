/* Paperweight service worker — makes the app open and work with no network.
 *
 * Strategy, per resource type:
 *   app shell (the HTML)  network-first with a short timeout, cache fallback.
 *                         Keeps a deploy landing immediately when online (the
 *                         app is one big file, so a stale copy means stale
 *                         features), while still opening instantly offline.
 *   fonts (Google Fonts)  cache-first — versioned+immutable upstream, and the
 *                         CSS already declares local fallbacks, so a miss
 *                         degrades to Georgia/system rather than breaking.
 *   icons/manifest        cache-first.
 *   /content/* (notes)    never touched — the app asks for these with no-store
 *                         to see if a chapter changed, so a cached copy would
 *                         hide every update. The notes themselves live in
 *                         localStorage, so offline still has them.
 *
 * Bump CACHE_VERSION when the precache list changes; old caches are dropped on
 * activate.
 */
const CACHE_VERSION = 'v3';
const SHELL_CACHE = 'pw-shell-' + CACHE_VERSION;
const ASSET_CACHE = 'pw-assets-' + CACHE_VERSION;

// the app is index.html, served at "/" (paperweight.html was its old name)
const SHELL_URLS = ['/', '/index.html'];
const ASSET_URLS = ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png'];

const DOC_TIMEOUT_MS = 3500; // don't let a flaky connection stall a cold open

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      // addAll is atomic — one 404 would throw away the whole precache, and "/"
      // only exists once the Vercel rewrite is deployed. Cache independently.
      await Promise.allSettled(SHELL_URLS.map((u) => shell.add(new Request(u, { cache: 'reload' }))));
      const assets = await caches.open(ASSET_CACHE);
      await Promise.allSettled(ASSET_URLS.map((u) => assets.add(new Request(u, { cache: 'reload' }))));
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('pw-') && k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isFontRequest(url) {
  return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const resp = await fetch(request);
  // opaque (no-cors) font responses still cache usefully; only skip real errors
  if (resp && (resp.ok || resp.type === 'opaque')) cache.put(request, resp.clone());
  return resp;
}

async function networkFirstWithTimeout(request, cacheName) {
  const cache = await caches.open(cacheName);
  let timer;
  try {
    const resp = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), DOC_TIMEOUT_MS);
      fetch(request).then(resolve, reject);
    });
    if (resp && resp.ok) cache.put(request, resp.clone());
    return resp;
  } catch (err) {
    const hit = (await cache.match(request)) || (await cache.match('/')) || (await cache.match('/index.html'));
    if (hit) return hit;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // notes sync: always the network (see above)
  if (url.origin === self.location.origin && url.pathname.startsWith('/content/')) return;

  if (req.mode === 'navigate' || (req.destination === 'document' && url.origin === self.location.origin)) {
    event.respondWith(networkFirstWithTimeout(req, SHELL_CACHE));
    return;
  }

  if (isFontRequest(url)) {
    event.respondWith(cacheFirst(req, ASSET_CACHE).catch(() => Response.error()));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, ASSET_CACHE).catch(() => Response.error()));
  }
});
