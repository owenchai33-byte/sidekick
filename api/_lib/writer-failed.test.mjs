// A writer that FAILED says so, with why; a caption the checks REFUSED does not.
// The Mac retries only the first. Edward, 2026-09-15 12:08: the reel came back
// "the reel writer failed" with a reason attached, the Mac's retry keyed on "no
// reason", and so it never retried — the TikTok reel was simply missing.
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

const TAPANG = '🏡 Brand New Double Storey Intermediate House For Sale\n\n📍 Tapang Height, 7 Mile Sentosa\n💰 Selling Price: RM850,000 Nego\n\n🏠 Property Details:\n• 4 Bedrooms\n• 4 Bathrooms'
const LISTING = { price: 850000, listingType: 'sale', location: 'Tapang Height, 7 Mile Sentosa', bedrooms: 4, bathrooms: 4, rawText: TAPANG }
const RATE_LIMIT = 'groq 429: Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute'
const call = async (body) => {
  const r = { statusCode: 0, body: null, headers: {}, setHeader() {}, end(b) { this.body = typeof b === 'string' ? JSON.parse(b) : b; return this } }
  await ingestHandler({ method: 'POST', url: '/api/ingest', headers: { 'x-ingest-secret': 's3cret' }, body }, r)
  return r.body
}

beforeEach(() => {
  process.env.INGEST_SECRET = 's3cret'
  vi.clearAllMocks()
  providers.providerStatus.mockReturnValue({ configured: true, provider: 'groq' })
  social.defaultProfile.mockReturnValue('')
  social.connectedAccounts.mockResolvedValue(0)
  pending.putPending.mockResolvedValue('held-1')
})

describe('the reel writer says when it failed, and why', () => {
  it('a rate-limited reel writer is flagged writerFailed with the real error', async () => {
    let n = 0
    providers.runModel.mockImplementation(async () => { n++; if (n === 1) return '{}'; throw new Error(RATE_LIMIT) })
    providers.extractJson.mockImplementation(() => LISTING)
    const out = await call({ mode: 'reel', profileId: 'p1', text: TAPANG, images: ['https://cdn.test/1.jpg'] })
    expect(out.ok).toBe(true)
    expect(out.captionDegraded).toBe(true)
    expect(out.writerFailed).toBe(true)
    expect(out.writerError).toMatch(/429/)
  })

  it('a reel the model wrote is not flagged', async () => {
    providers.runModel.mockResolvedValue('{}')
    providers.extractJson.mockImplementationOnce(() => LISTING).mockImplementation(() => ({ script: 'Check this out! Message me for a viewing!', caption: 'Tapang Height' }))
    const out = await call({ mode: 'reel', profileId: 'p1', text: TAPANG, images: ['https://cdn.test/1.jpg'] })
    expect(out.captionDegraded).toBe(false)
    expect(out.writerFailed).toBeUndefined()
  })
})

describe('the FB/IG writer says when it failed', () => {
  it('a rate-limited caption writer is flagged writerFailed', async () => {
    let n = 0
    providers.runModel.mockImplementation(async () => { n++; if (n === 1) return '{}'; throw new Error(RATE_LIMIT) })
    providers.extractJson.mockImplementation(() => LISTING)
    const out = await call({ profileId: 'p1', text: TAPANG, images: ['https://cdn.test/1.jpg'] })
    expect(out.captionDegraded).toBe(true)
    expect(out.captionDegradedReason ?? null).toBeNull()
    expect(out.writerFailed).toBe(true)
    expect(out.captionEngineError).toMatch(/429/)
  })
})
