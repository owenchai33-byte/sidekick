// The last check, at the moment of publishing.
//
// A caption is validated when it is WRITTEN — ingest.js runs captionViolations
// and repairs what it finds — and then held, and then published later, on the
// human's ✅. But a pending record only ever stored the FINISHED caption, so
// approve.js had nothing to re-check against: it could only trust
// captionDegraded, a boolean somebody upstream set. Two ways that fails:
//
//   1. The Mac reel script composes its own caption and POSTs it straight to
//      /api/hold. Nothing on that path ever compares the caption to the listing
//      it claims to describe.
//   2. The flag is one field. Dropped, defaulted or never sent, invented content
//      reaches a real client's public page with nothing standing in the way.
//
// So hold.js now persists the SOURCE the caption was written from, and approve.js
// measures the caption against it before publishing.
//
// WHAT THIS FILE IS ACTUALLY FOR. A guard that wrongly REFUSES a good caption is
// worse than one that misses a bad one, because the refusal is silent and total —
// this codebase produced four separate silent-refusal bugs in three days
// (one-line listings, landmark names, contact lines, and an emoji rule that
// stripped a real client's entire format on his live Facebook page). So the
// MUST-PASS corpus below is the half that decides whether this ships. MUST-CATCH
// only says the guard is worth having; MUST-PASS says it is safe to have.
//
// No provider and no network: pending, social and feed are mocked, exactly as
// credits.test.mjs does it. postguard.js itself is REAL, because what it does and
// does not flag is the entire subject.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const pending = { putPending: vi.fn(), getPending: vi.fn(), delPending: vi.fn(), claimPending: vi.fn(), releasePending: vi.fn() }
const social = { postToConnected: vi.fn(), connectedAccounts: vi.fn(), defaultProfile: vi.fn() }

vi.mock('./pending.js', () => pending)
vi.mock('./social.js', () => social)
vi.mock('./feed.js', () => ({ appendFeed: vi.fn() }))

// NOT mocked. The corpora run the real guard — a stub would only prove this file
// agrees with itself.
const { captionViolations, inventedMarketing, ruleViolations } = await import('./postguard.js')

const { default: holdHandler } = await import('../hold.js')
const { default: approveHandler } = await import('../approve.js')

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

/** What hold() actually wrote to the pending store. */
const heldRecord = () => pending.putPending.mock.calls.at(-1)[0]

const MEDIA = [{ url: 'https://cdn.test/reel.mp4', type: 'video' }]

/** The full round trip a real post takes: hold it, then tick it. */
const holdThenApprove = async (body, extra = {}) => {
  await hold({ mediaItems: MEDIA, profileId: 'p1', ...body })
  pending.getPending.mockResolvedValue(heldRecord())
  return approve({ id: 'held-1', decision: 'approve', ...extra })
}

/** Nothing was published and the post is still sitting there, retryable. */
const leftIntact = () => {
  expect(social.postToConnected).not.toHaveBeenCalled()
  expect(pending.claimPending).not.toHaveBeenCalled()   // never claimed, so the same id retries
  expect(pending.delPending).not.toHaveBeenCalled()     // and it is still in the store
}

beforeEach(() => {
  process.env.INGEST_SECRET = 's3cret'
  delete process.env.BLOB_READ_WRITE_TOKEN
  vi.clearAllMocks()
  pending.putPending.mockResolvedValue('held-1')
  pending.claimPending.mockResolvedValue(true)
  social.postToConnected.mockResolvedValue({ ok: true, platforms: ['facebook', 'instagram'] })
  social.defaultProfile.mockReturnValue('p1')
})

// ---------------------------------------------------------------------------
// THE CORPUS.
//
// Real Kuching/Sarawak listing shapes, each as the agent typed it, the fields a
// parse produces from it, and a caption that is FAITHFUL to it. Every one of
// these must publish. They are chosen to sit on the exact edges that produced
// past silent refusals: prices typed as "450k nego" and "RM43万", figures the
// caption computes rather than copies (annual rent, psf), a Malay listing
// captioned in English, tenure written as a lease duration, "2+1 rooms", a room
// ad with no property name, and a one-line title.
// ---------------------------------------------------------------------------
const MUST_PASS = [
  ['English sale, every field stated',
    { sourceText: 'Riveria Residence Kuching for sale\nRM498,000 nego\n1,100 sqft, 3 bed 2 bath\nFully furnished, gated and guarded\nRM100k below market valuation\nWhatsApp Kelvin 012-345 6789',
      listing: { propertyName: 'Riveria Residence', location: 'Kuching', price: 498000, sqft: 1100, bedrooms: 3, bathrooms: 2, listingType: 'sale', furnishing: 'fully furnished' } },
    'Riveria Residence, Kuching — for sale\nRM498,000, 1,100 sq ft, 3 bed 2 bath\nFully furnished, gated and guarded\nRM100k below market valuation\nWhatsApp Kelvin 012-345 6789\n#KuchingProperty #Sarawak'],

  ['rental, and the caption COMPUTES the annual figure',
    { sourceText: 'Tropics City Kota Samarahan for rent. RM1,300/month. 3 rooms, 900 sqft, fully tiled. Walking distance to UNIMAS. Call Sheila 013-888 4422',
      listing: { propertyName: 'Tropics City', location: 'Kota Samarahan', price: 1300, sqft: 900, bedrooms: 3, listingType: 'rental' } },
    'Tropics City, Kota Samarahan — for rent\nRM1,300/month (RM15,600 a year)\n3 rooms, 900 sq ft, fully tiled\nWalking distance to UNIMAS\nCall Sheila 013-888 4422'],

  ['price typed as "450k nego", caption writes it in full',
    { sourceText: 'Land at Matang, 450k nego. Freehold, road frontage, mixed zone. Serious buyers only, call 019-777 4455',
      listing: { location: 'Matang', price: 450000, listingType: 'sale', tenure: 'freehold' } },
    'Land at Matang — RM450,000 nego. Freehold, road frontage, mixed zone. Serious buyers only, call 019-777 4455. #KuchingLand'],

  ['Chinese listing priced in 万, Chinese caption',
    { sourceText: '古晋 BDC 排屋出售，售价 RM43万。3 房 2 厕，1,320 平方尺，永久地契。欢迎私讯安排看房。联络 012-345 6789',
      listing: { location: '古晋', price: 430000, sqft: 1320, bedrooms: 3, bathrooms: 2, listingType: 'sale', tenure: 'freehold' } },
    '古晋 BDC 排屋出售\nRM430,000，1,320 平方尺\n3 房 2 厕，永久地契\n欢迎私讯看房 012-345 6789\n#古晋房产 #砂拉越'],

  ['Malay listing, Malay caption',
    { sourceText: 'Rumah teres dua tingkat di Kota Samarahan. RM520,000 boleh runding. 4 bilik tidur, 3 bilik air. Hubungi 012-345 6789',
      listing: { location: 'Kota Samarahan', price: 520000, bedrooms: 4, bathrooms: 3, listingType: 'sale' } },
    'Rumah teres dua tingkat di Kota Samarahan\nRM520,000, boleh runding\n4 bilik tidur, 3 bilik air\nHubungi 012-345 6789\n#HartanahSarawak'],

  // The whole point of the product is a caption written in a different language
  // from the listing. A facilities check that only reads English refuses this.
  ['Malay listing, English caption, facilities translated',
    { sourceText: 'Semi-D di Green Heights untuk dijual. RM1.25 juta. 5 bilik tidur, 4 bilik air. Kawasan berpagar dan berpengawal, ada gim dan kolam renang. Hubungi 012-345 6789',
      listing: { location: 'Green Heights', price: 1250000, bedrooms: 5, bathrooms: 4, listingType: 'sale' } },
    'Green Heights semi-D for sale — RM1,250,000\n5 bed 4 bath\nGated and guarded, gym and swimming pool\nCall 012-345 6789'],

  ['a yield the agent worked out from their own rent and price',
    { sourceText: 'Kingwood Park Sibu for sale RM320,000. 2 bed 1 bath, first floor. Currently tenanted at RM1,350/month. Call 011-2345 6789',
      listing: { propertyName: 'Kingwood Park', location: 'Sibu', price: 320000, bedrooms: 2, bathrooms: 1, listingType: 'sale' } },
    'Kingwood Park, Sibu — RM320,000\n2 bed 1 bath, first floor\nTenanted at RM1,350/month — around 5% gross yield\nCall 011-2345 6789'],

  // "10% downpayment, loan up to 90%" is on a large share of Malaysian sale ads.
  // A yield rule that reads any percentage near any return word refuses it.
  ['the deposit-and-loan boilerplate every sale ad carries',
    { sourceText: 'BDC intermediate terrace RM585,000. 3 bed 2 bath, 1,320 sqft. Renovated kitchen. Call 011-2345 6789',
      listing: { location: 'BDC', price: 585000, bedrooms: 3, bathrooms: 2, sqft: 1320, listingType: 'sale' } },
    'BDC terrace — RM585,000\n3 bed 2 bath, 1,320 sq ft, renovated kitchen\nOnly 10% downpayment, loan up to 90%\nCall 011-2345 6789'],

  ['a lease term the listing itself states',
    { sourceText: 'Vivacity Megamall condo for rent RM2,100/month. 2 rooms, pool view, covered parking. Minimum 1 year tenancy. WhatsApp 012-987 6543',
      listing: { propertyName: 'Vivacity Megamall', price: 2100, bedrooms: 2, listingType: 'rental' } },
    'For rent: Vivacity Megamall condo, RM2,100 a month\n2 rooms, pool view, covered parking\nMinimum 1 year tenancy\nWhatsApp 012-987 6543'],

  // TENURE written as a duration. "89 years lease remaining" is how a leasehold
  // listing is worded; reading it as an invented tenancy refuses honest copy.
  ['leasehold tenure written as a lease duration',
    { sourceText: 'Apartment Jalan Song for sale RM390,000. 900 sqft, 3 bed 2 bath. Leasehold, 89 years remaining. WhatsApp 012-987 6543',
      listing: { location: 'Jalan Song', price: 390000, sqft: 900, bedrooms: 3, bathrooms: 2, listingType: 'sale', tenure: 'leasehold' } },
    'Jalan Song apartment — RM390,000\n900 sq ft, 3 bed 2 bath\nLeasehold with 89 years lease remaining\nWhatsApp 012-987 6543'],

  ['"2+1 rooms", which is a utility room, not a third bedroom',
    { sourceText: 'Whole unit at Jalan Song for rent, RM2,500/month. 2+1 rooms, fully furnished, covered parking. WhatsApp 012-987 6543',
      listing: { location: 'Jalan Song', price: 2500, bedrooms: 2, listingType: 'rental', furnishing: 'fully furnished' } },
    'Jalan Song whole unit for rent — RM2,500/month\n2+1 rooms, fully furnished, covered parking\nWhatsApp 012-987 6543'],

  ['a room ad, which has no property name at all',
    { sourceText: 'Master room for rent at Vivacity RM800/month, attached bathroom, aircond wifi cleaning included, female preferred. DM 012-345 6789',
      listing: { price: 800, listingType: 'rental' } },
    'Master room for rent at Vivacity — RM800 a month. Attached bathroom, aircond, wifi and cleaning included. Female tenant preferred. DM 012-345 6789'],

  ['psf, which the caption computes and rounds the way agents quote it',
    { sourceText: 'Tabuan Jaya corner unit for sale RM735,000. 2,100 sqft. Solar installed. DM for the album. 019-777 4455',
      listing: { location: 'Tabuan Jaya', price: 735000, sqft: 2100, listingType: 'sale' } },
    'Just listed in Tabuan Jaya — RM735,000\n2,100 sq ft, about RM350 psf\nSolar installed, low electric bill\nDM 019-777 4455'],

  ['a distance to a landmark the listing names',
    { sourceText: 'Samarahan apartment for rent RM1,900/month. 3 rooms, fully furnished. 5 minutes to UNIMAS. Call 013-888 4422',
      listing: { location: 'Kota Samarahan', price: 1900, bedrooms: 3, listingType: 'rental', furnishing: 'fully furnished' } },
    'Samarahan under two thousand a month. Three rooms, fully furnished, 5 minutes to UNIMAS. Message me today. 013-888 4422'],

  // The exact one-liner a reverted shape-detector refused on 2026-09-03. It is
  // what a real TikTok title looks like. If anything ever refuses it again, this
  // test is how we find out.
  ['a one-line title, which is a whole listing on TikTok',
    { sourceText: 'Studio in Kuching for rent RM650 a month. Call 012-345 6789',
      listing: { location: 'Kuching', price: 650, listingType: 'rental' } },
    'Studio in Kuching — RM650 a month'],

  ['ALL CAPS Malay, price in juta',
    { sourceText: 'SEMI-D DI GREEN HEIGHTS 1.25 JUTA. 5 BILIK TIDUR, 4 BILIK AIR, LOT TEPI. HUBUNGI 012-345 6789',
      listing: { location: 'Green Heights', price: 1250000, bedrooms: 5, bathrooms: 4, listingType: 'sale' } },
    'SEMI-D DI GREEN HEIGHTS — RM1,250,000. 5 BILIK TIDUR, 4 BILIK AIR, LOT TEPI. HUBUNGI 012-345 6789 UNTUK LAWATAN. #HartanahKuching'],
]

// Genuine inventions: a FACT stated in the caption that the listing does not
// support. Each is a thing a buyer or tenant acts on — a price they compare, a
// room count they plan around, a yield they invest on, a term they can hold the
// landlord to, a facility they turn up expecting.
const MUST_CATCH = [
  // NOT a money case. A price history ("originally RM438,000") used to sit here
  // and is deliberately no longer refused at the ✅ — see the money describe
  // block below for why, and for the test that pins the new behaviour.
  ['a single invented facility, on a listing that named none', /swimming pool/,
    { sourceText: 'Terrace at Batu Kawa for sale RM620,000. 4 bed 3 bath, 1,540 sqft. Call 012-345 6789',
      listing: { location: 'Batu Kawa', price: 620000, bedrooms: 4, bathrooms: 3, sqft: 1540, listingType: 'sale' } },
    'Batu Kawa terrace — RM620,000. 4 bed 3 bath, 1,540 sqft. Swimming pool in the compound. Call 012-345 6789'],

  ['room counts that contradict the listing', /4 bedrooms \(the listing says 2\)/,
    { sourceText: 'Apartment at Batu Kawa for sale RM480,000, 2 bed 2 bath. Call 012-345 6789',
      listing: { location: 'Batu Kawa', price: 480000, bedrooms: 2, bathrooms: 2, listingType: 'sale' } },
    'Batu Kawa apartment — RM480,000. 4 bedrooms and 3 bathrooms. Call 012-345 6789'],

  ['a guaranteed yield on a listing stating no percentage', /8% yield/,
    { sourceText: 'Kingwood Park Sibu RM320,000. 2 bed 1 bath, first floor. Call 011-2345 6789',
      listing: { propertyName: 'Kingwood Park', price: 320000, bedrooms: 2, bathrooms: 1, listingType: 'sale' } },
    'Kingwood Park, Sibu — RM320,000. 2 bed 1 bath. Guaranteed 8% rental yield. Call 011-2345 6789'],

  ['a tenancy term nobody agreed to', /2-year lease/,
    { sourceText: 'Vivacity condo for rent RM2,100/month. 2 rooms, covered parking. WhatsApp 012-987 6543',
      listing: { price: 2100, bedrooms: 2, listingType: 'rental' } },
    'Vivacity condo for rent RM2,100 a month. 2 rooms, covered parking. 2-year lease available. WhatsApp 012-987 6543'],

  ['four facilities invented onto a one-line room ad', /swimming pool/,
    { sourceText: 'Room for rent Tabuan Jaya. RM1,500/month. Wifi included. 012-345 6789',
      listing: { location: 'Tabuan Jaya', price: 1500, listingType: 'rental' } },
    'Tabuan Jaya room — RM1,500/month. Gated and guarded, 24-hour security, swimming pool and gym. Wifi included. 012-345 6789'],

  ['a distance to a landmark the listing never named', /5 minutes to Vivacity/,
    { sourceText: 'Studio in Kuching for rent RM650 a month. Call 012-345 6789',
      listing: { location: 'Kuching', price: 650, listingType: 'rental' } },
    'Studio in Kuching — RM650 a month. 5 minutes to Vivacity Megamall. Call 012-345 6789'],

  ['furnishing the listing never claimed', /fully furnished/i,
    { sourceText: 'Studio in Kuching for rent RM650 a month. Call 012-345 6789',
      listing: { location: 'Kuching', price: 650, listingType: 'rental' } },
    'Studio in Kuching — RM650 a month, fully furnished. Call 012-345 6789'],

  ['tenure the listing never stated', /freehold/i,
    { sourceText: 'Studio in Kuching for rent RM650 a month. Call 012-345 6789',
      listing: { location: 'Kuching', price: 650, listingType: 'rental' } },
    'Studio in Kuching — RM650 a month. Freehold. Call 012-345 6789'],
]

// ---------------------------------------------------------------------------

describe('hold.js stores the source the caption was written from', () => {
  const BODY = MUST_PASS[0][1]

  it('persists the listing text and exactly the fields the guard reads', async () => {
    const res = await hold({ caption: MUST_PASS[0][2], mediaItems: MEDIA, profileId: 'p1', ...BODY })
    expect(res.statusCode).toBe(200)
    expect(res.body.sourceStored).toBe(true)

    const { source } = heldRecord()
    expect(source.text).toBe(BODY.sourceText)
    expect(source).toMatchObject({
      propertyName: 'Riveria Residence', location: 'Kuching', price: 498000,
      sqft: 1100, bedrooms: 3, bathrooms: 2, listingType: 'sale', furnishing: 'fully furnished',
    })
    // Small on purpose: the photos, the card and the media list are already on
    // the record and none of them are text the guard can read.
    expect(source.mediaItems).toBeUndefined()
    expect(source.cover).toBeUndefined()
    expect(source.images).toBeUndefined()
  })

  it('takes price/location/listingType from the flat fields when no listing is parsed', async () => {
    // These three have always been sent flat, and `price` is what grounds every
    // figure a caption computes rather than copies.
    await hold({ caption: 'x', mediaItems: MEDIA, profileId: 'p1', sourceText: 'Tropics City for rent RM1,300/month. 3 rooms.', price: 1300, location: 'Kota Samarahan', listingType: 'rental' })
    expect(heldRecord().source).toMatchObject({ price: 1300, location: 'Kota Samarahan', listingType: 'rental' })
  })

  it('stores no source when the caller sends no listing text, and says so', async () => {
    const res = await hold({ caption: MUST_PASS[0][2], mediaItems: MEDIA, profileId: 'p1' })
    expect(res.statusCode).toBe(200)
    expect(heldRecord().source).toBe(null)
    expect(res.body.sourceStored).toBe(false)
    expect(res.body.sourceWarning).toMatch(/no listing text/i)
  })

  it('DROPS an oversized source rather than truncating it', async () => {
    // A cut-off source is missing money figures and room counts the listing
    // really states, and every one of those would then read as invented at the
    // ✅. No source means no check, which is the safe direction to fail in.
    await hold({ caption: 'x', mediaItems: MEDIA, profileId: 'p1', sourceText: 'RM498,000. '.repeat(2000) })
    expect(heldRecord().source).toBe(null)
  })
})

describe('MUST-PASS: an ordinary caption is never refused at the ✅', () => {
  it.each(MUST_PASS.map(([name, body, caption], i) => [i, name, body, caption]))(
    'MUST-PASS #%i — %s',
    async (_i, _name, body, caption) => {
      const res = await holdThenApprove({ caption, ...body })
      // The refusal is silent and total, so this assertion is the product.
      expect(res.body.blocked).toBeUndefined()
      expect(res.statusCode).toBe(200)
      expect(social.postToConnected).toHaveBeenCalledOnce()
    })

  it('the source really was stored for every one of them', async () => {
    // Otherwise MUST-PASS would pass by never running the check at all, which is
    // the way a corpus like this quietly stops meaning anything.
    for (const [, body, caption] of MUST_PASS) {
      await hold({ caption, mediaItems: MEDIA, profileId: 'p1', ...body })
      expect(heldRecord().source?.text).toBe(body.sourceText)
    }
  })
})

describe('MUST-CATCH: an invented fact does not reach the page', () => {
  it.each(MUST_CATCH.map(([name, named, body, caption], i) => [i, name, named, body, caption]))(
    'MUST-CATCH #%i — %s',
    async (_i, _name, named, body, caption) => {
      const res = await holdThenApprove({ caption, ...body })
      expect(res.statusCode).toBe(409)
      expect(res.body.blocked).toBe('captionInvented')
      // NAMED, so the agent can be told what was actually wrong with it rather
      // than just that something was.
      expect(res.body.invented.join('; ')).toMatch(named)
      expect(res.body.error).toMatch(named)
      leftIntact()
    })

  it('the refused post is still there for a retry, and ❌ still works on it', async () => {
    const [, , body, caption] = MUST_CATCH[0]
    await holdThenApprove({ caption, ...body })
    leftIntact()
    const skipped = await approve({ id: 'held-1', decision: 'skip' })
    expect(skipped.statusCode).toBe(200)
    expect(skipped.body.skipped).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// THE NARROWNESS OF THE REFUSAL. Only invented FACTS block. Everything below is
// something the guard can see and deliberately does not refuse over, and each
// test first proves the thing is really there — otherwise it would be asserting
// that a caption with no problem has no problem.
// ---------------------------------------------------------------------------

describe('cosmetic problems must NOT block a publish', () => {
  const ROOM = {
    sourceText: 'Room for rent Tabuan Jaya. RM1,500/month. Wifi included. Walking distance to ICATS. 012-345 6789',
    listing: { location: 'Tabuan Jaya', price: 1500, listingType: 'rental' },
  }

  it('marketing language the listing never used publishes anyway', async () => {
    // The measured 2026-09-04 output: "Prime Location" is a claim about the
    // property that nobody made. It is still only a word, and a listing is worth
    // more than a word.
    const caption = 'Prime Location | Wifi Included | Walking distance to ICATS\nRM1,500/month, Tabuan Jaya\nSpacious and modern. 012-345 6789'
    const v = captionViolations(caption, { ...ROOM.listing, rawText: ROOM.sourceText })
    expect(inventedMarketing(caption, { ...ROOM.listing, rawText: ROOM.sourceText }).length).toBeGreaterThan(0)
    expect(v.marketing).toContain('prime location')
    expect(v.invented).toEqual([])   // and postguard already keeps the two apart

    const res = await holdThenApprove({ caption, ...ROOM })
    expect(res.statusCode).toBe(200)
    expect(social.postToConnected).toHaveBeenCalledOnce()
  })

  it('a breach of the agent\'s own style rule publishes anyway', async () => {
    // On 2026-09-04 an emoji rule read as a blanket ban flattened a real client's
    // whole caption format on his live Facebook page. Style is the agent's to
    // fix; it is not worth losing the listing over.
    const caption = 'Tabuan Jaya room 🔥🔥 RM1,500/month. Wifi included. Walking distance to ICATS. 012-345 6789'
    expect(ruleViolations(caption, ['never use the fire emoji']).length).toBeGreaterThan(0)

    const res = await holdThenApprove({ caption, ...ROOM })
    expect(res.statusCode).toBe(200)
    expect(social.postToConnected).toHaveBeenCalledOnce()
  })

  it('a heuristic property-name WARNING publishes anyway', async () => {
    // The 2026-09-03 landmark bug, reproduced: a nearby mall is read as the
    // property's name, and the caption "drops" a name the property never had.
    // Warnings may never refuse anything.
    const body = {
      sourceText: 'Room for rent at Tabuan Jaya, next to Boulevard Shopping Mall. RM900/month. 012-345 6789',
      listing: { location: 'Tabuan Jaya', price: 900, listingType: 'rental' },
    }
    const caption = 'Room for rent in Tabuan Jaya — RM900 a month. 012-345 6789'
    const v = captionViolations(caption, { ...body.listing, rawText: body.sourceText })
    expect(v.warnings.length).toBeGreaterThan(0)
    expect(v.invented).toEqual([])

    const res = await holdThenApprove({ caption, ...body })
    expect(res.statusCode).toBe(200)
  })

  it('a MISSING fact publishes anyway — the write path already decided that', async () => {
    // ingest.js decides `missing` with the languages, the trained style and two
    // repair rounds of context this handler does not have, and it lets a single
    // non-money omission through on purpose. Re-deciding it here would refuse
    // posts the write path deliberately allowed.
    const body = {
      sourceText: 'Riveria Residence Kuching RM498,000. 1,100 sqft, 3 bed 2 bath. WhatsApp Kelvin 012-345 6789',
      listing: { propertyName: 'Riveria Residence', location: 'Kuching', price: 498000, sqft: 1100, bedrooms: 3, bathrooms: 2, listingType: 'sale' },
    }
    const caption = 'Riveria Residence, Kuching — RM498,000. 3 bed 2 bath. DM me for details.'
    const v = captionViolations(caption, { ...body.listing, rawText: body.sourceText })
    expect(v.missing.length).toBeGreaterThan(0)      // the sqft and the phone number
    expect(v.invented).toEqual([])

    const res = await holdThenApprove({ caption, ...body })
    expect(res.statusCode).toBe(200)
    expect(social.postToConnected).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------

describe('BACKWARD COMPATIBILITY: a record with no source is UNKNOWN, not guilty', () => {
  // The ~14 pendings already in the blob store were written before `source`
  // existed, and everything ingest.js writes still lacks it. Treating an absent
  // source as a failure would make every one of them unpublishable the moment
  // this ships — the same silent, total refusal this guard exists to prevent,
  // wearing a different costume.

  /** Exactly the record api/ingest.js putPending()s today: no `source` key. */
  const PRODUCTION_RECORD = {
    id: 'e5f48cc5',
    at: '2026-09-02T06:33:13.000Z',
    captionShort: 'Riveria Residence @ Kuching — RM498,000',
    mediaItems: [{ url: 'https://cdn.test/photo1.jpg', type: 'image' }],
    location: 'Kuching',
    price: 498000,
    listingType: 'sale',
    card: 'https://blob.test/card.png',
    cover: 'https://blob.test/card.png',
    caption: 'Riveria Residence, Kuching — RM498,000. 3 bed 2 bath, 1,100 sq ft. Gated and guarded, fully furnished, 5 minutes to Vivacity. Guaranteed 8% yield. WhatsApp 012-345 6789',
    group: null,
    mediaCount: 1,
    sender: '60123456789',
    profileId: 'p1',
    platforms: ['facebook', 'instagram'],
    captionDegraded: false,
    captionDegradedReason: null,
  }

  it('an already-held record publishes exactly as it does today', async () => {
    // The caption above is deliberately stuffed with everything MUST-CATCH
    // blocks. With no source there is nothing to check it against, and guessing
    // would refuse it. It publishes.
    pending.getPending.mockResolvedValue(PRODUCTION_RECORD)
    const res = await approve({ id: 'e5f48cc5', decision: 'approve' })
    expect(res.statusCode).toBe(200)
    expect(res.body.blocked).toBeUndefined()
    expect(social.postToConnected).toHaveBeenCalledOnce()
  })

  it('and so does one held today without the listing text', async () => {
    const res = await holdThenApprove({ caption: PRODUCTION_RECORD.caption })
    expect(heldRecord().source).toBe(null)
    expect(res.statusCode).toBe(200)
    expect(social.postToConnected).toHaveBeenCalledOnce()
  })

  it.each([
    ['source: null', null],
    ['source: undefined', undefined],
    ['an empty source object', {}],
    ['a source whose text is blank', { text: '   ' }],
    ['a source that is not an object', 'RM498,000'],
  ])('%s is treated as no source, and publishes', async (_n, source) => {
    pending.getPending.mockResolvedValue({ ...PRODUCTION_RECORD, source })
    const res = await approve({ id: 'e5f48cc5', decision: 'approve' })
    expect(res.statusCode).toBe(200)
    expect(social.postToConnected).toHaveBeenCalledOnce()
  })

  it('a guard that THROWS still publishes', async () => {
    // The guard must fail OPEN. Failing closed would take out every publish at
    // once, for every agent, with no error anyone ever sees — strictly worse
    // than publishing the caption a human is already looking at. Nothing in
    // postguard.js throws today, so this drives it from the outside: the point
    // is that the next thing added to captionViolations cannot take the product
    // down by throwing on one odd listing.
    vi.resetModules()
    vi.doMock('./postguard.js', () => ({
      captionViolations: () => { throw new TypeError('cannot read properties of undefined') },
    }))
    try {
      const { default: approveWithBrokenGuard } = await import('../approve.js')
      pending.getPending.mockResolvedValue({ ...PRODUCTION_RECORD, source: { text: 'Studio in Kuching RM650/month', price: 650 } })
      const res = mkRes()
      await approveWithBrokenGuard({ method: 'POST', url: '/api/approve', headers: { 'x-ingest-secret': 's3cret' }, body: { id: 'e5f48cc5', decision: 'approve' } }, res)
      expect(res.statusCode).toBe(200)
      expect(social.postToConnected).toHaveBeenCalledOnce()
    } finally {
      vi.doUnmock('./postguard.js')
      vi.resetModules()
    }
  })

  it('a source with junk in its parsed fields does not throw and does not refuse', async () => {
    pending.getPending.mockResolvedValue({
      ...PRODUCTION_RECORD,
      caption: 'Riveria Residence, Kuching — RM498,000. 3 bed 2 bath. WhatsApp 012-345 6789',
      source: {
        text: 'Riveria Residence Kuching RM498,000. 3 bed 2 bath. WhatsApp 012-345 6789',
        bedrooms: 'three', bathrooms: null, price: 'RM498k', sqft: NaN, propertyName: 42, tenure: [],
      },
    })
    const res = await approve({ id: 'e5f48cc5', decision: 'approve' })
    expect(res.statusCode).toBe(200)
  })
})

describe('money never refuses at the ✅ — the arithmetic agents really write', () => {
  // knownAmounts() can ground exactly three figures: the price, price x 12, and
  // price / sqft. Malaysian captions state far more arithmetic than that, all of
  // it computed off numbers the listing genuinely gives. Every case below was
  // measured refusing before money was taken out of this gate, and case 1 was
  // taken verbatim from a caption live on a client's page.
  //
  // Money invention is still caught on the WRITE path (ingest.js), where the
  // model is handed the invention by name and gets two rounds to rewrite it.
  // Here there is no repair round and no model — a refusal is terminal, silent,
  // and lands on the human at the moment they tap ✅.
  const COMPUTED = [
    ['a saving worked out against the bank valuation',
      { sourceText: 'Milano 8 Tabuan Jaya for sale RM540,000. Bank value RM582,000. 3 bed 2 bath, 1,200 sqft. Call 012-345 6789', price: 540000, listingType: 'sale' },
      '🔥 Milano 8, Tabuan Jaya — RM540,000\nSave RM42,000 below bank value\n3 bed 2 bath | 1,200 sqft\nCall 012-345 6789'],
    ['a deposit stated in ringgit as well as months',
      { sourceText: 'Vivacity condo for rent RM1,300/month. 2 rooms. Deposit 2 months. WhatsApp 012-987 6543', price: 1300, listingType: 'rental' },
      'Vivacity condo — RM1,300/month\n2 rooms\nDeposit: 2 months (RM2,600)\nWhatsApp 012-987 6543'],
    ['a downpayment worked out as a percentage',
      { sourceText: 'Terrace at Batu Kawa for sale RM450,000. 4 bed 3 bath. Loan up to 90%. Call 012-345 6789', price: 450000, listingType: 'sale' },
      'Batu Kawa terrace — RM450,000\n4 bed 3 bath\nLoan up to 90% — downpayment only RM45,000\nCall 012-345 6789'],
    ['an instalment estimate off a loan table',
      { sourceText: 'Apartment Jalan Song for sale RM390,000. 900 sqft, 3 bed 2 bath. WhatsApp 012-987 6543', price: 390000, listingType: 'sale' },
      'Jalan Song apartment — RM390,000\n3 bed 2 bath | 900 sqft\nEstimated instalment from RM1,750/month\nWhatsApp 012-987 6543'],
    ['an additive all-in total',
      { sourceText: 'Shoplot at Jalan Song for rent RM3,500/month plus RM300 service charge. WhatsApp 012-987 6543', price: 3500, listingType: 'rental' },
      'Jalan Song shoplot\nRM3,500/month + RM300 service charge (RM3,800 all in)\nWhatsApp 012-987 6543'],
    ['a discount netted off the asking price',
      { sourceText: 'Bumi lot at Kota Samarahan RM600,000. 7% bumi discount. 4 bed 3 bath. Call 019-777 4455', price: 600000, listingType: 'sale' },
      'Kota Samarahan — RM600,000\n4 bed 3 bath\nBumi lot — 7% discount, nett RM558,000\nCall 019-777 4455'],
    ['the annual rental, on a source that DOES carry the price',
      { sourceText: 'Tropics City Kota Samarahan for rent. RM1,300/month. 3 rooms, 900 sqft. Call Sheila 013-888 4422', price: 1300, listingType: 'rental' },
      'Tropics City, Kota Samarahan — RM1,300/month (RM15,600 a year). 3 rooms, 900 sq ft. Call Sheila 013-888 4422'],
  ]

  it.each(COMPUTED.map(([n, b, c], i) => [i, n, b, c]))('publishes #%i — %s', async (_i, _n, body, caption) => {
    const res = await holdThenApprove({ caption, ...body })
    expect(res.body.blocked).toBeUndefined()
    expect(res.statusCode).toBe(200)
    expect(social.postToConnected).toHaveBeenCalledOnce()
  })

  it('and the raw guard really does call these inventions — the exemption is load-bearing', async () => {
    // Without this the suite above could pass because postguard got quieter,
    // rather than because approve.js stopped acting on it.
    const named = COMPUTED.map(([, b, c]) =>
      captionViolations(c, { rawText: b.sourceText, price: b.price, listingType: b.listingType }).invented)
    expect(named.filter((v) => v.length).length).toBeGreaterThanOrEqual(6)
  })

  it('a NON-money invention alongside the arithmetic still blocks', async () => {
    // Taking money out of this gate must not take anything else out with it.
    const res = await holdThenApprove({
      caption: 'Vivacity condo — RM1,300/month\nDeposit: 2 months (RM2,600)\nGated and guarded with a swimming pool and gym\nWhatsApp 012-987 6543',
      sourceText: 'Vivacity condo for rent RM1,300/month. 2 rooms. Deposit 2 months. WhatsApp 012-987 6543',
      price: 1300, listingType: 'rental',
    })
    expect(res.statusCode).toBe(409)
    expect(res.body.invented).toContain('swimming pool')
    expect(res.body.invented.join(' ')).not.toMatch(/RM2,600/)
    leftIntact()
  })

  it('an outright invented price is let through here, and named on the write path instead', async () => {
    // Stated plainly rather than hidden: this gate no longer judges money at all,
    // so a fabricated price reaches the page if nothing upstream caught it. That
    // is the price of not refusing the six captions above, and it is paid where
    // there is a repair round to pay it — see ingest.js.
    const body = { sourceText: 'Tropics City Kota Samarahan for rent. RM1,300/month. 3 rooms, 900 sqft. Call Sheila 013-888 4422', price: 1300, listingType: 'rental' }
    const caption = 'Tropics City — was RM2,900/month, now RM1,300/month. 3 rooms. Call 013-888 4422'
    expect(captionViolations(caption, { rawText: body.sourceText, ...body }).invented.join(' ')).toMatch(/RM2,900/)
    const res = await holdThenApprove({ caption, ...body })
    expect(res.statusCode).toBe(200)
  })
})

describe('the source has to be a source', () => {
  const CAPTION = 'Milano 8, Tabuan Jaya — RM540,000. 3 bed 2 bath, 1,200 sqft. Partially furnished, swimming pool and parking. Call 012-345 6789'

  it('a bare `text` field is NOT taken as the listing', async () => {
    // `text` is a generic key. The Mac reel script is outside this repo and may
    // well send a hook line or a voiceover under it, and a source that describes
    // nothing refuses everything. A caller that means the listing says so.
    await hold({ caption: CAPTION, mediaItems: MEDIA, profileId: 'p1', text: 'Brand new, must see! Swipe for the album 🔥' })
    expect(heldRecord().source).toBe(null)
  })

  it.each([
    ['an 18-character fragment', 'FOR SALE - Kuching'],
    ['a building name alone', 'Milano 8 Tabuan Jaya'],
  ])('%s is too short to be a listing, so nothing is checked against it', async (_n, sourceText) => {
    // Measured: an 18-character source made this caption refuse with five
    // inventions named, every one of them a fact the real listing states. Short
    // is as dangerous as truncated, and in the same direction.
    const res = await holdThenApprove({ caption: CAPTION, sourceText })
    expect(heldRecord().source).toBe(null)
    expect(res.statusCode).toBe(200)
  })

  it('but a genuine one-line listing is still a source', async () => {
    // The floor sits below the shortest listing agents really send, so it costs
    // no coverage. This one is 33 characters.
    await hold({ caption: 'x', mediaItems: MEDIA, profileId: 'p1', sourceText: 'Studio in Kuching — RM650 a month' })
    expect(heldRecord().source?.text).toBe('Studio in Kuching — RM650 a month')
  })

  it('reads the listing text off a parsed listing too', async () => {
    await hold({ caption: 'x', mediaItems: MEDIA, profileId: 'p1', listing: { rawText: 'Tropics City Kota Samarahan for rent. RM1,300/month. 3 rooms.', price: 1300 } })
    expect(heldRecord().source?.price).toBe(1300)
  })
})

describe('force: true overrides, exactly as it does for captionDegraded', () => {
  const [, , body, caption] = MUST_CATCH[2]   // the guaranteed 8% yield

  it('publishes a caption the guard refused', async () => {
    const res = await holdThenApprove({ caption, ...body }, { force: true })
    expect(res.statusCode).toBe(200)
    expect(res.body.blocked).toBeUndefined()
    expect(social.postToConnected).toHaveBeenCalledOnce()
  })

  it('and the same post without force is still refused', async () => {
    const res = await holdThenApprove({ caption, ...body })
    expect(res.statusCode).toBe(409)
    leftIntact()
  })

  it('force does not weaken the degraded gate it sits beside', async () => {
    const res = await holdThenApprove({ caption, ...body, captionDegraded: true }, { force: true })
    expect(res.statusCode).toBe(200)   // force means force, for both gates
  })

  it('a degraded caption is still refused before this check ever runs', async () => {
    const res = await holdThenApprove({ caption: MUST_PASS[0][2], ...MUST_PASS[0][1], captionDegraded: true })
    expect(res.statusCode).toBe(409)
    expect(res.body.blocked).toBe('captionDegraded')
    leftIntact()
  })
})

describe('the GET link can use the override its own error names', () => {
  // approve.js documents GET /api/approve?id=…&decision=approve as the
  // convenience path, and both refusals end with "or pass force:true to publish
  // it anyway" — but the body is only parsed for POST. An override the error
  // message names and the documented path cannot reach is not an override.
  const [, , body, caption] = MUST_CATCH[2]   // the guaranteed 8% yield

  const getApprove = async (qs) => {
    const res = mkRes()
    await approveHandler({ method: 'GET', url: `/api/approve?id=held-1&decision=approve&secret=s3cret${qs}`, headers: {} }, res)
    return res
  }

  it('refuses on the GET path, same as POST', async () => {
    await hold({ mediaItems: MEDIA, profileId: 'p1', caption, ...body })
    pending.getPending.mockResolvedValue(heldRecord())
    const res = await getApprove('')
    expect(res.statusCode).toBe(409)
    leftIntact()
  })

  it.each([['&force=true'], ['&force=1'], ['&force=yes'], ['&force=TRUE']])('and %s gets through', async (qs) => {
    await hold({ mediaItems: MEDIA, profileId: 'p1', caption, ...body })
    pending.getPending.mockResolvedValue(heldRecord())
    const res = await getApprove(qs)
    expect(res.statusCode).toBe(200)
    expect(social.postToConnected).toHaveBeenCalledOnce()
  })

  it.each([['&force=false'], ['&force=0'], ['&force='], ['&force=maybe']])('but %s does not', async (qs) => {
    await hold({ mediaItems: MEDIA, profileId: 'p1', caption, ...body })
    pending.getPending.mockResolvedValue(heldRecord())
    const res = await getApprove(qs)
    expect(res.statusCode).toBe(409)
    leftIntact()
  })

  it('and it overrides the degraded gate on the GET path too', async () => {
    await hold({ mediaItems: MEDIA, profileId: 'p1', caption: MUST_PASS[0][2], ...MUST_PASS[0][1], captionDegraded: true })
    pending.getPending.mockResolvedValue(heldRecord())
    expect((await getApprove('')).statusCode).toBe(409)
    await hold({ mediaItems: MEDIA, profileId: 'p1', caption: MUST_PASS[0][2], ...MUST_PASS[0][1], captionDegraded: true })
    pending.getPending.mockResolvedValue(heldRecord())
    expect((await getApprove('&force=true')).statusCode).toBe(200)
  })
})

describe('the refusal says something an agent can act on', () => {
  it('names the invention in words, and offers the way out', async () => {
    const [, , body, caption] = MUST_CATCH[4]   // the four invented facilities
    const res = await holdThenApprove({ caption, ...body })
    const msg = res.body.error
    expect(msg).toMatch(/swimming pool/)
    expect(msg).toMatch(/force:true/)
    // No stack traces, no status codes, no field names — the agent reads this out.
    expect(msg).not.toMatch(/undefined|\[object|captionViolations|4\d\d|5\d\d/)
  })
})
