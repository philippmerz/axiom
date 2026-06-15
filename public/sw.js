/** AXIOM service worker — dependency-free, stale-while-revalidate.
 * Caches the app shell so the game runs offline once loaded; serves cached
 * assets instantly and refreshes them in the background. */
const CACHE = 'axiom-v1'
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

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req)
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone())
          return res
        })
        .catch(() => cached || (req.mode === 'navigate' ? cache.match('/index.html') : undefined))
      return cached || network
    }),
  )
})
