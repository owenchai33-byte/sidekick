// Posts the agent has prepared but is holding for a human ✅. Each pending item
// is one small JSON blob under pending/<id>.json holding everything needed to
// publish later (caption + final mediaItems), so approve just fires the post.
// Approve/skip removes it; a posted item then lands in the feed log.

import { put, list, del } from '@vercel/blob'
import { randomUUID } from 'node:crypto'

const PREFIX = 'pending/'

function token() { return process.env.BLOB_READ_WRITE_TOKEN }

/** Store a prepared post; returns its short id. Throws if Blob isn't configured. */
// `forceId` re-creates an item under its ORIGINAL id. approve() claims a pending
// post by deleting it BEFORE publishing (so a second tick cannot publish it twice),
// and puts it back under the same id if publishing fails, so the human can retry
// with the id they were already given.
export async function putPending(item, forceId) {
  const t = token()
  if (!t) throw new Error('no BLOB token')
  const id = forceId || randomUUID().slice(0, 8)
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
// --- atomic claim ------------------------------------------------------------
// Two ✅ arriving together (a double tap, or a retry) used to BOTH publish: reading
// then deleting is two operations, so both callers saw the item and both went ahead.
// Verified: a claim-before-publish version still published twice under a real race.
//
// Blob `put` with allowOverwrite:false throws when the key exists, which is a true
// test-and-set — measured with 4 concurrent claims, exactly one winner. So the
// winner publishes and everyone else is told it is already handled.
const CLAIM = 'pending-claim/'
const CLAIM_STALE_MS = 10 * 60 * 1000

/** true if THIS caller owns the right to publish `id`. */
export async function claimPending(id) {
  const t = token()
  if (!t) throw new Error('no BLOB token')
  const key = `${CLAIM}${id}.json`
  try {
    await put(key, JSON.stringify({ at: Date.now() }), {
      access: 'public', token: t, contentType: 'application/json',
      addRandomSuffix: false, allowOverwrite: false,
    })
    return true
  } catch {
    // Someone holds it — unless they died mid-publish and left it stale.
    try {
      const { blobs } = await list({ prefix: key, token: t, limit: 1 })
      const b = blobs[0]
      if (b && Date.now() - new Date(b.uploadedAt).getTime() > CLAIM_STALE_MS) {
        await del(b.url, { token: t })
        await put(key, JSON.stringify({ at: Date.now() }), {
          access: 'public', token: t, contentType: 'application/json',
          addRandomSuffix: false, allowOverwrite: false,
        })
        return true
      }
    } catch { /* lost the takeover race too — fine, someone else has it */ }
    return false
  }
}

/** Release a claim so a failed publish can be retried. */
export async function releasePending(id) {
  const t = token()
  if (!t) return
  try {
    const { blobs } = await list({ prefix: `${CLAIM}${id}.json`, token: t, limit: 1 })
    if (blobs[0]) await del(blobs[0].url, { token: t })
  } catch { /* best effort */ }
}

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
