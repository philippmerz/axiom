/** AXIOM service worker — dependency-free. Network-first for navigations so a
 * fresh deploy is picked up immediately and the shell never pins stale hashed
 * assets; cache-first for the content-hashed assets themselves (immutable), so
 * the game still loads offline. Bump CACHE on release to purge old entries. */
const CACHE = 'axiom-v2'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => undefined)))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// only store same-origin, non-redirected 2xx basic responses
function cacheable(res) {
  return res && res.ok && res.type === 'basic' && !res.redirected
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return

  if (req.mode === 'navigate') {
    // network-first: always try the live shell, fall back to cache offline
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (cacheable(res)) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put('/index.html', copy))
          }
          return res
        })
        .catch(() => caches.open(CACHE).then((c) => c.match('/index.html').then((m) => m || c.match('/')))),
    )
    return
  }

  // hashed assets are immutable: serve from cache, revalidate in background
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req)
      const network = fetch(req)
        .then((res) => {
          if (cacheable(res)) cache.put(req, res.clone())
          return res
        })
        .catch(() => cached)
      return cached || network
    }),
  )
})
