// Portal: start a hosted OAuth connect for one platform, scoped to a profile
// (one per agent). Returns an authUrl to redirect the agent to — they authorize
// their OWN Facebook/Instagram/TikTok on the provider's audited app, so there's
// no Meta/TikTok dev app or audit on our side.
//   GET /api/social-connect?platform=facebook|instagram|tiktok&origin=<app origin>
import { connectUrl, defaultProfile, providerConfigured } from './_lib/social.js'

const PLATFORMS = ['facebook', 'instagram', 'tiktok']

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}

export default async function handler(req, res) {
  const { configured } = providerConfigured()
  if (!configured) return send(res, 501, { error: 'Posting provider not connected — set its API key in Vercel' })

  const q = new URL(req.url, 'http://localhost').searchParams
  const platform = (q.get('platform') || '').toLowerCase()
  const origin = q.get('origin') || ''
  if (!PLATFORMS.includes(platform)) return send(res, 400, { error: 'platform must be one of: ' + PLATFORMS.join(', ') })

  // Per-agent: connect to the profile in the link (?profile=…); else the default.
  const profileId = q.get('profile') || defaultProfile()
  // Send the agent back to THEIR profile's connect page after authorizing.
  const redirectUrl = origin ? `${origin}/#/connect?profile=${profileId}` : ''

  try {
    return send(res, 200, { authUrl: await connectUrl({ platform, profileId, redirectUrl }) })
  } catch (e) {
    return send(res, 502, { error: e?.message || String(e) })
  }
}
