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
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async () => ({ url: 'https://blob.test/card.png' })),
  list: vi.fn(async () => ({ blobs: [] })), del: vi.fn(async () => {}),
}))
// NOT mocked: the corpora below run the real demo-caption detector, because
// what it does and does not see is half of why this flag has to exist.
const { looksLikeDemoCaption } = await import('./postguard.js')

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
  // Price shapes an agent actually types. The parse-side corpus that scored
  // 2/12 fell over on exactly these: "450k nego" and "1.25 juta" are prices,
  // not inventions, and a caption carrying them is a good caption.
  'Land at Matang — 450k nego. Freehold, road frontage, mixed zone. Serious buyers only, call 019-777 4455. #KuchingLand #Sarawak',
  'SEMI-D DI GREEN HEIGHTS — 1.25 juta. 5 BILIK TIDUR, 4 BILIK AIR, LOT TEPI. HUBUNGI 012-345 6789 UNTUK LAWATAN. #HartanahKuching',
  'Whole unit at Jalan Song for rent, RM2.5k/month. 3 rooms, fully furnished, covered parking. Single rooms also available from RM650. WhatsApp me.',
  '古晋 BDC 排屋出售，售价 430,000。3 房 2 厕，1,320 平方尺，永久地契。欢迎私讯安排看房。#古晋房产',
  'Master room for rent at Vivacity — RM800 a month. Attached bathroom, aircond, wifi and cleaning included. Female tenant preferred. DM me.',
  // The exact one-liner the reverted shape-detector refused on 2026-09-03.
  // It is a real TikTok title. If anything ever refuses this again, this fails.
  'Studio in Kuching — RM650 a month',
]

// NOTE (2026-09-04): these expectations changed when the template stopped
// substituting a location. It used to say "Kuching" whenever the parser found
// none — see #6, #7 and #8 below, which now name no town at all — and it used to
// end every caption "#KuchingProperty #Sarawak" whatever the listing said. Both
// were false facts about a real property, produced with no model in the loop.
//
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


// ---------------------------------------------------------------------------
// THE EVIDENCE. The flag is set where the fallback is CHOSEN, so the two corpora
// below are separated by provenance, not by wording — which is the whole point.
// The reverted version guessed from text in hold.js and refused 7 of 8 real
// short captions; MUST-PASS is what stops that coming back.
// ---------------------------------------------------------------------------

// Real WhatsApp reel messages, each paired with the caption ingest.js's
// deterministic template actually produces for it. The strings were captured
// from the code under test, not written by hand: if the template drifts, these
// fail, and the flag would then be describing something else.
const FALLBACK = [
  ["For rent in Kuching, RM1,300 per month, 3 rooms",
   "Property in Kuching — RM1,300 a month 🏡 #KuchingProperty #PropertyMalaysia"],
  ["Apartment at Batu Kawa for sale RM480,000, 3 bed 2 bath",
   "Apartment in Batu Kawa — RM480,000 🏡 #BatuKawaProperty #PropertyMalaysia"],
  ["Terrace in Kota Samarahan, 620,000 nego, 4 bed 3 bath",
   "Terrace in Kota Samarahan  🏡 #KotaSamarahanProperty #PropertyMalaysia"],
  ["Semi-D at Green Heights, 1.25 juta, 5 bed 4 bath",
   "Semi-D in Green Heights — RM1,250,000 🏡 #GreenHeightsProperty #PropertyMalaysia"],
  ["Condo in Petra Jaya for rent RM2.1k/month, 2 rooms",
   "Condo in Petra Jaya — RM2,100 a month 🏡 #PetraJayaProperty #PropertyMalaysia"],
  ["Land at Matang, 450k nego, freehold",
   "Land in Matang — RM450,000 🏡 #MatangProperty #PropertyMalaysia"],
  ["古晋 BDC 排屋出售 售价 430,000, 3 房 2 厕",
   "Property  🏡 #PropertyMalaysia"],
  ["Rumah teres di Samarahan, RM520,000, 4 bilik 3 tandas",
   "Property — RM520,000 🏡 #PropertyMalaysia"],
  ["SHOPLOT AT STUTONG BARU FOR RENT RM3,500/MO, 22FT FRONTAGE",
   "Shoplot — RM3,500 a month 🏡 #PropertyMalaysia"],
  ["Detached house at Tabuan Jaya, 5 bed 4 bath, price on ask",
   "Detached in Tabuan Jaya  🏡 #TabuanJayaProperty #PropertyMalaysia"],
  ["New listing at Jalan Song\nApartment for sale\nRM390,000\n3 bed 2 bath, 900 sqft",
   "Apartment in Jalan Song Apartment — RM390,000 🏡 #JalanSongApartmentProperty #PropertyMalaysia"],
]

const reelBodyFor = (text) => ({ mode: 'reel', profileId: 'p1', text, images: ['https://cdn.test/photo1.jpg'] })

/** Forward what ingest(reel) returned to /api/hold, the way the Mac must. */
const holdReel = (reel) => hold({
  caption: reel.body.caption, script: reel.body.script, mediaItems: MEDIA, profileId: 'p1',
  captionDegraded: reel.body.captionDegraded, captionDegradedReason: reel.body.captionDegradedReason,
})

describe('MUST-CATCH: the fallback is flagged where it is generated', () => {
  it.each(FALLBACK.map(([t, c], i) => [i, t, c]))(
    'MUST-CATCH #%i — the model dies (429), the template is flagged and the ✅ refuses it',
    async (_i, text, expected) => {
      // The live shape of the 2026-09-03 incident: a provider IS configured and
      // the call fails, so status.configured tells you nothing about the output.
      providers.providerStatus.mockReturnValue({ configured: true, provider: 'gemini' })
      providers.runModel.mockRejectedValue(new Error('429 quota exceeded'))

      const reel = await ingest(reelBodyFor(text))
      expect(reel.body.caption).toBe(expected)          // this IS the template
      expect(reel.body.captionDegraded).toBe(true)
      expect(reel.body.captionDegradedReason).toMatch(/template/i)
      // Why a flag was needed at all: the detector already in the tree sees
      // nothing wrong with any of these — its markers describe demoContent(),
      // which the reel path never calls.
      expect(looksLikeDemoCaption(reel.body.caption)).toBe(false)
      expect(looksLikeDemoCaption(reel.body.script)).toBe(false)

      await holdReel(reel)
      expect(heldRecord().captionDegraded).toBe(true)
      expect(heldRecord().captionDegradedReason).toMatch(/template/i)

      pending.getPending.mockResolvedValue(heldRecord())
      const a = await approve({ id: 'e5f48cc5', decision: 'approve' })
      expect(a.statusCode).toBe(409)
      expect(a.body.blocked).toBe('captionDegraded')
      expect(social.postToConnected).not.toHaveBeenCalled()  // nothing reached TikTok
    })

  it.each(FALLBACK.map(([t], i) => [i, t]))(
    'MUST-CATCH #%i — with no provider at all, same template, same refusal',
    async (_i, text) => {
      providers.providerStatus.mockReturnValue({ configured: false, provider: null })
      const reel = await ingest(reelBodyFor(text))
      expect(reel.body.captionDegraded).toBe(true)
      expect(reel.body.captionDegradedReason).toMatch(/no AI provider/i)
      await holdReel(reel)
      pending.getPending.mockResolvedValue(heldRecord())
      expect((await approve({ id: 'e5f48cc5', decision: 'approve' })).statusCode).toBe(409)
    })
})

describe('MUST-PASS: a model-written reel is never flagged', () => {
  it.each(FALLBACK.map(([t], i) => [i, t]))(
    'MUST-PASS reel #%i — the model answered, so it holds clean and publishes',
    async (_i, text) => {
      providers.providerStatus.mockReturnValue({ configured: true, provider: 'groq' })
      providers.runModel.mockResolvedValue('{}')
      // First extractJson is the listing parse, every later one is the reel.
      providers.extractJson
        .mockReturnValueOnce({ listingType: 'sale', price: 498000, location: 'Kuching', propertyType: 'Terrace', bedrooms: 3, bathrooms: 2 })
        .mockReturnValue({ script: MUST_PASS[10], caption: MUST_PASS[2] })

      const reel = await ingest(reelBodyFor(text))
      expect(reel.body.captionDegraded).toBe(false)
      expect(reel.body.captionDegradedReason).toBeUndefined()
      expect(reel.body.captionWarning).toBeUndefined()

      await holdReel(reel)
      expect(heldRecord().captionDegraded).toBe(false)
      expect(heldRecord().captionDegradedReason).toBe(null)

      pending.getPending.mockResolvedValue(heldRecord())
      const a = await approve({ id: 'e5f48cc5', decision: 'approve' })
      expect(a.statusCode).toBe(200)
      expect(social.postToConnected).toHaveBeenCalled()
    })
})

describe('MUST-PASS: real captions still reach the page', () => {
  it.each(MUST_PASS.map((c, i) => [i, c]))(
    'MUST-PASS #%i holds clean and the ✅ publishes it',
    async (_i, caption) => {
      expect(looksLikeDemoCaption(caption)).toBe(false)
      await hold({ caption, mediaItems: MEDIA, profileId: 'p1' })
      expect(heldRecord().captionDegraded).toBe(false)
      pending.getPending.mockResolvedValue(heldRecord())
      const res = await approve({ id: 'ok-1', decision: 'approve' })
      expect(res.statusCode).toBe(200)
      expect(social.postToConnected).toHaveBeenCalled()
    })
})

describe('provenance decides, not shape', () => {
  // Two captions one word apart. The refusal has to come from knowing which one
  // the model wrote, because no reading of the text can tell them apart — the
  // detector that tried scored 1 of 8 on captions like the first.
  it('the agent\'s own short title publishes; the template with the same shape does not', async () => {
    await hold({ caption: 'Studio in Kuching — RM650 a month', mediaItems: MEDIA, profileId: 'p1' })
    pending.getPending.mockResolvedValue(heldRecord())
    expect((await approve({ id: 'a', decision: 'approve' })).statusCode).toBe(200)

    providers.providerStatus.mockReturnValue({ configured: true, provider: 'gemini' })
    providers.runModel.mockRejectedValue(new Error('429 quota exceeded'))
    const reel = await ingest(reelBodyFor('For rent in Kuching, RM1,300 per month, 3 rooms'))
    await holdReel(reel)
    pending.getPending.mockResolvedValue(heldRecord())
    const blocked = await approve({ id: 'b', decision: 'approve' })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.body.blocked).toBe('captionDegraded')
  })
})

// The repair must never swap the agent's real copy for the template.
//
// The reel path runs one repair round when captionViolations finds an invention,
// and accepted the retry whenever it had FEWER inventions. The deterministic
// fallback has zero by construction — so a retry that hit a rate limit and fell
// back replaced a perfectly good caption with "Condo in Kuching — RM498,000" and
// flagged it degraded, which is a 409 at the tick. Silent, total, on the good
// path. Measured 2026-09-04. The guard is `!retry.degraded`.
describe('the reel repair keeps the good copy', () => {
  const GOOD = {
    script: 'Riveria Residence in Kuching. Four ninety eight thousand. Three bed, two bath.',
    caption: 'Riveria Residence, Kuching — RM498,000. 3 bed 2 bath, 1,100 sq ft.',
    degraded: false,
  }
  const FELL_BACK = {
    script: 'Trust me, it won\'t last long. DM me now before it\'s gone.',
    caption: 'Condo in Kuching — RM498,000 🏡 #KuchingProperty',
    degraded: true,
  }

  it('rejects a retry that fell back, even though it has fewer inventions', () => {
    // This is the arithmetic the bug turned on: the fallback scores better on
    // the only measure the old condition looked at.
    const inventionsIn = (r) => (r === GOOD ? 1 : 0)
    const accept = (retry, before, after) => !retry.degraded && after < before
    expect(accept(FELL_BACK, inventionsIn(GOOD), inventionsIn(FELL_BACK))).toBe(false)
  })

  it('still accepts a clean retry that genuinely fixed the invention', () => {
    const CLEANED = { ...GOOD, caption: GOOD.caption.replace('1,100 sq ft', '1,100 sq ft'), degraded: false }
    const accept = (retry, before, after) => !retry.degraded && after < before
    expect(accept(CLEANED, 2, 0)).toBe(true)
  })

  it('the guard is present in the source, not just in this test', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('api/ingest.js', 'utf8'))
    expect(src).toMatch(/if \(!retry\.degraded && rv2\.invented\.length < rv\.invented\.length\)/)
  })
})

// ---------------------------------------------------------------------------
// THE HOLD BODY. The reel caller used to assemble its own /api/hold request from
// this response and silently left two fields out: captionDegraded (so hold.js
// defaulted it to false and the ✅ saw a clean record) and the listing text (so
// approve.js had no source and its fact check returned [] for every reel ever
// held). Both are now assembled server-side, where they cannot be forgotten.

describe('ingest(reel) hands back a hold body that cannot lose a field', () => {
  const LISTING = 'Riveria Residence Kuching for sale RM498,000. 1,100 sqft, 3 bed 2 bath. Fully furnished. WhatsApp Kelvin 012-345 6789'

  beforeEach(() => {
    providers.providerStatus.mockReturnValue({ configured: true, provider: 'gemini' })
    providers.runModel.mockRejectedValue(new Error('429 quota exceeded'))
  })

  it('carries the degraded flag and its reason', async () => {
    const reel = await ingest(reelBodyFor(LISTING))
    expect(reel.body.holdBody.captionDegraded).toBe(true)
    expect(reel.body.holdBody.captionDegradedReason).toMatch(/template/i)
  })

  it('carries the agent\'s own listing text, under a name hold.js accepts', async () => {
    const reel = await ingest(reelBodyFor(LISTING))
    // Not a bare `text`: hold.js takes sourceText/rawText only, precisely so a
    // reel hook or a voiceover line cannot be mistaken for the listing.
    expect(reel.body.holdBody.sourceText).toContain('Riveria Residence')
    expect(reel.body.holdBody.text).toBeUndefined()
  })

  it('held VERBATIM, the source really is stored and the ✅ really does refuse', async () => {
    const reel = await ingest(reelBodyFor(LISTING))
    // Exactly what the caller should now send: the body it was given, plus only
    // the two things it alone knows.
    await hold({ ...reel.body.holdBody, mediaItems: MEDIA, cover: reel.body.card })
    const rec = heldRecord()
    expect(rec.captionDegraded).toBe(true)
    expect(rec.source?.text).toContain('Riveria Residence')

    pending.getPending.mockResolvedValue(rec)
    const a = await approve({ id: 'e5f48cc5', decision: 'approve' })
    expect(a.statusCode).toBe(409)
    expect(social.postToConnected).not.toHaveBeenCalled()
  })

  it('THE OLD BUG: a caller that rebuilds the body by hand and forgets both fields', async () => {
    // Pinned so the cost of the old shape stays visible. This is what
    // tools/sidekick.mjs did — and the post published.
    const reel = await ingest(reelBodyFor(LISTING))
    await hold({ caption: reel.body.caption, mediaItems: MEDIA, platforms: ['tiktok'], profileId: 'p1' })
    const rec = heldRecord()
    expect(rec.captionDegraded).toBe(false)   // the flag was never sent
    expect(rec.source).toBe(null)             // and there is nothing to check against

    pending.getPending.mockResolvedValue(rec)
    const a = await approve({ id: 'e5f48cc5', decision: 'approve' })
    expect(a.statusCode).toBe(200)            // template copy, straight to TikTok
  })

  it('the good path is unchanged: a real caption holds clean and publishes', async () => {
    providers.runModel.mockResolvedValue('{}')
    providers.extractJson.mockReturnValue({
      script: 'Riveria Residence in Kuching, three bedrooms, RM498,000. Message me for a viewing.',
      caption: 'Riveria Residence, Kuching — RM498,000\n1,100 sq ft, 3 bed 2 bath\nWhatsApp Kelvin 012-345 6789',
    })
    const reel = await ingest(reelBodyFor(LISTING))
    expect(reel.body.holdBody.captionDegraded).toBe(false)
    expect(reel.body.holdBody.captionDegradedReason).toBeUndefined()

    await hold({ ...reel.body.holdBody, mediaItems: MEDIA })
    pending.getPending.mockResolvedValue(heldRecord())
    const a = await approve({ id: 'e5f48cc5', decision: 'approve' })
    expect(a.statusCode).toBe(200)
    expect(social.postToConnected).toHaveBeenCalledOnce()
  })
})
