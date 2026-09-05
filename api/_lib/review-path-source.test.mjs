// THE REVIEW PATH, RE-CHECKED AT THE ✅ — and proved not to refuse anything it
// used to publish.
//
// ingest.js now stores the agent's listing text on the pending it writes, so
// approve.js can measure the caption against it at the tick instead of only
// trusting captionDegraded. That is a second reading of evidence the write path
// has already read, and the danger is entirely one-sided: the write path calls
// captionViolations with the FULL parsed listing, while approve.js calls it with
// the stored subset. If those two disagree, a caption that ingest deliberately
// allowed gets refused at the ✅ — silently, terminally, with no repair round.
// That is the silent-refusal failure this product has shipped five times.
//
// So every one of these runs the REAL chain: ingest (review) -> approve.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const pending = { putPending: vi.fn(), getPending: vi.fn(), delPending: vi.fn(), claimPending: vi.fn(), releasePending: vi.fn() }
const social = { postToConnected: vi.fn(), connectedAccounts: vi.fn(), defaultProfile: vi.fn() }
const providers = { providerStatus: vi.fn(), runModel: vi.fn(), extractJson: vi.fn() }

vi.mock('./pending.js', () => pending)
vi.mock('./social.js', () => social)
vi.mock('./feed.js', () => ({ appendFeed: vi.fn() }))
vi.mock('./providers.js', () => providers)
vi.mock('./style.js', () => ({ getStyle: vi.fn(async () => ({})), getRules: vi.fn(async () => ({ rules: [] })) }))
vi.mock('./brand.js', () => ({ getBrand: vi.fn(async () => ({})) }))
vi.mock('./brandcard.js', () => ({ renderBrandCard: vi.fn(async () => Buffer.from('')) }))
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async () => ({ url: 'https://blob.test/card.png' })),
  list: vi.fn(async () => ({ blobs: [] })), del: vi.fn(async () => {}),
}))

const { default: ingestHandler } = await import('../ingest.js')
const { default: approveHandler } = await import('../approve.js')

const mkRes = () => {
  const r = { statusCode: 0, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.end = (b) => { r.body = typeof b === 'string' ? JSON.parse(b) : b; return r }
  return r
}
const call = async (h, path, body) => {
  const res = mkRes()
  await h({ method: 'POST', url: path, headers: { 'x-ingest-secret': 's3cret' }, body }, res)
  return res
}
const heldRecord = () => pending.putPending.mock.calls.at(-1)[0]

beforeEach(() => {
  process.env.INGEST_SECRET = 's3cret'
  vi.clearAllMocks()
  pending.putPending.mockResolvedValue('held-1')
  social.defaultProfile.mockReturnValue('')
  social.connectedAccounts.mockResolvedValue(0)
  providers.providerStatus.mockReturnValue({ configured: true, provider: 'groq' })
})

/** Ingest a listing, then tick the held record BOTH ways: as it is now stored
 *  (with a source) and as it was stored before this change (source stripped).
 *  The comparison is the whole point — the only regression that matters is a
 *  post that used to publish and now does not. */
const bothWays = async (text, caption) => {
  providers.runModel.mockResolvedValue('{}')
  // The parse call falls back to the real demoParse, exactly as production does
  // when the provider is out of budget; the content call returns the caption.
  providers.extractJson
    .mockImplementationOnce(() => { throw new Error('no json') })
    .mockReturnValue({ caption })
  await call(ingestHandler, '/api/ingest', { profileId: 'p1', text, images: ['https://cdn.test/photo1.jpg'] })
  const rec = heldRecord()

  pending.getPending.mockResolvedValue(rec)
  const withSource = await call(approveHandler, '/api/approve', { id: 'held-1', decision: 'approve' })
  vi.clearAllMocks(); social.defaultProfile.mockReturnValue(''); social.connectedAccounts.mockResolvedValue(0)
  pending.getPending.mockResolvedValue({ ...rec, source: null })
  const without = await call(approveHandler, '/api/approve', { id: 'held-1', decision: 'approve' })
  return { rec, withSource, without }
}

// Real listings, and captions faithful to them — the kind the write path lets
// through every day. Not one of them may be refused at the tick.
const FAITHFUL = [
  ['a sale with a below-value hook',
    'Riveria Residence Kuching for sale\nRM498,000 nego\n1,100 sqft, 3 bed 2 bath\nFully furnished, gated and guarded\nRM100k below market valuation\nWhatsApp Kelvin 012-345 6789',
    'Riveria Residence, Kuching — for sale\nRM498,000 (nego)\n1,100 sq ft | 3 bed | 2 bath\nFully furnished, gated and guarded\nRM100k below market valuation\nWhatsApp Kelvin 012-345 6789'],
  ['a rental with a walking-distance line',
    'Tropics City Kota Samarahan for rent. RM1,300/month. 3 rooms, 900 sqft, fully tiled. Walking distance to UNIMAS. Call Sheila 013-888 4422',
    'Tropics City, Kota Samarahan — for rent\nRM1,300 a month\n3 rooms, 900 sq ft, fully tiled\nWalking distance to UNIMAS\nCall Sheila 013-888 4422'],
  ['a Malay listing captioned in Malay',
    'Rumah teres dua tingkat di Kota Samarahan. RM520,000 boleh runding. 4 bilik tidur, 3 bilik air. Hubungi 012-345 6789',
    'Rumah teres dua tingkat, Kota Samarahan\nRM520,000 (boleh runding)\n4 bilik tidur | 3 bilik air\nHubungi 012-345 6789'],
  ['a Chinese listing captioned in Chinese',
    '古晋 BDC 排屋出售，售价 RM43万。3 房 2 厕，1,320 平方尺，永久地契。联络 012-345 6789',
    '古晋 BDC 排屋出售\n售价 RM43万\n3 房 2 厕 · 1,320 平方尺\n永久地契\n联络 012-345 6789'],
  ['a one-line room ad',
    'Master room for rent at Vivacity RM800/month, attached bathroom, aircond wifi cleaning included, female preferred. DM 012-345 6789',
    'Master room at Vivacity — RM800/month\nAttached bathroom\nAircond, wifi and cleaning included\nFemale preferred. DM 012-345 6789'],
  ['a very short listing',
    'Studio in Kuching for rent RM650 a month. Call 012-345 6789',
    'Studio in Kuching — RM650 a month. Call 012-345 6789'],
  ['a listing with a computed annual rental',
    'Kingwood Park Sibu for sale RM320,000. 2 bed 1 bath, first floor. Currently tenanted at RM1,350/month. Call 011-2345 6789',
    'Kingwood Park, Sibu — RM320,000\n2 bed 1 bath, first floor\nTenanted at RM1,350/month (RM16,200 a year)\nCall 011-2345 6789'],
  ['a leasehold with the years remaining',
    'Apartment Jalan Song for sale RM390,000. 900 sqft, 3 bed 2 bath. Leasehold, 89 years remaining. WhatsApp 012-987 6543',
    'Jalan Song apartment — RM390,000\n900 sq ft | 3 bed | 2 bath\nLeasehold, 89 years remaining\nWhatsApp 012-987 6543'],
]

describe('storing the source refuses nothing that used to publish', () => {
  it.each(FAITHFUL.map(([n, t, c], i) => [i, n, t, c]))('#%i — %s', async (_i, _n, text, caption) => {
    const { rec, withSource, without } = await bothWays(text, caption)
    // The source really was stored, so this is not passing by never checking.
    expect(rec.source?.text).toBe(text)
    // THE ASSERTION THAT MATTERS. Not "it publishes" — some of these are refused
    // by the pre-existing captionDegraded gate, and that is not this change's
    // doing. What must never happen is the two disagreeing.
    expect(withSource.statusCode).toBe(without.statusCode)
    if (withSource.statusCode === 409) {
      expect(withSource.body.blocked).toBe(without.body.blocked)
    }
  })

  it('at least half the corpus genuinely reaches the new check', async () => {
    // Otherwise the suite above could be green because every case was stopped
    // earlier by captionDegraded and the source was never read at all.
    let reached = 0
    for (const [, text, caption] of FAITHFUL) {
      const { rec, withSource } = await bothWays(text, caption)
      if (rec.source && !rec.captionDegraded && withSource.statusCode === 200) reached++
      vi.clearAllMocks(); social.defaultProfile.mockReturnValue(''); social.connectedAccounts.mockResolvedValue(0)
      pending.putPending.mockResolvedValue('held-1')
    }
    expect(reached).toBeGreaterThanOrEqual(4)
  })
})

describe('and the re-check is not decoration', () => {
  it('a fact the listing never stated is caught at the ✅ on the review path', async () => {
    // Driven straight at approve with a record shaped exactly as ingest.js now
    // writes one, so the assertion is about the guard and not about how well the
    // fallback parser happened to read the listing.
    pending.getPending.mockResolvedValue({
      id: 'held-1', caption: 'Batu Kawa terrace — RM620,000. 4 bed 3 bath, 1,540 sq ft. Gated and guarded with a swimming pool and gym. Call 012-345 6789',
      mediaItems: [{ url: 'https://cdn.test/p.jpg', type: 'image' }], profileId: 'p1', platforms: ['facebook'],
      captionDegraded: false,
      source: { text: 'Terrace at Batu Kawa for sale RM620,000. 4 bed 3 bath, 1,540 sqft. Call 012-345 6789',
        location: 'Batu Kawa', price: 620000, bedrooms: 4, bathrooms: 3, sqft: 1540, listingType: 'sale' },
    })
    const app = await call(approveHandler, '/api/approve', { id: 'held-1', decision: 'approve' })
    expect(app.statusCode).toBe(409)
    expect(app.body.invented).toContain('swimming pool')
    expect(social.postToConnected).not.toHaveBeenCalled()
  })

  it('and the identical record with no source publishes — which is what changed', async () => {
    pending.getPending.mockResolvedValue({
      id: 'held-1', caption: 'Batu Kawa terrace — RM620,000. 4 bed 3 bath, 1,540 sq ft. Gated and guarded with a swimming pool and gym. Call 012-345 6789',
      mediaItems: [{ url: 'https://cdn.test/p.jpg', type: 'image' }], profileId: 'p1', platforms: ['facebook'],
      captionDegraded: false, source: null,
    })
    const app = await call(approveHandler, '/api/approve', { id: 'held-1', decision: 'approve' })
    expect(app.statusCode).toBe(200)
  })
})
