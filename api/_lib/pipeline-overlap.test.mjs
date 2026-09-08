// DEAD AIR ON THE ONLY PATH THAT CARRIES EVERY LISTING.
//
// Measured against the live function on 2026-09-08 with Owen's RENNA listing:
// /api/ingest took ~8s warm, and ~3.2s of it was the branded card — rendered and
// uploaded strictly AFTER the caption came back from the model. The card is
// drawn from `listing` and `brand`. It is not passed the caption and never has
// been. Those seconds bought nothing; the agent just watched a silent chat.
//
// The same request also made three blob reads for the agent's brand, style and
// rules one after another, with the parse model call wedged between the first
// and the second — none of which depends on the message or on each other.
//
// The reel branch has overlapped its card with its script since 2026-09-04. This
// file exists so the social path cannot quietly go back to waiting, because a
// regression here is invisible: every test still passes, every value is still
// correct, the agent just waits longer. Nothing but a clock would notice.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const pending = { putPending: vi.fn(), getPending: vi.fn(), delPending: vi.fn(), claimPending: vi.fn(), releasePending: vi.fn() }
const social = { postToConnected: vi.fn(), connectedAccounts: vi.fn(), defaultProfile: vi.fn() }
const providers = { providerStatus: vi.fn(), runModel: vi.fn(), extractJson: vi.fn() }
const style = { getStyle: vi.fn(), getRules: vi.fn() }
const brand = { getBrand: vi.fn() }
const card = { renderBrandCard: vi.fn() }

vi.mock('./pending.js', () => pending)
vi.mock('./social.js', () => social)
vi.mock('./feed.js', () => ({ appendFeed: vi.fn() }))
vi.mock('./providers.js', () => providers)
vi.mock('./style.js', () => style)
vi.mock('./brand.js', () => brand)
vi.mock('./brandcard.js', () => card)
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

// A promise we hold open, plus a signal that fires the moment something is called.
const gate = () => { let open; const p = new Promise((r) => { open = r }); return { p, open } }
const signal = () => { let fire; const p = new Promise((r) => { fire = r }); return { p, fire } }
// Resolves true if `p` settles first, false if the event loop drains without it.
// Uses a macrotask so every already-queued microtask has run before we judge.
const settledFirst = (p) => Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), 0))])

const LISTING = 'Tropics City Tabuan Dayak RM338,000. 1 bed 1 bath, 800 sqft. Call 012-345 6789'
const CAPTION = 'Tropics City, Tabuan Dayak — RM338,000. 1 bed 1 bath, 800 sqft. Call 012-345 6789'
const PHOTOS = ['https://cdn.test/bedroom.jpg', 'https://cdn.test/living.jpg']

const start = (body = {}) => {
  const res = mkRes()
  const done = ingest({
    method: 'POST', url: '/api/ingest', headers: { 'x-ingest-secret': 's3cret' },
    body: { profileId: 'p1', text: LISTING, images: PHOTOS, ...body },
  }, res)
  return { res, done }
}

beforeEach(() => {
  process.env.INGEST_SECRET = 's3cret'
  process.env.BLOB_READ_WRITE_TOKEN = 'tok'
  vi.clearAllMocks()
  pending.putPending.mockResolvedValue('held-1')
  social.defaultProfile.mockReturnValue('')
  social.connectedAccounts.mockResolvedValue(0)
  providers.providerStatus.mockReturnValue({ configured: true, provider: 'groq' })
  style.getStyle.mockResolvedValue({})
  style.getRules.mockResolvedValue({ rules: [] })
  brand.getBrand.mockResolvedValue({})
  card.renderBrandCard.mockResolvedValue(Buffer.from('png'))
  providers.runModel.mockResolvedValue('{}')
  providers.extractJson
    .mockImplementationOnce(() => { throw new Error('use demoParse') })
    .mockReturnValue({ caption: CAPTION })
})

describe('the card is drawn while the caption is being written', () => {
  it('renderBrandCard is called before the caption model call comes back', async () => {
    const caption = gate()
    const drawing = signal()
    card.renderBrandCard.mockImplementation(async () => { drawing.fire(); return Buffer.from('png') })
    // call 1 is the parse, call 2 is the caption — hold the caption open.
    providers.runModel
      .mockResolvedValueOnce('{}')
      .mockImplementationOnce(async () => { await caption.p; return '{}' })

    const { done } = start()
    // The card must already be rendering while the caption model call is still
    // outstanding. Sequential code cannot satisfy this.
    expect(await settledFirst(drawing.p)).toBe(true)

    caption.open()
    await done
  })

  it('the album is still correct when the two run together', async () => {
    // Overlapping must not change a single byte of the result: the card still
    // replaces the photo it was made from, and nothing is published twice.
    const { res, done } = start()
    await done
    const urls = pending.putPending.mock.calls.at(-1)[0].mediaItems.map((m) => m.url)
    expect(urls).toEqual(['https://blob.test/card.png', 'https://cdn.test/living.jpg'])
    expect(new Set(urls).size).toBe(urls.length)
    expect(res.body.ok).toBe(true)
  })

  it('a dry run draws no card at all', async () => {
    // `dry` is the health check. Starting the card eagerly there would burn a
    // blob write on a result the caller never reads, on every check.
    const { res, done } = start({ dry: true })
    await done
    expect(res.body.mode).toBe('dry')
    expect(card.renderBrandCard).not.toHaveBeenCalled()
  })

  it('a listing with no photo draws no card', async () => {
    const { done } = start({ images: [] })
    await done
    expect(card.renderBrandCard).not.toHaveBeenCalled()
  })

  it('card:false is still honoured', async () => {
    const { done } = start({ card: false })
    await done
    expect(card.renderBrandCard).not.toHaveBeenCalled()
    const urls = pending.putPending.mock.calls.at(-1)[0].mediaItems.map((m) => m.url)
    expect(urls).toEqual(PHOTOS)
  })
})

describe("the agent's saved settings are read under the parse, not after it", () => {
  it('brand, style and rules are all in flight before the parse returns', async () => {
    const parse = gate()
    providers.runModel.mockImplementationOnce(async () => { await parse.p; return '{}' })

    const { done } = start()
    await new Promise((r) => setTimeout(r, 0))
    // All three used to be strung out around the parse: getBrand, then the model
    // call, then getStyle, then getRules.
    expect(brand.getBrand).toHaveBeenCalledTimes(1)
    expect(style.getStyle).toHaveBeenCalledTimes(1)
    expect(style.getRules).toHaveBeenCalledTimes(1)

    parse.open()
    await done
  })

  it('the reel path shares those same reads instead of repeating them', async () => {
    const { done } = start({ mode: 'reel' })
    await done
    expect(style.getStyle).toHaveBeenCalledTimes(1)
    expect(style.getRules).toHaveBeenCalledTimes(1)
    expect(brand.getBrand).toHaveBeenCalledTimes(1)
  })

  it('a reel with no photos returns cleanly, with its settings reads still awaited', async () => {
    // This return happens BEFORE the reel branch awaits style and rules. Without
    // the .catch() marker on each promise, a degraded blob read here becomes an
    // unhandled rejection that takes the whole function down.
    style.getStyle.mockRejectedValue(new Error('blob store down'))
    style.getRules.mockRejectedValue(new Error('blob store down'))
    const { res, done } = start({ mode: 'reel', images: [] })
    await expect(done).resolves.not.toThrow()
    expect(res.body.ok).toBe(false)
    expect(res.body.reason).toMatch(/needs photos/i)
  })
})
