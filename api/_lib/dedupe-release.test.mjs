// A failed publish must not keep its dedupe claim.
//
// postToConnected takes a 10-minute "this exact post already went out" claim
// BEFORE it publishes. Confirmed 2026-09-03: the human taps the tick, the
// publish fails because Instagram is not linked yet, approve.js releases the
// pending and answers retryable:true, AGENTS.md tells the agent it may retry
// that id — and the retry hits the claim nobody released, gets
// duplicate:true, and the agent tells the human it already posted. The listing
// is unpublishable for the full window behind a false success. Silent, total.
//
// The opposite mistake is just as real: if SOME platforms published, the claim
// must STAY, or the retry re-publishes the whole set and double-posts to the
// ones that succeeded — a visible duplicate on a client's public page.
//
// Note postguard early-returns when BLOB_READ_WRITE_TOKEN is unset, so a test
// that forgets to set it passes vacuously against a no-op store. Every test
// here sets it. The blob mock is a real little store rather than stubs, so the
// retry assertions exercise the actual claim/release round trip.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ACCOUNTS = [
  { id: 'a1', platform: 'facebook', username: 'page' },
  { id: 'a2', platform: 'instagram', username: 'ig' },
]

/** An in-memory stand-in for @vercel/blob that honours allowOverwrite:false. */
function fakeBlob() {
  const store = new Map()
  return {
    store,
    put: vi.fn(async (key, _body, opts) => {
      if (store.has(key) && opts?.allowOverwrite === false) throw new Error('blob already exists')
      const b = { url: `https://blob/${key}`, uploadedAt: new Date().toISOString() }
      store.set(key, b)
      return b
    }),
    list: vi.fn(async ({ prefix }) => ({
      blobs: [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v),
    })),
    del: vi.fn(async (url) => {
      for (const [k, v] of store) if (v.url === url) store.delete(k)
    }),
  }
}

/**
 * `accounts` is what /connect/integrations answers with; `publish` is the
 * Response the POST /posts/ call gets back. Returns { post, blob, calls }.
 */
async function setup({ accounts = ACCOUNTS, publish } = {}) {
  vi.resetModules()
  const blob = fakeBlob()
  vi.doMock('@vercel/blob', () => ({ put: blob.put, list: blob.list, del: blob.del }))

  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url)
    calls.push(u)
    // Plenty of credits: this file is about the dedupe claim, not the credit
    // gate, and that gate already releases correctly (see credits.test.mjs).
    if (/\/usage\/?$/.test(u)) {
      return new Response(JSON.stringify({ balance: { monthly: { remaining: 99 }, purchased: { remaining: 0 } } }), { status: 200 })
    }
    if (/\/connect\/integrations/.test(u)) {
      return new Response(JSON.stringify({ integrations: accounts }), { status: 200 })
    }
    if (/\/posts\/?$/.test(u)) return publish()
    return new Response('{}', { status: 200 })
  }))

  const { postToConnected } = await import('./social.js')
  return { postToConnected, blob, calls }
}

// Terminal statuses only — 'publishing' would send postToConnected into its
// 2s-per-attempt poll loop and make this suite crawl.
const ok202 = (platforms, status) =>
  new Response(JSON.stringify({ postId: 'p1', status, platforms }), { status: 202 })
const ALL_OK = () => ok202([{ platform: 'facebook', success: true }, { platform: 'instagram', success: true }], 'published')
const ALL_FAILED = () => ok202(
  [{ platform: 'facebook', success: false, errorMessage: 'token expired' },
   { platform: 'instagram', success: false, errorMessage: 'not linked' }], 'failed')
const PARTIAL = () => ok202(
  [{ platform: 'facebook', success: true },
   { platform: 'instagram', success: false, errorMessage: 'not linked' }], 'partial')

const LISTING = { caption: 'Tropics City RM338,000 — 017-1234567', mediaItems: [{ url: 'https://img/1.jpg' }], profileId: 'PROF1' }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.POSTING_PROVIDER = 'postpeer'
  process.env.POSTPEER_API_KEY = 'pp_test'
  // Without this postguard is a no-op and every assertion below is vacuous.
  process.env.BLOB_READ_WRITE_TOKEN = 'blob_test_token'
})
afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock('@vercel/blob') })

describe('nothing published → the claim is released', () => {
  it('releases when the requested platform has no connected account', async () => {
    // The exact incident: the human approves, Instagram was never linked.
    const { postToConnected, blob } = await setup({ accounts: [{ id: 'a1', platform: 'facebook' }] })
    const r = await postToConnected({ ...LISTING, platforms: ['instagram'] })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/No instagram account connected/)
    expect(blob.del).toHaveBeenCalled()
    expect(blob.store.size).toBe(0)
  })

  it('releases when there are no connected accounts at all', async () => {
    const { postToConnected, blob } = await setup({ accounts: [] })
    const r = await postToConnected({ ...LISTING })
    expect(r.ok).toBe(false)
    expect(blob.store.size).toBe(0)
  })

  // The three cases below KEEP the claim on purpose, and each one was written the
  // other way round first. The rule they encode: release only when we can prove
  // nothing was published. Anything ambiguous keeps the claim, because a silent
  // ten-minute refusal is recoverable and a duplicate on a client's public
  // Facebook page is not.
  it('keeps the claim on a PostPeer 502 — the post may have been accepted', async () => {
    const { postToConnected, blob } = await setup({ publish: () => new Response('upstream exploded', { status: 502 }) })
    const r = await postToConnected({ ...LISTING })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/PostPeer 502/)
    // A gateway 502 cannot be told apart from "processed, response lost".
    expect(blob.del).not.toHaveBeenCalled()
    expect(blob.store.size).toBe(1)
  })

  it('keeps the claim when no platform reports published — they may still be uploading', async () => {
    const { postToConnected, blob } = await setup({ publish: ALL_FAILED })
    const r = await postToConnected({ ...LISTING })
    expect(r.ok).toBe(false)
    // `!posted.length` also matches "still pending": ok2 counts only
    // status 'published', and the poll loop gives up after 12s. A TikTok reel
    // sits in exactly that state.
    expect(blob.del).not.toHaveBeenCalled()
    expect(blob.store.size).toBe(1)
  })

  // No Zernio equivalent here on purpose. POSTING_PROVIDER is postpeer in
  // production, so that branch is not the one that runs, and a test whose
  // outcome is decided by the mock rather than the logic is worse than no test.
  // The code path keeps its claim for the same reason as PostPeer above: `posted`
  // only fills on a 2xx, so an all-groups-failed result cannot be told apart from
  // a swallowed response.

  it('a retry after an ambiguous failure is refused rather than risking a double post', async () => {
    const { postToConnected, blob } = await setup({ publish: ALL_FAILED })
    await postToConnected({ ...LISTING })
    const again = await postToConnected({ ...LISTING })
    expect(again.duplicate).toBe(true)
    expect(blob.store.size).toBe(1)
  })

  it('keeps the claim on a full success', async () => {
    const { postToConnected, blob } = await setup({ publish: ALL_OK })
    const r = await postToConnected({ ...LISTING })
    expect(r.ok).toBe(true)
    expect(r.platforms).toEqual(['facebook', 'instagram'])
    expect(blob.del).not.toHaveBeenCalled()
    expect(blob.store.size).toBe(1)
  })

  it('keeps the claim on a PARTIAL success — Facebook is already live', async () => {
    const { postToConnected, blob } = await setup({ publish: PARTIAL })
    const r = await postToConnected({ ...LISTING })
    expect(r.ok).toBe(true)
    expect(r.platforms).toEqual(['facebook'])
    expect(r.partialErrors).toEqual(['instagram: not linked'])
    // Releasing here would let a retry re-publish to Facebook: a visible
    // duplicate on the client's page, which is worse than Instagram staying
    // unposted and reported.
    expect(blob.del).not.toHaveBeenCalled()
    expect(blob.store.size).toBe(1)
  })

  it('blocks a re-send of a partially published post', async () => {
    const { postToConnected } = await setup({ publish: PARTIAL })
    await postToConnected({ ...LISTING })
    const again = await postToConnected({ ...LISTING })
    expect(again.ok).toBe(false)
    expect(again.duplicate).toBe(true)
  })
})
