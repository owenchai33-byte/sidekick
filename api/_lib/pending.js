// Posts the agent has prepared but is holding for a human ✅. Each pending item
// is one small JSON blob under pending/<id>.json holding everything needed to
// publish later (caption + final mediaItems), so approve just fires the post.
// Approve/skip removes it; a posted item then lands in the feed log.

import { put, list, del } from '@vercel/blob'
import { randomUUID } from 'node:crypto'

const PREFIX = 'pending/'

function token() { return process.env.BLOB_READ_WRITE_TOKEN }

/** Store a prepared post; returns its short id. Throws if Blob isn't configured. */
export async function putPending(item) {
  const t = token()
  if (!t) throw new Error('no BLOB token')
  const id = randomUUID().slice(0, 8)
  await put(`${PREFIX}${id}.json`, JSON.stringify({ ...item, id }), {
    access: 'public', token: t, contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true,
  })
  return id
}

async function urlFor(id, t) {
  const { blobs } = await list({ prefix: `${PREFIX}${id}.json`, token: t, limit: 1 })
  return blobs[0]?.url || null
}

/** Load one prepared post by id, or null if gone/handled. */
export async function getPending(id) {
  const t = token()
  if (!t || !id) return null
  try {
    const u = await urlFor(id, t)
    if (!u) return null
    const r = await fetch(u, { cache: 'no-store' })
    return r.ok ? await r.json() : null
  } catch { return null }
}

/** Remove a prepared post (after it's approved & posted, or skipped). */
export async function delPending(id) {
  const t = token()
  if (!t || !id) return
  try { const u = await urlFor(id, t); if (u) await del(u, { token: t }) } catch { /* ignore */ }
}

/** Recent prepared posts, newest first (for read-only visibility in the app). */
export async function listPending(limit = 20) {
  const t = token()
  if (!t) return []
  try {
    const { blobs } = await list({ prefix: PREFIX, token: t, limit: 100 })
    const recent = blobs
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
      .slice(0, limit)
    const items = await Promise.all(recent.map(async (b) => {
      try { const r = await fetch(b.url, { cache: 'no-store' }); return r.ok ? await r.json() : null } catch { return null }
    }))
    return items.filter(Boolean)
  } catch { return [] }
}
