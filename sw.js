/* SideKick service worker — makes the app installable and offline-capable.
   Network-first for navigations (always get the latest build when online,
   fall back to the cached shell offline); stale-while-revalidate for assets. */
const VERSION = 'sk-v1'
const CORE = ['.', 'manifest.webmanifest', 'logo.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon.png']

self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE).catch(() => {})))
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.endsWith('/api/generate')) return // never cache the AI proxy

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const net = await fetch(req)
        const cache = await caches.open(VERSION)
        cache.put('.', net.clone())
        return net
      } catch {
        const cache = await caches.open(VERSION)
        return (await cache.match(req)) || (await cache.match('.')) || Response.error()
      }
    })())
    return
  }

  e.respondWith((async () => {
    const cache = await caches.open(VERSION)
    const cached = await cache.match(req)
    const network = fetch(req)
      .then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res })
      .catch(() => null)
    return cached || (await network) || Response.error()
  })())
})
