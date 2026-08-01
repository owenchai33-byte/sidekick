// Portal: list the social accounts an agent has connected (via Zernio) for
// their profile, so the Connect screen can show status and the post flow knows
// which accountIds to target.  GET /api/social-accounts
const ZERNIO = 'https://zernio.com/api/v1'
const DEFAULT_PROFILE = '6a6c498971a67c109cfcae06'

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}

export default async function handler(req, res) {
  const key = process.env.ZERNIO_API_KEY
  if (!key) return send(res, 501, { error: 'Zernio not connected — set ZERNIO_API_KEY in Vercel' })

  const profileId = process.env.ZERNIO_PROFILE_ID || DEFAULT_PROFILE
  try {
    const r = await fetch(`${ZERNIO}/accounts?profileId=${encodeURIComponent(profileId)}`, {
      headers: { authorization: `Bearer ${key}` },
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) return send(res, 502, { error: `Zernio ${r.status}: ${JSON.stringify(data).slice(0, 150)}` })
    const accounts = (data.accounts || []).map((a) => ({ id: a._id, platform: a.platform, username: a.username }))
    return send(res, 200, { accounts })
  } catch (e) {
    return send(res, 502, { error: 'Zernio unreachable: ' + (e?.message || String(e)) })
  }
}
