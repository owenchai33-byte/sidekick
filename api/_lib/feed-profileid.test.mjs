// WHO /api/feed ANSWERS, AND WITH WHAT.
//
// This file started as "the pending projection must stay public-safe" — it held
// down the rule that adding profileId/sourceText for secret-holding callers left
// the unauthenticated payload byte-identical. That rule was kept, and it was not
// enough: the payload it was holding identical was itself the leak. A live
// unauthenticated GET returned 11 pendings and 30 posts belonging to EVERY
// tenant, and each pending's `id` is the token /api/approve takes.
//
// So the contract these tests now hold down is the three-tier one in api/feed.js:
//   secret     → everything, plus profileId / kind / sourceText   (unchanged)
//   ?profile=  → that tenant's records, and NO approval id
//   neither    → status only
//
// The deliberate change from the previous version of this file: the
// unauthenticated key set no longer contains 'id'. That was asserted here on
// purpose and is removed on purpose — src/pages/FeedPage.jsx uses p.id only as a
// React key, with `key={(p.id || p.at || i) + ...}`, so it falls through to p.at
// and the screen renders identically.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const social = { connectedAccounts: vi.fn(), defaultProfile: vi.fn(), providerConfigured: vi.fn() }
const pending = { listPending: vi.fn() }
const feed = { readFeed: vi.fn(async () => []) }
vi.mock('./social.js', () => social)
vi.mock('./providers.js', () => ({ providerStatus: () => ({ configured: true, provider: 'groq' }) }))
vi.mock('./feed.js', () => feed)
vi.mock('./pending.js', () => pending)

const { default: handler } = await import('../feed.js')

const MINE = '6a90f9f6f59d1531f8d04018'
const THEIRS = 'bb11cc22dd33ee44ff550066'

const PENDING = {
  id: 'a1a2b293', at: '2026-09-04T09:18:00.000Z', location: 'Kuching', price: 2500,
  listingType: 'rental', cover: 'https://x/y.jpg', caption: 'a real caption', mediaCount: 6,
  group: null, kind: 'social', profileId: MINE,
  sourceText: 'SECRET internal text', captionShort: 'short',
}

const call = async (url = '/api/feed', headers = {}) => {
  const res = { statusCode: 200, body: null, setHeader() {}, end(b) { this.body = JSON.parse(b); return this } }
  await handler({ method: 'GET', url, headers }, res)
  return res.body
}

beforeEach(() => {
  vi.clearAllMocks()
  social.providerConfigured.mockReturnValue({ configured: false, provider: 'postpeer' })
  social.defaultProfile.mockReturnValue('')
  pending.listPending.mockResolvedValue([PENDING])
  feed.readFeed.mockResolvedValue([])
  process.env.INGEST_SECRET = 'topsecret'
})

const PUBLIC_KEYS = ['at', 'location', 'price', 'listingType', 'cover', 'caption', 'mediaCount', 'group']

describe('anonymous (no secret, no profile) — the leak that started this', () => {
  it('hands out no pendings at all', async () => {
    const body = await call()
    expect(body.pending).toEqual([])
  })

  it('hands out no posts at all', async () => {
    feed.readFeed.mockResolvedValue([{ at: 'x', price: 880000, location: 'Jalan Song', profileId: MINE }])
    const body = await call()
    expect(body.posts).toEqual([])
    expect(JSON.stringify(body)).not.toContain('Jalan Song')
  })

  it('still answers 200 with the status panel, so the app can render its empty state', async () => {
    const res = { statusCode: 0, body: null, setHeader() {}, end(b) { this.body = JSON.parse(b); return this } }
    await handler({ method: 'GET', url: '/api/feed', headers: {} }, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.status.scope).toBe('anonymous')
    expect(typeof res.body.status.providerConfigured).toBe('boolean')
  })
})

describe('scoped by ?profile= (the home screen, opened from an agent\'s own link)', () => {
  it('returns that tenant\'s pending listing', async () => {
    const body = await call(`/api/feed?profile=${MINE}`)
    expect(body.pending).toHaveLength(1)
    expect(body.pending[0].caption).toBe('a real caption')
  })

  it('NEVER returns the approval id — the id is the token /api/approve takes', async () => {
    const body = await call(`/api/feed?profile=${MINE}`)
    expect(body.pending[0].id).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('a1a2b293')
  })

  it('exposes exactly the fields the home screen renders, and no tenant identity', async () => {
    const body = await call(`/api/feed?profile=${MINE}`)
    expect(Object.keys(body.pending[0]).sort()).toEqual([...PUBLIC_KEYS].sort())
    expect(body.pending[0].profileId).toBeUndefined()
  })

  it('never leaks the internal source text', async () => {
    const body = await call(`/api/feed?profile=${MINE}`)
    expect(JSON.stringify(body)).not.toContain('SECRET internal text')
  })

  it('does not return ANOTHER tenant\'s pending', async () => {
    const body = await call(`/api/feed?profile=${THEIRS}`)
    expect(body.pending).toEqual([])
  })

  it('returns that tenant\'s posts and not the other tenant\'s', async () => {
    feed.readFeed.mockResolvedValue([
      { at: '1', price: 880000, location: 'mine', profileId: MINE },
      { at: '2', price: 450000, location: 'theirs', profileId: THEIRS },
    ])
    const body = await call(`/api/feed?profile=${MINE}`)
    expect(body.posts).toHaveLength(1)
    expect(body.posts[0].location).toBe('mine')
    expect(JSON.stringify(body)).not.toContain('theirs')
  })

  it('withholds posts written before tenant tagging, and SAYS how many', async () => {
    // The 30 records already in the feed carry no owner. Showing them to a
    // profile-scoped caller would be a guess about whose they are; showing an
    // empty history with no explanation is the silent half of the same problem.
    feed.readFeed.mockResolvedValue([
      { at: '1', price: 1, location: 'legacy one' },
      { at: '2', price: 2, location: 'legacy two' },
      { at: '3', price: 3, location: 'tagged', profileId: MINE },
    ])
    const body = await call(`/api/feed?profile=${MINE}`)
    expect(body.posts).toHaveLength(1)
    expect(body.status.untaggedPosts).toBe(2)
    expect(JSON.stringify(body)).not.toContain('legacy one')
  })

  it('a WRONG secret is treated as unauthenticated, not as a secret-holder', async () => {
    const body = await call(`/api/feed?secret=wrong&profile=${MINE}`)
    expect(body.pending[0].profileId).toBeUndefined()
    expect(body.pending[0].id).toBeUndefined()
  })

  it('stays unauthenticated when INGEST_SECRET is unset, even if a secret is sent', async () => {
    delete process.env.INGEST_SECRET
    const body = await call(`/api/feed?secret=&profile=${MINE}`)
    expect(body.pending[0].profileId).toBeUndefined()
  })
})

describe('authenticated (sidekick.mjs status/caption, healthcheck, selftest)', () => {
  it('still gets every tenant\'s pendings — the CLI holds the secret and needs the whole list', async () => {
    pending.listPending.mockResolvedValue([PENDING, { ...PENDING, id: 'zz99', profileId: THEIRS }])
    const body = await call('/api/feed?secret=topsecret')
    expect(body.pending).toHaveLength(2)
    expect(body.status.scope).toBe('secret')
  })

  it('still gets the approval id — sidekick.mjs caption() and approve() are built on it', async () => {
    const body = await call('/api/feed?secret=topsecret')
    expect(body.pending[0].id).toBe('a1a2b293')
  })

  it('adds profileId and kind via the query string', async () => {
    const body = await call('/api/feed?secret=topsecret')
    expect(body.pending[0].profileId).toBe(MINE)
    expect(body.pending[0].kind).toBe('social')
  })

  it('adds them via the x-ingest-secret header too', async () => {
    const body = await call('/api/feed', { 'x-ingest-secret': 'topsecret' })
    expect(body.pending[0].profileId).toBe(MINE)
  })

  it('still exposes nothing beyond the public fields plus id and those three', async () => {
    const body = await call('/api/feed?secret=topsecret')
    expect(Object.keys(body.pending[0]).sort()).toEqual([...PUBLIC_KEYS, 'id', 'profileId', 'kind', 'sourceText'].sort())
    // A stray top-level `sourceText` on the record is NOT the stored source. The
    // source lives at `source.text` (api/hold.js), and only that is read.
    expect(JSON.stringify(body)).not.toContain('SECRET internal text')
  })

  it('returns the stored listing text to an authenticated caller', async () => {
    // The caption guard needs it to tell "the model is quoting the sender's own
    // listing" from "the model invented a caption". A pending the guard recovers
    // through this endpoint would otherwise lose that protection while a
    // freshly-held one kept it.
    pending.listPending.mockResolvedValue([{ ...PENDING, source: { text: 'Brand New RENNA RESIDENCE for Rent, RM2.5k' } }])
    const body = await call('/api/feed?secret=topsecret')
    expect(body.pending[0].sourceText).toBe('Brand New RENNA RESIDENCE for Rent, RM2.5k')
  })

  it('and NEVER to an unauthenticated one', async () => {
    pending.listPending.mockResolvedValue([{ ...PENDING, source: { text: 'Brand New RENNA RESIDENCE for Rent, RM2.5k' } }])
    const body = await call(`/api/feed?profile=${MINE}`)
    expect(JSON.stringify(body)).not.toContain('RENNA RESIDENCE')
    expect(body.pending[0].sourceText).toBeUndefined()
  })

  it('reports null rather than an empty string when a pending has no source', async () => {
    pending.listPending.mockResolvedValue([{ ...PENDING, source: null }])
    const body = await call('/api/feed?secret=topsecret')
    expect(body.pending[0].sourceText).toBeNull()
  })

  it('reports null rather than inventing an id when a pending has no profile', async () => {
    pending.listPending.mockResolvedValue([{ ...PENDING, profileId: undefined, kind: undefined }])
    const body = await call('/api/feed?secret=topsecret')
    expect(body.pending[0].profileId).toBeNull()
    expect(body.pending[0].kind).toBeNull()
  })

  it('still gets the untagged legacy posts — it is the only caller that can know whose they are', async () => {
    feed.readFeed.mockResolvedValue([{ at: '1', price: 1, location: 'legacy' }])
    const body = await call('/api/feed?secret=topsecret')
    expect(body.posts).toHaveLength(1)
  })
})

describe('a malformed url cannot break the feed', () => {
  it('still answers 200', async () => {
    const res = { statusCode: 0, body: null, setHeader() {}, end(b) { this.body = JSON.parse(b); return this } }
    await handler({ method: 'GET', url: '://not a url', headers: {} }, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.pending).toEqual([])
  })
})
