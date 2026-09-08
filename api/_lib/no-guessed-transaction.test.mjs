// A LISTING THAT NEVER SAID WHETHER IT IS A SALE OR A RENTAL MUST NOT BE
// PUBLISHED AS EITHER.
//
// demoParse() was deliberately changed to return listingType: null rather than
// `rental ? 'rental' : 'sale'`, because that ternary typed a listing mentioning
// neither as a SALE, which then picked the FOR SALE pill. Four places downstream
// put the guess straight back, and three of them are the worst kind of place:
//
//   src/lib/graphics.js       FOR SALE burned into the exported JPEG and into
//                             the carousel's first slide
//   PropertyVideo.jsx         FOR SALE burned into the encoded MP4
//   api/_lib/prompts.js       "this property is FOR SALE. It is NOT for rent."
//                             stated to the model in the FACTS block
//   api/hold.js               stored as 'sale' on the pending record, so the
//                             agent's own feed shows a monthly rent as a price
//
// Measured 2026-09-06 on the shipped functions before the fix:
//   drawCard(listingType: null)   -> ["FOR SALE","WP","Wilson Property", ...]
//   introScene(listingType: null) -> ["FOR SALE","RM1,800","Apartment · Miri"]
//
// These tests drive the REAL renderers against a recording canvas context and
// read back the strings that would be drawn on a client's advert.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drawCard } from '../../src/lib/graphics.js'
import { introScene } from '../../src/components/PropertyVideo.jsx'
import { buildContentPrompt, buildReelPrompt } from './prompts.js'
import { transactionTag } from '../../shared/txn.js'

// Records every string the renderer would paint. Nothing else about the canvas
// matters here — the question is only what words end up on the image.
function recordingCtx() {
  const text = []
  const noop = () => {}
  return {
    text,
    save: noop, restore: noop, translate: noop, scale: noop, rotate: noop, clip: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, arcTo: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, rect: noop, fill: noop, stroke: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop, drawImage: noop, setTransform: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    measureText: (s) => ({ width: String(s).length * 14 }),
    fillText: (s) => { text.push(String(s)) },
    strokeText: (s) => { text.push(String(s)) },
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: 'left',
    textBaseline: 'alphabetic', globalAlpha: 1, shadowColor: '', shadowBlur: 0,
    letterSpacing: '', filter: 'none',
  }
}

const pending = { putPending: vi.fn(), getPending: vi.fn(), delPending: vi.fn() }
vi.mock('./pending.js', () => pending)

const LISTING = { id: 'l_9931', propertyType: 'Apartment', location: 'Miri', bedrooms: 3, price: 1800 }
const BRAND = { agency: 'Wilson Property', color: '#2d6a4f' }
// Every shape a parser that could not find a transaction word actually returns.
const UNSTATED = [null, undefined, '']

describe('the exported card never stamps a transaction the listing did not state', () => {
  it.each(UNSTATED)('listingType %p draws no FOR SALE pill', (lt) => {
    const ctx = recordingCtx()
    drawCard(ctx, 1080, 1080, { ...LISTING, listingType: lt }, BRAND, null, null)
    expect(ctx.text).not.toContain('FOR SALE')
    expect(ctx.text).not.toContain('FOR RENT')
  })

  it('a stated rental still says FOR RENT', () => {
    const ctx = recordingCtx()
    drawCard(ctx, 1080, 1080, { ...LISTING, listingType: 'rental' }, BRAND, null, null)
    expect(ctx.text).toContain('FOR RENT')
  })

  it('a stated sale still says FOR SALE', () => {
    const ctx = recordingCtx()
    drawCard(ctx, 1080, 1080, { ...LISTING, listingType: 'sale' }, BRAND, null, null)
    expect(ctx.text).toContain('FOR SALE')
  })

  // The parsers emit the agent's own word, not always an English one.
  it.each([['sewa', 'FOR RENT'], ['出租', 'FOR RENT'], ['dijual', 'FOR SALE'], ['出售', 'FOR SALE']])(
    'listingType %s is understood as %s', (lt, want) => {
      const ctx = recordingCtx()
      drawCard(ctx, 1080, 1080, { ...LISTING, listingType: lt }, BRAND, null, null)
      expect(ctx.text).toContain(want)
    })
})

describe('the reel never opens on a transaction the listing did not state', () => {
  const rise = () => ({ y: 0, a: 1, s: 1 })

  it.each(UNSTATED)('listingType %p draws no pill in the intro frame', (lt) => {
    const ctx = recordingCtx()
    introScene(ctx, { kind: 'intro' }, { listing: { ...LISTING, listingType: lt } }, '#fff', rise)
    expect(ctx.text).not.toContain('FOR SALE')
    expect(ctx.text).not.toContain('FOR RENT')
    // The price and the property line are still there — the frame is not blank.
    expect(ctx.text).toContain('RM1,800')
  })

  it('a stated rental still opens FOR RENT, with /mo on the price', () => {
    const ctx = recordingCtx()
    introScene(ctx, { kind: 'intro' }, { listing: { ...LISTING, listingType: 'rental' } }, '#fff', rise)
    expect(ctx.text).toContain('FOR RENT')
    expect(ctx.text).toContain('RM1,800/mo')
  })
})

describe('the model is never told a property is for sale when the listing did not say', () => {
  it('the FACTS block states the absence instead of resolving it', () => {
    const p = buildContentPrompt({ ...LISTING, listingType: null, rawText: '美里 3房公寓 每月RM1800' },
      ['facebook_page'], ['en'], null, {}, [])
    expect(p).not.toContain('this property is FOR SALE')
    expect(p).toContain('Listing type: NOT STATED')
  })

  it('the reel prompt asks for no sale/rent wording and no #..._Sale hashtag', () => {
    const p = buildReelPrompt({ ...LISTING, listingType: null }, null, [])
    expect(p).not.toContain('Type: For sale')
    expect(p).toContain('the listing never says')
  })

  it('a stated sale is still told to say SALE', () => {
    const p = buildContentPrompt({ ...LISTING, listingType: 'sale' }, ['facebook_page'], ['en'], null, {}, [])
    expect(p).toContain('this property is FOR SALE')
  })

  it('a stated rental is still told to say RENT', () => {
    const p = buildContentPrompt({ ...LISTING, listingType: 'rental' }, ['facebook_page'], ['en'], null, {}, [])
    expect(p).toContain('this property is FOR RENT')
  })
})

// /api/hold is the reel path's own store: ingest.js builds holdBody with
// `listingType: listing.listingType`, which is null whenever the fallback parser
// found no transaction word. Stored as 'sale', it reached the agent's feed.
describe('a held pending records the transaction as unknown, not as a sale', () => {
  beforeEach(() => {
    process.env.INGEST_SECRET = 's3cret'
    vi.clearAllMocks()
    pending.putPending.mockResolvedValue('held-1')
  })

  const hold = async (body) => {
    const { default: handler } = await import('../hold.js')
    const res = { statusCode: 0, body: null, setHeader() {}, end(b) { this.body = typeof b === 'string' ? JSON.parse(b) : b; return this } }
    await handler({ method: 'POST', url: '/api/hold', headers: { 'x-ingest-secret': 's3cret' },
      body: { caption: 'A caption long enough to clear the floor this endpoint applies to held posts.', mediaItems: [{ url: 'https://cdn.test/1.jpg', type: 'image' }], profileId: 'p1', ...body } }, res)
    return res
  }

  it('a Chinese rental the parser could not type is not stored as a sale', async () => {
    await hold({ listingType: null, location: 'Miri', price: 1800 })
    expect(pending.putPending).toHaveBeenCalled()
    const stored = pending.putPending.mock.calls[0][0]
    expect(stored.listingType).toBeNull()
  })

  it('a stated rental is still stored as a rental', async () => {
    await hold({ listingType: 'rental', price: 1800 })
    expect(pending.putPending.mock.calls[0][0].listingType).toBe('rental')
  })
})

describe('transactionTag is the one place that decides', () => {
  it('never invents', () => {
    for (const lt of [null, undefined, '', '   ', 'unknown', 'n/a']) {
      expect(transactionTag({ listingType: lt })).toBe('')
    }
  })
})
