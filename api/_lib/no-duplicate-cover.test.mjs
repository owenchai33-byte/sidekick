// THE COVER PHOTO PUBLISHED TWICE.
//
// Seen on Facebook 2026-09-05: image 1 of the album was the bedroom shot with
// the price panel on it, and image 2 was the SAME bedroom shot, raw. Every post
// this system has ever made did that.
//
// renderBrandCard's own header says what it does: "Turns a listing photo into a
// polished cover: the photo, a gradient scrim, a FOR SALE / FOR RENT pill, and
// the price". The card IS the photo. withBrandCard then prepended it to the
// FULL media list, original included, so the album led with the same picture
// twice — one carded, one not.
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
vi.mock('./brandcard.js', () => ({ renderBrandCard: vi.fn(async () => Buffer.from('png')) }))
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async () => ({ url: 'https://blob.test/card.png' })),
  list: vi.fn(async () => ({ blobs: [] })), del: vi.fn(async () => {}),
}))

const { default: ingest } = await import('../ingest.js')

const mkRes = () => {
  const r = { statusCode: 0, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.end = (b) => { r.body = typeof b === 'string' ? JSON.parse(b) : b; return r }
  return r
}
const PHOTOS = ['https://cdn.test/bedroom.jpg', 'https://cdn.test/living.jpg', 'https://cdn.test/dining.jpg']
const run = async (images = PHOTOS) => {
  const res = mkRes()
  await ingest({
    method: 'POST', url: '/api/ingest', headers: { 'x-ingest-secret': 's3cret' },
    body: { profileId: 'p1', text: 'Tropics City Tabuan Dayak RM338,000. 1 bed 1 bath, 800 sqft. Call 012-345 6789', images },
  }, res)
  return res
}
const written = () => pending.putPending.mock.calls.at(-1)[0]

beforeEach(() => {
  process.env.INGEST_SECRET = 's3cret'
  process.env.BLOB_READ_WRITE_TOKEN = 'tok'
  vi.clearAllMocks()
  pending.putPending.mockResolvedValue('held-1')
  social.defaultProfile.mockReturnValue('')
  social.connectedAccounts.mockResolvedValue(0)
  providers.providerStatus.mockReturnValue({ configured: true, provider: 'groq' })
  providers.runModel.mockResolvedValue('{}')
  providers.extractJson
    .mockImplementationOnce(() => { throw new Error('use demoParse') })
    .mockReturnValue({ caption: 'Tropics City, Tabuan Dayak — RM338,000. 1 bed 1 bath, 800 sqft. Call 012-345 6789' })
})

describe('the carded photo is not published twice', () => {
  it('the raw photo the card was made from is gone from the album', async () => {
    await run()
    const urls = written().mediaItems.map((m) => m.url)
    expect(urls[0]).toBe('https://blob.test/card.png')
    expect(urls).not.toContain('https://cdn.test/bedroom.jpg')
  })

  it('every other photo survives, in order', async () => {
    await run()
    const urls = written().mediaItems.map((m) => m.url)
    expect(urls).toEqual(['https://blob.test/card.png', 'https://cdn.test/living.jpg', 'https://cdn.test/dining.jpg'])
  })

  it('no image appears twice, whatever the input', async () => {
    await run()
    const urls = written().mediaItems.map((m) => m.url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('the count the human is told matches the album', async () => {
    // mediaCount drives "(card + N photos)" in the WhatsApp preview. It counted
    // the duplicate too, so the human was told one more photo than they got.
    const res = await run()
    expect(written().mediaCount).toBe(written().mediaItems.length)
    expect(res.body.mediaCount).toBe(written().mediaItems.length)
  })

  it('a single-photo listing still posts one image, not a card plus its twin', async () => {
    await run(['https://cdn.test/only.jpg'])
    expect(written().mediaItems.map((m) => m.url)).toEqual(['https://blob.test/card.png'])
  })

  it('the photo the card came from is recorded, so it is recoverable', async () => {
    await run()
    expect(written().cardFrom).toBe('https://cdn.test/bedroom.jpg')
  })

  it('a video first still cards the first IMAGE, and removes that image only', async () => {
    // `first` is found by type, not by position, so the removal must follow it.
    await run(['https://cdn.test/tour.mp4', 'https://cdn.test/bedroom.jpg', 'https://cdn.test/living.jpg'])
    const urls = written().mediaItems.map((m) => m.url)
    expect(urls).toContain('https://cdn.test/tour.mp4')
    expect(urls).not.toContain('https://cdn.test/bedroom.jpg')
    expect(urls).toContain('https://cdn.test/living.jpg')
  })
})

// ---------------------------------------------------------------------------
// AND THE THIRD HARDCODED "KUCHING".
//
// brandcard.js read `listing.location || 'Kuching'` and drew it onto the image.
// That is the worst place of the three for a substituted location: a caption can
// be edited and a script can be re-rendered, but a wrong town BURNED INTO A JPEG
// on a client's page cannot be repaired — and no model is involved, so no
// caption guard would ever have seen it.
describe('the price card never draws a town the listing did not give', () => {
  it('omits the location line rather than inventing one', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./brandcard.js', import.meta.url), 'utf8'))
    expect(src).not.toMatch(/listing\.location \|\| 'Kuching'/)
    // the element is conditional, so an absent location draws nothing at all
    expect(src).toMatch(/loc \? h\('span'/)
  })
})
