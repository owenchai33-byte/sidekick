// A ZERNIO PUBLISH MUST FIT INSIDE THE FUNCTION IT RUNS IN.
//
// The Zernio branch polled 6 × 2000ms after accepting a post, and Zernio needs
// TWO groups (tiktok, and everything else). A three-platform publish therefore
// measured 24,030ms against a Vercel function with no maxDuration — ~10s, a
// number _lib/providers.js:36 states in this repo's own words.
//
// What that costs is not a slow post. Zernio accepts both groups and the
// listing goes LIVE; the function is then killed before appendFeed, delPending
// or releasePending run. The agent sees a gateway error and retries. Inside ten
// minutes claimPostOnce answers `duplicate`. After ten minutes
// (POST_DEDUPE_WINDOW_MS) the claim has expired and the same listing publishes
// A SECOND TIME on a client's public page.
//
// The poll only buys per-platform detail; publishing already happened when the
// request was accepted. So running out of budget means reporting what we know,
// never losing the post.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const THREE = [
  { id: 'a1', platform: 'facebook', username: 'page' },
  { id: 'a2', platform: 'instagram', username: 'ig' },
  { id: 'a3', platform: 'tiktok', username: 'tt' },
]

/** Zernio, answering the way that used to make the poll run forever. */
async function setup({ statusBody }) {
  vi.resetModules()
  const store = new Map()
  vi.doMock('@vercel/blob', () => ({
    put: vi.fn(async (key, _b, opts) => {
      if (store.has(key) && opts?.allowOverwrite === false) throw new Error('exists')
      const b = { url: `https://blob/${key}`, uploadedAt: new Date().toISOString() }
      store.set(key, b); return b
    }),
    list: vi.fn(async ({ prefix }) => ({ blobs: [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v) })),
    del: vi.fn(async () => {}),
  }))

  let polls = 0
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url)
    if (/\/accounts\?/.test(u)) return new Response(JSON.stringify({ accounts: THREE }), { status: 200 })
    if (/\/posts\/[^/?]+$/.test(u)) { polls++; return new Response(JSON.stringify(statusBody), { status: 200 }) }
    if (/\/posts\/?$/.test(u)) return new Response(JSON.stringify({ postId: 'p_1' }), { status: 202 })
    return new Response('{}', { status: 200 })
  }))

  const mod = await import('./social.js')
  return { mod, polls: () => polls }
}

beforeEach(() => {
  process.env.BLOB_READ_WRITE_TOKEN = 'tok'
  process.env.POSTING_PROVIDER = 'zernio'
  process.env.ZERNIO_API_KEY = 'zk'
})
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

const publish = (mod) => mod.postToConnected({
  caption: 'RENNA RESIDENCE — for rent\nRM2,500/month',
  captionShort: 'Condo @ The Northbank — RM2,500/mo',
  mediaItems: [{ url: 'https://cdn.test/a.jpg', type: 'image' }],
  profileId: 'P1',
})

describe('the publish poll is bounded by wall clock, not by iterations', () => {
  it('a Zernio that never reports a terminal status still returns in time', async () => {
    // The dangerous arm: `!status` stays true forever when the body names its
    // field anything but `status` — and the shape is unverified, which
    // _lib/social.js says out loud.
    const { mod } = await setup({ statusBody: { post: { state: 'whatever' } } })
    const t0 = Date.now()
    const r = await publish(mod)
    const ms = Date.now() - t0
    expect(ms).toBeLessThan(8000)            // the function dies at ~10s
    expect(r.ok).toBe(true)                  // and the post is still reported
  }, 20000)

  it('the budget covers BOTH groups, not each of them', async () => {
    // tiktok and non-tiktok are two separate publishes. Six sleeps EACH was the
    // bug; the budget is one clock across the whole call.
    const { mod, polls } = await setup({ statusBody: { post: { state: 'queued' } } })
    const t0 = Date.now()
    await publish(mod)
    expect(Date.now() - t0).toBeLessThan(8000)
    expect(polls()).toBeGreaterThan(0)       // it did poll — just not forever
  }, 20000)

  it('a terminal status still ends it immediately', async () => {
    // The budget must not make the fast path slow.
    const { mod } = await setup({ statusBody: { post: { status: 'published', platforms: [{ platform: 'facebook', status: 'published' }] } } })
    const t0 = Date.now()
    const r = await publish(mod)
    expect(Date.now() - t0).toBeLessThan(4000)
    expect(r.ok).toBe(true)
  }, 20000)

})
