// Serverless proxy: SideKick → Make.com → Facebook Page + Instagram.
// The browser POSTs a listing here; this forwards it to the Make scenario
// webhook (which owns the approved Meta app, so no Meta developer app is
// needed). The webhook URL stays server-side. Runs as a Vercel function in
// production and via Vite dev middleware locally (see vite.config.js).
//
// Body: { caption, imageUrl, platforms } → POST to process.env.MAKE_WEBHOOK_URL.

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })

  const hook = process.env.MAKE_WEBHOOK_URL
  if (!hook) {
    // Not wired yet — tell the UI clearly instead of dead-ending.
    return send(res, 501, { error: 'Auto-posting is not connected yet. Add MAKE_WEBHOOK_URL to enable it.' })
  }

  let body
  try { body = await readJson(req) } catch { return send(res, 400, { error: 'Invalid JSON' }) }
  const caption = (body?.caption || '').trim()
  const imageUrl = body?.imageUrl || ''
  const platforms = body?.platforms || 'facebook,instagram'
  if (!caption) return send(res, 400, { error: 'caption is required' })

  try {
    const r = await fetch(hook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caption, imageUrl, platforms }),
    })
    const text = await r.text().catch(() => '')
    if (!r.ok) return send(res, 502, { error: `Make returned ${r.status}: ${text.slice(0, 200)}` })
    return send(res, 200, { ok: true, makeStatus: r.status })
  } catch (e) {
    return send(res, 502, { error: 'Could not reach Make: ' + (e?.message || String(e)) })
  }
}
