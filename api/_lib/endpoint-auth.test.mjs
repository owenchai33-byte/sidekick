// The two posting endpoints that used to be open to the internet.
//
// /api/social-post and /api/social-broadcast both reached a provider's publish
// API with nothing in front of them: no secret, and on social-post no
// degraded-caption check and no dedupe either. On 2026-09-01 the agent's exec
// tool used exactly that shortcut to publish around the approve pipeline. These
// tests prove the SERVER refuses, so neither a stranger with the deployed URL
// nor an agent that dislikes the tool's output can reach a client's page.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Readable } from 'node:stream'

const social = {
  connectedAccounts: vi.fn(),
  defaultProfile: vi.fn(() => 'profile-1'),
  providerConfigured: vi.fn(() => ({ configured: true })),
  provider: vi.fn(() => 'postpeer'),
  postToConnected: vi.fn(),
  DEFAULT_PROFILE: 'profile-1',
}
vi.mock('./social.js', () => social)

// Real looksLikeDemoCaption and postFingerprint - the point is to prove the
// endpoints call the SHARED guard, not a copy. Only the two Blob-backed dedupe
// calls are stubbed, so no test touches network storage.
const guard = { claimPostOnce: vi.fn(), releasePostOnce: vi.fn() }
vi.mock('./postguard.js', async (importOriginal) => ({ ...(await importOriginal()), ...guard }))

const { default: broadcast } = await import('../social-broadcast.js')
const { default: socialPost } = await import('../social-post.js')
const { resetRateLimits } = await import('./tenant.js')

const SECRET = 's3cret'
const HOST = 'sidekick.example'
// Every broadcast must now name WHOSE accounts it is publishing to — the
// defaultProfile() fallback is gone, because "post to the default profile" means
// "post to whichever agent happens to own it". The helper below supplies one so
// each test below still asserts the thing it was written to assert; the tests
// for the requirement itself are in the "names whose accounts" block.
const PROFILE = 'profile-1'

const mkRes = () => {
  const r = { statusCode: 0, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.end = (b) => { r.body = typeof b === 'string' ? JSON.parse(b) : b; return r }
  return r
}
// A request as a script/curl/exec tool sends it: no browser fetch metadata.
const mkReq = (body, headers = {}, url = '/api/x') => {
  const req = Readable.from([JSON.stringify(body)])
  req.method = 'POST'
  req.url = url
  req.headers = { 'content-type': 'application/json', host: HOST, ...headers }
  return req
}
// The same request as the portal's own pages make it.
const browser = (extra = {}) => ({ 'sec-fetch-site': 'same-origin', origin: `https://${HOST}`, ...extra })

const call = async (handler, body, headers, url) => {
  const res = mkRes()
  await handler(mkReq({ profile: PROFILE, ...body }, headers, url), res)
  return res
}
// The same call with nothing filled in for it — used to test the requirement.
const callRaw = async (handler, body, headers, url) => {
  const res = mkRes()
  await handler(mkReq(body, headers, url), res)
  return res
}

// A caption that reads like an agent actually wrote it.
const REAL = '🏡 Double-storey terrace at Riveria Park, Kuching — RM638,000. 4 bed, 3 bath, 1,540 sq ft, freehold. Walking distance to the new school. WhatsApp me at 012-345 6789 for viewing times.'

// The exact English facebook_page boilerplate demoContent() emits when the
// model call fails - four markers, so looksLikeDemoCaption must fire.
const DEMO = `✨ Terrace in Kuching — now available

Looking for a place that just feels right? This terrace with 4 bedrooms in Kuching is ready for its next owner. RM638,000.

4 bedrooms · 3 bathrooms

Drop me a DM and I'll send over the full details and viewing times. 🏡`

beforeEach(() => {
  vi.clearAllMocks()
  resetRateLimits()
  process.env.INGEST_SECRET = SECRET
  process.env.POSTPEER_API_KEY = 'pp-key'
  process.env.POSTPEER_TIKTOK_ACCOUNT_ID = 'tt-configured'
  process.env.MAKE_WEBHOOK_URL = 'https://hook.make.test/abc'
  guard.claimPostOnce.mockResolvedValue(true)
  social.connectedAccounts.mockResolvedValue([{ id: 'fb-1', platform: 'facebook' }])
  social.providerConfigured.mockReturnValue({ configured: true })
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{}' }))
})

describe('/api/social-broadcast: who may publish', () => {
  it('refuses a scripted POST with no secret, and publishes nothing', async () => {
    const res = await call(broadcast, { caption: REAL })
    expect(res.statusCode).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(social.connectedAccounts).not.toHaveBeenCalled()
  })

  it('refuses a WRONG secret, and publishes nothing', async () => {
    const res = await call(broadcast, { caption: REAL }, { 'x-ingest-secret': 'not-it' })
    expect(res.statusCode).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('refuses the ?secret= query form when it is wrong', async () => {
    const res = await call(broadcast, { caption: REAL }, {}, '/api/social-broadcast?secret=nope')
    expect(res.statusCode).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('proceeds with the correct secret', async () => {
    const res = await call(broadcast, { caption: REAL }, { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('proceeds with the correct secret in the query string', async () => {
    const res = await call(broadcast, { caption: REAL }, {}, '/api/social-broadcast?secret=' + SECRET)
    expect(res.statusCode).toBe(200)
  })

  // The portal's own pages have no credential to send. If this breaks, the
  // Connect test post and all three posting buttons die with "Post failed".
  it('still lets the portal itself post — the UI has no secret to send', async () => {
    const res = await call(broadcast, { caption: REAL }, browser())
    expect(res.statusCode).toBe(200)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('lets an older browser through on Origin alone (no Sec-Fetch-*)', async () => {
    const res = await call(broadcast, { caption: REAL }, { origin: `https://${HOST}` })
    expect(res.statusCode).toBe(200)
  })

  it('lets a browser through on Referer alone', async () => {
    const res = await call(broadcast, { caption: REAL }, { referer: `https://${HOST}/listing/9` })
    expect(res.statusCode).toBe(200)
  })

  it('behind the Vercel proxy, matches x-forwarded-host', async () => {
    const res = await call(broadcast, { caption: REAL },
      { origin: `https://${HOST}`, host: 'internal-lambda.vercel', 'x-forwarded-host': HOST })
    expect(res.statusCode).toBe(200)
  })

  it('refuses another site posting on the user\'s behalf', async () => {
    const res = await call(broadcast, { caption: REAL },
      { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' })
    expect(res.statusCode).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('refuses a forged Origin for a different host', async () => {
    const res = await call(broadcast, { caption: REAL }, { origin: 'https://evil.example' })
    expect(res.statusCode).toBe(401)
  })

  it('refuses the demo caption even with the right secret', async () => {
    const res = await call(broadcast, { caption: DEMO }, { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(409)
    expect(res.body.blocked).toBe('captionDegraded')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('refuses a repeat of an identical post', async () => {
    guard.claimPostOnce.mockResolvedValue(false)
    const res = await call(broadcast, { caption: REAL }, { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(409)
    expect(res.body.duplicate).toBe(true)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('/api/social-broadcast: it must name whose accounts', () => {
  // defaultProfile() used to answer this question. In production it answers ''
  // (so the three in-app buttons that sent no profile have been 502-ing), and it
  // answers with ONE SHARED TENANT the moment anyone sets POSTPEER_PROFILE_ID to
  // fix the home screen's "No accounts" badge. Guessing is the bug.
  it('refuses a post that names no profile, even with the right secret', async () => {
    const res = await callRaw(broadcast, { caption: REAL }, { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/profile/i)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(social.connectedAccounts).not.toHaveBeenCalled()
  })

  it('never asks for a default profile', async () => {
    await call(broadcast, { caption: REAL }, { 'x-ingest-secret': SECRET })
    expect(social.defaultProfile).not.toHaveBeenCalled()
  })

  it('publishes to the profile the caller named', async () => {
    await call(broadcast, { caption: REAL }, { 'x-ingest-secret': SECRET })
    expect(social.connectedAccounts).toHaveBeenCalledWith(PROFILE)
  })

  // The Connect screen's test post is the one thing a brand-new agent does to
  // confirm they are set up. It sends its profile and no credential.
  it('still lets ConnectPage\'s test post through — profile, no secret', async () => {
    const res = await call(broadcast, { caption: REAL }, browser())
    expect(res.statusCode).toBe(200)
    expect(social.connectedAccounts).toHaveBeenCalledWith(PROFILE)
  })

  it('closes the verified self-comparison bypass once a real host is known', async () => {
    // Verified 2026-09-04: `{ host:'evil.test', origin:'https://evil.test' }`
    // walked through, because Origin was compared against the caller's own Host.
    process.env.APP_HOST = HOST
    try {
      const res = await callRaw(broadcast, { caption: REAL, profile: PROFILE },
        { host: 'evil.test', origin: 'https://evil.test' })
      expect(res.statusCode).toBe(401)
      expect(global.fetch).not.toHaveBeenCalled()
    } finally { delete process.env.APP_HOST }
  })

  it('and still admits the real host it is configured with', async () => {
    process.env.APP_HOST = HOST
    try {
      const res = await callRaw(broadcast, { caption: REAL, profile: PROFILE }, { origin: `https://${HOST}` })
      expect(res.statusCode).toBe(200)
    } finally { delete process.env.APP_HOST }
  })

  it('throttles an uncredentialled flood, but not a secret-holder', async () => {
    resetRateLimits()
    const send = () => call(broadcast, { caption: `${REAL} ${Math.random()}` }, browser())
    let last
    for (let i = 0; i < 12; i++) last = await send()
    expect(last.statusCode).toBe(429)
    // The same profile, with the secret, is unaffected.
    const authed = await call(broadcast, { caption: REAL }, { 'x-ingest-secret': SECRET })
    expect(authed.statusCode).toBe(200)
    resetRateLimits()
  })
})

describe('/api/social-post: who may publish', () => {
  // Nothing in the app calls this route, so unlike broadcast it is a hard gate:
  // no same-origin exemption at all.
  it('refuses a POST with no secret, and publishes nothing', async () => {
    const res = await call(socialPost, { caption: REAL })
    expect(res.statusCode).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('refuses a WRONG secret, and publishes nothing', async () => {
    const res = await call(socialPost, { caption: REAL }, { 'x-ingest-secret': 'not-it' })
    expect(res.statusCode).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('refuses a browser too — this route is not reachable from the portal', async () => {
    const res = await call(socialPost, { caption: REAL }, browser())
    expect(res.statusCode).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('refuses everything while INGEST_SECRET is unset', async () => {
    delete process.env.INGEST_SECRET
    const res = await call(socialPost, { caption: REAL }, { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(501)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('proceeds with the correct secret', async () => {
    const res = await call(socialPost, { caption: REAL, imageUrl: 'https://blob.test/a.jpg' },
      { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('refuses the demo caption even with the right secret', async () => {
    const res = await call(socialPost, { caption: DEMO }, { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(409)
    expect(res.body.blocked).toBe('captionDegraded')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('refuses a repeat of an identical post', async () => {
    guard.claimPostOnce.mockResolvedValue(false)
    const res = await call(socialPost, { caption: REAL }, { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(409)
    expect(res.body.duplicate).toBe(true)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('releases the claim when nothing published, so a real retry works', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' }))
    const res = await call(socialPost, { caption: REAL }, { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(502)
    expect(guard.releasePostOnce).toHaveBeenCalledTimes(1)
  })
})

describe('/api/social-post: the hardcoded TikTok account is gone', () => {
  it('refuses TikTok rather than falling back to the pilot account id', async () => {
    delete process.env.POSTPEER_TIKTOK_ACCOUNT_ID
    delete process.env.ZERNIO_TIKTOK_ACCOUNT_ID
    const res = await call(socialPost,
      { caption: REAL, platforms: 'tiktok', mediaUrl: 'https://blob.test/a.mp4', mediaType: 'video' },
      { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(502)
    expect(res.body.error).toMatch(/TIKTOK_ACCOUNT_ID/)
    expect(global.fetch).not.toHaveBeenCalled()   // nothing reached a stranger's TikTok
  })

  it('posts to TikTok when the account id IS configured', async () => {
    const res = await call(socialPost,
      { caption: REAL, platforms: 'tiktok', mediaUrl: 'https://blob.test/a.mp4', mediaType: 'video' },
      { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(200)
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(sent.platforms[0].accountId).toBe('tt-configured')
  })
})

// ── Regression corpora ────────────────────────────────────────────────────────
// On 2026-09-03 a name-validation change refused every one-line listing for
// hours because nobody checked the good captions. Both endpoints now run the
// caption guard, so both corpora go through both endpoints: the good ones must
// ALL still publish, the boilerplate must ALL be refused.

const MUST_PASS = [
  // one-liner, the exact shape that broke on 2026-09-03
  'Terrace for sale in BDC, Kuching. RM520,000. WhatsApp 012-345 6789.',
  // full agent-style listing
  REAL,
  // rental, Malay
  '✨ Rumah teres 3 bilik di Batu Kawa, Kuching — RM1,200 sebulan. Dapur kemas, dekat sekolah & pasar. PM saya untuk tempahan lihat rumah. 🏡 #HartanahKuching',
  // Chinese
  '🏡 古晋 BDC 双层排屋出售，售价 RM638,000。4房3厕，1540平方尺，永久地契。近学校与商圈，交通方便。有兴趣请私信 012-345 6789 安排看房。',
  // mixed EN/ZH, the divider the caption engine joins languages with
  'Semi-D at Stutong Heights — RM880,000. 5 bed, 4 bath.\n\n• • •\n\n实达东半独立式洋房，售价 RM880,000，5房4厕。',
  // legitimately reduced price
  '📉 Price reduced! Was RM720,000, now only RM668,000 — corner terrace at Tabuan Tranquility. Owner relocating. Call 013-888 2211.',
  // commercial
  'Shoplot for rent — Jalan Song, Kuching. RM4,500/month. Ground floor, 1,600 sq ft, corner unit with parking in front. Suit café or clinic. 📩',
  // land
  'Land for sale: 1.2 acres at Kota Padawan, Kuching. RM1.8 mil. Mixed zone, road frontage, title ready. Serious buyers only — 019-777 4455.',
  // status update, no price
  '🔴 SOLD — the double-storey at Riveria Park went in 9 days. Thinking of selling yours? Let\'s talk. 📩 #KuchingProperty',
  // new launch
  '🚀 New launch: Aeria Residence, Kuching. From RM438,000. 3 bed apartments, gym & pool, 10 mins to town. Booking now open — DM for the floor plan.',
  // the demo-plan style non-listing content post the planner produces
  '💡 Buying in Kuching? Budget for the Memorandum of Transfer (MOT) and legal fees on top of your deposit — first-timers often forget these. Ask me for a full cost breakdown before you commit. 📩 #KuchingProperty #HomeBuyingTips',
  // festive post
  '🌾 Selamat Hari Gawai to everyone celebrating across Sarawak! Wishing you togetherness, a good harvest and new beginnings — maybe even a new home. 🏡 #Gawai #Kuching',
  // open house
  'OPEN HOUSE this Saturday, 2–5pm. 12 Jalan Tun Jugah, Kuching. Semi-D, 4 bed, RM950,000. Walk in, no appointment needed. 📍',
  // furnished condo, brand sign-off
  'Fully furnished condo at The Park Residency — RM2,300/month. 2+1 bed, 2 bath, covered parking, pool view. Available immediately. — Edward, TRR Properties 📞 012-987 6543',
  // one word short of nothing, but real
  'Just listed: 4-bed terrace, Matang Jaya, RM488,000. 📩',
  // uses one demo-ish phrase but is otherwise a real caption — must NOT be caught
  'This one is ready for its next owner: single-storey at Sungai Maong, RM398,000, renovated kitchen, gated. Call me. 012-345 6789',
]

const MUST_CATCH = [
  DEMO,
  // the same boilerplate for a rental
  `✨ Apartment in Kuching — now available\n\nLooking for a place that just feels right? This apartment with 3 bedrooms in Kuching is ready for its next owner. RM1,500/month — great value for the area.\n\n3 bedrooms · 2 bathrooms\n\nDrop me a DM and I'll send over the full details and viewing times. 🏡`,
  // with no property type or location resolved
  `✨ Property in Kuching — now available\n\nLooking for a place that just feels right? This home in Kuching is ready for its next owner. Price on ask.\n\n\n\nDrop me a DM and I'll send over the full details and viewing times. 🏡`,
  // Two markers is the threshold, so this is the minimum that must still be
  // caught. Note it needs BOTH tail phrases: the "… — now available" marker is
  // written /Property in .+ — now available/, which never fires once the listing
  // has a propertyType, because the template substitutes "Terrace" for
  // "Property". Only three of the four markers do any work on a typed listing.
  `✨ Terrace in Miri — now available\n\nThis one is ready for its next owner. Drop me a DM and I'll send over the full details and viewing times.`,
]

describe('caption guard: regression corpora', () => {
  it.each(MUST_PASS.map((c, i) => [i, c]))('MUST-PASS #%i publishes through both endpoints', async (_i, caption) => {
    const b = await call(broadcast, { caption }, { 'x-ingest-secret': SECRET })
    expect(b.statusCode).toBe(200)
    const p = await call(socialPost, { caption }, { 'x-ingest-secret': SECRET })
    expect(p.statusCode).toBe(200)
  })

  it.each(MUST_CATCH.map((c, i) => [i, c]))('MUST-CATCH #%i is refused by both endpoints', async (_i, caption) => {
    const b = await call(broadcast, { caption }, { 'x-ingest-secret': SECRET })
    expect(b.statusCode).toBe(409)
    expect(b.body.blocked).toBe('captionDegraded')
    const p = await call(socialPost, { caption }, { 'x-ingest-secret': SECRET })
    expect(p.statusCode).toBe(409)
    expect(p.body.blocked).toBe('captionDegraded')
  })
})
