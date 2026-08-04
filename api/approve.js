// Approve (or skip) a held post. OpenClaw calls this when the human replies ✅
// or ❌ in the WhatsApp control chat. Secret-gated (same INGEST_SECRET), since
// approving publishes to real socials.
//
//   POST /api/approve   { id, decision:'approve'|'skip' }   header x-ingest-secret
//   GET  /api/approve?id=<id>&decision=approve&secret=<secret>   (convenience)
//
// approve → publishes the held post to the connected accounts, logs it to the
//           feed, removes it from pending.
// skip    → just removes it from pending.

import { getPending, delPending } from './_lib/pending.js'
import { appendFeed } from './_lib/feed.js'
import { postToConnected, DEFAULT_PROFILE } from './_lib/zernio.js'

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}) } catch (e) { reject(e) } })
    req.on('error', reject)
  })
}
// ✅/👍/yes → approve, ❌/👎/no → skip; anything else falls through to the arg.
function normalizeDecision(d) {
  const s = String(d || '').trim().toLowerCase()
  if (/(approve|post|yes|ya|ok|👍|✅|✔)/.test(s)) return 'approve'
  if (/(skip|no|cancel|reject|👎|❌|✖)/.test(s)) return 'skip'
  return s
}

export default async function handler(req, res) {
  const secret = process.env.INGEST_SECRET
  const url = new URL(req.url, 'http://x')
  const provided = req.headers['x-ingest-secret'] || url.searchParams.get('secret') || ''
  if (!secret) return send(res, 501, { error: 'INGEST_SECRET not set' })
  if (provided !== secret) return send(res, 401, { error: 'Bad or missing x-ingest-secret' })

  let body = {}
  if (req.method === 'POST') { try { body = req.body ?? (await readJson(req)) } catch { return send(res, 400, { error: 'Invalid JSON' }) } }
  else if (req.method !== 'GET') return send(res, 405, { error: 'POST or GET only' })

  const id = body.id || url.searchParams.get('id')
  const decision = normalizeDecision(body.decision || url.searchParams.get('decision') || 'approve')
  if (!id) return send(res, 400, { error: 'id is required' })

  const item = await getPending(id)
  if (!item) return send(res, 404, { ok: false, error: 'Not found — already handled or expired' })

  if (decision === 'skip') {
    await delPending(id)
    return send(res, 200, { ok: true, decision: 'skip', skipped: true, id })
  }
  if (decision !== 'approve') return send(res, 400, { error: `Unclear decision "${decision}" — use approve or skip` })

  const key = process.env.ZERNIO_API_KEY
  const profileId = process.env.ZERNIO_PROFILE_ID || DEFAULT_PROFILE
  const r = await postToConnected({ caption: item.caption, captionShort: item.captionShort, mediaItems: item.mediaItems, key, profileId })
  if (!r.ok) return send(res, r.error ? 502 : 200, { ok: false, id, reason: r.reason, error: r.error })

  await appendFeed({
    at: new Date().toISOString(),
    location: item.location ?? null,
    price: item.price ?? null,
    listingType: item.listingType,
    platforms: r.platforms,
    card: item.card ?? null,
    cover: item.cover ?? null,
    mediaCount: item.mediaCount ?? (item.mediaItems?.length || 0),
    caption: item.caption ? item.caption.slice(0, 180) : '',
    group: item.group ?? null,
  })
  await delPending(id)
  return send(res, 200, { ok: true, decision: 'approve', posted: r.platforms, id })
}
