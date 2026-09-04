// Reproduces the 2026-09-01 incident: one listing published to Facebook and
// Instagram three times (06:33:13 / 06:34:16 / 06:35:23), carrying demo
// boilerplate, because the operator asked "fb and ig posted?".
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { postFingerprint, looksLikeDemoCaption, inventsPriceHistory, captionViolations, propertyNames, knownAmounts } from './postguard.js'

// The exact text PostPeer received three times that day.
const DEMO = `✨ Property in The Northbank — now available

Looking for a place that just feels right? This home with 2 bedrooms in The Northbank is ready for its next owner. RM2,500/month — great value for the area.

2 bedrooms · 2 bathrooms · 787 sq ft

Drop me a DM and I'll send over the full details and viewing times. 🏡`

// The caption the operator actually approved and believed had gone out.
const REAL = `✨ Brand New RENNA RESIDENCE — Now Available for Rent

Looking for a premium rental at The Northbank? This stunning RENNA RESIDENCE is move-in ready!

📍 The Northbank, Kuching
💰 RM2,500/month (negotiable)
🛏️ 2 Bedrooms | 2 Bathrooms | 787 Sqft
🏢 Level 12 | Fully Furnished

Ready to view? DM or call Lydia 0143998011 🏡`

describe('demo-caption detection', () => {
  it('catches the boilerplate that actually got published', () => {
    expect(looksLikeDemoCaption(DEMO)).toBe(true)
  })

  it('does NOT flag the real branded caption', () => {
    expect(looksLikeDemoCaption(REAL)).toBe(false)
  })

  it('does not flag a normal caption that merely mentions a DM', () => {
    expect(looksLikeDemoCaption('Lovely 3 bed in Batu Kawa, RM480k. DM me for a viewing.')).toBe(false)
  })

  it('is safe on empty/undefined input', () => {
    expect(looksLikeDemoCaption('')).toBe(false)
    expect(looksLikeDemoCaption(undefined)).toBe(false)
  })
})

describe('post fingerprint', () => {
  const base = {
    profileId: 'p1', caption: REAL,
    platforms: ['facebook', 'instagram'],
    mediaItems: [{ url: 'https://blob/a.png' }],
  }

  it('is identical for a repeat of the same post', () => {
    expect(postFingerprint(base)).toBe(postFingerprint({ ...base }))
  })

  it('ignores platform ORDER, so fb+ig equals ig+fb', () => {
    expect(postFingerprint(base)).toBe(postFingerprint({ ...base, platforms: ['instagram', 'facebook'] }))
  })

  it('differs for a different agent, so one agent cannot block another', () => {
    expect(postFingerprint(base)).not.toBe(postFingerprint({ ...base, profileId: 'p2' }))
  })

  it('differs for a genuinely different listing', () => {
    expect(postFingerprint(base)).not.toBe(postFingerprint({ ...base, caption: 'Totally different listing' }))
  })

  it('differs when the media changes', () => {
    expect(postFingerprint(base)).not.toBe(postFingerprint({ ...base, mediaItems: [{ url: 'https://blob/b.png' }] }))
  })
})

describe('claimPostOnce', () => {
  let store
  beforeEach(async () => {
    vi.resetModules()
    store = new Map()
    process.env.BLOB_READ_WRITE_TOKEN = 'tok'
    process.env.POST_DEDUPE_WINDOW_MS = '600000'
    vi.doMock('@vercel/blob', () => ({
      put: async (key) => {
        if (store.has(key)) throw new Error('exists')   // allowOverwrite:false
        store.set(key, { url: `u/${key}`, uploadedAt: new Date().toISOString() })
        return store.get(key)
      },
      list: async ({ prefix }) => ({ blobs: store.has(prefix) ? [store.get(prefix)] : [] }),
      del: async (url) => { for (const [k, v] of store) if (v.url === url) store.delete(k) },
    }))
  })

  it('lets the first post through and blocks the immediate repeats', async () => {
    const { claimPostOnce } = await import('./postguard.js')
    const fp = 'abc123'
    expect(await claimPostOnce(fp)).toBe(true)   // 06:33:13 - the real post
    expect(await claimPostOnce(fp)).toBe(false)  // 06:34:16 - blocked
    expect(await claimPostOnce(fp)).toBe(false)  // 06:35:23 - blocked
  })

  it('does not block a DIFFERENT listing posted at the same moment', async () => {
    const { claimPostOnce } = await import('./postguard.js')
    expect(await claimPostOnce('listing-a')).toBe(true)
    expect(await claimPostOnce('listing-b')).toBe(true)
  })

  it('releases the claim so a failed publish can genuinely retry', async () => {
    const { claimPostOnce, releasePostOnce } = await import('./postguard.js')
    expect(await claimPostOnce('x')).toBe(true)
    expect(await claimPostOnce('x')).toBe(false)
    await releasePostOnce('x')
    expect(await claimPostOnce('x')).toBe(true)
  })

  it('fails OPEN when Blob has no token, rather than blocking all posting', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    const { claimPostOnce } = await import('./postguard.js')
    expect(await claimPostOnce('anything')).toBe(true)
  })
})

describe('invented price history', () => {
  const listing = { rawText: 'RARE 1-BEDROOM FOR SALE. Tropics City. RM338,000 (RM100k below value).' }

  it('catches the exact fabrication seen in 8 of 8 generations', () => {
    expect(inventsPriceHistory('💰 Selling Price\nRM438,000\nNOW ONLY RM338,000', listing)).toBe(true)
  })

  it('catches "PRICE REDUCED" when the listing never said so', () => {
    expect(inventsPriceHistory('🔥 PRICE REDUCED | FOR SALE', listing)).toBe(true)
  })

  it('allows an honest below-bank-value caption', () => {
    expect(inventsPriceHistory('💰 RM338,000\n🏦 Bank Value RM438,000\n💥 Save RM100,000', listing)).toBe(false)
  })

  it('does NOT block a listing the agent really did reduce', () => {
    const reduced = { rawText: 'PRICE REDUCED! Was RM400,000, now RM338,000.' }
    expect(inventsPriceHistory('🔥 PRICE REDUCED\nNOW ONLY RM338,000', reduced)).toBe(false)
  })

  it('is safe on empty input', () => {
    expect(inventsPriceHistory('', listing)).toBe(false)
    expect(inventsPriceHistory('Lovely 2 bed in Kuching, RM2,500/month.', listing)).toBe(false)
  })
})

describe('caption contract (the Tropics City incident)', () => {
  const listing = { rawText: `RARE 1-BEDROOM UNIT FOR SALE. SAVED RM100k
Tropics City - 1 Bedroom Unit For Sale
Location : Tabuan Dayak
Selling Price : RM338,000 (RM100K Below Value)
800 sqft, 1 Bedroom, 1 Bathroom, 1 Carpark
Current Rental : RM1,300/month. Annual Rental: RM15,600
5 mins to Jalan Song. Gross ROI 4.62% p.a.
Lister: Edward 0183929100` }

  it('flags the published caption: invented furnishing + dropped hook and name', () => {
    const v = captionViolations('RM338,000. 800 sq ft. Fully Furnished. RM1,300/month. RM15,600 annual. Edward 0183929100', listing)
    expect(v.invented).toContain('Fully Furnished')
    expect(v.missing).toContain('the below-value hook')
    expect(v.missing.some((m) => m.includes('Tropics City'))).toBe(true)
  })

  it('passes a caption that honours the listing', () => {
    const good = `Tropics City, Tabuan Dayak. RM338,000 - RM100K Below Value (save RM100k).
800 sqft, 1 bed 1 bath 1 carpark. Rental RM1,300/month, RM15,600/year, ROI 4.62%.
5 mins to Jalan Song. Edward 0183929100`
    const v = captionViolations(good, listing)
    expect(v.invented).toEqual([])
    expect(v.missing).toEqual([])
  })

  it('allows furnishing when the listing states it', () => {
    const furnished = { rawText: 'RENNA RESIDENCE for rent, RM2,500/month, fully furnished, Lydia 0143998011' }
    const v = captionViolations('RENNA RESIDENCE - RM2,500/month, Fully Furnished. Lydia 0143998011', furnished)
    expect(v.invented).toEqual([])
  })

  it('flags an invented distance claim', () => {
    const v = captionViolations('Tropics City RM338,000, 800 sqft, RM1,300/month, RM15,600, RM100k below value, 5 mins to Jalan Song, 3 mins to the airport! Edward 0183929100', listing)
    expect(v.invented.some((x) => /airport/i.test(x))).toBe(true)
  })
})

// Invented numbers: room counts and money.
//
// All four of these published clean on 2026-09-03 against a 2-bed/2-bath
// listing. The first three are what this pass adds; the yield is deliberately
// still out of scope (see the report in postguard.js) - a yield claim needs a
// caption-to-listing walk, and every extra rule is another chance to refuse a
// good caption.
describe('invented numbers', () => {
  const twoBed = {
    listingType: 'sale', price: 338000, location: 'Tabuan Dayak', bedrooms: 2, bathrooms: 2, sqft: 800,
    rawText: `Tropics City - 2 Bedroom Unit For Sale
Location : Tabuan Dayak
Selling Price : RM338,000 (RM100K Below Value)
800 sqft, 2 Bedroom, 2 Bathroom, 1 Carpark
Lister: Edward 0183929100`,
  }
  const base = 'Tropics City, Tabuan Dayak. RM338,000 - RM100K below value. 800 sqft. Edward 0183929100'

  it('catches a room count that contradicts the listing', () => {
    const v = captionViolations(`${base} 4 bedrooms and 3 bathrooms.`, twoBed)
    expect(v.invented.some((x) => /4 bedrooms/.test(x))).toBe(true)
    expect(v.invented.some((x) => /3 bathrooms/.test(x))).toBe(true)
  })

  it('says nothing when the listing never stated a room count', () => {
    const noCounts = { ...twoBed, bedrooms: null, bathrooms: undefined }
    expect(captionViolations(`${base} 4 bedrooms and 3 bathrooms.`, noCounts).invented).toEqual([])
  })

  it('trusts the source over a parser slip', () => {
    // if the LISTING itself says 4 bedrooms, a caption repeating it is faithful,
    // whatever the parser put in the field.
    const slipped = { ...twoBed, bedrooms: 2, rawText: `${twoBed.rawText}\n4 bedrooms upstairs` }
    expect(captionViolations(`${base} 4 bedrooms.`, slipped).invented).toEqual([])
  })

  it('catches a money figure the listing cannot justify', () => {
    expect(captionViolations(`${base} 2 Bedroom 2 Bathroom. Deposit RM10,000.`, twoBed).invented)
      .toContain('RM10,000')
  })

  // THE REVERT, as a test. A listing written "450k nego" has no "RM" in it at
  // all; an RM-only scan of rawText produced an empty set, so prompts.js told
  // the model "Asking price: RM450,000", the guard called that an invention, and
  // the repair loop had the model delete the price. The advert then published
  // with no price and no violation.
  it('never calls the agent\'s own asking price an invention', () => {
    const nego = {
      listingType: 'sale', price: 450000, location: 'Batu Kawa', bedrooms: 3, bathrooms: 2, sqft: 1400,
      rawText: 'Double storey terrace Batu Kawa for sale. 450k nego. 3 bed 2 bath, 1400 sqft built-up. call 0128887766',
    }
    const v = captionViolations('Double Storey Terrace @ Batu Kawa\nRM450,000 (nego)\n3 Bed | 2 Bath | 1,400 sqft\n0128887766', nego)
    expect(v.invented).toEqual([])
    expect(knownAmounts(nego)).toContain(450000)
  })

  it('allows the figures a caption legitimately computes', () => {
    const rental = {
      listingType: 'rental', price: 2500, location: 'Vivacity', bedrooms: 2, bathrooms: 2, sqft: 850,
      rawText: 'Vivacity for rent RM2,500/month, 2 bed 2 bath, 850 sqft. call 0122223333',
    }
    // annual = 2500 x 12; psf = 2500/850 = 2.94, quoted rounded
    const v = captionViolations('Vivacity RM2,500/month (RM30,000 a year, about RM3 psf). 2 bed 2 bath, 850 sqft. 0122223333', rental)
    expect(v.invented).toEqual([])
  })

  it('reads every price notation the parser accepts', () => {
    const juta = { price: 1250000, rawText: 'Land for sale, 1.25 juta, 21,780 sq ft. call 0111234567' }
    expect(captionViolations('Land for sale RM1,250,000 — 21,780 sq ft. 0111234567', juta).invented).toEqual([])
    const k = { price: 288000, rawText: 'Terrace for sale 288k nego. call 0175552222' }
    expect(captionViolations('Terrace RM288k nego. 0175552222', k).invented).toEqual([])
  })

  it('does not read the word "form" as an RM amount', () => {
    const l = { price: 338000, bedrooms: 2, bathrooms: 2, rawText: 'Apartment for sale RM338,000, 2 bed 2 bath. call 0183929100' }
    expect(captionViolations('RM338,000. 2 bed 2 bath. Fill in the form 3 and confirm 2 slots. 0183929100', l).invented).toEqual([])
  })

  it('checks nothing when there is nothing to check against', () => {
    // no source text and no parsed price: every figure would look invented, and
    // the caption would be refused for carrying a price at all.
    expect(captionViolations('A lovely home, RM450,000.', {}).invented).toEqual([])
  })
})

describe('price-cut phrasings', () => {
  const listing = { rawText: 'RARE 1-BEDROOM FOR SALE. Tropics City. RM338,000 (RM100k below value).' }

  for (const cap of [
    'Originally RM438,000 — yours for RM338,000',
    'Down from RM438,000. Now RM338,000',
    'Price slashed! RM338,000',
    'Reduced by RM100,000 — RM338,000',
    'RM100,000 off the asking price',
    'Was RM438,000, now RM338,000',
  ]) {
    it(`catches "${cap.slice(0, 28)}..."`, () => {
      expect(inventsPriceHistory(cap, listing)).toBe(true)
    })
  }

  it('still allows the honest below-bank-value caption', () => {
    expect(inventsPriceHistory('RM338,000 — RM100k below bank value. Save RM100,000.', listing)).toBe(false)
  })

  it('still allows a listing the agent really did reduce', () => {
    const reduced = { rawText: 'Originally RM438,000, reduced to RM338,000 for a quick sale.' }
    expect(inventsPriceHistory('Down from RM438,000 — now RM338,000', reduced)).toBe(false)
  })
})

describe('per-agent rule isolation', () => {
  it('one agent\'s rules can never reach another agent (separate profile keys)', async () => {
    // rules/<profileId>.json — the key IS the isolation. This test exists
    // because 100 agents share one system and a leak would put one agent's
    // preferences (or worse, their listings) into another's captions.
    process.env.BLOB_READ_WRITE_TOKEN = 'test-token'
    const { saveRule, getRules } = await import('./style.js')
    // saveRule refuses without a profile — there is no shared/global bucket to
    // fall back to, so a rule cannot be written anywhere but one agent's key.
    await expect(saveRule('', { rule: 'x' })).rejects.toThrow(/profile required/)
    // and a read for an unknown profile returns empty, never someone else's
    delete process.env.BLOB_READ_WRITE_TOKEN
    expect(await getRules('nobody')).toEqual({ rules: [] })
  })
})

describe('property name extraction (the two multi-style failures)', () => {
  const name = (raw, location) => propertyNames(raw, { location })[0]

  it('does not mistake marketing filler for the name', () => {
    // "Brand New RENNA RESIDENCE" yielded "Brand New" first, so the prompt told
    // the model the property was called "Brand New" and the real name vanished.
    expect(name('Brand New RENNA RESIDENCE for Rent. The Northbank Kuching.', 'The Northbank')).toBe('RENNA RESIDENCE')
  })

  it('trims listing vocabulary instead of discarding the name with it', () => {
    expect(name('Tropics City For Sale. RM338,000.', 'Tabuan Dayak')).toBe('Tropics City')
    expect(name('Tropics City – 1 Bedroom Unit For Sale', 'Tabuan Dayak')).toBe('Tropics City')
  })

  it('never returns the area as the property name', () => {
    expect(name('Tabuan Dayak condo for sale', 'Tabuan Dayak')).toBeUndefined()
  })
})

describe('the below-value hook is a concept, not an English phrase', () => {
  const listing = { rawText: 'Tropics City. RM338,000 (RM100K Below Value). Edward 0183929100' }
  const missesHook = (cap) => captionViolations(cap, listing).missing.includes('the below-value hook')

  it('accepts the hook in Chinese', () => {
    expect(missesHook('Tropics City 售价 RM338,000，低于市价 RM100,000。Edward 0183929100')).toBe(false)
  })

  it('accepts the hook in Malay', () => {
    expect(missesHook('Tropics City RM338,000, bawah nilai pasaran RM100,000. Edward 0183929100')).toBe(false)
  })

  it('still catches a caption that genuinely drops it', () => {
    expect(missesHook('Tropics City RM338,000. Edward 0183929100')).toBe(true)
  })
})

// The name extractor is only as good as the listing SHAPES it has seen.
//
// It was measured 9/9 on multi-line fixtures and shipped. The client's RENNA
// listing arrives as ONE line, which hands the regex several capitalised runs:
// it returned both "RENNA RESIDENCE" and "Sqft Fully Furnished", and because
// captionViolations requires every returned name to appear in the caption, that
// listing degraded on every single attempt - three probes for three, with no
// error to explain it. A property has one name.
describe('property name extraction across real listing shapes', () => {
  const cases = [
    ['a one-line listing', 'Brand New RENNA RESIDENCE for Rent. The Northbank Kuching. 2 Bed 2 Bath 787 Sqft Fully Furnished 12th Floor RM2.5k nego.', 'RENNA RESIDENCE'],
    ['the same listing over several lines', 'Brand New RENNA RESIDENCE for Rent. The Northbank Kuching.\n2 Bed 2 Bath 787 Sqft Fully Furnished 12th Floor\nRental price: RM2,500 (nego)', 'RENNA RESIDENCE'],
    ['a title-case name', 'Tropics City – 1 Bedroom Unit For Sale. SAVED RM100k\nLocation : Tabuan Dayak\nSelling Price : RM338,000', 'Tropics City'],
    ['a land listing', 'Batu Kawa Commercial Land For Sale\nLand area: 21,780 sq ft (0.5 acre)\nPrice: RM1,250,000', 'Batu Kawa'],
    ['an ALL-CAPS name', 'RIVERINE DIAMOND KUCHING For Sale\nRM520,000\n3 bedrooms', 'RIVERINE DIAMOND'],
  ]

  for (const [label, raw, expected] of cases) {
    it(`picks the name out of ${label}`, () => {
      const names = propertyNames(raw, { location: 'The Northbank' })
      expect(names[0]).toBe(expected)
    })

    it(`asks for nothing but the name in ${label}`, () => {
      // Every extra candidate becomes a phrase the caption is REQUIRED to carry.
      const names = propertyNames(raw, { location: 'The Northbank' })
      expect(names).toHaveLength(1)
    })
  }

  it('does not demand measurements or furnishing as a property name', () => {
    const raw = 'Brand New RENNA RESIDENCE for Rent. The Northbank Kuching. 2 Bed 2 Bath 787 Sqft Fully Furnished 12th Floor RM2.5k nego.'
    const names = propertyNames(raw, { location: 'The Northbank' })
    expect(names.join(' ')).not.toMatch(/sqft|furnished|floor|bed|bath/i)
  })

  it('clears a caption that carries the real name', () => {
    const listing = {
      listingType: 'rental', price: 2500, location: 'The Northbank', sqft: 787, furnishing: 'fully furnished',
      rawText: 'Brand New RENNA RESIDENCE for Rent. The Northbank Kuching. 2 Bed 2 Bath 787 Sqft Fully Furnished 12th Floor. Rental RM2,500 nego. Lydia 0143998011',
    }
    const caption = 'RENNA RESIDENCE — The Northbank Kuching\nRM2,500/month (nego)\n2 Bed 2 Bath | 787 Sqft | 12th Floor | Fully Furnished\nLydia 0143998011'
    expect(captionViolations(caption, listing)).toEqual({ missing: [], invented: [] })
  })
})

// Chinese listings, which are a large share of this market.
//
// The money regexes ended with \b, which is defined on [A-Za-z0-9_]. 万 and 萬
// are not word characters, so the boundary only held when an ASCII character
// happened to follow — "RM43万 3房" matched "RM43" and dropped the 万, turning
// 430,000 into 43. The caption's own asking price then looked invented, and the
// repair loop told the model to delete it. ASCII multipliers keep their
// boundary so "form 3 bedrooms" is not read as "rm 3"; CJK ones need none.
describe('money written in Chinese', () => {
  const listing = {
    listingType: 'sale', price: 430000, location: '石角', bedrooms: 3, bathrooms: 2, sqft: 1300,
    rawText: '石角排屋出售\n售价43万（低于市价10万）\n3房2厕 1300平方尺\n联络 0165554444',
  }

  it('accepts a caption that writes the price in 万', () => {
    const cap = '石角排屋出售 RM43万（低于市价RM10万）3房2厕 1300平方尺 联络 0165554444'
    expect(captionViolations(cap, listing).invented).toEqual([])
  })

  it('accepts the same caption written in full figures', () => {
    const cap = '石角排屋出售 RM430,000（低于市价 RM100,000）3房2厕 1300平方尺 联络 0165554444'
    expect(captionViolations(cap, listing).invented).toEqual([])
  })

  it('does not call the asking price an invention when the listing has no parsed price', () => {
    // The worst version of this bug: with price null the known set was empty and
    // the guard flagged the only price the listing has.
    const cap = '石角排屋出售 RM430,000 3房2厕 联络 0165554444'
    expect(captionViolations(cap, { ...listing, price: null }).invented).toEqual([])
  })

  it('still refuses a figure that is in neither the listing nor derivable from it', () => {
    const cap = '石角排屋出售 RM43万 3房2厕 押金 RM50,000 联络 0165554444'
    expect(captionViolations(cap, listing).invented.join(' ')).toMatch(/50,?000/)
  })

  it('does not read "form" as an RM amount', () => {
    const l = { listingType: 'sale', price: 338000, bedrooms: 3, rawText: 'Terrace RM338,000 3 bed' }
    expect(captionViolations('Terrace RM338,000, 3 bed. Fill in the form 3 times.', l).invented).toEqual([])
  })
})
