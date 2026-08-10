// Hold a pre-built post (e.g. a TikTok reel the Mac just rendered) as a pending,
// so the normal ✅ approve flow can publish it. Secret-gated (INGEST_SECRET).
//   POST /api/hold  { caption, mediaItems:[{url,type}], platforms?, profileId,
//                     location?, price?, listingType?, cover?, group? }
import { putPending } from './_lib/pending.js'

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

export default async function handler(req, res) {
  const secret = process.env.INGEST_SECRET
  const provided = req.headers['x-ingest-secret'] || (new URL(req.url, 'http://x').searchParams.get('secret')) || ''
  if (!secret) return send(res, 501, { error: 'INGEST_SECRET not set' })
  if (provided !== secret) return send(res, 401, { error: 'Bad or missing x-ingest-secret' })
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })

  let body
  try { body = req.body ?? (await readJson(req)) } catch { return send(res, 400, { error: 'Invalid JSON' }) }
  const mediaItems = Array.isArray(body?.mediaItems) ? body.mediaItems.filter((m) => m && m.url) : []
  if (!mediaItems.length) return send(res, 400, { error: 'mediaItems required' })
  const caption = (body?.caption || '').toString()

  try {
    const id = await putPending({
      at: new Date().toISOString(),
      caption,
      captionShort: (body?.captionShort || caption).toString().slice(0, 90),
      mediaItems,
      platforms: Array.isArray(body?.platforms) && body.platforms.length ? body.platforms : null,
      profileId: body?.profileId || null,
      location: body?.location ?? null,
      price: body?.price ?? null,
      listingType: body?.listingType || 'sale',
      cover: body?.cover || mediaItems[0]?.url || null,
      mediaCount: mediaItems.length,
      group: body?.group || null,
      kind: body?.kind || 'reel',
    })
    return send(res, 200, { ok: true, pendingId: id })
  } catch (e) {
    return send(res, 502, { ok: false, error: 'Could not hold: ' + (e?.message || String(e)) })
  }
}
