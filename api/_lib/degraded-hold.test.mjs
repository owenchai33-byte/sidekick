// The hole between /api/hold and the ✅.
//
// approve.js has refused captionDegraded records since the Gemini 429s, but
// hold.js never WROTE that field, so every post the Mac held arrived at the tick
// looking clean. Confirmed 2026-09-03: pending e5f48cc5 held the caption
// "Property in Kuching - RM1,300 a month" — ingest.js's deterministic reel
// fallback, word for word — and a ✅ on it would have published template text to
// TikTok while the same listing's FB/IG post was correctly blocked.
// looksLikeDemoCaption() matched 0 of its 4 markers, because those markers
// describe demoContent(), which the reel path never calls.
//
// These tests run the real chain: ingest(reel) -> hold -> approve.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const pending = { putPending: vi.fn(), getPending: vi.fn(), delPending: vi.fn(), claimPending: vi.fn(), releasePending: vi.fn() }
const social = { postToConnected: vi.fn(), connectedAccounts: vi.fn(), defaultProfile: vi.fn() }
const providers = { providerStatus: vi.fn(), runModel: vi.fn(), extractJson: vi.fn() }

vi.mock('./pending.js', () => pending)
vi.mock('./social.js', () => social)
vi.mock('./feed.js', () => ({ appendFeed: vi.fn() }))
// No provider is ever reached: providerStatus() reports unconfigured, and runModel
// throws if anything calls it anyway. A test that spends the demo's free-tier
// tokens is a test that breaks the demo.
vi.mock('./providers.js', () => providers)
vi.mock('./style.js', () => ({ getStyle: vi.fn(async () => ({})), getRules: vi.fn(async () => ({ rules: [] })) }))
vi.mock('./brand.js', () => ({ getBrand: vi.fn(async () => ({})) }))
vi.mock('./brandcard.js', () => ({ renderBrandCard: vi.fn(async () => Buffer.from('')) }))
vi.mock('@vercel/blob', () => ({ put: vi.fn(async () => ({ url: 'https://blob.test/card.png' })) }))

const { default: holdHandler } = await import('../hold.js')
const { default: approveHandler } = await import('../approve.js')
const { default: ingestHandler } = await import('../ingest.js')

const mkRes = () => {
  const r = { statusCode: 0, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.end = (b) => { r.body = typeof b === 'string' ? JSON.parse(b) : b; return r }
  return r
}
const call = async (handler, path, body) => {
  const res = mkRes()
  await handler({ method: 'POST', url: path, headers: { 'x-ingest-secret': 's3cret' }, body }, res)
  return res
}
const hold = (body) => call(holdHandler, '/api/hold', body)
const approve = (body) => call(approveHandler, '/api/approve', body)
const ingest = (body) => call(ingestHandler, '/api/ingest', body)

/** What hold() actually wrote to the pending store. */
const heldRecord = () => pending.putPending.mock.calls.at(-1)[0]

const MEDIA = [{ url: 'https://cdn.test/reel.mp4', type: 'video' }]

beforeEach(() => {
  process.env.INGEST_SECRET = 's3cret'
  delete process.env.BLOB_READ_WRITE_TOKEN
  vi.clearAllMocks()
  pending.putPending.mockResolvedValue('e5f48cc5')
  pending.claimPending.mockResolvedValue(true)
  social.postToConnected.mockResolvedValue({ ok: true, platforms: ['tiktok'] })
  social.defaultProfile.mockReturnValue('p1')
  providers.providerStatus.mockReturnValue({ configured: false, provider: null })
  providers.runModel.mockRejectedValue(new Error('no test may call a provider'))
  providers.extractJson.mockImplementation(() => { throw new Error('no test may call a provider') })
})

// ---------------------------------------------------------------------------
// The corpora. A guard that wrongly REFUSES a good caption fails silently and
// totally — on 2026-09-03 a name check refused every one-line listing for hours —
// so the MUST-PASS set is the one that decides whether this change ships.
// ---------------------------------------------------------------------------

// Realistic copy for realistic Kuching/Sarawak listings: the 3-5 line captions
// buildReelPrompt asks for, the spoken scripts it asks for (including the exact
// "DM before it's gone" CTA the prompt requests, which is one word away from the
// template's sign-off), and terse-but-real one-liners.
const MUST_PASS = [
  'Riveria Residence, Kuching — for sale\nRM498,000, 1,100 sq ft, 3 bed 2 bath\nRM100k below market valuation\nWhatsApp Kelvin 012-345 6789\n#KuchingProperty #Sarawak #RiveriaResidence #PropertyMalaysia',
  'Tropics City, Kota Samarahan — for rent\nRM1,300 a month, 3 rooms, fully tiled\nWalking distance to UNIMAS\nCall Sheila 013-888 4422\n#SamarahanProperty #KuchingRental #Sarawak',
  'Double storey terrace at Batu Kawa\nRM620,000 negotiable\n1,540 sq ft, 4 bed 3 bath\nDM to arrange a viewing\n#BatuKawa #KuchingProperty #Sarawak #ForSale',
  'Green Heights semi-D, for sale\nRM1,250,000 · 2,800 sq ft · 5 bed\nCorner lot with extra land\nMessage me for the floor plan\n#GreenHeights #KuchingProperty',
  'BDC intermediate terrace — RM585,000\nRenovated kitchen, gated and guarded\n3 bed 2 bath, 1,320 sq ft\nCall 011-2345 6789\n#BDCKuching #Sarawak #PropertyForSale',
  'Semi-D in Batu Kawa — RM480,000. Call Kelvin 012-345 6789 to view.',
  'Rental in Petra Jaya — RM950 a month, water included. WhatsApp me today.',
  'For rent: Vivacity Megamall condo, RM2,100 a month. 2 rooms, pool view, covered parking. DM for viewing times.',
  'Stutong Baru shoplot for rent — RM3,500/mo\nGround floor, 22ft frontage\nSuits F&B or clinic\n#KuchingShoplot #Sarawak',
  'Kingwood Park, Sibu — RM320,000\nFirst floor unit, 2 bed 1 bath\nRental yield around 5%\nDM me before it\'s gone\n#SibuProperty #Sarawak',
  'Looking for space to grow into? This Matang double storey has 4 bedrooms and a garden, going at five eighty-five thousand. Owner is motivated. DM before it\'s gone.',
  'Stop scrolling if you want Samarahan under two thousand a month. Three rooms, fully furnished, five minutes from UNIMAS. Message me today and I\'ll send the video walkthrough.',
  'A corner lot in Green Heights does not come up often. Twenty eight hundred square feet, five bedrooms, and land on two sides. Ask me for the floor plan before it is gone.',
  'This one is priced a hundred thousand under valuation. Riveria Residence, three bedrooms, ready to move in. DM me now and I will get you in this week.',
  'Kuching buyers, this is the one. Renovated kitchen, gated and guarded, four ninety-eight thousand. Trust me on this one — send me a message.',
  'New listing 🏡 Jalan Song apartment, RM390,000. 900 sq ft, 3 bed 2 bath, tenanted at RM1,200 a month. WhatsApp 012-987 6543 #JalanSong #KuchingProperty #Sarawak',
  'Rumah teres dua tingkat di Kota Samarahan\nRM520,000, boleh runding\n4 bilik tidur, 3 bilik air\nHubungi saya untuk lawatan\n#HartanahSarawak #Kuching',
  '古晋 BDC 排屋出售\nRM585,000，1,320 平方尺\n3 房 2 浴，已装修\n欢迎私讯看房\n#古晋房产 #砂拉越',
  'Just listed in Tabuan Jaya — RM735,000\n2,100 sq ft corner unit\nSolar installed, low electric bill\nDM for the full album\n#TabuanJaya #KuchingProperty #Sarawak',
  'Serviced apartment at The Park Residence, RM1,800 a month. Fully furnished, covered parking, gym and pool. Available from next month — message me to book a viewing.',
]

// The specific bad output being targeted: the deterministic template at
// ingest.js reelScript(), in the shapes it actually produces and the shapes it
// survives in after the Mac trims it (hashtags stripped, em dash flattened —
// exactly how e5f48cc5 was stored).
const MUST_CATCH = [
  'Property in Kuching - RM1,300 a month',
  'Property in Kuching — RM1,300 a month 🏡 #KuchingProperty #Sarawak #PropertyMalaysia',
  'Apartment in Batu Kawa — RM480,000 🏡 #KuchingProperty #Sarawak #PropertyMalaysia',
  'Terrace house in Kota Samarahan — RM620,000 🏡 #KuchingProperty #Sarawak #PropertyMalaysia',
  'Condo in Petra Jaya — RM2,100 a month 🏡 #KuchingProperty #Sarawak #PropertyMalaysia',
  'Semi-D in Green Heights — RM1,250,000',
  'Property in Kuching — RM1,300 a month',
  "Looking for a place in Kuching? This one, and it's RM1,300 a month. Trust me, it won't last long. DM me now before it's gone.",
  "Looking for a place in Batu Kawa? This apartment has 3 bedrooms, and it's RM480,000. Trust me, it won't last long. DM me now before it's gone.",
  "Looking for a place in Kuching? This terrace house has 4 bedrooms. Trust me, it won't last long. DM me now before it's gone.",
]


describe('hold -> approve: a degraded caption cannot be ticked through', () => {
  it('persists captionDegraded from the caller, and the ✅ then refuses', async () => {
    const held = await hold({
      caption: 'Property in Kuching — RM1,300 a month', mediaItems: MEDIA, profileId: 'p1',
      captionDegraded: true, captionDegradedReason: 'the reel writer failed',
    })
    expect(held.statusCode).toBe(200)
    expect(heldRecord().captionDegraded).toBe(true)
    expect(heldRecord().captionDegradedReason).toBe('the reel writer failed')

    pending.getPending.mockResolvedValue(heldRecord())
    const res = await approve({ id: 'e5f48cc5', decision: 'approve' })
    expect(res.statusCode).toBe(409)
    expect(res.body.blocked).toBe('captionDegraded')
    expect(social.postToConnected).not.toHaveBeenCalled() // nothing reached TikTok
  })



  it('holds a real caption clean, and the ✅ publishes it', async () => {
    await hold({
      caption: MUST_PASS[0], captionShort: 'Riveria Residence @ Kuching — RM498,000',
      mediaItems: MEDIA, profileId: 'p1',
      script: MUST_PASS[10],
    })
    expect(heldRecord().captionDegraded).toBe(false)
    expect(heldRecord().captionDegradedReason).toBe(null)

    pending.getPending.mockResolvedValue(heldRecord())
    const res = await approve({ id: 'e5f48cc5', decision: 'approve' })
    expect(res.statusCode).toBe(200)
    expect(social.postToConnected).toHaveBeenCalled()
  })

  it('NO RETROACTIVE BREAKAGE: a record with no captionDegraded field still publishes', async () => {
    // The 14 pendings already in the blob store predate this field. Defaulting
    // the missing case to "degraded" would make every one of them unpublishable
    // the moment this ships — a silent, total refusal, which is the exact failure
    // mode this whole guard exists to avoid.
    pending.getPending.mockResolvedValue({ caption: 'Riveria Residence, Kuching — RM498,000. DM me.', profileId: 'p1', mediaItems: MEDIA })
    const res = await approve({ id: 'old-1', decision: 'approve' })
    expect(res.statusCode).toBe(200)
    expect(social.postToConnected).toHaveBeenCalled()
  })

  it('still lets a degraded held post be SKIPPED', async () => {
    await hold({ caption: 'Property in Kuching - RM1,300 a month', mediaItems: MEDIA, profileId: 'p1' })
    pending.getPending.mockResolvedValue(heldRecord())
    const res = await approve({ id: 'e5f48cc5', decision: 'skip' })
    expect(res.statusCode).toBe(200)
    expect(res.body.skipped).toBe(true)
  })
})

describe('ingest(reel) marks its own fallback', () => {
  const reelBody = {
    mode: 'reel', profileId: 'p1',
    text: 'For rent in Kuching, RM1,300 per month, 3 rooms',
    images: ['https://cdn.test/photo1.jpg'],
  }

  it('flags the deterministic script as degraded so the holder can pass it on', async () => {
    const res = await ingest(reelBody)
    expect(res.statusCode).toBe(200)
    expect(res.body.mode).toBe('reel')
    expect(res.body.captionDegraded).toBe(true)
    expect(res.body.captionDegradedReason).toMatch(/template/i)
    expect(providers.runModel).not.toHaveBeenCalled() // no provider was touched
  })

  it('and that flag, carried to hold, is what approve refuses', async () => {
    const reel = await ingest(reelBody)
    await hold({
      caption: reel.body.caption, script: reel.body.script, mediaItems: MEDIA, profileId: 'p1',
      captionDegraded: reel.body.captionDegraded, captionDegradedReason: reel.body.captionDegradedReason,
    })
    expect(heldRecord().captionDegraded).toBe(true)

    pending.getPending.mockResolvedValue(heldRecord())
    const res = await approve({ id: 'e5f48cc5', decision: 'approve' })
    expect(res.statusCode).toBe(409)
    expect(res.body.blocked).toBe('captionDegraded')
  })

  it('a model-written reel is NOT flagged', async () => {
    providers.providerStatus.mockReturnValue({ configured: true, provider: 'groq' })
    providers.runModel.mockResolvedValue('{}')
    providers.extractJson.mockReturnValue({
      script: MUST_PASS[10],
      caption: MUST_PASS[2],
    })
    const res = await ingest(reelBody)
    expect(res.statusCode).toBe(200)
    expect(res.body.captionDegraded).toBe(false)
    expect(res.body.captionWarning).toBeUndefined()
  })
})
