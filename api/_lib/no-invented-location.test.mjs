// A LOCATION IS A FACT ABOUT A REAL ADDRESS, so the deterministic paths must
// never supply one the listing did not.
//
// Until 2026-09-04 both fallbacks read `listing.location || 'Kuching'`, and the
// reel caption ended `#KuchingProperty #Sarawak` unconditionally. That was true
// of the pilot agent and of nobody else. A Miri, Sibu, Bintulu or Johor listing
// whose area the parser missed was published on TikTok as being in Kuching —
// and these two functions run with NO model in them, so there is no repair
// round, no captionViolations pass and no human review between the substitution
// and a paying client's public account.
//
// These tests are pinned on the SHIPPED functions, not on a copy of the rule.
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Same harness as degraded-hold.test.mjs: no provider is ever reached, so this
// exercises exactly the deterministic path the substitution lived on.
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

const mkRes = () => {
  const r = { statusCode: 0, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.end = (b) => { r.body = typeof b === 'string' ? JSON.parse(b) : b; return r }
  return r
}
const reel = async (text) => {
  const res = mkRes()
  await ingestHandler({
    method: 'POST', url: '/api/ingest', headers: { 'x-ingest-secret': 's3cret' },
    body: { mode: 'reel', profileId: 'p1', text, images: ['https://cdn.test/photo1.jpg'] },
  }, res)
  return res.body
}

beforeEach(() => {
  process.env.INGEST_SECRET = 's3cret'
  vi.clearAllMocks()
  // A provider IS configured and the call fails — the live shape of the incident,
  // and the only way to reach the deterministic template.
  providers.providerStatus.mockReturnValue({ configured: true, provider: 'gemini' })
  providers.runModel.mockRejectedValue(new Error('429 quota exceeded'))
  pending.putPending.mockResolvedValue('held-1')
  social.defaultProfile.mockReturnValue('')
  social.connectedAccounts.mockResolvedValue(0)
})

describe('the deterministic reel never names a town the listing did not', () => {
  // Listings from outside Sarawak, and listings whose area the fallback parser
  // simply does not find. Both used to come out saying Kuching.
  const NO_LOCATION_FOUND = [
    ['a Chinese listing the fallback parser cannot place', '古晋 BDC 排屋出售 售价 430,000, 3 房 2 厕'],
    ['a Malay listing the fallback parser cannot place', 'Rumah teres di Samarahan, RM520,000, 4 bilik 3 tandas'],
    ['an all-caps shoplot ad', 'SHOPLOT AT STUTONG BARU FOR RENT RM3,500/MO, 22FT FRONTAGE'],
  ]

  it.each(NO_LOCATION_FOUND)('%s says no town at all', async (_n, text) => {
    const r = await reel(text)
    expect(r.caption).not.toMatch(/Kuching/i)
    expect(r.caption).not.toMatch(/Sarawak/i)
    expect(r.script).not.toMatch(/Kuching/i)
    // and it still reads as a sentence rather than a gap
    expect(r.script).toMatch(/Looking for a new place\?/)
  })

  it('a town the listing DOES name is kept, verbatim', async () => {
    const r = await reel('Apartment at Batu Kawa for sale RM480,000, 3 bed 2 bath')
    expect(r.caption).toContain('in Batu Kawa')
    expect(r.script).toContain('a place in Batu Kawa')
  })

  it('the hashtags follow the listing, and never assert a state', async () => {
    const r = await reel('Apartment at Batu Kawa for sale RM480,000, 3 bed 2 bath')
    expect(r.caption).toContain('#BatuKawaProperty')
    expect(r.caption).toContain('#PropertyMalaysia')
    expect(r.caption).not.toContain('#Sarawak')       // we are never told the state
    expect(r.caption).not.toContain('#KuchingProperty')
  })

  it('with no location there are no geographic hashtags at all', async () => {
    const r = await reel('古晋 BDC 排屋出售 售价 430,000, 3 房 2 厕')
    expect(r.caption).toMatch(/#PropertyMalaysia\s*$/)
    expect(r.caption.match(/#/g)).toHaveLength(1)      // a hashtag is a claim
  })
})

describe('the TikTok title never names a town the listing did not', () => {
  // shortCaption() is what PostPeer publishes as the TikTok title, and nothing
  // validates it — captionViolations only ever sees `caption`.
  it('omits the location rather than inventing one', async () => {
    const r = await reel('SHOPLOT AT STUTONG BARU FOR RENT RM3,500/MO, 22FT FRONTAGE')
    expect(r.captionShort ?? '').not.toMatch(/Kuching/i)
  })

  it('keeps a location the listing gave', async () => {
    const r = await reel('Condo in Petra Jaya for rent RM2.1k/month, 2 rooms')
    if (r.captionShort) expect(r.captionShort).toContain('Petra Jaya')
  })
})
