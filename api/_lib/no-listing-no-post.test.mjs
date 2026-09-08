// A FINISHED POST ABOUT A PROPERTY NOBODY DESCRIBED.
//
// Measured against the live function 2026-09-08 with text:''. The reel branch
// returned ok:true and this script:
//   "Looking for a new place? This one. Trust me, it won't last long.
//    DM me now before it's gone."
// The feed branch returned a caption reading "📍 Location: [Specify Location]"
// and tagged it #PCMY_Sale — a transaction type that appears nowhere in any
// input, copied out of the agent's trained style template.
//
// It happens for a real reason: WhatsApp media is never debounced, so six
// photos start a run and the listing text lands seconds later. On 2026-09-08 at
// 08:07:43 the agent built and showed Owen a complete reel; the listing arrived
// at 08:07:51.
//
// No caption guard can catch this. Every one of them checks the caption against
// the listing, and when the listing is empty there is nothing to contradict —
// an empty source makes every invention unfalsifiable. The refusal has to come
// before the model is asked.
//
// The other half of this file matters just as much: the guard must not refuse a
// real listing. Seven guards in this codebase have done exactly that.
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
const PHOTOS = ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg']
const run = async (text, extra = {}) => {
  const res = mkRes()
  await ingest({
    method: 'POST', url: '/api/ingest', headers: { 'x-ingest-secret': 's3cret' },
    body: { profileId: 'p1', text, images: PHOTOS, ...extra },
  }, res)
  return res
}

beforeEach(() => {
  process.env.INGEST_SECRET = 's3cret'
  process.env.BLOB_READ_WRITE_TOKEN = 'tok'
  vi.clearAllMocks()
  pending.putPending.mockResolvedValue('held-1')
  social.defaultProfile.mockReturnValue('')
  social.connectedAccounts.mockResolvedValue(0)
  providers.providerStatus.mockReturnValue({ configured: true, provider: 'groq' })
  providers.runModel.mockResolvedValue('{}')
  // Force the demoParse fallback for the parse call, then hand back a caption —
  // the same shape the other ingest tests use.
  providers.extractJson
    .mockImplementationOnce(() => { throw new Error('use demoParse') })
    .mockReturnValue({ caption: 'a caption', script: 'a script', facebook_page: { en: 'a caption' } })
})

describe('photos with no listing do not become a post', () => {
  for (const [label, text] of [
    ['nothing at all', ''],
    ['a bare handover line', 'here you go'],
    ['emoji only', '📸📸📸'],
    ['punctuation only', '-----'],
    ['a greeting', 'hi bro'],
  ]) {
    it(`the feed path refuses: ${label}`, async () => {
      const res = await run(text)
      expect(res.body.ok).toBe(false)
      expect(res.body.reason).toMatch(/no listing to post/i)
      expect(pending.putPending).not.toHaveBeenCalled()
    })

    it(`the reel path refuses: ${label}`, async () => {
      const res = await run(text, { mode: 'reel' })
      expect(res.body.ok).toBe(false)
      expect(res.body.script).toBeUndefined()
    })
  }

  it('the refusal says what to send instead', async () => {
    // A refusal nobody can act on is its own failure — the agent needs to know
    // it should go ask for the listing text.
    const res = await run('')
    expect(res.body.reason).toMatch(/listing text/i)
    expect(res.body.reason).toMatch(/price|size|location/i)
  })

  it('no model is asked to write anything', async () => {
    // The point is to refuse BEFORE the model invents, not to filter after.
    await run('')
    // Only the parse may run; no caption or reel-script call.
    expect(providers.runModel.mock.calls.length).toBeLessThanOrEqual(1)
  })
})

describe('a real listing is never refused', () => {
  const REAL = [
    ['Owen\'s RENNA listing', 'Brand New RENNA RESIDENCE for Rent\nThe Northbank, Kuching\n2 Bedrooms | 2 Bathrooms\nSize: 787 Sqft | Fully Furnished\nRental price: RM2.5k (nego)'],
    ['one line, one price', 'RM338,000 Tropics City Tabuan Dayak'],
    ['a price and nothing else', 'RM2,500/month'],
    ['rooms and size only', '3 bedrooms 2 bathrooms 1200 sqft'],
    ['a location only', 'Unit at Vivacity Megamall Kuching'],
    ['Chinese rental', '出租 RM1800 每月 2房2厕 Kuching'],
  ]
  for (const [label, text] of REAL) {
    it(`accepted: ${label}`, async () => {
      const res = await run(text)
      expect(res.body.reason || '').not.toMatch(/no listing to post/i)
    })
  }

  it('a short listing with a number survives a parser that recovers nothing', async () => {
    // THE EIGHTH SILENT REFUSAL, CAUGHT HERE INSTEAD OF IN A CHAT.
    //
    // The first cut of this guard refused on "no parsed fields AND short text",
    // and it took down 'For rent in Kuching, RM1,300 per month, 3 rooms' — a
    // complete, correct listing — the moment the parse came back empty. On the
    // free tier the parse comes back empty several times a day.
    //
    // Every real listing carries a number: a price, a size, a floor, a room
    // count, a phone. One digit is enough to prove there is something here.
    for (const text of [
      'For rent in Kuching, RM1,300 per month, 3 rooms',
      'RM2.5k',
      'Kuching unit, call 0143998011',
      '出租 RM1800',
    ]) {
      vi.clearAllMocks()
      providers.providerStatus.mockReturnValue({ configured: true, provider: 'groq' })
      providers.runModel.mockResolvedValue('{}')
      // A parse that recovers NOTHING — the rate-limited case.
      providers.extractJson.mockReturnValue({ facebook_page: { en: 'a caption' } })
      const res = await run(text)
      expect(res.body.reason || '', text).not.toMatch(/no listing to post/i)
    }
  })

  it('a long listing survives a parser that recovers nothing', async () => {
    // The free tier rate-limits constantly and demoParse is what runs then. If
    // the guard trusted the parse alone, a rate limit would start refusing real
    // listings — which is precisely how the other seven refusals shipped.
    const wordy = 'Beautiful spacious unit available now in a quiet neighbourhood, '
      + 'recently renovated throughout with a lovely open outlook, viewing anytime, '
      + 'please contact me for the full details and to arrange a visit'
    const res = await run(wordy)
    expect(res.body.reason || '').not.toMatch(/no listing to post/i)
  })
})
