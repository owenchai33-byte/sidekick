// What an agent sees when the posting account runs dry.
//
// Until now a zero-credit account failed at the provider, mid-publish, and the
// agent — who does not own the account and cannot top it up — got the raw
// error. These tests pin the three things that has to become: refuse before
// sending, say it in words a non-technical agent can pass on, and keep the post
// so it publishes after the top-up. Plus the one that keeps the guard honest:
// a usage endpoint that is down must not stop a legitimate post.
//
// PostPeer is never called for real here; there are credits on that account.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const pending = { getPending: vi.fn(), delPending: vi.fn(), claimPending: vi.fn(), releasePending: vi.fn() }
vi.mock('./pending.js', () => pending)
vi.mock('./feed.js', () => ({ appendFeed: vi.fn() }))

const { postToConnected } = await import('./social.js')
const { default: approve } = await import('../approve.js')

const ACCOUNTS = [
  { id: 'a1', platform: 'facebook', username: 'page' },
  { id: 'a2', platform: 'instagram', username: 'ig' },
  { id: 'a3', platform: 'tiktok', username: 'tt' },
]

// `usage` is what GET /v1/usage/ answers with: a balance object, the string
// 'down' for a 500, or 'unreachable' for a connection that never lands.
const install = (usage) => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url)
    calls.push(u)
    if (/\/usage\/?$/.test(u)) {
      if (usage === 'unreachable') throw new TypeError('fetch failed')
      if (usage === 'down') return new Response('boom', { status: 500 })
      return new Response(JSON.stringify({ balance: usage }), { status: 200 })
    }
    if (/\/connect\/integrations/.test(u)) {
      return new Response(JSON.stringify({ integrations: ACCOUNTS }), { status: 200 })
    }
    if (/\/posts\/?$/.test(u)) {
      return new Response(JSON.stringify({
        postId: 'p1', status: 'published',
        platforms: ACCOUNTS.map((a) => ({ platform: a.platform, success: true })),
      }), { status: 202 })
    }
    return new Response('{}', { status: 200 })
  }))
  return calls
}
const published = (calls) => calls.some((u) => /\/posts\/?$/.test(u))

const balance = (monthly, purchased = 0) => ({ monthly: { remaining: monthly }, purchased: { remaining: purchased } })
const post = (platforms) =>
  postToConnected({ caption: 'Tropics City RM338,000 — 017-1234567', mediaItems: [], profileId: 'PROF1', platforms })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.POSTING_PROVIDER = 'postpeer'
  process.env.POSTPEER_API_KEY = 'pp_test'
  process.env.INGEST_SECRET = 's3cret'
  // No Blob token: postguard's dedupe store is a no-op, so these tests exercise
  // the credit gate rather than the duplicate gate.
  delete process.env.BLOB_READ_WRITE_TOKEN
})
afterEach(() => { vi.unstubAllGlobals() })

describe('posting credits: the pre-flight', () => {
  it('publishes when there are more than enough credits', async () => {
    const calls = install(balance(50))
    const r = await post()
    expect(r.ok).toBe(true)
    expect(r.platforms).toEqual(['facebook', 'instagram', 'tiktok'])
    expect(published(calls)).toBe(true)
  })

  it('publishes on the exact balance — 3 credits for 3 platforms is enough', async () => {
    const calls = install(balance(1, 2))   // monthly + purchased are spendable together
    const r = await post()
    expect(r.ok).toBe(true)
    expect(published(calls)).toBe(true)
  })

  it('still tries when the balance is short but not empty', async () => {
    // PostPeer publishes what it can afford and reports `partial`. Refusing a
    // partly-funded post would turn posts it WOULD have published into none,
    // and nobody has verified what it actually does here - finding out costs
    // credits. So a short balance goes through, exactly as it did before.
    const short = install(balance(1))
    const three = await post()
    expect(three.blocked).toBeUndefined()
    expect(published(short)).toBe(true)
  })

  it('refuses at zero credits without calling the publish endpoint', async () => {
    const calls = install(balance(0, 0))
    const r = await post()
    expect(r.ok).toBe(false)
    expect(r.blocked).toBe('noCredits')
    expect(r.credits).toEqual({ have: 0, need: 3 })
    expect(published(calls)).toBe(false)
  })

  it('says it in words an agent can pass on, and blames nobody', async () => {
    install(balance(0, 0))
    const msg = (await post()).reason
    // no status codes, no provider name, no key names - the agent reads this out loud
    expect(msg).not.toMatch(/postpeer|http|4\d\d|5\d\d|api|token|credit balance|error/i)
    expect(msg).toMatch(/posting credits/i)
    expect(msg).toMatch(/account owner/i)      // the owner tops up, not the agent
    // It must NOT promise the post was kept: that is true when approve.js
    // refuses and false when ingest.js publishes in auto mode, and one constant
    // reaches both callers.
    expect(msg).not.toMatch(/kept|approved again/i)
  })
})

describe('posting credits: the check fails open', () => {
  it('publishes when the usage endpoint errors', async () => {
    const calls = install('down')
    const r = await post()
    expect(r.ok).toBe(true)
    expect(published(calls)).toBe(true)
  })

  it('publishes when the usage endpoint is unreachable', async () => {
    const calls = install('unreachable')
    const r = await post()
    expect(r.ok).toBe(true)
    expect(published(calls)).toBe(true)
  })

  it('publishes when the balance comes back in a shape we do not know', async () => {
    const calls = install({ credits: 'plenty' })   // unknown is not zero
    const r = await post()
    expect(r.ok).toBe(true)
    expect(published(calls)).toBe(true)
  })
})

describe('posting credits: the post is held, not lost', () => {
  const call = async () => {
    const res = { statusCode: 0, body: null, setHeader() {}, end(b) { res.body = JSON.parse(b); return res } }
    await approve(
      { method: 'POST', url: '/api/approve', headers: { 'x-ingest-secret': 's3cret' }, body: { id: 'abc', decision: 'approve' } },
      res,
    )
    return res
  }

  beforeEach(() => {
    pending.claimPending.mockResolvedValue(true)
    pending.getPending.mockResolvedValue({ caption: 'Tropics City RM338,000', profileId: 'PROF1', mediaItems: [] })
  })

  it('leaves the held post pending so it can be approved again after a top-up', async () => {
    install(balance(0, 0))
    const res = await call()
    expect(res.statusCode).toBe(200)          // not a crash the agent has to interpret
    expect(res.body.retryable).toBe(true)
    expect(res.body.blocked).toBe('noCredits')
    expect(res.body.reason).toMatch(/account owner/i)
    expect(pending.releasePending).toHaveBeenCalledWith('abc')
    expect(pending.delPending).not.toHaveBeenCalled()   // the post survives the refusal
  })

  it('publishes and clears the held post once the account has credits again', async () => {
    install(balance(10))
    const res = await call()
    expect(res.body.ok).toBe(true)
    expect(res.body.posted).toEqual(['facebook', 'instagram', 'tiktok'])
    expect(pending.delPending).toHaveBeenCalledWith('abc')
  })
})

// The dedupe claim must be released when credits refuse.
//
// postToConnected takes a 10-minute "this exact post already went out" claim
// before publishing. If a credit refusal leaves that claim standing, the
// re-approval after a top-up looks like a duplicate and is silently swallowed -
// the agent approves, nothing happens, and nothing says why.
//
// This is here because a review deleted the releasePostOnce() line and the whole
// suite still passed: every other test in this file deletes BLOB_READ_WRITE_TOKEN,
// and postguard early-returns without a token, so claim and release were both
// no-ops everywhere. A guard nothing can catch the removal of is not guarded.
describe('the dedupe claim is not left behind', () => {
  it('releases the claim so the post can be approved again after a top-up', async () => {
    vi.resetModules()
    process.env.BLOB_READ_WRITE_TOKEN = 'blob_test_token'
    process.env.POSTPEER_API_KEY = 'pp_test'
    process.env.POSTING_PROVIDER = 'postpeer'

    const del = vi.fn(async () => {})
    vi.doMock('@vercel/blob', () => ({
      // The claim SUCCEEDS - that is the real path: this post is new, it takes
      // the claim, and only then does the credit check refuse it. (Making put
      // throw instead tests the duplicate path, where no claim was taken and
      // there is correctly nothing to release.)
      put: vi.fn(async () => ({ url: 'https://blob/post-once/x.json' })),
      list: vi.fn(async () => ({ blobs: [{ url: 'https://blob/post-once/x.json', uploadedAt: new Date().toISOString() }] })),
      del,
    }))

    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url)
      if (u.includes('/usage/')) return new Response(JSON.stringify({ balance: { monthly: { remaining: 0 }, purchased: { remaining: 0 } } }), { status: 200 })
      if (u.includes('/connect/integrations')) return new Response(JSON.stringify({ integrations: ACCOUNTS }), { status: 200 })
      return new Response(JSON.stringify({ id: 'should-not-happen' }), { status: 200 })
    }))

    const { postToConnected: post } = await import('./social.js')
    const r = await post({ caption: 'x', mediaItems: [{ url: 'https://img/1.jpg' }], profileId: 'p1' })

    expect(r.ok).toBe(false)
    expect(r.blocked).toBe('noCredits')
    // del() is how releasePostOnce drops the claim. Without the release call
    // this is never reached and the next approval is treated as a duplicate.
    expect(del).toHaveBeenCalled()
  })
})
