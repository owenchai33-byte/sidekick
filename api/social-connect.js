// Portal: start a hosted OAuth connect for one platform, scoped to a Zernio
// profile (one per agent). Returns an authUrl to redirect the agent to — they
// authorize their OWN Facebook/Instagram/TikTok on Zernio's audited app, so
// there's no Meta/TikTok dev app or audit on our side.
//   GET /api/social-connect?platform=facebook|instagram|tiktok&origin=<app origin>
const ZERNIO = 'https://zernio.com/api/v1'
// Pilot/demo: one shared profile. Per-agent profiles come with the multi-tenant
// store (create each via POST /profiles and map profileId -> agent).
const DEFAULT_PROFILE = '6a6c498971a67c109cfcae06'
const PLATFORMS = ['facebook', 'instagram', 'tiktok']

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}

export default async function handler(req, res) {
  const key = process.env.ZERNIO_API_KEY
  if (!key) return send(res, 501, { error: 'Zernio not connected — set ZERNIO_API_KEY in Vercel' })

  const q = new URL(req.url, 'http://localhost').searchParams
  const platform = (q.get('platform') || '').toLowerCase()
  const origin = q.get('origin') || ''
  if (!PLATFORMS.includes(platform)) return send(res, 400, { error: 'platform must be one of: ' + PLATFORMS.join(', ') })

  const profileId = process.env.ZERNIO_PROFILE_ID || DEFAULT_PROFILE
  const params = new URLSearchParams({ profileId })
  // Where Zernio sends the agent back after they authorize (back to the portal).
  if (origin) params.set('redirect_url', `${origin}/#/connect`)

  try {
    const r = await fetch(`${ZERNIO}/connect/${platform}?${params}`, { headers: { authorization: `Bearer ${key}` } })
    const data = await r.json().catch(() => ({}))
    if (!r.ok || !data.authUrl) return send(res, 502, { error: `Zernio ${r.status}: ${JSON.stringify(data).slice(0, 200)}` })
    return send(res, 200, { authUrl: data.authUrl })
  } catch (e) {
    return send(res, 502, { error: 'Zernio unreachable: ' + (e?.message || String(e)) })
  }
}
