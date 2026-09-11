// THE ZERNIO BRANCH, which is the one that goes live on switch day and the one
// nothing tested.
//
// Measured before this file existed: `grep -rn "POSTING_PROVIDER" --include=
// "*.test.mjs" api/` returned four lines and every one of them pins 'postpeer'.
// dedupe-release.test.mjs declines the Zernio case in a comment on the grounds
// that "POSTING_PROVIDER is postpeer in production, so that branch is not the
// one that runs". That was true. The switch falsifies it, and turns that comment
// into a map of the untested code.
//
// Two defects this pins shut, both of which this codebase has already shipped
// once on the PostPeer side and written incident notes about:
//
//   1. FALSE SUCCESS. The branch pushed every platform in the group on a bare
//      HTTP 2xx and never opened the response body — while the PostPeer branch
//      directly above it carries the comment "Reporting 'posted to all' just
//      because the HTTP call worked is how a listing that failed on Instagram
//      gets announced as published everywhere. Read the body."
//
//   2. THE UN-RELEASED CLAIM. A 4xx left the dedupe claim standing, so the
//      agent's corrected retry came back duplicate:true and the agent told the
//      human it had already posted. That is the incident at social.js:255-263,
//      reintroduced one provider along.
//
// And one thing these tests deliberately protect: when Zernio returns NO
// per-platform detail, the optimistic answer stays. Zernio's response shape is
// not verified anywhere (there is no Zernio key on this machine to verify it
// with), so a guess about the shape must never turn a real post into a reported
// failure.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ACCOUNTS = [
  { _id: 'z1', platform: 'facebook', username: 'page' },
  { _id: 'z2', platform: 'instagram', username: 'ig' },
]

function fakeBlob() {
  const store = new Map()
  return {
    store,
    put: vi.fn(async (key, _b, opts) => {
      if (store.has(key) && opts?.allowOverwrite === false) throw new Error('blob already exists')
      const b = { url: `https://blob/${key}`, uploadedAt: new Date().toISOString() }
      store.set(key, b)
      return b
    }),
    list: vi.fn(async ({ prefix }) => ({ blobs: [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v) })),
    del: vi.fn(async (url) => { for (const [k, v] of store) if (v.url === url) store.delete(k) }),
  }
}

async function setup({ accounts = ACCOUNTS, publish, accountsStatus = 200, accountsBody } = {}) {
  vi.resetModules()
  const blob = fakeBlob()
  vi.doMock('@vercel/blob', () => ({ put: blob.put, list: blob.list, del: blob.del }))

  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const u = String(url)
    calls.push({ url: u, init })
    if (/\/accounts\?/.test(u)) {
      return new Response(JSON.stringify(accountsBody ?? { accounts }), { status: accountsStatus })
    }
    if (/\/posts$/.test(u)) return publish ? publish() : new Response('{}', { status: 200 })
    return new Response('{}', { status: 200 })
  }))

  const social = await import('./social.js')
  const publishCalls = () => calls.filter((c) => /\/posts$/.test(c.url)).length
  return { ...social, blob, calls, publishCalls }
}

const LISTING = { caption: 'KOTA SAMARAHAN Tropics City RM1,300 a month — 017-1234567', mediaItems: [{ url: 'https://img/1.jpg' }], profileId: 'AGENT1' }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.POSTING_PROVIDER = 'zernio'
  process.env.ZERNIO_API_KEY = 'zk_test'
  process.env.BLOB_READ_WRITE_TOKEN = 'blob-token'
  delete process.env.ZERNIO_PROFILE_ID
})
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

// -----------------------------------------------------------------------------

describe('it does not announce posts it has not verified', () => {
  it('reports ONLY the platforms the body says succeeded', async () => {
    // Zernio accepts the call (2xx) but Instagram failed inside it. The old code
    // told the agent it went to Facebook AND Instagram.
    const { postToConnected } = await setup({
      publish: () => new Response(JSON.stringify({
        postId: 'zp1', status: 'partial',
        platforms: [
          { platform: 'facebook', success: true, platformPostUrl: 'https://fb.test/1' },
          { platform: 'instagram', success: false, errorMessage: 'token expired' },
        ],
      }), { status: 202 }),
    })
    const r = await postToConnected({ ...LISTING })
    expect(r.ok).toBe(true)
    expect(r.platforms).toEqual(['facebook'])
    expect(r.platforms).not.toContain('instagram')
    expect(r.partialErrors.join(' ')).toMatch(/instagram: token expired/)
    expect(r.postUrls.join(' ')).toMatch(/facebook: https:\/\/fb\.test\/1/)
  })

  it('fails the whole post when every platform reports itself dead', async () => {
    const { postToConnected } = await setup({
      publish: () => new Response(JSON.stringify({
        postId: 'zp1', status: 'failed',
        platforms: [
          { platform: 'facebook', status: 'failed', errorMessage: 'token expired' },
          { platform: 'instagram', status: 'failed', errorMessage: 'not linked' },
        ],
      }), { status: 202 }),
    })
    const r = await postToConnected({ ...LISTING })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/token expired/)
  })

  it('STAYS OPTIMISTIC when the body carries no per-platform detail', async () => {
    // Unchanged behaviour, and deliberately so: Zernio's response shape is not
    // verified here, and a guess must never turn a successful post into a
    // reported failure.
    const { postToConnected } = await setup({
      publish: () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    })
    const r = await postToConnected({ ...LISTING })
    expect(r.ok).toBe(true)
    expect(r.platforms.sort()).toEqual(['facebook', 'instagram'])
  })

  it('is not fooled by a body that is not JSON at all', async () => {
    const { postToConnected } = await setup({
      publish: () => new Response('<html>gateway</html>', { status: 200 }),
    })
    const r = await postToConnected({ ...LISTING })
    expect(r.ok).toBe(true)
    expect(r.platforms.sort()).toEqual(['facebook', 'instagram'])
  })
})

describe('the dedupe claim is released only on proof that nothing is live', () => {
  it('RELEASES on an outright 4xx, so a corrected retry is not swallowed', async () => {
    // The whole incident: agent fixes the caption, retries, and is told it was
    // already posted when nothing ever was.
    const { postToConnected, publishCalls } = await setup({
      publish: () => new Response(JSON.stringify({ error: 'bad media' }), { status: 400 }),
    })
    const first = await postToConnected({ ...LISTING })
    expect(first.ok).toBe(false)
    expect(first.error).toMatch(/400/)

    const retry = await postToConnected({ ...LISTING })
    expect(retry.duplicate).toBeUndefined()
    expect(publishCalls()).toBe(2)      // the retry really did leave the building
  })

  it('KEEPS the claim on a 5xx — that could have been processed', async () => {
    const { postToConnected, publishCalls } = await setup({
      publish: () => new Response('gateway timeout', { status: 504 }),
    })
    await postToConnected({ ...LISTING })
    const retry = await postToConnected({ ...LISTING })
    expect(retry.duplicate).toBe(true)
    expect(publishCalls()).toBe(1)      // and the second publish never happened
  })

  it('KEEPS the claim on 429 and 408, which can arrive after queueing', async () => {
    for (const status of [429, 408]) {
      const { postToConnected, publishCalls } = await setup({
        publish: () => new Response('slow down', { status }),
      })
      await postToConnected({ ...LISTING })
      const retry = await postToConnected({ ...LISTING })
      expect(retry.duplicate).toBe(true)
      expect(publishCalls()).toBe(1)
    }
  })

  it('KEEPS the claim when a target platform stays silent', async () => {
    // Instagram was a target and simply is not in the response. Unknown means
    // possibly live, and releasing here is how the whole set gets published twice.
    const { postToConnected, publishCalls } = await setup({
      publish: () => new Response(JSON.stringify({
        postId: 'zp1', status: 'failed',
        platforms: [{ platform: 'facebook', status: 'failed', errorMessage: 'token expired' }],
      }), { status: 202 }),
    })
    await postToConnected({ ...LISTING })
    const retry = await postToConnected({ ...LISTING })
    expect(retry.duplicate).toBe(true)
    expect(publishCalls()).toBe(1)
  })

  it('KEEPS the claim on a partial success — the live half must not double-post', async () => {
    const { postToConnected, publishCalls } = await setup({
      publish: () => new Response(JSON.stringify({
        postId: 'zp1', status: 'partial',
        platforms: [
          { platform: 'facebook', success: true },
          { platform: 'instagram', success: false, errorMessage: 'not linked' },
        ],
      }), { status: 202 }),
    })
    await postToConnected({ ...LISTING })
    const retry = await postToConnected({ ...LISTING })
    expect(retry.duplicate).toBe(true)
    expect(publishCalls()).toBe(1)
  })
})

describe('listing accounts', () => {
  it('asks for a page size, so a busy agent is not silently truncated', async () => {
    const { connectedAccounts, calls } = await setup({})
    await connectedAccounts('AGENT1')
    const u = calls.find((c) => /\/accounts\?/.test(c.url)).url
    expect(u).toMatch(/limit=100/)
    expect(u).toMatch(/profileId=AGENT1/)
  })

  it('carries the response BODY into the error, not just a status code', async () => {
    // A bare "Zernio accounts 404" reaches the agent through postToConnected's
    // catch as "zernio unreachable: Zernio accounts 404" — which is not
    // actionable and is a lie, because an unknown profile is not an outage.
    const { connectedAccounts } = await setup({ accountsStatus: 404, accountsBody: { error: 'profile not found' } })
    await expect(connectedAccounts('AGENT1')).rejects.toThrow(/profile not found/)
  })

  it('surfaces a stale token, but only on a word that certainly means dead', async () => {
    const { connectedAccounts } = await setup({
      accounts: [
        { _id: 'z1', platform: 'facebook', authStatus: 'expired' },
        { _id: 'z2', platform: 'instagram', authStatus: 'active' },
        // An unfamiliar word must NOT be reported as broken: inventing a
        // "reconnect" prompt for a working account is its own silent refusal.
        { _id: 'z3', platform: 'tiktok', authStatus: 'healthy-ish' },
      ],
    })
    const a = await connectedAccounts('AGENT1')
    expect(a.find((x) => x.platform === 'facebook').broken).toBe('expired')
    expect(a.find((x) => x.platform === 'instagram').broken).toBeNull()
    expect(a.find((x) => x.platform === 'tiktok').broken).toBeNull()
  })

  it('refuses an unnamed profile rather than listing the whole project', async () => {
    const { connectedAccounts } = await setup({})
    await expect(connectedAccounts('')).rejects.toThrow(/no profile for this sender/)
  })

  it('does NOT consult ZERNIO_PROFILE_ID when the caller named nobody', async () => {
    // The switch-day hazard, at the layer under ingest.
    process.env.ZERNIO_PROFILE_ID = '6a6c498971a67c109cfcae06'
    const { connectedAccounts, calls } = await setup({})
    await expect(connectedAccounts('')).rejects.toThrow(/no profile for this sender/)
    expect(calls.filter((c) => /\/accounts\?/.test(c.url))).toHaveLength(0)
  })
})

describe('the credit check', () => {
  it('answers UNKNOWN under Zernio instead of asking PostPeer', async () => {
    // The URL in postingCredits is hardcoded to PostPeer with no provider
    // branch, so without this guard a Zernio install would send a Bearer token
    // to PostPeer's usage endpoint. null is UNKNOWN, never zero.
    const { postingCredits, calls } = await setup({})
    expect(await postingCredits()).toBeNull()
    expect(calls.filter((c) => /usage/.test(c.url))).toHaveLength(0)
  })

  it('does not block a Zernio publish on a balance it cannot know', async () => {
    const { postToConnected } = await setup({
      publish: () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    })
    const r = await postToConnected({ ...LISTING })
    expect(r.blocked).toBeUndefined()
    expect(r.ok).toBe(true)
  })
})

// ONE REQUEST, PER-PLATFORM TEXT.
//
// This test used to assert `bodies.toHaveLength(2)` — it pinned the bug as the
// requirement. The two-call design rested on a comment saying "Zernio has no
// per-platform text", which was never checked. On 2026-09-11 a paying client
// approved a full caption and his Facebook Page published TikTok's
// 90-character title instead, twice: two posts with identical media went in,
// and came out as one, wearing TikTok's text. Zernio documents per-entry
// `customContent`. One request cannot be merged with itself.
describe('TikTok gets a title and the full caption, in ONE request', () => {
  const FB = { _id: 'z1', platform: 'facebook' }, IG = { _id: 'z2', platform: 'instagram' }, TT = { _id: 'z3', platform: 'tiktok' }
  const long = '🏡 FOR SALE - WESTHILL AVENUE PHASE 1\n💰 RM520,000\n📲 https://wa.me/60183929100\n#PCMY_Sale'
  const bodiesOf = (calls) => calls.filter((c) => /\/posts$/.test(c.url)).map((c) => JSON.parse(c.init.body))

  it('sends exactly one request for a mixed-platform photo post', async () => {
    const { postToConnected, calls } = await setup({
      accounts: [FB, TT], publish: () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    })
    const r = await postToConnected({ caption: long, captionShort: 'short one', mediaItems: [{ url: 'https://img/1.jpg', type: 'image' }], profileId: 'AGENT1' })
    expect(r.ok).toBe(true)
    expect(r.platforms.sort()).toEqual(['facebook', 'tiktok'])
    expect(bodiesOf(calls)).toHaveLength(1)
  })

  it('Facebook and Instagram publish the FULL caption — the one the agent approved', async () => {
    const { postToConnected, calls } = await setup({
      accounts: [FB, IG, TT], publish: () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    })
    await postToConnected({ caption: long, captionShort: 'short one', mediaItems: [{ url: 'https://img/1.jpg', type: 'image' }], profileId: 'AGENT1' })
    const [b] = bodiesOf(calls)
    expect(b.content).toBe(long)
    for (const p of b.platforms.filter((x) => x.platform !== 'tiktok')) {
      expect(p.customContent, p.platform).toBeUndefined()
    }
  })

  it('TikTok photo gets the short TITLE and the full caption as its description', async () => {
    // Zernio: for a photo post "`content` becomes the photo title (90 characters,
    // hashtags and URLs stripped), so put the full caption in `description`".
    // Filling only the title is why every TikTok photo post went out captionless.
    const { postToConnected, calls } = await setup({
      accounts: [FB, TT], publish: () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    })
    await postToConnected({ caption: long, captionShort: 'short one', mediaItems: [{ url: 'https://img/1.jpg', type: 'image' }], profileId: 'AGENT1' })
    const tk = bodiesOf(calls)[0].platforms.find((p) => p.platform === 'tiktok')
    expect(tk.customContent).toBe('short one')
    expect(tk.platformSpecificData.tiktokSettings.description).toBe(long)
  })

  it('a TikTok VIDEO keeps the full caption — its content IS the caption', async () => {
    const { postToConnected, calls } = await setup({
      accounts: [TT], publish: () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    })
    await postToConnected({ caption: long, captionShort: 'short one', mediaItems: [{ url: 'https://vid/r.mp4', type: 'video' }], profileId: 'AGENT1' })
    const [b] = bodiesOf(calls)
    expect(b.content).toBe(long)
    const tk = b.platforms.find((p) => p.platform === 'tiktok')
    expect(tk.customContent).toBeUndefined()
    expect(tk.platformSpecificData).toBeUndefined()
  })

  it('the short title is never sent to a platform that is not TikTok', async () => {
    // The exact failure: TikTok's title on a client's Facebook Page.
    const { postToConnected, calls } = await setup({
      accounts: [FB, IG, TT], publish: () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    })
    await postToConnected({ caption: long, captionShort: 'short one', mediaItems: [{ url: 'https://img/1.jpg', type: 'image' }], profileId: 'AGENT1' })
    const b = bodiesOf(calls)[0]
    const nonTikTok = JSON.stringify(b.platforms.filter((p) => p.platform !== 'tiktok'))
    expect(nonTikTok).not.toContain('short one')
    expect(b.content).not.toBe('short one')
  })
})
