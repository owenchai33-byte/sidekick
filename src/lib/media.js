// Video storage. Videos are far too large for localStorage (they'd blow the
// ~5MB quota), so blobs live in IndexedDB keyed by id; the listing only stores
// a lightweight { id, name } reference. Images stay as data URLs (small, and
// already working). Persists per-browser today; moves to Supabase Storage later.

const DB_NAME = 'sidekick-media'
const STORE = 'videos'
const urlCache = new Map() // id -> object URL (kept for the session)

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function putVideo(blob) {
  const id = crypto.randomUUID?.() || 'v-' + Math.random().toString(36).slice(2)
  const db = await openDB()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, id)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  // Pre-cache the object URL so previews show immediately after upload.
  urlCache.set(id, URL.createObjectURL(blob))
  return id
}

export async function getVideoBlob(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const rq = tx.objectStore(STORE).get(id)
    rq.onsuccess = () => resolve(rq.result || null)
    rq.onerror = () => reject(rq.error)
  })
}

export async function getVideoUrl(id) {
  if (urlCache.has(id)) return urlCache.get(id)
  const blob = await getVideoBlob(id)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  urlCache.set(id, url)
  return url
}

export async function deleteVideo(id) {
  const cached = urlCache.get(id)
  if (cached) { URL.revokeObjectURL(cached); urlCache.delete(id) }
  const db = await openDB()
  await new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = resolve
    tx.onerror = resolve
  })
}
