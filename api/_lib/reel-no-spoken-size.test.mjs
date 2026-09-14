// Through the real /api/ingest reel path: the model writes the size into the
// voiceover anyway (as it did for Edward's Penview reel on 2026-09-14), and what
// comes back — and what gets held — does not say it. The caption keeps it.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const pending = { putPending: vi.fn(), getPending: vi.fn(), delPending: vi.fn(), claimPending: vi.fn(), releasePending: vi.fn() }
const social = { postToConnected: vi.fn(), connectedAccounts: vi.fn(), defaultProfile: vi.fn() }
const providers = { providerStatus: vi.fn(), runModel: vi.fn(), extractJson: vi.fn(), runModelVision: vi.fn() }

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

const PENVIEW = `Nearby Penview Hotel Pending First floor
Commercial shoplot for Sale

742.7 sqft
First Floor
Selling price:
Rm198,000`
const SCRIPT = "Check this out! A commercial shoplot on the first floor, right next to Penview Hotel. It's 742.7 sq ft and priced at RM198,000. Message me for a viewing!"
const CAPTION = 'Shoplot – FOR SALE\n\nRM198,000\n\n742.7 sq ft\n\n#PenviewHotel #Shoplot'

const reel = async (listing) => {
  providers.extractJson.mockReset()
  providers.extractJson
    .mockImplementationOnce(() => listing)                                    // the parse
    .mockImplementation(() => ({ script: SCRIPT, caption: CAPTION }))         // the reel writer
  const r = { statusCode: 0, body: null, headers: {}, setHeader() {}, end(b) { this.body = typeof b === 'string' ? JSON.parse(b) : b; return this } }
  await ingestHandler({ method: 'POST', url: '/api/ingest', headers: { 'x-ingest-secret': 's3cret' },
    body: { mode: 'reel', profileId: 'p1', text: PENVIEW, images: ['https://cdn.test/photo1.jpg'] } }, r)
  return r.body
}

beforeEach(() => {
  process.env.INGEST_SECRET = 's3cret'
  vi.clearAllMocks()
  providers.providerStatus.mockReturnValue({ configured: true, provider: 'groq' })
  providers.runModel.mockResolvedValue('{}')
  social.defaultProfile.mockReturnValue('')
  social.connectedAccounts.mockResolvedValue(0)
})

describe('the reel voice does not read the size the price bar shows', () => {
  it('drops it from the script and the held record, keeps it in the caption', async () => {
    const out = await reel({ price: 198000, sqft: 742.7, listingType: 'sale', location: 'Penview Hotel', propertyType: 'shoplot', rawText: PENVIEW })
    expect(out.ok).toBe(true)
    expect(out.captionDegraded).toBe(false)
    expect(out.script).toBe("Check this out! A commercial shoplot on the first floor, right next to Penview Hotel. It's priced at RM198,000. Message me for a viewing!")
    expect(out.holdBody.script).toBe(out.script)
    expect(out.caption).toContain('742.7 sq ft')
    expect(out.listing.sqft).toBe(742.7)
  })

  it('the reel writer is told the size is caption-only and never reads it in the listing', async () => {
    await reel({ price: 198000, sqft: 742.7, listingType: 'sale', location: 'Penview Hotel', propertyType: 'shoplot', rawText: PENVIEW })
    const prompt = providers.runModel.mock.calls.map((c) => c[0]).find((p) => /Write a TikTok reel/.test(p))
    expect(prompt).toMatch(/Floor area: 742\.7 sq ft — for the CAPTION only/)
    const message = prompt.slice(prompt.indexOf("Agent's message:"))
    expect(message).toMatch(/Rm198,000/)
    expect(message).not.toMatch(/742\.7/)
  })

  it('leaves the voice alone when the bar has no size to show', async () => {
    const out = await reel({ price: 198000, sqft: null, listingType: 'sale', location: 'Penview Hotel', propertyType: 'shoplot', rawText: PENVIEW })
    expect(out.script).toBe(SCRIPT)
  })
})
