// Powers the app's agent-first home. One GET returns:
//   status  — is the content engine live? how many accounts are connected?
//   pending — what is waiting for a ✅
//   posts   — what has gone out (newest first)
//
// WHO SEES WHAT. There are three answers, and the difference between them is the
// whole point of this file:
//
//   1. INGEST_SECRET  → everything, plus the tenant fields (profileId, kind,
//      sourceText). This is sidekick.mjs and the crons, on a machine that holds
//      the secret. Unchanged.
//   2. ?profile=<id>  → that tenant's pendings and that tenant's posts, and the
//      approval id is withheld.
//   3. nothing        → status only. No pendings, no posts.
//
// Until today there was one answer for everybody. A live unauthenticated GET
// returned 11 pending items and 30 posts across ALL tenants — prices, addresses,
// captions — and, worse, each pending's `id` IS the approval token that
// /api/approve takes. Anyone with the URL could read fifty agents' listings and
// hold the id needed to act on them.
//
// TWO HONEST LIMITS, so nobody reads more into this than it does:
//   * `?profile=` is NOT a credential. It is in every Connect link WhatsApped to
//     a client, in their address bar, and in /api/ingest's response body. Scoping
//     by it stops one tenant ACCIDENTALLY seeing another's data — which is the
//     realistic failure at fifty agents — and stops nothing deliberate. The
//     deliberate half needs a token in the link, and the two scripts that compose
//     those links live outside this repo (see _lib/tenant.js).
//   * Feed records written before today carry NO owner (appendFeed never wrote
//     one), so they can be shown to nobody but the secret-holder without guessing
//     whose they are. `status.untaggedPosts` says how many are being withheld for
//     that reason, so an agent whose history looks short is told why instead of
//     quietly wondering. Records written from now on carry profileId.

import { readFeed } from './_lib/feed.js'
import { listPending } from './_lib/pending.js'
import { providerStatus } from './_lib/providers.js'
import { connectedAccounts, providerConfigured } from './_lib/social.js'

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}

// Exactly what the home screen renders (src/pages/FeedPage.jsx): cover, price,
// listingType, at, location, caption — and `id` only as a React key, which
// already falls through to `p.at`. So withholding the approval id from an
// unauthenticated caller costs the UI nothing.
const publicPending = (p) => ({
  at: p.at, location: p.location, price: p.price, listingType: p.listingType,
  cover: p.cover, caption: p.caption, mediaCount: p.mediaCount, group: p.group,
})

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'GET only' })

  let q
  try { q = new URL(req.url, 'http://x').searchParams } catch { q = new URLSearchParams() }
  const provided = req.headers?.['x-ingest-secret'] || q.get('secret') || ''
  const authed = !!process.env.INGEST_SECRET && provided === process.env.INGEST_SECRET
  const profile = (q.get('profile') || '').trim()

  const status = providerStatus()
  const posting = providerConfigured()

  // null means UNKNOWN, and it is not the same as zero.
  //
  // This used to ask for the DEFAULT profile's accounts and swallow the error.
  // With no default configured — which is deliberate; _lib/social.js documents
  // that a multi-tenant account has no safe default — the call always threw,
  // `accounts` stayed empty, and the home screen rendered a red
  // "No accounts — connect" over an account with Facebook, Instagram and TikTok
  // all live. The fix is not to configure a default (that re-arms cross-tenant
  // publishing); it is to ask about the profile the caller actually named, and
  // to answer "I cannot tell" when they named none.
  let accounts = null
  if (posting.configured && profile) {
    try { accounts = await connectedAccounts(profile) } catch { accounts = null }
  }

  const [posts, pending] = await Promise.all([readFeed(30), listPending(20)])

  const myPending = authed ? pending : (profile ? pending.filter((p) => p?.profileId === profile) : [])
  const myPosts = authed ? posts : (profile ? posts.filter((p) => p?.profileId === profile) : [])
  const untaggedPosts = authed ? 0 : posts.filter((p) => !p?.profileId).length

  return send(res, 200, {
    status: {
      providerConfigured: status.configured,
      provider: status.provider,
      postingProvider: posting.provider,
      postingKey: posting.configured,
      zernioKey: posting.configured, // kept for the existing UI field name
      connectedAccounts: accounts ? accounts.length : null,
      platforms: accounts ? accounts.map((a) => a.platform) : [],
      // How this response was scoped, so the UI can say WHY a list is empty
      // rather than showing a bare "nothing here yet".
      scope: authed ? 'secret' : profile ? 'profile' : 'anonymous',
      untaggedPosts,
    },
    pending: myPending.map((p) => (authed
      ? {
        id: p.id, ...publicPending(p),
        // `profileId` is tenant identity and `sourceText` is the agent's own
        // listing; the caption guard needs both to prove a caption it is about
        // to show in WhatsApp belongs to this sender. Secret-holders only.
        profileId: p.profileId || null, kind: p.kind || null, sourceText: p.source?.text || null,
      }
      : publicPending(p))),
    posts: myPosts.map((p) => {
      if (authed) return p
      const { profileId, ...rest } = p || {}
      return rest
    }),
  })
}
