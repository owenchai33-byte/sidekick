// Client helper for the agent-first home. Reads /api/feed (status + posts).
// Never throws — on any failure the Feed screen shows its empty/offline state.
//
// It now says WHOSE feed it wants. /api/feed used to answer one unauthenticated
// GET with every tenant's pending listings and posts — prices, addresses,
// captions — plus each pending's approval id. It answers with a tenant's records
// only when the caller names that tenant, so this sends the profile captured
// from the agent's own SideKick link. A device that has never opened one gets
// the status panel and empty lists, and FeedPage says why.

import { tenantQuery } from './tenant.js'

export async function getFeed() {
  try {
    const q = tenantQuery()
    const r = await fetch('/api/feed' + (q ? `?${q}` : ''))
    if (!r.ok) return { status: null, pending: [], posts: [] }
    const d = await r.json().catch(() => null)
    return d && typeof d === 'object'
      ? { status: d.status || null, pending: d.pending || [], posts: d.posts || [] }
      : { status: null, pending: [], posts: [] }
  } catch {
    return { status: null, pending: [], posts: [] }
  }
}
