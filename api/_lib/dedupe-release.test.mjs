// A failed publish must not keep its dedupe claim — and a publish that may have
// worked must keep it.
//
// postToConnected takes a 10-minute "this exact post already went out" claim
// BEFORE it publishes. Confirmed 2026-09-03: the human taps the tick, the
// publish fails because Instagram is not linked yet, approve.js releases the
// pending and answers retryable:true, AGENTS.md tells the agent it may retry
// that id — and the retry hits the claim nobody released, gets
// duplicate:true, and the agent tells the human it already posted. The listing
// is unpublishable for the full window behind a false success. Silent, total.
//
// The opposite mistake is just as real, and was measured 2026-09-04 when an
// earlier fix released on `!posted.length`: that branch also catches a post
// PostPeer accepted and is still uploading, so the retry published the whole set
// a second time — two publish calls where there should have been one.
//
// The rule these tests encode: release only on the PROVIDER's own word that
// nothing is live — every target platform reporting a terminal status, or an
// outright 4xx refusal. Anything ambiguous keeps the claim, because a silent
// ten-minute refusal is recoverable and a duplicate on a client's public
// Facebook page is not.
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
 * `accounts` is what /connect/integrations answers with; `publish` is called for
 * each POST /posts/ and returns that call's Response, so a test can hand the
 * retry a different answer from the first attempt.
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
  // How many times we actually asked the provider to publish. The double-post
  // this file guards against is invisible to a return value; it is this count.
  const publishCalls = () => calls.filter((u) => /\/posts\/?$/.test(u)).length
  return { postToConnected, blob, calls, publishCalls }
}

/** Answer the first publish with `a`, every later one with `b`. */
const then = (a, b) => { let n = 0; return () => (n++ === 0 ? a() : b()) }

// Terminal TOP-LEVEL statuses only — 'publishing' would send postToConnected
// into its 2s-per-attempt poll loop and make this suite crawl.
const ok202 = (platforms, status) =>
  new Response(JSON.stringify({ postId: 'p1', status, platforms }), { status: 202 })
const ALL_OK = () => ok202([{ platform: 'facebook', success: true }, { platform: 'instagram', success: true }], 'published')
const PARTIAL = () => ok202(
  [{ platform: 'facebook', success: true },
   { platform: 'instagram', success: false, errorMessage: 'not linked' }], 'partial')
// Every target platform says, in its own status field, that it is dead.
const ALL_TERMINAL = () => ok202(
  [{ platform: 'facebook', status: 'failed', errorMessage: 'token expired' },
   { platform: 'instagram', status: 'failed', errorMessage: 'not linked' }], 'failed')
// success:false with NO per-platform status - the shape an expired Facebook
// token actually produces, and the documented field. Terminal: nothing is live.
// (The earlier note here said this was "not proof of anything"; it is, and
// PostPeer never writes that while a platform is still uploading.
const NO_STATUS = () => ok202(
  [{ platform: 'facebook', success: false, errorMessage: 'token expired' },
   { platform: 'instagram', success: false, errorMessage: 'not linked' }], 'failed')
// The measured double-post: Facebook is dead, the reel is still going up.
const ONE_STILL_UPLOADING = () => ok202(
  [{ platform: 'facebook', status: 'failed', errorMessage: 'token expired' },
   { platform: 'instagram', status: 'pending' }], 'failed')
// Instagram was a target but is simply absent from the response.
const ONE_SILENT = () => ok202([{ platform: 'facebook', status: 'failed', errorMessage: 'token expired' }], 'failed')

const LISTING = { caption: 'Tropics City RM338,000 — 017-1234567', mediaItems: [{ url: 'https://img/1.jpg' }], profileId: 'PROF1' }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.POSTING_PROVIDER = 'postpeer'
  process.env.POSTPEER_API_KEY = 'pp_test'
  // Without this postguard is a no-op and every assertion below is vacuous.
  process.env.BLOB_READ_WRITE_TOKEN = 'blob_test_token'
})
afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock('@vercel/blob') })

describe('provably nothing published → the claim is released', () => {
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

  it('releases when EVERY target platform reports a terminal status', async () => {
    const { postToConnected, blob } = await setup({ publish: ALL_TERMINAL })
    const r = await postToConnected({ ...LISTING })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/token expired/)
    // Both platforms said 'failed' in their own status field. Nothing is live,
    // so the retry after the agent reconnects must not be swallowed.
    expect(blob.del).toHaveBeenCalled()
    expect(blob.store.size).toBe(0)
  })

  it('the retry after a terminal failure actually publishes instead of lying', async () => {
    // End to end, this is the bug: without the release the second call returns
    // duplicate:true and the agent tells the human the listing is already up.
    const { postToConnected, publishCalls } = await setup({ publish: then(ALL_TERMINAL, ALL_OK) })
    const first = await postToConnected({ ...LISTING })
    expect(first.ok).toBe(false)
    const retry = await postToConnected({ ...LISTING })
    expect(retry.duplicate).toBeUndefined()
    expect(retry.ok).toBe(true)
    expect(retry.platforms).toEqual(['facebook', 'instagram'])
    expect(publishCalls()).toBe(2)
  })

  it.each(['error', 'rejected'])('treats a %s status as terminal too', async (word) => {
    const publish = () => ok202(
      [{ platform: 'facebook', status: word }, { platform: 'instagram', status: word }], 'failed')
    const { postToConnected, blob } = await setup({ publish })
    await postToConnected({ ...LISTING })
    expect(blob.store.size).toBe(0)
  })

  it.each([400, 401, 403, 422])('releases on a PostPeer %i — the request was refused outright', async (code) => {
    const { postToConnected, blob } = await setup({ publish: () => new Response('nope', { status: code }) })
    const r = await postToConnected({ ...LISTING })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(new RegExp(`PostPeer ${code}`))
    expect(blob.del).toHaveBeenCalled()
    expect(blob.store.size).toBe(0)
  })

  it('the retry after a 401 publishes once the key is fixed', async () => {
    const { postToConnected, publishCalls } = await setup({
      publish: then(() => new Response('bad key', { status: 401 }), ALL_OK),
    })
    await postToConnected({ ...LISTING })
    const retry = await postToConnected({ ...LISTING })
    expect(retry.ok).toBe(true)
    expect(publishCalls()).toBe(2)
  })
})

describe('anything ambiguous keeps the claim', () => {
  // Every case below was written the other way round first, and each one costs a
  // duplicate on a client's public page if it is released.
  it.each([500, 502, 504, 429, 408])('keeps the claim on a PostPeer %i — the post may have been accepted', async (code) => {
    const { postToConnected, blob } = await setup({ publish: () => new Response('upstream exploded', { status: code }) })
    const r = await postToConnected({ ...LISTING })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(new RegExp(`PostPeer ${code}`))
    // A gateway 5xx cannot be told apart from "processed, response lost", and a
    // 429 or 408 can arrive after the post was already queued.
    expect(blob.del).not.toHaveBeenCalled()
    expect(blob.store.size).toBe(1)
  })

  it('keeps the claim when one platform is still uploading', async () => {
    // The measured regression: Facebook is terminally dead but the Instagram
    // reel is 'pending', and `!posted.length` catches both. Releasing here let a
    // retry publish the whole set twice on 2026-09-04.
    const { postToConnected, blob } = await setup({ publish: ONE_STILL_UPLOADING })
    const r = await postToConnected({ ...LISTING })
    expect(r.ok).toBe(false)
    expect(blob.del).not.toHaveBeenCalled()
    expect(blob.store.size).toBe(1)
  })

  it('keeps the claim when a target platform is missing from the response', async () => {
    // Instagram was asked for and said nothing at all. Silence is not failure.
    const { postToConnected, blob } = await setup({ publish: ONE_SILENT })
    await postToConnected({ ...LISTING })
    expect(blob.del).not.toHaveBeenCalled()
    expect(blob.store.size).toBe(1)
  })

  it('releases on success:false, which is how a dead platform actually reports', async () => {
    // This test asserted the opposite first, and that is exactly why the fix did
    // not work: the 2026-09-03 incident is an expired Facebook token, and
    // PostPeer reports that as success:false with an errorMessage and no
    // per-platform status. Treating it as "unknown" left the claim standing and
    // the retry still came back duplicate.
    const { postToConnected, blob } = await setup({ publish: NO_STATUS })
    const r = await postToConnected({ ...LISTING })
    expect(r.ok).toBe(false)
    expect(blob.del).toHaveBeenCalled()
    expect(blob.store.size).toBe(0)
  })

  it('a retry after an ambiguous failure is refused rather than risking a double post', async () => {
    const { postToConnected, blob, publishCalls } = await setup({ publish: then(ONE_STILL_UPLOADING, ALL_OK) })
    await postToConnected({ ...LISTING })
    const again = await postToConnected({ ...LISTING })
    expect(again.duplicate).toBe(true)
    expect(publishCalls()).toBe(1)     // the second publish never left the building
    expect(blob.store.size).toBe(1)
  })

  // No Zernio equivalent here on purpose. POSTING_PROVIDER is postpeer in
  // production, so that branch is not the one that runs, and a test whose
  // outcome is decided by the mock rather than the logic is worse than no test.
  // The code path keeps its claim for the same reason as PostPeer's 5xx above:
  // `posted` only fills on a 2xx, so an all-groups-failed result cannot be told
  // apart from a swallowed response, and Zernio returns no per-platform status
  // to resolve it with.

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

// A release rule must not touch a post that WORKS. These are the listing shapes
// that actually come off the Kuching WhatsApp feed — sale and rental, land and
// room, one line and many, English, Chinese and Malay, prices written every way
// an agent writes them. Each must publish, keep its claim, and still refuse an
// identical immediate re-send: exactly the behaviour before this change.
const CORPUS = [
  ['sale, comma price', 'Tropics City RM338,000 — 3 bed 2 bath, 1,200 sqft. Call 017-1234567'],
  ['sale, no RM prefix', 'Freehold terrace at Batu Kawa. 338,000 nego. WhatsApp 016-8887777'],
  ['rental, k shorthand', 'Whole block Stutong 450k nego, rooms from RM650/month'],
  ['rental, decimal k', 'Shoplot Jalan Song RM2.5k/month, ready to move. 019-2223344'],
  ['sale, juta', 'Bungalow Petra Jaya 1.25 juta. Tanah 8,000 kaki persegi. Hubungi 013-4445555'],
  ['chinese sale', '古晋 Tabuan Jaya 排屋出售 售价 430,000，三房两厕，联系 018-7776666'],
  ['chinese rental', '诗巫店屋出租，月租 RM1,800，可议价。电话 014-2223333'],
  ['malay sale', 'Rumah teres untuk dijual di Kota Samarahan, harga RM385,000. Hubungi 011-23456789'],
  ['malay rental', 'Bilik sewa berhampiran UNIMAS RM500 sebulan, termasuk internet. 010-9998888'],
  ['all caps', 'RARE UNIT! RIVERIA HEIGHTS FOR SALE RM520,000 ONLY. CALL 017-3334444 NOW'],
  ['land', 'Land for sale Kuching-Serian road, 2.3 acres, RM1,150,000. Agent 019-8765432'],
  ['multi-line sale', 'RENNA RESIDENCE\nFor Sale\nRM438,000\n787 sqft, 12th floor\nContact 017-1112222'],
  ['multi-line rental', 'For Rent\nVivacity Suites\nRM1,600/month\nFully furnished by owner\n018-5556666'],
  ['one line, many numbers', '3 storey shoplot RM1,880,000 | 4,500 sqft | rental return RM7,000/mth | 016-2223344'],
  ['below-value hook', 'Icom Square office RM290,000, RM60k below bank value. Call 017-9990000'],
  ['room only', 'Single room Jalan Green RM450 per month, female only, 013-1112223'],
  ['mixed en/zh', 'Kuching semi-D for sale RM880,000。面积 3,200 sqft。Call 019-1234567'],
  ['emoji heavy', '🔥 HOT LISTING 🔥 Sapphire on the Park RM620,000 ✨ 1,050 sqft ✨ 017-4445555'],
  ['short one-liner', 'Kuching city terrace RM299,000. 018-1231234'],
  ['long description', 'Beautiful double storey at Stampin, walking distance to the market, well kept by the current owner, asking RM465,000 and open to serious offers. Viewing anytime, contact 017-6667777 to arrange.'],
]

describe('MUST-PASS: real listings still publish, keep the claim, and stay deduped', () => {
  it.each(CORPUS)('%s', async (_label, caption) => {
    const { postToConnected, blob, publishCalls } = await setup({ publish: ALL_OK })
    const listing = { caption, mediaItems: [{ url: `https://img/${encodeURIComponent(caption.slice(0, 12))}.jpg` }], profileId: 'PROF1' }
    const r = await postToConnected(listing)
    expect(r.ok).toBe(true)
    expect(r.platforms).toEqual(['facebook', 'instagram'])
    expect(blob.del).not.toHaveBeenCalled()
    expect(blob.store.size).toBe(1)
    // and the double-tap this whole guard exists for is still refused
    const again = await postToConnected(listing)
    expect(again.duplicate).toBe(true)
    expect(publishCalls()).toBe(1)
  })
})
