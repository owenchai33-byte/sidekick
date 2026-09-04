// Reproduces the 2026-09-01 incident: one listing published to Facebook and
// Instagram three times (06:33:13 / 06:34:16 / 06:35:23), carrying demo
// boilerplate, because the operator asked "fb and ig posted?".
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { postFingerprint, looksLikeDemoCaption, inventsPriceHistory, captionViolations, propertyNames, knownAmounts, knownYields, resolvePropertyName, carriesName } from './postguard.js'

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
    // the name is still SPOTTED - it is now a warning, because this listing was
    // parsed without a propertyName and the finder is the capitalisation guess.
    expect(v.warnings.some((m) => m.includes('Tropics City'))).toBe(true)
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
    expect(captionViolations(caption, listing)).toEqual({ missing: [], invented: [], warnings: [] })
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

// A contact line is not a property name.
//
// "Call Jason 0128887766" and "Hubungi Azlan 0198887766" were both returned as
// REQUIRED names. A missing name blocks in ingest.js, so a caption that wrote
// the contact as "Jason 0128887766" — which is what a caption does — was refused
// every time. Found 2026-09-04 while answering "is it ready": three ordinary
// listings, English, Malay and an all-caps room ad, all blocked. Same shape as
// the one-line bug the day before: the extractor treating whatever is
// capitalised near the top as a name.
describe('contact lines and property types are not property names', () => {
  const blocked = (caption, listing) =>
    captionViolations(caption, listing).missing.some((m) => /property name/i.test(m))

  it('lets a Malay caption reformat "Hubungi Azlan" as "Azlan"', () => {
    const l = { listingType: 'sale', price: 520000, rawText: 'Rumah teres Kuching dijual. Harga RM520,000. Hubungi Azlan 0198887766' }
    expect(blocked('Rumah Teres Kuching — RM520,000\nAzlan 0198887766', l)).toBe(false)
  })

  it('lets an English caption reformat "Call Jason" as "Jason"', () => {
    const l = { listingType: 'sale', price: 880000, bedrooms: 4, bathrooms: 3, rawText: 'Semi D Batu Kawa for sale. RM880,000. 4 bed 3 bath. Call Jason 0128887766' }
    expect(blocked('Semi D Batu Kawa — RM880,000\n4 bed 3 bath\nJason 0128887766', l)).toBe(false)
  })

  it('does not demand "ROOM FOR RENT" from an all-caps room ad', () => {
    const l = { listingType: 'rental', price: 500, rawText: 'ROOM FOR RENT TABUAN JAYA RM500 PER MONTH CALL 0123456789' }
    expect(blocked('Room for rent, Tabuan Jaya — RM500 per month\nCall 0123456789', l)).toBe(false)
  })

  it('refuses a caption that drops the name the PARSER found', () => {
    // The guard has to keep doing its job: this is why it exists. The name now
    // comes from buildParsePrompt's propertyName, which a model produces and can
    // return as null - not from a regex over capitalised words.
    const l = { listingType: 'sale', price: 338000, propertyName: 'Tropics City', rawText: 'Tropics City For Sale\nRM338,000\n800 sqft\nEdward 0183929100' }
    expect(blocked('A condo in Kuching — RM338,000, 800 sqft. Edward 0183929100', l)).toBe(true)
  })

  it('only WARNS when the same name came from the heuristic', () => {
    // Same listing, parsed before propertyName existed. The heuristic still
    // notices, and ingest.js may say so - but it may not refuse the post.
    const l = { listingType: 'sale', price: 338000, rawText: 'Tropics City For Sale\nRM338,000\n800 sqft\nEdward 0183929100' }
    const cap = 'A condo in Kuching — RM338,000, 800 sqft. Edward 0183929100'
    expect(blocked(cap, l)).toBe(false)
    expect(captionViolations(cap, l).warnings.join(' ')).toMatch(/Tropics City/)
  })

  it('still finds the name in the shapes it always could', () => {
    expect(propertyNames('Tropics City For Sale\nRM338,000', {})[0]).toBe('Tropics City')
    expect(propertyNames('Brand New RENNA RESIDENCE for Rent. The Northbank', {})[0]).toBe('RENNA RESIDENCE')
    expect(propertyNames('RIVERINE DIAMOND KUCHING For Sale', {})[0]).toBe('RIVERINE DIAMOND')
    expect(propertyNames('Batu Kawa Commercial Land For Sale', {})[0]).toBe('Batu Kawa')
  })
})

// THE PROPERTY NAME COMES FROM THE PARSER.
//
// Three silent refusals in two days, all from the same root: propertyNames()
// guesses a name out of capitalised runs, every returned name was treated as
// REQUIRED, and a missing required name blocks in ingest.js. A one-line listing
// gave "Sqft Fully Furnished"; a landmark line gave "City Mall"; "Call Jason"
// gave "Jason". Each was patched as a symptom and the next shape broke it.
// buildParsePrompt now returns propertyName, which can be null - the answer the
// regex could never give.
describe('the property name comes from the parser, not from capitalisation', () => {
  const l = (extra) => ({
    listingType: 'sale', price: 338000, sqft: 800,
    rawText: 'Tropics City For Sale\nRM338,000\n800 sqft\nEdward 0183929100',
    ...extra,
  })
  const dropped = 'A condo in Kuching — RM338,000, 800 sqft. Edward 0183929100'
  const carries = 'Tropics City, Kuching — RM338,000, 800 sqft. Edward 0183929100'

  it('requires the name the parser gave', () => {
    expect(captionViolations(dropped, l({ propertyName: 'Tropics City' })).missing)
      .toContain('property name "Tropics City"')
  })

  it('clears a caption that carries it, whatever the casing', () => {
    const v = captionViolations(carries.replace('Tropics City', 'TROPICS CITY'), l({ propertyName: 'Tropics City' }))
    expect(v.missing).toEqual([])
    expect(v.warnings).toEqual([])
  })

  it('requires NOTHING when the parser says the property has no name', () => {
    // A room ad, a plot of land, an unnamed terrace: null is the normal answer,
    // and the whole point is that the regex could never give it. An empty or
    // blank string is the same thing - no name - and is treated as absent, so
    // the heuristic may still hint, but nothing here is ever REQUIRED.
    for (const name of [null, undefined, '', '   ']) {
      const v = captionViolations(dropped, l({ propertyName: name }))
      expect(v.missing.some((m) => /property name/i.test(m))).toBe(false)
    }
  })

  it('demotes the heuristic guess to a warning, never a missing field', () => {
    const v = captionViolations(dropped, l())
    expect(v.missing.some((m) => /property name/i.test(m))).toBe(false)
    expect(v.warnings.some((w) => /heuristic/.test(w))).toBe(true)
  })

  it('never lets the three historic guesses refuse a post', () => {
    const cases = [
      // 2026-09-03: a one-line listing yielded "Sqft Fully Furnished"
      [{ listingType: 'rental', price: 2500, sqft: 787, furnishing: 'Fully Furnished', location: 'The Northbank',
         rawText: 'Brand New RENNA RESIDENCE for Rent. The Northbank Kuching. 2 Bed 2 Bath 787 Sqft Fully Furnished 12th Floor RM2.5k nego. Lydia 0143998011' },
       'A brand new unit at The Northbank — RM2,500/month, 787 sqft, fully furnished. Lydia 0143998011'],
      // 2026-09-03: a landmark line yielded "City Mall"
      [{ listingType: 'sale', price: 480000, sqft: 1200,
         rawText: 'Terrace for sale, walking distance to Kuching City Mall. RM480,000. 1,200 sqft. Call 0128881234' },
       'Terrace for sale — RM480,000, 1,200 sqft, walking distance to the mall. 0128881234'],
      // 2026-09-04: a contact line yielded "Jason" / "Azlan"
      [{ listingType: 'sale', price: 880000, bedrooms: 4, bathrooms: 3,
         rawText: 'Semi D Batu Kawa for sale. RM880,000. 4 bed 3 bath. Call Jason 0128887766' },
       'Semi D Batu Kawa — RM880,000\n4 bed 3 bath\nJason 0128887766'],
    ]
    for (const [listing, caption] of cases) {
      const v = captionViolations(caption, listing)
      expect(v.missing.some((m) => /property name/i.test(m))).toBe(false)
    }
  })

  it('keeps propertyNames() exported and unchanged as the fallback', () => {
    expect(propertyNames('Tropics City For Sale\nRM338,000', {})[0]).toBe('Tropics City')
    expect(propertyNames('Brand New RENNA RESIDENCE for Rent. The Northbank', {})[0]).toBe('RENNA RESIDENCE')
  })
})

// The caption-to-listing walk for checkable claims.
//
// The INVENTED half was a fixed list of seven material claims plus money and
// room counts. Nothing walked the caption back to the listing, so a yield, a
// lease term and a page of facilities published clean against listings that
// state none of them. Open-ended adjectives are deliberately still out of
// scope: they cannot be checked, and a rule that guesses refuses good captions.
describe('invented claims the caption makes and the listing never made', () => {
  const plain = {
    listingType: 'sale', price: 338000, bedrooms: 3, bathrooms: 2, sqft: 1300,
    rawText: 'Terrace house Kuching for sale, RM338,000 negotiable. 3 rooms 2 toilets, 1,300 sqft. call 0177778888',
  }
  const base = 'Terrace house in Kuching — RM338,000 (negotiable)\n3 rooms | 2 toilets | 1,300 sqft\n0177778888'
  const invented = (cap, l = plain) => captionViolations(cap, l).invented.join(' | ')

  it('catches a yield the listing neither states nor implies', () => {
    expect(invented(`${base}\nGuaranteed 8% rental yield.`)).toMatch(/8% yield/)
  })

  it('allows a yield the caption legitimately computes from the listing', () => {
    const tenanted = {
      listingType: 'sale', price: 520000, bedrooms: 3, bathrooms: 2, sqft: 1050, propertyName: 'Riverine Diamond',
      rawText: 'Riverine Diamond for sale, asking RM520,000. Currently tenanted at RM1,800/month. 1,050 sq ft, 3 bedrooms 2 bathrooms. Call Jason 0128887766',
    }
    // 1,800 x 12 / 520,000 = 4.15%, quoted as 4.2
    const cap = 'Riverine Diamond — RM520,000\nTenanted at RM1,800/month, about 4.2% gross yield\n1,050 sq ft · 3 bedrooms · 2 bathrooms\nJason 0128887766'
    expect(captionViolations(cap, tenanted).invented).toEqual([])
  })

  it('allows the yield the listing states outright', () => {
    const stated = { ...plain, rawText: `${plain.rawText} Gross ROI 4.62% p.a.` }
    expect(invented(`${base}\nGross ROI 4.62% p.a.`, stated)).toEqual('')
  })

  it('ignores percentages that are not yield claims', () => {
    // "10% deposit" and "5% discount" are ordinary. Checking every percentage
    // would refuse honest captions, which is the failure this file exists to stop.
    expect(invented(`${base}\n10% deposit on signing. 5% early-bird discount.`)).toEqual('')
  })

  // THE LEASE-TERM GUARD IS GONE. These assert the deletion, not the rule.
  //
  // It refused "99-year lease" and "99 years lease remaining" on a listing
  // whose own tenure field said Leasehold (tenure is written as a word, so the
  // source could never ground the duration), and it refused the minimum-term
  // boilerplate that is on most Malaysian rental ads. That boilerplate WAS the
  // rule's only remaining target, so it could not be excluded. It also read
  // English only, so the same claim in Malay or Chinese passed regardless.
  it('no longer refuses a tenure duration on a leasehold listing', () => {
    const lh = { ...plain, tenure: 'Leasehold', rawText: `${plain.rawText} Leasehold.` }
    expect(invented(`${base}\n99-year lease.`, lh)).toEqual('')
    expect(invented(`${base}\n99 years lease remaining.`, lh)).toEqual('')
  })

  it('no longer refuses ordinary minimum-term boilerplate', () => {
    expect(invented(`${base}\n12-month tenancy required.`)).toEqual('')
    expect(invented(`${base}\n2-year lease.`)).toEqual('')
  })

  it('KNOWN MISS: an invented lease term now publishes; the money on it does not', () => {
    // Recorded on purpose. A missed claim is recoverable; the silent refusal
    // this rule caused was not. The money walk still catches the deposit.
    const out = invented(`${base}\nDeposit RM10,000, 2-year lease.`)
    expect(out).not.toMatch(/lease/)
    expect(out).toMatch(/RM10,000/)
  })

  it('does not read a monthly rental as anything at all', () => {
    const rental = { listingType: 'rental', price: 1500, rawText: 'Apartment for rent RM1,500/month. RM1,500 per month. call 0145556666' }
    expect(invented('Apartment for rent — RM1,500/month. 0145556666', rental)).toEqual('')
  })

  it('catches the facilities line that published clean', () => {
    const out = invented(`${base}\nGated and guarded, 24-hour security, swimming pool, gym.`)
    for (const f of ['gated', 'guarded', '24-hour security', 'swimming pool', 'gym']) expect(out).toMatch(f)
  })

  it('allows every facility the listing actually stated', () => {
    const withFacilities = {
      listingType: 'rental', price: 2800, bedrooms: 2, bathrooms: 2, sqft: 900, propertyName: 'Vivacity Residence',
      rawText: 'Vivacity Residence for rent RM2,800/month, 2 bed 2 bath, 900 sqft.\nFacilities: swimming pool, gym, 24 hours security, gated and guarded, playground, clubhouse, lift, covered parking.\nCall Michelle 0139998888',
    }
    const cap = 'Vivacity Residence — RM2,800/month\n2 bed · 2 bath · 900 sqft\nSwimming pool, gym, 24-hour security, gated and guarded, playground, clubhouse, lift, covered parking\nMichelle 0139998888'
    expect(captionViolations(cap, withFacilities).invented).toEqual([])
  })

  it('grounds a facility written in another language', () => {
    const cn = { listingType: 'rental', price: 1800, propertyName: 'Riverine Diamond',
      rawText: '古晋 Riverine Diamond 出租 月租 RM1,800\n设施：游泳池、健身房、24小时保安\n联络 0128889999' }
    expect(captionViolations('Riverine Diamond — RM1,800/month. Swimming pool, gym, 24-hour security. 0128889999', cn).invented).toEqual([])
    const ms = { listingType: 'sale', price: 980000,
      rawText: 'Semi-D Green Heights dijual RM980,000. Kawasan berpagar dan berkawal, ada taman permainan. Hubungi Faizal 0138887777' }
    expect(captionViolations('Semi-D Green Heights — RM980,000. Gated and guarded, playground. Faizal 0138887777', ms).invented).toEqual([])
  })

  it('does not read "security deposit" as a security guard', () => {
    // The obvious way to write this rule wrong: a rental term is not a facility.
    expect(invented(`${base}\nSecurity deposit RM338,000 refundable.`)).toEqual('')
  })

  it('does not read "leasehold" as an invented tenure when the listing says it', () => {
    const lh = { ...plain, tenure: 'Leasehold', rawText: `${plain.rawText} Leasehold.` }
    expect(invented(`${base}\nLeasehold title.`, lh)).toEqual('')
  })

  it('leaves open-ended adjectives alone, on purpose', () => {
    // Marketing language. The prompt bans it; a guard that tried to catch it
    // would refuse good captions, which is the more expensive failure.
    expect(invented(`${base}\nA modern, spacious home in a prime location.`)).toEqual('')
  })

  it('still catches the tenure claim it always caught', () => {
    const leasehold = { ...plain, tenure: 'Leasehold', rawText: `${plain.rawText} Leasehold title.` }
    expect(invented(`${base}\nFreehold.`, leasehold)).toMatch(/Freehold/i)
  })
})

// THE CORPUS.
//
// Every rule added above is another chance to refuse a caption that was fine,
// and a refusal here is silent and total - the agent's post simply never goes
// out. These are ordinary Malaysian listings with the captions an agent would
// actually publish, and NONE of them may be blocked. If this set stops being
// green, the new rule is wrong; narrow the rule, do not edit the corpus.
const MUST_PASS = [
  ['named condo, sale, hook + stated ROI', {
    listingType: 'sale', propertyName: 'Tropics City', price: 338000, location: 'Tabuan Dayak', bedrooms: 1, bathrooms: 1, sqft: 800,
    rawText: `Tropics City - 1 Bedroom Unit For Sale
Location : Tabuan Dayak
Selling Price : RM338,000 (RM100K Below Value)
800 sqft, 1 Bedroom, 1 Bathroom, 1 Carpark
Current Rental : RM1,300/month. Annual Rental: RM15,600
Gross ROI 4.62% p.a.
Lister: Edward 0183929100`,
  }, `Tropics City, Tabuan Dayak — RM338,000 (RM100K below value)
800 sqft · 1 bed · 1 bath · 1 carpark
Rental RM1,300/month, RM15,600 a year — gross ROI 4.62% p.a.
Edward 0183929100`],

  ['unnamed terrace, "450k nego", one line, "Call Jason"', {
    listingType: 'sale', propertyName: null, price: 450000, location: 'Batu Kawa', bedrooms: 3, bathrooms: 2, sqft: 1400,
    rawText: 'Double storey terrace Batu Kawa for sale. 450k nego. 3 bed 2 bath, 1400 sqft built-up. Call Jason 0128887766',
  }, 'Double Storey Terrace @ Batu Kawa\nRM450,000 (nego)\n3 Bed | 2 Bath | 1,400 sqft built-up\nJason 0128887766'],

  ['Malay terrace, "Hubungi Azlan"', {
    listingType: 'sale', propertyName: null, price: 520000, bedrooms: 4, bathrooms: 3,
    rawText: 'Rumah teres 2 tingkat di Kuching dijual. Harga RM520,000. 4 bilik tidur, 3 bilik air, 1,600 kaki persegi. Hubungi Azlan 0198887766',
  }, 'Rumah Teres 2 Tingkat, Kuching — RM520,000\n4 bilik tidur | 3 bilik air | 1,600 kaki persegi\nAzlan 0198887766'],

  ['Chinese terrace, 售价43万', {
    listingType: 'sale', propertyName: null, price: 430000, location: '石角', bedrooms: 3, bathrooms: 2, sqft: 1300,
    rawText: '石角排屋出售\n售价43万（低于市价10万）\n3房2厕 1300平方尺\n联络 0165554444',
  }, '石角排屋出售\n售价 RM43万（低于市价 RM10万）\n3房2厕 · 1300平方尺\n联络 0165554444'],

  ['named rental, RM2.5k/month, one line', {
    listingType: 'rental', propertyName: 'RENNA RESIDENCE', price: 2500, location: 'The Northbank', bedrooms: 2, bathrooms: 2, sqft: 787, furnishing: 'Fully Furnished',
    rawText: 'Brand New RENNA RESIDENCE for Rent. The Northbank Kuching. 2 Bed 2 Bath 787 Sqft Fully Furnished 12th Floor RM2.5k nego. Lydia 0143998011',
  }, 'RENNA RESIDENCE — The Northbank, Kuching\nRM2,500/month (nego)\n2 Bed | 2 Bath | 787 Sqft | 12th Floor | Fully Furnished\nLydia 0143998011'],

  ['ALL CAPS room ad, no name', {
    listingType: 'rental', propertyName: null, price: 500, location: 'Tabuan Jaya',
    rawText: 'ROOM FOR RENT TABUAN JAYA RM500 PER MONTH INCLUDE WIFI CALL 0123456789',
  }, 'Room for rent — Tabuan Jaya\nRM500 per month, wifi included\nCall 0123456789'],

  ['land, 1.25 juta, "Lister: Edward"', {
    listingType: 'sale', propertyName: null, price: 1250000, location: 'Batu Kawa', landSqft: 21780,
    rawText: 'Commercial land for sale at Batu Kawa. 21,780 sq ft (0.5 acre). Price 1.25 juta nego. Lister: Edward 0183929100',
  }, 'Commercial Land @ Batu Kawa\nRM1,250,000 (nego)\n21,780 sq ft\nEdward 0183929100'],

  ['rental whose listing DOES state the facilities', {
    listingType: 'rental', propertyName: 'Vivacity Megamall Residence', price: 2800, bedrooms: 2, bathrooms: 2, sqft: 900,
    rawText: `Vivacity Megamall Residence for rent
RM2,800/month, 2 bed 2 bath, 900 sqft
Facilities: swimming pool, gym, 24 hours security, covered parking
Call Michelle 0139998888`,
  }, `Vivacity Megamall Residence — for rent
RM2,800/month · 2 bed · 2 bath · 900 sqft
Swimming pool, gym, 24-hour security and covered parking
Michelle 0139998888`],

  ['Malay semi-D, gated + playground stated in Malay', {
    listingType: 'sale', propertyName: null, price: 980000, bedrooms: 4, bathrooms: 4,
    rawText: 'Rumah semi-D di Green Heights untuk dijual. RM980,000. 4 bilik tidur 4 bilik air, 2,400 kaki persegi. Kawasan berpagar dan berkawal, ada taman permainan. Hubungi Faizal 0138887777',
  }, 'Semi-D di Green Heights — RM980,000\n4 bilik tidur | 4 bilik air | 2,400 kaki persegi\nKawasan berpagar dan berkawal, ada taman permainan\nFaizal 0138887777'],

  ['Chinese condo rental, facilities stated in Chinese', {
    listingType: 'rental', propertyName: 'Riverine Diamond', price: 1800, bedrooms: 2, bathrooms: 2, sqft: 850,
    rawText: '古晋 Riverine Diamond 公寓出租\n月租 RM1,800，2房2厕，850平方尺\n设施：游泳池、健身房、24小时保安\n联络 王小姐 0128889999',
  }, 'Riverine Diamond 古晋 · 公寓出租\n月租 RM1,800｜2房2厕｜850平方尺\n游泳池、健身房、24小时保安\n联络 王小姐 0128889999'],

  ['below-value hook rewritten as "Save RM100,000"', {
    listingType: 'sale', propertyName: null, price: 338000, location: 'The Northbank', bedrooms: 1, sqft: 800,
    rawText: 'RARE 1-bedroom at The Northbank for sale, RM338,000 (RM100k below value). 800 sqft. Call Edward 0183929100',
  }, '1-Bedroom @ The Northbank — RM338,000\nSave RM100,000 against bank value\n800 sqft\nEdward 0183929100'],

  ['price written bare as "338,000"', {
    listingType: 'sale', propertyName: null, price: 338000, bedrooms: 3, bathrooms: 2, sqft: 1300,
    rawText: 'Terrace house Kuching for sale, 338,000 negotiable. 3 rooms 2 toilets, 1,300 sqft. call 0177778888',
  }, 'Terrace house in Kuching — RM338,000 (negotiable)\n3 rooms | 2 toilets | 1,300 sqft\n0177778888'],

  ['rental with a lease term the listing states', {
    listingType: 'rental', propertyName: null, price: 1500, bedrooms: 3, bathrooms: 2, sqft: 1000,
    rawText: 'Apartment at Stutong for rent RM1,500/month. Minimum 2 years tenancy. 3 bed 2 bath, 1,000 sqft. Call Sarah 0145556666',
  }, 'Apartment @ Stutong — RM1,500/month\n2-year lease, 3 bed 2 bath, 1,000 sqft\nSarah 0145556666'],

  ['ALL CAPS shoplot', {
    listingType: 'sale', propertyName: null, price: 1850000, sqft: 1600,
    rawText: 'SHOPLOT FOR SALE AT JALAN SONG. RM1,850,000. GROUND FLOOR 1,600 SQ FT. CALL DAVID 0198882222',
  }, 'Shoplot for sale at Jalan Song\nRM1,850,000\nGround floor, 1,600 sq ft\nDavid 0198882222'],

  ['Chinese one-liner, 68万', {
    listingType: 'sale', propertyName: null, price: 680000, bedrooms: 4, bathrooms: 3, sqft: 1800,
    rawText: '古晋三层排屋出售，售价68万，4房3厕，建筑面积1800平方尺，联络陈先生 0126667777',
  }, '古晋三层排屋出售\n售价 RM680,000\n4房3厕 · 建筑面积 1800 平方尺\n联络陈先生 0126667777'],

  ['studio rental, furnishing stated', {
    listingType: 'rental', propertyName: null, price: 650, furnishing: 'Fully Furnished',
    rawText: 'Studio unit for rent in Kuching city centre. RM650 per month, fully furnished. Whatsapp 0111234567',
  }, 'Studio unit for rent, Kuching city centre\nRM650 per month, fully furnished\nWhatsApp 0111234567'],

  ['named condo with carpark, lift and security stated', {
    listingType: 'sale', propertyName: 'Tropics City', price: 420000, bedrooms: 3, bathrooms: 2, sqft: 1100,
    rawText: `TROPICS CITY for sale
RM420,000 | 3 bedrooms 2 bathrooms | 1,100 sq ft
2 covered car parks, lift lobby, 24 hours security
Lister: Alex 0168881111`,
  }, `Tropics City — for sale
RM420,000 · 3 bedrooms · 2 bathrooms · 1,100 sq ft
2 covered car parks, lift lobby, 24-hour security
Alex 0168881111`],

  ['Malay apartment rental, parking stated in Malay', {
    listingType: 'rental', propertyName: 'Sri Anggerik', price: 1200, bedrooms: 3, bathrooms: 2,
    rawText: 'Apartment Sri Anggerik untuk disewa. Sewa RM1,200 sebulan. 3 bilik tidur, 2 bilik air, 850 kaki persegi. Ada tempat letak kereta. Hubungi Nurul 0195553333',
  }, 'Sri Anggerik — untuk disewa\nRM1,200 sebulan\n3 bilik tidur | 2 bilik air | 850 kaki persegi\nAda tempat letak kereta\nNurul 0195553333'],

  ['price written "RM288k"', {
    listingType: 'sale', propertyName: null, price: 288000, bedrooms: 3, bathrooms: 2, sqft: 1200,
    rawText: 'Single storey terrace at Matang for sale. RM288k nego. 3 bed 2 bath 1,200 sqft. Call 0175552222',
  }, 'Single Storey Terrace @ Matang\nRM288,000 (nego)\n3 bed | 2 bath | 1,200 sqft\n0175552222'],

  ['tenanted unit, caption computes the yield', {
    listingType: 'sale', propertyName: 'Riverine Diamond', price: 520000, bedrooms: 3, bathrooms: 2, sqft: 1050,
    rawText: `Riverine Diamond, Kuching for sale
Asking RM520,000
Currently tenanted at RM1,800/month
1,050 sq ft, 3 bedrooms, 2 bathrooms
Call Jason 0128887766`,
  }, `Riverine Diamond, Kuching — RM520,000
Tenanted at RM1,800/month — about 4.2% gross yield
1,050 sq ft · 3 bedrooms · 2 bathrooms
Jason 0128887766`],

  ['Chinese listing with a stated 回报率', {
    listingType: 'sale', propertyName: 'Tropics City', price: 338000,
    rawText: '古晋 Tropics City 单位出售\n售价 RM338,000（低于市价 RM100,000）\n现租金 RM1,300/月，年租 RM15,600\n回报率 4.62%\n联络 Edward 0183929100',
  }, 'Tropics City 古晋 · 单位出售\n售价 RM338,000（低于市价 RM100,000）\n现租金 RM1,300/月，年租 RM15,600\n回报率 4.62%\n联络 Edward 0183929100'],

  ['detached house with no phone number in the listing', {
    listingType: 'sale', propertyName: null, price: 1380000, bedrooms: 5, bathrooms: 4, landSqft: 6000,
    rawText: 'Detached house at Petra Jaya for sale, RM1,380,000. 5 bedrooms 4 bathrooms, land 6,000 sq ft.',
  }, 'Detached House @ Petra Jaya — RM1,380,000\n5 bedrooms | 4 bathrooms | 6,000 sq ft land'],

  ['mixed Malay/English room rental', {
    listingType: 'rental', propertyName: null, price: 450,
    rawText: 'Bilik sewa di Kota Samarahan RM450 sebulan, termasuk air dan elektrik. WhatsApp 0146667777',
  }, 'Bilik sewa di Kota Samarahan — RM450 sebulan\nTermasuk air dan elektrik\nWhatsApp 0146667777'],

  ['leasehold condo, tenure repeated in the caption', {
    listingType: 'sale', propertyName: 'Vista Tunku', price: 390000, tenure: 'Leasehold', bedrooms: 2, bathrooms: 2, sqft: 950,
    rawText: 'Condo at Vista Tunku for sale. RM390,000. Leasehold. 2 bed 2 bath, 950 sqft. Lister: Michael 0128884444',
  }, 'Vista Tunku — RM390,000\nLeasehold · 2 bed · 2 bath · 950 sqft\nMichael 0128884444'],

  ['ALL CAPS named project', {
    listingType: 'sale', propertyName: 'RIVERINE DIAMOND', price: 520000, bedrooms: 3, bathrooms: 2, sqft: 1100,
    rawText: 'RIVERINE DIAMOND KUCHING FOR SALE. RM520,000. 3 BEDROOMS 2 BATHROOMS 1,100 SQ FT. CALL LYDIA 0143998011',
  }, 'RIVERINE DIAMOND KUCHING — FOR SALE\nRM520,000\n3 BEDROOMS | 2 BATHROOMS | 1,100 SQ FT\nLYDIA 0143998011'],

  ['room rental with a 12-month minimum stated', {
    listingType: 'rental', propertyName: null, price: 600,
    rawText: 'Room for rent Tabuan Jaya, RM600/month, minimum 12 months. Include wifi. Call 0123334444',
  }, 'Room for rent, Tabuan Jaya — RM600/month\n12-month tenancy minimum, wifi included\nCall 0123334444'],

  ['Malay bungalow, "1.5 juta"', {
    listingType: 'sale', propertyName: null, price: 1500000, bedrooms: 5, bathrooms: 4, landSqft: 8000,
    rawText: 'Banglo di Jalan Stakan untuk dijual. Harga 1.5 juta. 5 bilik tidur 4 bilik air. Tanah 8,000 kaki persegi. Hubungi Rahman 0139991111',
  }, 'Banglo di Jalan Stakan — RM1,500,000\n5 bilik tidur | 4 bilik air\nTanah 8,000 kaki persegi\nRahman 0139991111'],
]

// ingest.js's blocking rule, copied verbatim so the corpus measures what
// actually refuses a post rather than what merely appears in a list.
const blocksThePost = (caption, listing) => {
  const v = captionViolations(caption, listing)
  const blocking = v.missing.filter((m) => /^(?:RM|the below-value hook|property name)\b/i.test(m))
  return v.invented.length > 0 || blocking.length > 0 || v.missing.length > 1
}

const MUST_CATCH = [
  ['an invented yield', 'Guaranteed 8% rental yield', /8% yield/],
  ['the deposit on an invented lease line', 'Deposit RM10,000, 2-year lease', /RM10,000/],
  ['invented facilities', 'Gated and guarded, 24-hour security, swimming pool, gym', /gated/],
  ['each facility separately', 'Gated and guarded, 24-hour security, swimming pool, gym', /guarded.*24-hour security.*swimming pool.*gym|gym/],
  ['a bedroom count that contradicts the listing', '5 bedrooms and 4 bathrooms', /5 bedrooms/],
  ['an invented distance', '3 mins to the airport', /airport/],
]

describe('the must-pass corpus: real listings that must never be refused', () => {
  for (const [label, listing, caption] of MUST_PASS) {
    it(`publishes: ${label}`, () => {
      const v = captionViolations(caption, listing)
      expect({ label, invented: v.invented }).toEqual({ label, invented: [] })
      expect({ label, blocked: blocksThePost(caption, listing) }).toEqual({ label, blocked: false })
    })
  }

  it('reports the corpus counts', () => {
    const passed = MUST_PASS.filter(([, l, c]) => !blocksThePost(c, l) && captionViolations(c, l).invented.length === 0).length
    // the must-catch set runs against the plainest listing in the corpus: a
    // terrace with a price, room counts, a size and a phone number, and nothing
    // else. Every claim below is a promise it does not make.
    const plain = MUST_PASS[11][1]
    const plainCap = MUST_PASS[11][2]
    const caught = MUST_CATCH.filter(([, claim, re]) =>
      re.test(captionViolations(`${plainCap}\n${claim}`, plain).invented.join(' | '))).length
    // eslint-disable-next-line no-console
    console.log(`MUST-PASS: ${passed}/${MUST_PASS.length}   MUST-CATCH: ${caught}/${MUST_CATCH.length}`)
    expect(passed).toBe(MUST_PASS.length)
    expect(MUST_PASS.length).toBeGreaterThanOrEqual(25)
    expect(caught).toBe(MUST_CATCH.length)
  })
})


// ---------------------------------------------------------------------------
// THE REVIEW CORPUS, 2026-09-04.
//
// The corpus above was written by the same pass that wrote the rules, so its
// captions echo the source's own wording and every propertyName is an exact
// substring of both. A second reader wrote 30 cases without sight of the rules
// and measured six REGRESSIONS - captions the guard refused that HEAD published.
// Each one is reproduced here, and each is now a case the guard may never
// refuse again.
// ---------------------------------------------------------------------------

describe("a parser propertyName is a fact only when the listing contains it", () => {
  // Six of these blocked every caption for their listing, permanently, burning
  // two repair calls per attempt on a free tier that caps at ~15 listings/day.
  const base = { listingType: 'sale', price: 520000, rawText: 'Double storey terrace for sale RM520,000. Alan 0124446666' }
  const cap = 'Double storey terrace — RM520,000. Alan 0124446666'
  const blocksOnName = (l, c = cap) =>
    captionViolations(c, l).missing.some((m) => /property name/i.test(m))

  it('never refuses over a name the listing text does not contain', () => {
    // the parser is the SAME model that produced the three heuristic incidents,
    // reading the same text. "Sunway Vivaldi" appears nowhere in this listing.
    expect(blocksOnName({ ...base, propertyName: 'Sunway Vivaldi' })).toBe(false)
  })

  it('never refuses over the standard ways a model declines a nullable field', () => {
    for (const n of ['N/A', 'n/a', 'Unknown', 'None', 'null', 'NULL', '-', '--', '?', 'Tiada', 'Not specified'])
      expect({ n, blocked: blocksOnName({ ...base, propertyName: n }) }).toEqual({ n, blocked: false })
  })

  it('never refuses over a contact line the parser mistook for a name', () => {
    const l = { listingType: 'sale', price: 880000, rawText: 'Semi D Batu Kawa for sale. RM880,000. Call Jason 0128887766', propertyName: 'Call Jason' }
    expect(blocksOnName(l, 'Semi D Batu Kawa — RM880,000. Jason 0128887766')).toBe(false)
  })

  it('never refuses over the area, which is already its own field', () => {
    const l = { listingType: 'sale', price: 480000, location: 'Batu Kawa', propertyName: 'Batu Kawa',
      rawText: 'Terrace at Batu Kawa for sale RM480,000. 0128881234' }
    expect(blocksOnName(l, 'Terrace for sale — RM480,000. 0128881234')).toBe(false)
  })

  it('STILL refuses a caption that drops a name the listing really states', () => {
    // the bite that must survive: this is the original incident.
    const l = { listingType: 'sale', price: 338000, propertyName: 'Tropics City',
      rawText: 'Tropics City For Sale\nRM338,000\nEdward 0183929100' }
    expect(blocksOnName(l, 'A condo in Kuching — RM338,000. Edward 0183929100')).toBe(true)
  })

  it('reports where the name came from, so the prompt and the gate agree', () => {
    const grounded = { propertyName: 'Tropics City', rawText: 'Tropics City For Sale\nRM338,000' }
    expect(resolvePropertyName(grounded)).toEqual({ name: 'Tropics City', from: 'parser' })
    // ungrounded: it falls back to the heuristic, whose answer is advisory only.
    const invented = { propertyName: 'Sunway Vivaldi', rawText: 'Tropics City For Sale\nRM338,000' }
    expect(resolvePropertyName(invented)).toEqual({ name: 'Tropics City', from: 'guess' })
    // and prompts.js prints a 'guess' as a hint, never as "it MUST appear" -
    // otherwise an unverified name publishes on a client's page.
    expect(resolvePropertyName({ rawText: 'Room for rent RM600/month. 0123334444' }))
      .toEqual({ name: null, from: null })
  })
})

describe('a caption that shortens the property name has not dropped it', () => {
  it('accepts the short form of a long marketing name', () => {
    // the parser is told to copy the name exactly as written, so it returns the
    // full string while the agent's house style writes the short one.
    const renna = { listingType: 'rental', price: 2500, sqft: 787, propertyName: 'RENNA RESIDENCE',
      rawText: 'Brand New RENNA RESIDENCE for Rent. RM2,500/month. 787 sqft. Ben 0135557777' }
    expect(captionViolations('RENNA @ The Northbank — RM2,500/month, 787 sqft. Ben 0135557777', renna).missing).toEqual([])
    const viv = { listingType: 'sale', price: 620000, sqft: 900, propertyName: 'Vivacity Megamall Residence',
      rawText: 'Vivacity Megamall Residence for sale RM620,000. 900 sqft. Ann 0139998888' }
    expect(captionViolations('Vivacity Residence — RM620,000, 900 sqft. Ann 0139998888', viv).missing).toEqual([])
  })

  it('does not accept the generic half on its own', () => {
    // "Residence" is not a name, so a caption carrying only that has dropped it.
    expect(carriesName('A residence in Kuching', 'RENNA RESIDENCE')).toBe(false)
    expect(carriesName('RENNA is ready', 'RENNA RESIDENCE')).toBe(true)
    expect(carriesName('A condo in Kuching', 'Tropics City')).toBe(false)
    expect(carriesName('Tropics, Tabuan Dayak', 'Tropics City')).toBe(true)
  })
})

describe('the yield walk reads adjacency, not proximity', () => {
  // A 24-character window around any percentage refused all nine of these
  // against a listing stating no percentage at all - and the cascade is the
  // reverted money bug verbatim: the repair prompt says REMOVE "10% yield",
  // there is no such phrase, the model deletes the true "10% deposit", the
  // count drops and ingest.js accepts a caption that lost a real term.
  const l = { listingType: 'sale', price: 390000, sqft: 950, rawText: 'Apartment for sale RM390,000. 950 sqft. Vincent 0129998888' }
  const head = 'Apartment RM390,000 — 950 sqft. Vincent 0129998888. '
  const invented = (tail) => captionViolations(head + tail, l).invented.join(' | ')

  it('leaves ordinary Malaysian financing copy alone', () => {
    for (const tail of [
      '10% deposit, great return.',
      '10% deposit, solid return on investment.',
      'Strong yield here. Bank loan up to 90%.',
      'Great return — bank loan up to 90%.',
      'Only 10% downpayment. Rental return is steady.',
      'Deposit 10%, pulangan menarik.',      // "attractive returns", no "sewa"
      '首付10%，回报稳定。',                    // 回报 without 率 is "returns", not a yield
      '首付10%，收益不错。',
      'ROI is excellent. 90% margin of financing.',
      '10% deposit. 5% early-bird discount.',
    ]) expect({ tail, invented: invented(tail) }).toEqual({ tail, invented: '' })
  })

  it('still catches the figure when the caption says it IS a yield', () => {
    expect(invented('Guaranteed 8% rental yield.')).toMatch(/8% yield/)
    expect(invented('Gross yield of 8%.')).toMatch(/8% yield/)
    expect(invented('ROI 8%.')).toMatch(/8% yield/)
    expect(invented('8% p.a. gross yield.')).toMatch(/8% yield/)
    expect(invented('回报率 8%。')).toMatch(/8% yield/)
    expect(invented('Pulangan sewa 8%.')).toMatch(/8% yield/)
  })
})

describe('knownYields is built from rents the listing names, not from any number', () => {
  it('does not let a year or a psf figure authorise a yield', () => {
    const noRent = { listingType: 'sale', price: 338000, sqft: 800, rawText: 'Tropics City, completed 2024. RM338,000. 800 sqft. Edward 0128887766' }
    // 2024 read as a monthly rent authorised 7.19%; psf authorised three more.
    expect(knownYields(noRent)).toEqual([])
    expect(captionViolations('Tropics City — RM338,000, 800 sqft. Guaranteed 7.2% yield. Edward 0128887766', noRent).invented.join(' | '))
      .toMatch(/7\.2% yield/)
  })

  it('allows the yield computed from a rent the listing states WITHOUT an RM', () => {
    // "Rental 1,300/month" carries no RM, and knownAmounts drops comma-written
    // figures under 100,000 - so the honest 4.6% was refused.
    const l = { listingType: 'sale', price: 338000, sqft: 800, rawText: 'Tropics City. 338,000. 800 sqft. Rental 1,300/month. Edward 0128887766' }
    expect(captionViolations('Tropics City — RM338,000, 800 sqft, rental 1,300/month. About 4.6% gross yield. Edward 0128887766', l).invented).toEqual([])
  })
})

describe('facility grounds cross the language barrier', () => {
  // The product writes the caption in a different language from the listing, so
  // every grounding gap is a silent refusal. These four were measured refusing.
  const cross = [
    ['Kawasan berpengawal 24 jam', 'Gated and guarded community.'],
    ['Kawalan keselamatan 24 jam', 'Guarded and gated.'],
    ['Kemudahan: gimnasium', 'Gym on site.'],
    ['Kemudahan: gim', 'Gym on site.'],
    ['Kemudahan: kolam renang', 'Swimming pool.'],
    ['ada tempat letak kereta', 'Parking available.'],
    ['rumah kelab', 'Clubhouse.'],
    ['ada lif', 'Lift access.'],
    ['taman permainan', 'Playground.'],
    ['24小时保安', 'Gated and guarded, 24-hour security.'],
    ['游乐场', 'Playground for kids.'],
    ['车位一个', 'Car park included.'],
    ['电梯直达', 'Lift access.'],
  ]
  for (const [src, claim] of cross) {
    it(`grounds "${claim}" in "${src}"`, () => {
      const l = { listingType: 'sale', price: 390000, sqft: 950, rawText: `Apartment for sale RM390,000. 950 sqft. ${src}. Vincent 0129998888` }
      expect(captionViolations(`Apartment RM390,000 — 950 sqft. ${claim} Vincent 0129998888`, l).invented).toEqual([])
    })
  }

  it('says nothing at all when the listing has no source text to check against', () => {
    // latent, not live: ingest.js always sets rawText. An empty `known` would
    // otherwise flag every facility in the caption and refuse the post.
    expect(captionViolations('Gated and guarded, pool, gym.', { price: 338000 }).invented).toEqual([])
  })
})

// The review's own corpus, scored through the real blocking rule. HEAD refused
// 2 of 30; the first cut of this change refused 7. None of these may be refused.
const REVIEW_PASS = [
  ['shortened marketing name', { listingType: 'sale', price: 620000, sqft: 900, propertyName: 'Vivacity Megamall Residence',
    rawText: 'Vivacity Megamall Residence for sale RM620,000. 900 sqft. Ann 0139998888' },
    'Vivacity Residence — RM620,000, 900 sqft. Ann 0139998888'],
  ['a name the listing never contained', { listingType: 'sale', price: 520000, propertyName: 'Sunway Vivaldi',
    rawText: 'Double storey terrace for sale RM520,000. Alan 0124446666' },
    'Double storey terrace — RM520,000. Alan 0124446666'],
  ['propertyName "N/A"', { listingType: 'sale', price: 520000, propertyName: 'N/A',
    rawText: 'Double storey terrace for sale RM520,000. Alan 0124446666' },
    'Double storey terrace — RM520,000. Alan 0124446666'],
  ['10% deposit + "great return"', { listingType: 'sale', price: 390000, sqft: 950,
    rawText: 'Apartment for sale RM390,000. 950 sqft. Vincent 0129998888' },
    'Apartment RM390,000 — 950 sqft. 10% deposit, great return. Vincent 0129998888'],
  ['loan up to 90%', { listingType: 'sale', price: 390000, sqft: 950,
    rawText: 'Apartment for sale RM390,000. 950 sqft. Vincent 0129998888' },
    'Apartment RM390,000 — 950 sqft. Strong yield here. Bank loan up to 90%. Vincent 0129998888'],
  ['Chinese investor boilerplate', { listingType: 'sale', price: 390000, sqft: 950,
    rawText: 'Apartment for sale RM390,000. 950 sqft. Vincent 0129998888' },
    'Apartment RM390,000 — 950 平方尺。首付10%，回报稳定。Vincent 0129998888'],
  ['Malay investor boilerplate', { listingType: 'sale', price: 390000, sqft: 950,
    rawText: 'Apartment for sale RM390,000. 950 sqft. Vincent 0129998888' },
    'Apartment RM390,000 — 950 sqft. Deposit 10%, pulangan menarik. Vincent 0129998888'],
  ['99-year lease on a leasehold listing', { listingType: 'sale', price: 390000, sqft: 950, tenure: 'Leasehold',
    rawText: 'Apartment for sale RM390,000. Leasehold. 950 sqft. Vincent 0129998888' },
    'Apartment RM390,000 — 99-year lease, 950 sqft. Leasehold. Vincent 0129998888'],
  ['English caption over a Malay guarded listing', { listingType: 'sale', price: 980000,
    rawText: 'Semi-D Green Heights dijual RM980,000. Kawasan berpengawal 24 jam. Hubungi Faizal 0138887777' },
    'Semi-D Green Heights — RM980,000. Gated and guarded community. Faizal 0138887777'],
  ['English caption over a Malay gym listing', { listingType: 'rental', price: 1800,
    rawText: 'Apartment untuk disewa RM1,800 sebulan. Kemudahan: gimnasium, kolam renang. Hubungi Siti 0197778888' },
    'Apartment for rent — RM1,800/month. Gym and swimming pool on site. Siti 0197778888'],
]

describe('the review corpus: cases a second reader wrote without sight of the rules', () => {
  for (const [label, listing, caption] of REVIEW_PASS) {
    it(`publishes: ${label}`, () => {
      expect({ label, invented: captionViolations(caption, listing).invented }).toEqual({ label, invented: [] })
      expect({ label, blocked: blocksThePost(caption, listing) }).toEqual({ label, blocked: false })
    })
  }

  it('reports the review-corpus count', () => {
    const passed = REVIEW_PASS.filter(([, l, c]) => !blocksThePost(c, l)).length
    // eslint-disable-next-line no-console
    console.log(`REVIEW MUST-PASS: ${passed}/${REVIEW_PASS.length}`)
    expect(passed).toBe(REVIEW_PASS.length)
  })
})
