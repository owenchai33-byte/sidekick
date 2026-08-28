// Portal: list the social accounts an agent has connected for their profile, so
// the Connect screen can show status and the post flow knows which accountIds to
// target.  GET /api/social-accounts?profile=<profileId>
import { connectedAccounts, defaultProfile, providerConfigured } from './_lib/social.js'

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}

export default async function handler(req, res) {
  const { configured } = providerConfigured()
  if (!configured) return send(res, 501, { error: 'Posting provider not connected — set its API key in Vercel' })

  const q = new URL(req.url, 'http://localhost').searchParams
  const profileId = q.get('profile') || defaultProfile()
  try {
    return send(res, 200, { accounts: await connectedAccounts(profileId) })
  } catch (e) {
    return send(res, 502, { error: e?.message || String(e) })
  }
}
