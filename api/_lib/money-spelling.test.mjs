// THE SAME PRICE, SPELLED TWO WAYS, IS NOT A MISSING PRICE.
//
// captionViolations' MISSING walk canonicalised the SOURCE side only: a listing
// saying RM338,000 looked for the literal "338,000" or "338000" in the caption.
// A caption writing that price the way Malaysian agents actually write it —
// "RM338k" — matched neither. It landed in `missing`, and a `missing` entry
// beginning with RM is what blocks at ingest.js and marks the caption degraded.
//
// So the product refused a caption that was perfectly correct, told nobody, and
// sent the repair loop chasing a figure that was already on the page. That is
// silent-refusal number five, and it is the one costing a real agent a real post
// today rather than in theory.
import { describe, it, expect } from 'vitest'
import { captionViolations, knownAmounts } from './postguard.js'

const money = (v) => v.missing.filter((m) => /^RM/i.test(m))

describe('a price the caption spells differently is still the price', () => {
  const SALE = {
    rawText: 'Tropics City Kuching for sale. RM338,000 — RM100k below bank value. 2 bed 2 bath, 850 sqft. Call Jason 0128887766',
    price: 338000, sqft: 850, bedrooms: 2, bathrooms: 2, location: 'Kuching', listingType: 'sale',
  }
  const RENT = {
    rawText: 'Vivacity condo for rent RM2,500/month. 2 rooms, 787 sqft, fully furnished. WhatsApp Lydia 0143998011',
    price: 2500, sqft: 787, bedrooms: 2, location: 'Kuching', listingType: 'rental',
  }
  const BIG = {
    rawText: 'Semi-D at Green Heights for sale RM1,250,000. 5 bed 4 bath, 2,800 sqft. Call 012-345 6789',
    price: 1250000, sqft: 2800, bedrooms: 5, bathrooms: 4, listingType: 'sale',
  }

  const PAIRS = [
    ['k for a thousands-separated price', SALE,
      'Tropics City, Kuching — RM338k. RM100k below bank value. 2 bed 2 bath, 850 sqft. Call Jason 0128887766'],
    ['K uppercase', SALE,
      'Tropics City, Kuching — RM338K. RM100k below bank value. 2 bed 2 bath, 850 sqft. Call Jason 0128887766'],
    ['a space before the k', SALE,
      'Tropics City, Kuching — RM338 k. RM100k below bank value. 2 bed 2 bath, 850 sqft. Call Jason 0128887766'],
    ['the unabbreviated form, as before', SALE,
      'Tropics City, Kuching — RM338,000. RM100k below bank value. 2 bed 2 bath, 850 sqft. Call Jason 0128887766'],
    ['no separator at all', SALE,
      'Tropics City, Kuching — RM338000. RM100k below bank value. 2 bed 2 bath, 850 sqft. Call Jason 0128887766'],
    ['2.5k for a monthly rent', RENT,
      'Vivacity condo — RM2.5k a month. 2 rooms, 787 sqft, fully furnished. WhatsApp Lydia 0143998011'],
    ['juta for a million', BIG,
      'Green Heights semi-D — RM1.25 juta. 5 bed 4 bath, 2,800 sqft. Call 012-345 6789'],
    ['mil for a million', BIG,
      'Green Heights semi-D — RM1.25 mil. 5 bed 4 bath, 2,800 sqft. Call 012-345 6789'],
    ['million spelled out', BIG,
      'Green Heights semi-D — RM1.25 million. 5 bed 4 bath, 2,800 sqft. Call 012-345 6789'],
    ['万 in a Chinese caption', BIG,
      '绿岭半独立式洋房出售 RM125万。5 房 4 厕，2,800 平方尺。联络 012-345 6789'],
    ['a Malay caption abbreviating the rent', RENT,
      'Kondo Vivacity untuk disewa — RM2.5k sebulan. 2 bilik, 787 kaki persegi, lengkap berperabot. WhatsApp Lydia 0143998011'],
    ['both figures abbreviated at once', SALE,
      'Tropics City, Kuching — RM338k, RM100k below bank value. 2 bed 2 bath, 850 sqft. Call Jason 0128887766'],
  ]

  it.each(PAIRS)('%s', (_name, listing, caption) => {
    expect(money(captionViolations(caption, listing))).toEqual([])
  })

  it('and knownAmounts already parsed every one of those suffixes — this walk just never used it', () => {
    // Pins WHY the fix is a two-line accept rather than a new parser: the
    // canonicalisation has been sitting in this file the whole time.
    expect(knownAmounts(SALE)).toContain(338000)
    expect(knownAmounts(BIG)).toContain(1250000)
  })
})

describe('a price the caption really did drop is still reported', () => {
  const SALE = {
    rawText: 'Tropics City Kuching for sale. RM338,000 — RM100k below bank value. 2 bed 2 bath, 850 sqft. Call Jason 0128887766',
    price: 338000, sqft: 850, listingType: 'sale',
  }

  it('no price at all', () => {
    const v = captionViolations('Tropics City, Kuching. 2 bed 2 bath, 850 sqft. Below bank value. Call Jason 0128887766', SALE)
    expect(money(v)).toContain('RM338,000')
  })

  it('the asking price kept, the saving dropped', () => {
    const v = captionViolations('Tropics City, Kuching — RM338k. 2 bed 2 bath, 850 sqft. Call Jason 0128887766', SALE)
    expect(money(v)).toContain('RM100K')
  })

  it('a DIFFERENT number is not the same price', () => {
    // The accept path must key on the value, not on the presence of any figure.
    const v = captionViolations('Tropics City, Kuching — RM339k. RM100k below bank value. 2 bed 2 bath, 850 sqft. Call Jason 0128887766', SALE)
    expect(money(v)).toContain('RM338,000')
  })

  it('a bedroom count is not a price', () => {
    // BARE_AMOUNT skips one- and two-digit bare numbers for exactly this reason;
    // if it did not, "2 bed" could satisfy an RM2 in the source.
    const v = captionViolations('Tropics City, Kuching. 2 bed 2 bath, 850 sqft. Call Jason 0128887766', SALE)
    expect(money(v).length).toBeGreaterThan(0)
  })
})
