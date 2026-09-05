// CHANGING THE COVER, WITHOUT TOUCHING THE CAPTION.
//
// 2026-09-05: Owen sent a photo captioned "this is the first photo". The agent
// replied "Got it — this will be the cover photo for the reel & posts", he said
// "post it lesgo", and the ORIGINAL cover went out on Facebook, Instagram and
// TikTok.
//
// The model had not disobeyed. The cover is positional — withBrandCard renders
// the price panel onto media[0] and prepends it — AGENTS.md offered only "want a
// different cover? send it first", and there was no command that could change
// one after the post was composed. AGENTS.md even listed the cover under "what
// is trainable", which was untrue. So the model was told a capability existed,
// had no way to use it, and agreed anyway. Same shape as the invented captions:
// prose promised something the code could not do.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const pending = { putPending: vi.fn(), getPending: vi.fn(), delPending: vi.fn(), claimPending: vi.fn(), releasePending: vi.fn() }
const social = { postToConnected: vi.fn(), connectedAccounts: vi.fn(), defaultProfile: vi.fn() }
const providers = { providerStatus: vi.fn(), runModel: vi.fn(), extractJson: vi.fn() }

vi.mock('./pending.js', () => pending)
vi.mock('./social.js', () => social)
vi.mock('./feed.js', () => ({ appendFeed: vi.fn() }))
vi.mock('./providers.js', () => providers)
vi.mock('./style.js', () => ({ getStyle: vi.fn(async () => ({})), getRules: vi.fn(async () => ({ rules: [] })) }))
vi.mock('./brand.js', () => ({ getBrand: vi.fn(async () => ({ color: '#C8102E', name: 'TRR' })) }))
vi.mock('./brandcard.js', () => ({ renderBrandCard: vi.fn(async () => Buffer.from('png')) }))
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async () => ({ url: 'https://blob.test/card-NEW.png' })),
  list: vi.fn(async () => ({ blobs: [] })), del: vi.fn(async () => {}),
}))

const { default: ingest } = await import('../ingest.js')

const mkRes = () => {
  const r = { statusCode: 0, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.end = (b) => { r.body = typeof b === 'string' ? JSON.parse(b) : b; return r }
  return r
}
const post = async (body) => {
  const res = mkRes()
  await ingest({ method: 'POST', url: '/api/ingest', headers: { 'x-ingest-secret': 's3cret' }, body }, res)
  return res
}

const TUNED = '🏡 TROPICS CITY – FOR SALE\n\nRM338,000\n\n📍 TABUAN DAYAK\n\n🛏️ 1 Bed | 🛁 1 Bath | 📐 800 sqft'
const HELD = {
  id: 'p1', profileId: 'PROF1', caption: TUNED, captionShort: 'Condo @ Tabuan Dayak — RM338,000',
  cover: 'https://blob.test/card-OLD.png',
  mediaItems: [
    { url: 'https://blob.test/card-OLD.png', type: 'image' },   // the old card
    { url: 'https://cdn.test/bedroom.jpg', type: 'image' },
    { url: 'https://cdn.test/living.jpg', type: 'image' },
  ],
  mediaCount: 3, price: 338000, location: 'Tabuan Dayak', listingType: 'sale',
  source: { text: 'Tropics City Tabuan Dayak RM338,000. 1 bed 1 bath, 800 sqft.', price: 338000, bedrooms: 1, bathrooms: 1, sqft: 800 },
}
const written = () => pending.putPending.mock.calls.at(-1)[0]

beforeEach(() => {
  process.env.INGEST_SECRET = 's3cret'
  process.env.BLOB_READ_WRITE_TOKEN = 'tok'
  vi.clearAllMocks()
  pending.getPending.mockResolvedValue(HELD)
  pending.putPending.mockResolvedValue('p1')
  providers.providerStatus.mockReturnValue({ configured: true, provider: 'groq' })
  providers.runModel.mockRejectedValue(new Error('the writer must never run for a cover change'))
})

describe('mode: recover puts the chosen photo in front', () => {
  it('the new photo becomes the cover', async () => {
    const res = await post({ mode: 'recover', pendingId: 'p1', images: ['https://cdn.test/stairs.jpg'] })
    expect(res.statusCode).toBe(200)
    expect(written().cover).toBe('https://blob.test/card-NEW.png')
    expect(written().mediaItems[0].url).toBe('https://blob.test/card-NEW.png')
    // The card IS that photo with the price panel drawn on it, so the raw copy
    // is not also in the album — see the duplication block below.
    expect(written().cardFrom).toBe('https://cdn.test/stairs.jpg')
    expect(written().mediaItems.map((m) => m.url)).not.toContain('https://cdn.test/stairs.jpg')
  })

  it('the photo the OLD card was made from comes back into the album', async () => {
    // It was folded into the old card, so its raw URL is on no other item.
    // Without this, every cover change would quietly delete a photo.
    pending.getPending.mockResolvedValue({ ...HELD, cardFrom: 'https://cdn.test/bedroom-original.jpg' })
    await post({ mode: 'recover', pendingId: 'p1', images: ['https://cdn.test/stairs.jpg'] })
    expect(written().mediaItems.map((m) => m.url)).toContain('https://cdn.test/bedroom-original.jpg')
  })

  it('THE CAPTION IS UNTOUCHED — four rounds of tuning survive', async () => {
    // The whole point. An agent who has just spent four messages getting their
    // wording right must not lose it to a cover change.
    await post({ mode: 'recover', pendingId: 'p1', images: ['https://cdn.test/stairs.jpg'] })
    expect(written().caption).toBe(TUNED)
    expect(written().captionShort).toBe(HELD.captionShort)
    expect(providers.runModel).not.toHaveBeenCalled()
  })

  it('the stale price card is dropped, not carried along as a photo', async () => {
    const urls = (await post({ mode: 'recover', pendingId: 'p1', images: ['https://cdn.test/stairs.jpg'] }), written().mediaItems.map((m) => m.url))
    expect(urls).not.toContain('https://blob.test/card-OLD.png')
  })

  it('the other photos are kept, in their original order', async () => {
    await post({ mode: 'recover', pendingId: 'p1', images: ['https://cdn.test/stairs.jpg'] })
    const urls = written().mediaItems.map((m) => m.url)
    expect(urls).toContain('https://cdn.test/bedroom.jpg')
    expect(urls).toContain('https://cdn.test/living.jpg')
    expect(urls.indexOf('https://cdn.test/bedroom.jpg')).toBeLessThan(urls.indexOf('https://cdn.test/living.jpg'))
  })

  it('choosing a photo ALREADY in the post moves it into the card, once', async () => {
    await post({ mode: 'recover', pendingId: 'p1', images: ['https://cdn.test/living.jpg'] })
    const urls = written().mediaItems.map((m) => m.url)
    expect(written().cardFrom).toBe('https://cdn.test/living.jpg')
    expect(urls.filter((u) => u === 'https://cdn.test/living.jpg')).toHaveLength(0)
    expect(new Set(urls).size).toBe(urls.length)   // and nothing else doubled up
  })

  it('the caption can never be supplied by the caller', async () => {
    // An endpoint that accepted a caption would be a way to hand-write one,
    // which is what the whole guard chain exists to stop.
    await post({ mode: 'recover', pendingId: 'p1', images: ['https://cdn.test/stairs.jpg'], caption: 'INJECTED — call 011-000 0000' })
    expect(written().caption).toBe(TUNED)
  })

  it('a pending that is gone says so instead of half-doing anything', async () => {
    pending.getPending.mockResolvedValue(null)
    const res = await post({ mode: 'recover', pendingId: 'gone', images: ['https://cdn.test/stairs.jpg'] })
    expect(res.statusCode).toBe(404)
    expect(pending.putPending).not.toHaveBeenCalled()
  })

  it('no photo, no change', async () => {
    const res = await post({ mode: 'recover', pendingId: 'p1', images: [] })
    expect(res.statusCode).toBe(400)
    expect(pending.putPending).not.toHaveBeenCalled()
  })

  it('it writes back under the SAME id, so the ✅ the human was given still works', async () => {
    await post({ mode: 'recover', pendingId: 'p1', images: ['https://cdn.test/stairs.jpg'] })
    expect(pending.putPending.mock.calls.at(-1)[1]).toBe('p1')
  })
})
