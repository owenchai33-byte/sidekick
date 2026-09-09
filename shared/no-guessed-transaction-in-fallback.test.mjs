// THE FALLBACK ADVERTISED AN UNSTATED LISTING AS FOR SALE.
//
// Every template in demo.js read `listingType === 'rental' ? rent : sale`, so a
// listing whose type the parser could not determine was published as FOR SALE in
// 12 of 18 outputs — "Property For Sale", "untuk Dijual", "出售" — about a unit
// whose owner may be letting it.
//
// api/ingest.js already refuses to guess this. Its comment says a wrong type
// "turns a correct caption into a contradiction", and it sets
// `listingType: fields.listingType || null` for exactly that reason — then
// handed the null to a renderer that guessed anyway.
//
// It matters most HERE of all places: this file is the FALLBACK, so it runs
// precisely when the parse was too weak to read the type in the first place.
// The demoParse comment above it records the last time this bit — Chinese
// rentals typed as sales because it could not read 出租.
import { describe, it, expect } from 'vitest'
import { demoContent } from './demo.js'

const PLATFORMS = ['facebook_page', 'tiktok', 'instagram', 'marketplace', 'mudah', 'portals']
const LANGS = ['en', 'zh', 'ms']
const SALE = /for sale|untuk dijual|\bdijual\b|出售|forsale|买房/i
const RENT = /for rent|\bdisewa\b|出租|forrent|租房/i

const LISTINGS = [
  ['a full listing', { price: 450000, location: 'Kuching', bedrooms: 3, bathrooms: 2, sqft: 1200, propertyType: 'Terrace' }],
  ['a rent-shaped price', { price: 2500, location: 'Kuching', bedrooms: 2, bathrooms: 2, sqft: 787, propertyType: 'Condo' }],
  ['nothing at all', { price: null, location: null, bedrooms: null, bathrooms: null, sqft: null, propertyType: null }],
]

describe('an unstated transaction is not advertised as either', () => {
  for (const [label, base] of LISTINGS) {
    for (const plat of PLATFORMS) {
      for (const lang of LANGS) {
        it(`${plat}/${lang} claims neither — ${label}`, () => {
          const c = (demoContent({ ...base, listingType: null }, [plat], [lang])[plat] || {})[lang]
          if (!c) return
          expect(c, `${plat}/${lang} says SALE`).not.toMatch(SALE)
          expect(c, `${plat}/${lang} says RENT`).not.toMatch(RENT)
        })
      }
    }
  }

  it('does not hedge into claiming both', () => {
    // "For sale or rent" would be a second invented claim, not a smaller one.
    const c = demoContent({ ...LISTINGS[0][1], listingType: null }, ['portals'], ['en']).portals.en
    expect(c).not.toMatch(/sale or rent|rent or sale/i)
  })

  it('does not claim a MONTHLY price either', () => {
    // "/month" is itself a statement about the transaction.
    const c = demoContent({ ...LISTINGS[0][1], listingType: null }, ['portals'], ['en']).portals.en
    expect(c).toMatch(/RM450,000/)
    expect(c).not.toMatch(/\/month/)
  })
})

describe('a STATED transaction is still stated', () => {
  // The other half. Removing a guess must not remove a fact.
  for (const [lt, re, other] of [['rental', RENT, SALE], ['sale', SALE, RENT]]) {
    for (const plat of ['marketplace', 'mudah', 'portals', 'instagram']) {
      for (const lang of LANGS) {
        it(`${plat}/${lang} still says ${lt}`, () => {
          const c = (demoContent({ ...LISTINGS[0][1], listingType: lt }, [plat], [lang])[plat] || {})[lang]
          if (!c) return
          expect(c, `${plat}/${lang} lost ${lt}`).toMatch(re)
          expect(c, `${plat}/${lang} claims the opposite`).not.toMatch(other)
        })
      }
    }
  }

  it('a stated rental still prices per month', () => {
    expect(demoContent({ ...LISTINGS[1][1], listingType: 'rental' }, ['portals'], ['en']).portals.en).toMatch(/RM2,500\/month/)
  })

  it('a stated sale does not', () => {
    expect(demoContent({ ...LISTINGS[0][1], listingType: 'sale' }, ['portals'], ['en']).portals.en).not.toMatch(/\/month/)
  })
})
