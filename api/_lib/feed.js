// Durable feed of what the auto-ingest agent has posted. The app itself is
// client-side (localStorage), so it can't see server-side posts — this log is
// the bridge. Each auto-post writes one small JSON blob under feed/; the Feed
// screen reads them back newest-first. Best-effort throughout: logging must
// never break or slow a real post, and a missing/unreadable log reads as empty.

import { put, list } from '@vercel/blob'

const PREFIX = 'feed/'
const CAP = 60

/** Append one posted-listing record. Swallows all errors — never throws. */
export async function appendFeed(entry) {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) return
  try {
    await put(`${PREFIX}post.json`, JSON.stringify(entry), {
      access: 'public', token, contentType: 'application/json', addRandomSuffix: true,
    })
  } catch { /* a failed log write must not affect the post */ }
}

/** Read the most recent records, newest first. Returns [] on any problem. */
export async function readFeed(limit = 30) {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) return []
  try {
    const { blobs } = await list({ prefix: PREFIX, token, limit: 200 })
    const recent = blobs
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
      .slice(0, Math.min(limit, CAP))
    const items = await Promise.all(recent.map(async (b) => {
      try { const r = await fetch(b.url, { cache: 'no-store' }); return r.ok ? await r.json() : null } catch { return null }
    }))
    return items.filter(Boolean)
  } catch {
    return []
  }
}
