// THE BLIND SPOTS — what captionViolations could not see.
//
// Every case below published CLEAN before 2026-09-05, measured against the real
// exported function. They are grouped by what they cost:
//
//   BLOCKS  — a stated fact the listing contradicts or never gave, where the
//             rule can be shown not to misfire. A wrong room count is not a
//             matter of opinion.
//   WARNS   — a real invention the rule cannot separate from a coincidence
//             often enough to be trusted with a silent, total refusal. A
//             blocker that is right 70% of the time refuses a real listing
//             three times in ten; a warning that is right 70% of the time still
//             reaches the repair round, where a model can look at it.
import { describe, it, expect } from 'vitest'
import { captionViolations, contradictsRoomCounts } from './postguard.js'

const TWO_BED = {
  rawText: 'Tropics City Kuching for sale. RM338,000. 2 bed 2 bath, 850 sqft. Call Jason 0128887766',
  price: 338000, bedrooms: 2, bathrooms: 2, sqft: 850, location: 'Kuching', propertyName: 'Tropics City', listingType: 'sale',
}
const ROOM_AD = {
  rawText: 'Master room for rent at Vivacity RM800/month, attached bathroom, female preferred. DM 012-345 6789',
  price: 800, location: 'Vivacity', listingType: 'rental',
}

describe('a room count is a room count in any script', () => {
  // BED_STATED read ASCII digits only — in a product whose selling point is
  // writing the caption in a DIFFERENT language from the listing. "4 bedrooms"
  // was caught while every one of these published clean.
  it.each([
    ['English words', 'Three bedrooms, two bathrooms in Tropics City', 3],
    ['Malay words', 'Empat bilik tidur di Tropics City', 4],
    ['Chinese numerals', 'Tropics City 四房两厕', 4],
    ['the BR shorthand', 'Tropics City — 3BR unit', 3],
  ])('%s: %s', (_n, caption, stated) => {
    const out = contradictsRoomCounts(caption, TWO_BED)
    expect(out.join(' ')).toContain(`${stated} bedroom`)
    expect(out.join(' ')).toContain('the listing says 2')
  })

  it('digits still work — the old rule was not traded away', () => {
    expect(contradictsRoomCounts('4 bedrooms', TWO_BED).length).toBe(1)
  })

  it('and a FAITHFUL count in words is silent', () => {
    // The safety property the digit rule already had: silent when the number
    // agrees, in whatever script it is written.
    expect(contradictsRoomCounts('Two bedrooms, two bathrooms', TWO_BED)).toEqual([])
    expect(contradictsRoomCounts('Dua bilik tidur, dua bilik air', TWO_BED)).toEqual([])
    expect(contradictsRoomCounts('二房二厕', TWO_BED)).toEqual([])
  })

  it('silent when the listing states no count at all — an unknown truth cannot be contradicted', () => {
    expect(contradictsRoomCounts('Three bedrooms', ROOM_AD)).toEqual([])
  })

  it('silent when the SOURCE itself states the number, so a parser slip cannot refuse a faithful caption', () => {
    const odd = { ...TWO_BED, rawText: TWO_BED.rawText + ' Three bedrooms available in the block.' }
    expect(contradictsRoomCounts('Three bedrooms', odd)).toEqual([])
  })

  it('does not read "brick" or "Brunei" as a BR count', () => {
    expect(contradictsRoomCounts('Brick facade, Brunei-facing view', TWO_BED)).toEqual([])
  })
})

describe('facilities the closed list did not carry', () => {
  it.each([
    ['air-conditioning', 'Master room at Vivacity — RM800/month. Air-conditioning throughout.', 'air-conditioning'],
    ['water heater', 'Master room at Vivacity — RM800/month. Water heater installed.', 'water heater'],
    ['kitchen cabinets', 'Master room at Vivacity — RM800/month. Kitchen cabinets included.', 'kitchen cabinets'],
    ['rooftop deck', 'Master room at Vivacity — RM800/month. Residents-only rooftop deck.', 'rooftop deck'],
    ['sauna', 'Master room at Vivacity — RM800/month. Sauna downstairs.', 'sauna'],
    ['BBQ area', 'Master room at Vivacity — RM800/month. BBQ area for residents.', 'BBQ area'],
  ])('%s is blocked when the listing promised none', (_n, caption, label) => {
    expect(captionViolations(caption, ROOM_AD).invented).toContain(label)
  })

  it.each([
    ['English', 'Master room at Vivacity RM800/month, air-cond and water heater included. DM 012-345 6789'],
    ['Malay', 'Bilik master di Vivacity RM800 sebulan, ada penghawa dingin dan pemanas air. DM 012-345 6789'],
    ['Chinese', 'Vivacity 主人房出租 RM800/月，有冷气和热水器。DM 012-345 6789'],
  ])('and NOT blocked when the listing (%s) says so', (_n, rawText) => {
    const listing = { ...ROOM_AD, rawText }
    const cap = 'Master room at Vivacity — RM800/month. Air-conditioning and water heater. DM 012-345 6789'
    expect(captionViolations(cap, listing).invented).not.toContain('air-conditioning')
    expect(captionViolations(cap, listing).invented).not.toContain('water heater')
  })
})

describe('title and lot status — legally material in Malaysia', () => {
  it.each([
    ['individual title', 'Tropics City — RM338,000. Individual title.', /individual title/i],
    ['geran individu', 'Tropics City — RM338,000. Geran individu ready.', /geran individu/i],
    ['strata title', 'Tropics City — RM338,000. Strata title issued.', /strata title/i],
    ['non-bumi lot', 'Tropics City — RM338,000. Non-bumi lot, open to all buyers.', /non[- ]?bumi/i],
    ['malay reserve', 'Tropics City — RM338,000. Malay reserve land.', /malay reserve/i],
  ])('%s is blocked when the listing never said it', (_n, caption, re) => {
    expect(captionViolations(caption, TWO_BED).invented.join(' ')).toMatch(re)
  })

  it('and not blocked when the listing did say it', () => {
    const l = { ...TWO_BED, rawText: TWO_BED.rawText + ' Individual title, non-bumi lot.' }
    const v = captionViolations('Tropics City — RM338,000. Individual title, non-bumi lot.', l)
    expect(v.invented.join(' ')).not.toMatch(/title|bumi/i)
  })

  it('"non-bumi lot" is not also reported as a bumi lot claim', () => {
    const found = captionViolations('Tropics City — RM338,000. Non-bumi lot.', TWO_BED).invented
    expect(found.filter((x) => /bumi/i.test(x))).toHaveLength(1)
  })
})

describe('WARNINGS — real inventions that must never refuse a post', () => {
  const warn = (c, l = TWO_BED) => captionViolations(c, l).warnings.join(' | ')
  const blocked = (c, l = TWO_BED) => captionViolations(c, l).invented

  it('a landmark the listing never named is warned about, not refused', () => {
    const cap = 'Tropics City, Kuching — RM338,000. Walking distance to Vivacity Megamall.'
    expect(warn(cap)).toMatch(/Vivacity Megamall/)
    expect(blocked(cap)).toEqual([])          // it must NOT block
  })

  it('an invented developer is warned about, not refused', () => {
    const cap = 'Tropics City by Ibraco Berhad — RM338,000.'
    expect(warn(cap)).toMatch(/Ibraco Berhad/)
    expect(blocked(cap)).toEqual([])
  })

  it('a developer the listing DOES name is not warned about', () => {
    const l = { ...TWO_BED, rawText: 'Tropics City by Ibraco Berhad, Kuching. RM338,000. 2 bed 2 bath.' }
    expect(warn('Tropics City by Ibraco Berhad — RM338,000.', l)).not.toMatch(/developer/)
  })

  it('an unnamed nearby thing is not a claim about a landmark', () => {
    // "near the market" names nothing. Only a capitalised place is a factual
    // assertion somebody could check.
    expect(warn('Tropics City — RM338,000. Next to the market and shops.')).not.toMatch(/never mentions/)
  })

  it('the area the parser already stored is not an invention', () => {
    expect(warn('Tropics City — RM338,000. Near Kuching city centre.')).not.toMatch(/never mentions/)
  })

  it('an ordinary faithful caption produces no warning at all', () => {
    expect(warn('Tropics City, Kuching — RM338,000. 2 bed 2 bath, 850 sqft. Call Jason 0128887766')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// THE LIMITER'S KEY MUST NOT BE THE CALLER'S TO CHOOSE.
//
// clientIp read the FIRST entry of x-forwarded-for. Vercel appends the real
// client address to whatever the client already sent, so entry [0] is a value
// the attacker writes — and rotating it defeats every limit keyed on it.
// Measured 2026-09-05 with the old code: 300 /api/generate calls, each with a
// fresh x-forwarded-for, 0 blocked, against a 40/minute limit. The budget that
// limiter protects is the product's entire daily ceiling.
import { clientIp, rateLimit, resetRateLimits } from './tenant.js'

describe('the rate-limit key cannot be rotated by the caller', () => {
  it('prefers x-real-ip, which the platform sets and the client cannot forge', () => {
    expect(clientIp({ headers: { 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '10.0.0.1' } })).toBe('203.0.113.7')
  })

  it('otherwise takes the LAST hop, not the first', () => {
    // The client wrote "10.0.0.1"; the platform appended the real address.
    expect(clientIp({ headers: { 'x-forwarded-for': '10.0.0.1, 203.0.113.7' } })).toBe('203.0.113.7')
  })

  it('a caller rotating the header is still one bucket', () => {
    resetRateLimits()
    let blocked = 0
    for (let i = 0; i < 60; i++) {
      const ip = clientIp({ headers: { 'x-forwarded-for': `10.0.0.${i}, 203.0.113.7` } })
      if (!rateLimit(`probe:${ip}`, { limit: 40, windowMs: 60_000 }).ok) blocked++
    }
    expect(blocked).toBe(20)   // 60 attempts, 40 allowed
  })

  it('and two genuinely different callers are still two buckets', () => {
    resetRateLimits()
    const a = clientIp({ headers: { 'x-forwarded-for': '10.0.0.1, 203.0.113.7' } })
    const b = clientIp({ headers: { 'x-forwarded-for': '10.0.0.1, 198.51.100.9' } })
    expect(a).not.toBe(b)
  })

  it('falls back to "unknown" rather than throwing on a headerless request', () => {
    expect(clientIp({})).toBe('unknown')
    expect(clientIp(undefined)).toBe('unknown')
  })
})
