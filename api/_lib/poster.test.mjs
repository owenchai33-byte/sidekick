// THE POSTER GUESSES NOTHING.
//
// It replaced a one-photo cover that a paying client described, accurately, as
// "slapping text on the photo and calling it a cover photo". It composes the
// agent's real photos with real type — and every element it draws is baked into
// a JPEG on someone else's page, where a wrong fact cannot be edited or
// repaired. So each piece either comes from the agent's own message or is left
// off. These tests hold the "left off" half, which is the half that regresses
// silently: a guessed value looks exactly like a correct one.
import { describe, it, expect } from 'vitest'
import { renderBrandCard, priceUnit, chips, phoneFrom } from './brandcard.js'

// 1x1 PNG, so a render needs no network.
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('specs: shown when given, absent when not', () => {
  it('shows beds, baths and built-up', () => {
    expect(chips({ bedrooms: 2, bathrooms: 2, sqft: 787 }).map(([, k]) => k)).toEqual(['BEDS', 'BATHS', 'SQ FT'])
  })
  it('omits a field the listing never gave — no zero, no dash', () => {
    expect(chips({ bedrooms: 3 })).toEqual([['3', 'BEDS']])
    expect(chips({})).toEqual([])
  })
  it('a land figure is labelled LAND, never passed off as built-up', () => {
    // Buyers price per square foot off the built-up. A land figure under the
    // built-up label is more than double the truth on a terrace.
    expect(chips({ landSqft: 4800 })).toEqual([['4,800', 'SQ FT LAND']])
  })
  it('built-up wins when both exist; they are never merged', () => {
    const c = chips({ sqft: 2200, landSqft: 4800 })
    expect(c).toEqual([['2,200', 'SQ FT']])
  })
  it('singular for one', () => {
    expect(chips({ bedrooms: 1, bathrooms: 1 }).map(([, k]) => k)).toEqual(['BED', 'BATH'])
  })
})

describe('"per month" only for a stated rental', () => {
  it('rental says PER MONTH', () => expect(priceUnit({ listingType: 'rental' })).toBe('PER MONTH'))
  it('a sale says nothing', () => expect(priceUnit({ listingType: 'sale' })).toBe(''))
  it('an unstated transaction says nothing', () => {
    // "/month" is a claim about the transaction. The fallback templates and the
    // old price card both had to have exactly this taken out of them.
    expect(priceUnit({ listingType: null })).toBe('')
    expect(priceUnit({})).toBe('')
  })
})

describe("the agent's number, from the agent's own message", () => {
  it('formats a ten-digit mobile the way a Malaysian reads it', () => {
    expect(phoneFrom({ rawText: 'Lydia 0143998011' })).toBe('014-399 8011')
  })
  it('formats an eleven-digit mobile', () => {
    expect(phoneFrom({ rawText: 'Call 01112345678 now' })).toBe('011-1234 5678')
  })
  it('accepts the agent already having spaced it', () => {
    expect(phoneFrom({ rawText: 'WhatsApp 016-921 9859' })).toBe('016-921 9859')
  })
  it('prints nothing when there is no number — never a placeholder', () => {
    // wa.me/YourNumber reached a client this week. A poster is worse: it cannot
    // be edited once it is posted.
    expect(phoneFrom({ rawText: 'Terrace for sale RM520,000 Kuching' })).toBe('')
    expect(phoneFrom({})).toBe('')
  })
  it('does not mistake a price or a size for a phone number', () => {
    expect(phoneFrom({ rawText: 'RM1,500,000 land 10,890 sqft' })).toBe('')
  })
})

describe('it renders', () => {
  const listing = { listingType: 'rental', price: 2500, location: 'The Northbank', bedrooms: 2, bathrooms: 2, sqft: 787,
    rawText: 'Brand New RENNA RESIDENCE for Rent\n📍The Northbank, Kuching\nRM2.5k\nLydia 0143998011' }

  it('from a single photo — the hero takes the strip\'s space', async () => {
    const png = await renderBrandCard(PX, listing, { color: '#0b6b4f', name: 'Test' })
    expect(Buffer.isBuffer(png)).toBe(true)
    expect(png.subarray(1, 4).toString()).toBe('PNG')
  }, 30000)

  it('from four photos — hero plus a strip of three', async () => {
    const png = await renderBrandCard([PX, PX, PX, PX], listing, {})
    expect(png.subarray(1, 4).toString()).toBe('PNG')
  }, 30000)

  it('with almost nothing known, and still guesses nothing', async () => {
    const png = await renderBrandCard([PX], { rawText: 'unit available' }, {})
    expect(png.subarray(1, 4).toString()).toBe('PNG')
  }, 30000)

  it('refuses to render with no photo at all rather than invent one', async () => {
    await expect(renderBrandCard([], listing, {})).rejects.toThrow(/no photo/)
  })
})
