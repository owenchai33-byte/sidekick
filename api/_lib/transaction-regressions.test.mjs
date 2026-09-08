// THE FIVE THINGS THE REVIEWER FOUND, EACH PINNED.
//
// The sale-versus-rent rule caught the exact published caption and then did two
// worse things: it refused CORRECT rental captions on a path the codebase
// creates by default, and one word in the headline switched every blocking rule
// off. Both are measured below against the real shapes.
import { describe, it, expect } from 'vitest'
import { captionViolations } from './postguard.js'
import { demoParse } from '../../shared/demo.js'
import { readFileSync } from 'node:fs'

const RENNA_SRC = 'Brand New RENNA RESIDENCE for Rent. The Northbank, Kuching. RM2.5k nego. 2 Bedrooms 2 Bathrooms.'
const rental = (over = {}) => ({ rawText: RENNA_SRC, price: 2500, listingType: 'rental', ...over })
const blocks = (cap, l) => captionViolations(cap, l).invented

// ---------------------------------------------------------------------------
// F1 — SILENT REFUSAL NUMBER SIX.
//
// listingType comes from the parser; ingest defaulted it to 'sale' when the
// parser said nothing, and demoParse — the fallback used every time the free
// tier rate-limits — could not read 出租 at all. The price rule was the only one
// missing the `!grounded` source gate, so a correct Chinese rental caption was
// refused with three findings, and the agent was told the caption ENGINE had
// failed. That message is false and the retry fails identically forever.

describe('a CORRECT caption is never refused because the type was mis-parsed', () => {
  it.each([
    ['English, price in a later sentence',
      'RENNA RESIDENCE — FOR RENT\n\n💰 Monthly Rent\n\nRM2,500/month\n\n2 Bed | 2 Bath',
      { rawText: RENNA_SRC, price: 2500, listingType: 'sale' }],
    ['Chinese, price on its own line',
      '古晋公寓出租\n\n月租 RM1,800\n\n2房2厕\n\n#PCMY_Rent',
      { rawText: '古晋 BDC 公寓出租\nRM1,800\n2 房 2 厕', price: 1800, listingType: 'sale' }],
    ['Malay, price in a later sentence',
      'Apartment untuk disewa\n\nHarga sewa\n\nRM1,200 sahaja',
      { rawText: 'Apartment di Kuching untuk disewa. RM1,200 sahaja.', price: 1200, listingType: 'sale' }],
    ['a room ad, price on its own line',
      'Room for rent at Vivacity\n\nMonthly Rent\n\nRM550\n\nDM 012-345 6789',
      { rawText: 'Master room for rent at Vivacity.\nRM550\nDM 012-345 6789', price: 550, listingType: 'sale' }],
  ])('%s', (_n, caption, listing) => {
    expect(blocks(caption, listing)).toEqual([])
  })

  it('the fallback parser can read a Chinese rental at all', () => {
    // The root cause. Without 出租 every Chinese rental was typed as a sale.
    expect(demoParse('古晋 BDC 公寓出租 RM1,800 2房2厕').listingType).toBe('rental')
    expect(demoParse('招租：三楼店面 月租 RM3,500').listingType).toBe('rental')
    expect(demoParse('Apartment untuk disewa RM1,200').listingType).toBe('rental')
    expect(demoParse('古晋 BDC 排屋出售 售价 RM43万').listingType).not.toBe('rental')
  })

  it('ingest does not GUESS a type when the parser gave none', () => {
    // A guessed transaction type is worse than none: the rule is silent on an
    // unknown type, but a WRONG one turns a correct caption into a
    // contradiction. Pinned on the source because the alternative is standing up
    // the whole ingest harness for a single defaulting expression.
    const src = readFileSync(new URL('../ingest.js', import.meta.url), 'utf8')
    expect(src).toMatch(/listingType: fields\.listingType \|\| null/)
    expect(src).not.toMatch(/listingType: fields\.listingType \|\| 'sale'/)
  })

  it('a Chinese or Malay rent-per-month price reads as a rental', () => {
    expect(demoParse('公寓 RM1,800/月 2房2厕').listingType).toBe('rental')
    expect(demoParse('每月 RM1,800').listingType).toBe('rental')
    expect(demoParse('Apartment RM1,200 sebulan').listingType).toBe('rental')
  })

  it('an unknown type produces no transaction finding at all', () => {
    // Silent beats guessing: ingest no longer defaults the type to 'sale',
    // because a WRONG type turns a correct caption into a contradiction.
    expect(blocks('💰 Selling Price\n\nRM2,500/month\n\nWhy Buy This Property?', rental({ listingType: null }))).toEqual([])
  })

  it('but the real incident still refuses — the gate only ever widens', () => {
    // RENNA's source says "for Rent" and no sale words at all, so the source
    // gate is open and the rule fires exactly as it must.
    expect(blocks('🏡 RENNA RESIDENCE – FOR RENT\n\n💰 Selling Price\n\nRM2,500/month\n\nWhy Buy This Property?\n\n#PCMY_Sale', rental()).length).toBeGreaterThanOrEqual(3)
  })
})

// ---------------------------------------------------------------------------
// F2 / F3 — ONE TRUE WORD USED TO SWITCH EVERY RULE OFF.

describe('a FOR RENT headline does not excuse the rest of the caption', () => {
  const NEIGHBOUR = 'RENNA RESIDENCE — FOR RENT\n\n💰 Selling Price\n\nRM2,500/month\n\nWhy Buy This Property?\n\n#PCMY_Sale'

  it('the incident with one word changed still refuses, naming all three', () => {
    // This PUBLISHED before the fix: `mixed` was caption-wide, so the headline
    // downgraded every finding to a warning. And the new prompt pushes the model
    // to write exactly this headline — the rule was sharpest against a caption
    // we had made rarer and blind to the one we had made commoner.
    const v = captionViolations(NEIGHBOUR, rental())
    expect(v.invented).toHaveLength(3)
    expect(v.invented.join(' | ')).toMatch(/Selling Price/)
    expect(v.invented.join(' | ')).toMatch(/Why Buy/)
    expect(v.invented.join(' | ')).toMatch(/#PCMY_Sale/)
  })

  it('a partial repair cannot disarm the rest', () => {
    // F3: fixing only the price heading CREATED the true-type phrase, which
    // turned the two remaining findings into warnings and published a rental
    // still asking the reader to buy it. A guard its own repair round disarms is
    // worse than one that blocks once and stays blocked.
    const half = 'RENNA RESIDENCE\n\n💰 Monthly Rent\n\nRM2,500/month\n\nWhy Buy This Property?\n\n#PCMY_Sale'
    expect(blocks(half, rental()).length).toBeGreaterThanOrEqual(2)
  })

  it('a GENUINE dual listing still never refuses', () => {
    // "FOR SALE OR RENT" is a real Malaysian listing type and is in this agent's
    // own stored style examples. It may warn; it may never block.
    const dual = 'SHOPHOUSE — FOR SALE OR RENT\n\n💰 Selling Price\n\nRM960,000\n\nMonthly Rent RM4,500'
    expect(blocks(dual, { rawText: 'Shophouse for sale or rent. RM960,000 or RM4,500/month.', price: 960000, listingType: 'sale' })).toEqual([])
  })

  it('and "Why buy when you can rent?" is still comparison copy, not a CTA', () => {
    expect(blocks('Why buy when you can rent?\n\nRM2,500/month at RENNA', rental())).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// F4 — the pattern demanded "_sale" or "forsale" and missed half the tag space.

describe('the plainest sale hashtags are seen', () => {
  it.each([['#Sale'], ['#SALE'], ['#Sales'], ['#JualRumah'], ['#售'], ['#PropertyDijual']])(
    '%s on a rental is caught', (tag) => {
      expect(blocks(`RENNA RESIDENCE\n\nRM2,500/month\n\n${tag}`, rental()).join(' ')).toMatch(/hashtag/)
    })

  it('#Wholesale is still not a sale tag', () => {
    // The tag body is matched whole, and "wholesale" is one word — there is no
    // boundary before "sale".
    expect(blocks('Shoplot for rent\n\nRM3,500/month\n\n#Wholesale',
      { rawText: 'Shoplot for rent RM3,500/month. Suits wholesale.', price: 3500, listingType: 'rental' })).toEqual([])
  })

  it('and the correct tag never fires', () => {
    expect(blocks('RENNA RESIDENCE\n\nRM2,500/month\n\n#PCMY_Rent #ForRent', rental())).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// AND THE PARSER'S OWN GUESS.
//
// `rental ? 'rental' : 'sale'` meant a listing that mentioned NEITHER was typed
// a sale. That guess travels: it picks the FOR SALE pill burned onto the price
// card, it decides whether the price reads "RM1,800" or "RM1,800/month", and it
// is what the transaction guard measures every caption against.

describe('an unsignalled listing has no transaction type at all', () => {
  it.each([
    ['a bare listing', 'Tropics City Kuching. RM338,000. 800 sqft. Call 012-345 6789'],
    ['specs only', 'Semi-D at Green Heights. 5 bed 4 bath, 2,800 sqft.'],
    ['Chinese, no verb', '古晋 BDC 排屋。RM43万。3 房 2 厕。'],
  ])('%s -> null, not "sale"', (_n, text) => {
    expect(demoParse(text).listingType).toBeNull()
  })

  it.each([
    ['for sale', 'Terrace at Batu Kawa for sale RM620,000', 'sale'],
    ['dijual', 'Rumah teres dijual RM520,000', 'sale'],
    ['出售', '古晋 BDC 排屋出售 售价 RM43万', 'sale'],
    ['for rent', 'Room for rent RM800/month', 'rental'],
    ['disewa', 'Apartment untuk disewa RM1,200', 'rental'],
    ['出租', '古晋公寓出租 月租 RM1,800', 'rental'],
  ])('but %s is still read correctly', (_n, text, expected) => {
    expect(demoParse(text).listingType).toBe(expected)
  })

  it('the price card stamps no FOR SALE pill on an unknown type', () => {
    // Burned into a JPEG on a client's page, where it cannot be edited or
    // repaired — the same class as the hardcoded "Kuching", in the same place.
    const src = readFileSync(new URL('./brandcard.js', import.meta.url), 'utf8')
    expect(src).not.toMatch(/listing\.listingType === 'rental' \? 'FOR RENT' : 'FOR SALE'/)
    expect(src).toMatch(/tag \? h\('div'/)          // the pill is conditional
  })

  it('and an unknown type still cannot be refused by the transaction rule', () => {
    expect(blocks('💰 Selling Price\n\nRM2,500/month\n\nWhy Buy This Property?',
      { rawText: 'Tropics City. RM2,500. 800 sqft.', price: 2500, listingType: null })).toEqual([])
  })
})
