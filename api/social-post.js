// Serverless dispatcher: SideKick → the right posting backend per platform.
//   facebook / instagram → Make.com webhook (Router: photo vs video)
//   tiktok               → Zernio API (their audited app posts public, no
//                          per-account audit; takes our public Blob media URL)
// Secrets (MAKE_WEBHOOK_URL, ZERNIO_API_KEY) stay server-side. Runs as a Vercel
// function in production and via Vite dev middleware locally (see vite.config.js).
//
// Body: { caption, imageUrl, mediaUrl, mediaType, platforms }.
// Returns { ok, results, errors } — ok is true if at least one platform posted.

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

// Facebook (+ Instagram) via the Make scenario. `imageUrl` feeds the current FB
// photo module; `mediaUrl` + `mediaType` drive the Router (photo vs video).
async function postToMake({ caption, imageUrl, mediaUrl, mediaType, platforms }) {
  const hook = process.env.MAKE_WEBHOOK_URL
  if (!hook) return { ok: false, error: 'Make not connected (MAKE_WEBHOOK_URL)' }
  try {
    const r = await fetch(hook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caption, imageUrl, mediaUrl, mediaType, platforms }),
    })
    const text = await r.text().catch(() => '')
    if (!r.ok) return { ok: false, error: `Make ${r.status}: ${text.slice(0, 150)}` }
    return { ok: true, status: r.status }
  } catch (e) {
    return { ok: false, error: 'Make unreachable: ' + (e?.message || String(e)) }
  }
}

// TikTok via the configured posting provider. Publishes immediately and public;
// media is a public URL (our Blob-hosted reel), so no upload step. Pilot posts to
// one configured account; per-agent account ids come with the multi-agent rollout.
// The account id is provider-specific — a Zernio id is meaningless to PostPeer —
// so each provider reads its own env var.
async function postToZernio({ caption, mediaUrl, mediaType }) {
  const isPP = provider() === 'postpeer'
  const key = isPP ? process.env.POSTPEER_API_KEY : process.env.ZERNIO_API_KEY
  const accountId = isPP
    ? process.env.POSTPEER_TIKTOK_ACCOUNT_ID
    : process.env.ZERNIO_TIKTOK_ACCOUNT_ID || '6a6c49fbdf17280d930993f0'
  if (!key) return { ok: false, error: `${provider()} not connected — set its API key in Vercel` }
  if (!accountId) return { ok: false, error: 'Set POSTPEER_TIKTOK_ACCOUNT_ID (the integration id from /connect/integrations)' }
  if (!mediaUrl) return { ok: false, error: 'TikTok needs a video' }
  try {
    const r = await fetch(isPP ? 'https://api.postpeer.dev/v1/posts/' : 'https://zernio.com/api/v1/posts', {
      method: 'POST',
      headers: isPP
        ? { 'content-type': 'application/json', 'x-access-key': key }
        : { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        content: caption,
        mediaItems: [{ url: mediaUrl, type: mediaType === 'video' ? 'video' : 'image' }],
        platforms: [{ platform: 'tiktok', accountId }],
        publishNow: true,
      }),
    })
    const text = await r.text().catch(() => '')
    if (!r.ok) return { ok: false, error: `${provider()} ${r.status}: ${text.slice(0, 150)}` }
    return { ok: true, status: r.status }
  } catch (e) {
    return { ok: false, error: `${provider()} unreachable: ` + (e?.message || String(e)) }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })

  let body
  try { body = await readJson(req) } catch { return send(res, 400, { error: 'Invalid JSON' }) }
  const caption = (body?.caption || '').trim()
  const mediaUrl = body?.mediaUrl || body?.imageUrl || ''
  const mediaType = body?.mediaType || (mediaUrl ? 'image' : 'text')
  // `imageUrl` is kept for the current FB "Upload a Photo" module.
  const imageUrl = mediaType === 'image' ? mediaUrl : (body?.imageUrl || '')
  const platforms = String(body?.platforms || 'facebook,instagram')
    .split(',').map((s) => s.trim()).filter(Boolean)
  if (!caption) return send(res, 400, { error: 'caption is required' })

  const wantMake = platforms.some((p) => p === 'facebook' || p === 'instagram')
  const wantTikTok = platforms.includes('tiktok')
  if (!wantMake && !wantTikTok) return send(res, 400, { error: 'No supported platform in: ' + platforms.join(',') })

  const results = {}
  const errors = []
  // Fan out concurrently to each backend that was requested.
  await Promise.all([
    wantMake && postToMake({ caption, imageUrl, mediaUrl, mediaType, platforms: platforms.join(',') })
      .then((r) => { results.facebook = r; if (!r.ok) errors.push('Facebook: ' + r.error) }),
    wantTikTok && postToZernio({ caption, mediaUrl, mediaType })
      .then((r) => { results.tiktok = r; if (!r.ok) errors.push('TikTok: ' + r.error) }),
  ].filter(Boolean))

  const anyOk = Object.values(results).some((r) => r.ok)
  if (!anyOk) return send(res, 502, { error: errors.join(' · ') || 'All posts failed', results })
  return send(res, 200, { ok: true, results, errors: errors.length ? errors : undefined })
}
