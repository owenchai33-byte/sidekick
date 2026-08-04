// Powers the app's agent-first home. One unauthenticated GET returns:
//   status — is the content engine live? how many accounts are connected?
//   posts  — what the auto-ingest agent has posted (newest first)
// Nothing sensitive is exposed (no phone numbers; captions are trimmed at write).

import { readFeed } from './_lib/feed.js'
import { providerStatus } from './_lib/providers.js'

const ZERNIO = 'https://zernio.com/api/v1'
const DEFAULT_PROFILE = '6a6c498971a67c109cfcae06'

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'GET only' })

  const status = providerStatus()
  const key = process.env.ZERNIO_API_KEY
  const profileId = process.env.ZERNIO_PROFILE_ID || DEFAULT_PROFILE

  let accounts = []
  if (key) {
    try {
      const r = await fetch(`${ZERNIO}/accounts?profileId=${encodeURIComponent(profileId)}`, { headers: { authorization: `Bearer ${key}` } })
      const d = await r.json().catch(() => ({}))
      if (r.ok) accounts = d.accounts || []
    } catch { /* leave accounts empty */ }
  }

  const posts = await readFeed(30)
  return send(res, 200, {
    status: {
      providerConfigured: status.configured,
      provider: status.provider,
      zernioKey: !!key,
      connectedAccounts: accounts.length,
      platforms: accounts.map((a) => a.platform),
    },
    posts,
  })
}
