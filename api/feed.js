// Powers the app's agent-first home. One unauthenticated GET returns:
//   status — is the content engine live? how many accounts are connected?
//   posts  — what the auto-ingest agent has posted (newest first)
// Nothing sensitive is exposed (no phone numbers; captions are trimmed at write).

import { readFeed } from './_lib/feed.js'
import { listPending } from './_lib/pending.js'
import { providerStatus } from './_lib/providers.js'
import { connectedAccounts, defaultProfile, providerConfigured } from './_lib/social.js'

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'GET only' })

  const status = providerStatus()
  const posting = providerConfigured()

  let accounts = []
  if (posting.configured) {
    try { accounts = await connectedAccounts(defaultProfile()) } catch { /* leave accounts empty */ }
  }

  const [posts, pending] = await Promise.all([readFeed(30), listPending(20)])
  return send(res, 200, {
    status: {
      providerConfigured: status.configured,
      provider: status.provider,
      postingProvider: posting.provider,
      postingKey: posting.configured,
      zernioKey: posting.configured, // kept for the existing UI field name
      connectedAccounts: accounts.length,
      platforms: accounts.map((a) => a.platform),
    },
    pending: pending.map((p) => ({
      id: p.id, at: p.at, location: p.location, price: p.price, listingType: p.listingType,
      cover: p.cover, caption: p.caption, mediaCount: p.mediaCount, group: p.group,
    })),
    posts,
  })
}
