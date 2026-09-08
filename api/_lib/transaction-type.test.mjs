// A RENTAL PUBLISHED AS A SALE.
//
// Live on a client's Facebook page 2026-09-05. The caption for a RM2,500/month
// RENTAL (RENNA RESIDENCE, pending 24d4a759) carried "💰 Selling Price" over
// the monthly figure, a section headed "Why Buy This Property?", and the
// hashtag "#PCMY_Sale". Three statements of the wrong transaction, in one
// caption, on a paying client's page.
//
// Nothing caught it. `grep -c "Selling Price|for sale|Why Buy" postguard.js`
// returned 0 before this change: `listingType` was read in exactly one place in
// the whole guard, and only to ground a monthly rent figure.
//
// The model was obeying its instructions. The agent's trained style begins
// "Copy the EXACT layout, emojis, voice AND SPACING of the example captions
// below on EVERY listing", and BOTH stored examples are SALE listings carrying
// a "💰 Selling Price" heading.
//
// WHAT THIS FILE IS FOR, in one sentence: the rule must catch that caption and
// must never catch a sale that mentions its tenancy. The second half is the
// harder half, and it is why most of the cases below are cases that must
// produce NOTHING.
import { describe, it, expect } from 'vitest'
import { transactionTypeConflicts, captionViolations } from './postguard.js'
import { buildContentPrompt } from './prompts.js'

// ingest.js's blocking rule, copied verbatim (api/ingest.js, writeCaption) so
// these tests measure what actually refuses a post rather than what merely
// appears in a list. `warnings` is deliberately absent from it: a warning
// reaches the repair round and can never refuse a publish.
const blocksThePost = (caption, listing) => {
  const v = captionViolations(caption, listing)
  const blocking = v.missing.filter((m) => /^(?:RM|the below-value hook|property name)\b/i.test(m))
  return v.invented.length > 0 || blocking.length > 0 || v.missing.length > 1
}

const findings = (c, l) => transactionTypeConflicts(c, l)
const blocked = (c, l) => transactionTypeConflicts(c, l).invented.join(' | ')
const warned = (c, l) => transactionTypeConflicts(c, l).warnings.join(' | ')
const nothing = (c, l) => {
  const t = transactionTypeConflicts(c, l)
  return [...t.invented, ...t.warnings]
}

// ---------------------------------------------------------------------------
// THE LISTINGS. RENNA is the real one, from the corpus in postguard.test.mjs.
// ---------------------------------------------------------------------------
const RENNA = {
  listingType: 'rental', propertyName: 'RENNA RESIDENCE', price: 2500,
  location: 'The Northbank', bedrooms: 2, bathrooms: 2, sqft: 787, furnishing: 'Fully Furnished',
  rawText: 'Brand New RENNA RESIDENCE for Rent. The Northbank Kuching. 2 Bed 2 Bath 787 Sqft Fully Furnished 12th Floor RM2.5k nego. Lydia 0143998011',
}

// The published caption. The three lines that made it a false advert —
// "💰 Selling Price", "Why Buy This Property?" and "#PCMY_Sale" — are the
// verbatim strings from the incident; the surrounding template is this agent's
// house format, reconstructed around them.
const RENNA_PUBLISHED = `🏡 RENNA RESIDENCE — The Northbank, Kuching
━━━━━━━━━━━━━━━━━━
💰 Selling Price
RM2,500/month

🛏 2 Bed · 🛁 2 Bath · 📐 787 Sqft
🏢 12th Floor · Fully Furnished

Why Buy This Property?
✅ Brand new, never occupied
✅ Price negotiable

📲 Lydia 0143998011
#PCMY_Sale #KuchingProperty`

// A sale that states its current tenancy: the commonest legitimate
// both-mention in this market, and the one a careless rule destroys.
const TENANTED_SALE = {
  listingType: 'sale', propertyName: 'Riverine Diamond', price: 520000, sqft: 1050,
  rawText: 'Riverine Diamond for sale, asking RM520,000. Currently tenanted at RM1,800/month. 1,050 sq ft, 3 bedrooms 2 bathrooms. Call Jason 0128887766',
}
// A sale with no rent mention anywhere — the sale direction at full strength.
const CLEAN_SALE = {
  listingType: 'sale', propertyName: 'Riverine Diamond', price: 520000, sqft: 1050,
  rawText: 'Riverine Diamond for sale, asking RM520,000. 1,050 sq ft, 3 bedrooms 2 bathrooms. Call Jason 0128887766',
}
const MS_RENTAL = {
  listingType: 'rental', propertyName: 'Sri Anggerik', price: 1200, bedrooms: 3, bathrooms: 2,
  rawText: 'Apartment Sri Anggerik untuk disewa. Sewa RM1,200 sebulan. 3 bilik tidur, 2 bilik air. Hubungi Nurul 0195553333',
}
const MS_SALE = {
  listingType: 'sale', price: 980000, bedrooms: 4, bathrooms: 4,
  rawText: 'Rumah semi-D di Green Heights untuk dijual. RM980,000. 4 bilik tidur 4 bilik air. Hubungi Faizal 0138887777',
}
const ZH_RENTAL = {
  listingType: 'rental', propertyName: 'Riverine Diamond', price: 1800, bedrooms: 2, bathrooms: 2,
  rawText: '古晋 Riverine Diamond 公寓出租\n月租 RM1,800，2房2厕，850平方尺\n联络 王小姐 0128889999',
}
const ZH_TENANTED_SALE = {
  listingType: 'sale', propertyName: 'Tropics City', price: 338000,
  rawText: '古晋 Tropics City 单位出售\n售价 RM338,000（低于市价 RM100,000）\n现租金 RM1,300/月，年租 RM15,600\n回报率 4.62%\n联络 Edward 0183929100',
}

// ---------------------------------------------------------------------------
describe('the incident: a RM2,500/month rental captioned as a sale', () => {
  it('refuses the caption that published', () => {
    expect(blocksThePost(RENNA_PUBLISHED, RENNA)).toBe(true)
  })

  it('names the price heading — RM2,500 is this listing\'s RENT, not a sale price', () => {
    expect(blocked(RENNA_PUBLISHED, RENNA)).toMatch(/Selling Price/i)
    expect(blocked(RENNA_PUBLISHED, RENNA)).toMatch(/RM2,500 is its monthly rent/i)
  })

  it('names the hashtag', () => {
    expect(blocked(RENNA_PUBLISHED, RENNA)).toMatch(/#PCMY_Sale/i)
  })

  it('names the buy CTA', () => {
    expect(blocked(RENNA_PUBLISHED, RENNA)).toMatch(/Why Buy/i)
  })

  it('says each thing once — the repair round is not told to fix one phrase twice', () => {
    const all = findings(RENNA_PUBLISHED, RENNA).invented
    expect(all.length).toBe(new Set(all.map((s) => s.split('—')[0])).size)
  })

  it('clears the same caption once the wording follows the listing', () => {
    const fixed = RENNA_PUBLISHED
      .replace('💰 Selling Price', '💰 Monthly Rent')
      .replace('Why Buy This Property?', 'Why Rent This Property?')
      .replace('#PCMY_Sale', '#PCMY_Rent')
    expect(nothing(fixed, RENNA)).toEqual([])
    expect(blocksThePost(fixed, RENNA)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// THE HALF THAT MATTERS MOST. A caption may legitimately MENTION the other
// transaction. Every case here must produce NO finding at all — not a block,
// not a warning — because each is copy a real agent publishes today.
// ---------------------------------------------------------------------------
describe('legitimate both-mentions: must produce NO finding', () => {
  const CLEAN = [
    ['a sale stating its current tenancy', TENANTED_SALE,
      'Riverine Diamond — RM520,000\nCurrently tenanted at RM1,800/month\n1,050 sq ft · 3 bedrooms · 2 bathrooms\nJason 0128887766'],

    ['a sale labelling the TENANCY figure as rent (not the asking price)', TENANTED_SALE,
      'Riverine Diamond — RM520,000\nMonthly rent RM1,800\n1,050 sq ft\nJason 0128887766'],

    ['an investment line quoting rental yield on a property for sale', TENANTED_SALE,
      'Riverine Diamond — RM520,000\nRental price RM1,800/month — about 4.2% gross yield\nJason 0128887766'],

    ['"Why buy when you can rent?" on a rental — a comparison, not a CTA', RENNA,
      'RENNA RESIDENCE — RM2,500/month\nWhy buy when you can rent?\n787 sqft\nLydia 0143998011'],

    ['"not for sale" on a rental — a negation states the TRUE type', RENNA,
      'RENNA RESIDENCE — RM2,500/month\nThis unit is for rent only, not for sale.\nLydia 0143998011'],

    ['a Chinese tenanted sale writing 租金 and 年租', ZH_TENANTED_SALE,
      'Tropics City 古晋 · 单位出售\n售价 RM338,000（低于市价 RM100,000）\n租金 RM1,300/月，年租 RM15,600\n回报率 4.62%\n联络 Edward 0183929100'],

    ['a mis-parsed listingType — the agent\'s own text says "for sale"',
      { listingType: 'rental', price: 450000, rawText: 'Double storey terrace Batu Kawa for sale. RM450,000. Call Jason 0128887766' },
      'Double Storey Terrace @ Batu Kawa\nFOR SALE\nRM450,000\nJason 0128887766'],

    ['a mis-parsed listingType the other way — the text says "untuk disewa"',
      { listingType: 'sale', price: 1200, rawText: 'Apartment Sri Anggerik untuk disewa. Sewa RM1,200 sebulan. Hubungi Nurul 0195553333' },
      'Sri Anggerik — UNTUK DISEWA\nRM1,200 sebulan\nNurul 0195553333'],

    ['an ordinary rental caption', RENNA,
      'RENNA RESIDENCE — The Northbank, Kuching\nFOR RENT · RM2,500/month (nego)\n2 Bed | 2 Bath | 787 Sqft\nLydia 0143998011'],

    ['an ordinary sale caption', CLEAN_SALE,
      'Riverine Diamond — FOR SALE\nRM520,000\n1,050 sq ft · 3 bedrooms · 2 bathrooms\nJason 0128887766'],

    ['an ordinary Malay rental caption', MS_RENTAL,
      'Sri Anggerik — untuk disewa\nRM1,200 sebulan\n3 bilik tidur | 2 bilik air\nNurul 0195553333'],

    ['an ordinary Chinese rental caption', ZH_RENTAL,
      'Riverine Diamond 古晋 · 公寓出租\n月租 RM1,800｜2房2厕｜850平方尺\n联络 王小姐 0128889999'],

    ['a listing with no listingType at all — an unknown truth cannot be contradicted',
      { price: 2500, rawText: 'Some unit. RM2,500. Call 0143998011' },
      '💰 Selling Price\nRM2,500/month\nWhy buy this property?\n#PCMY_Sale'],

    ['a security deposit on a rental — "purchase" nowhere near it', RENNA,
      'RENNA RESIDENCE — RM2,500/month\nDeposit 2 months + 1 month utility\nLydia 0143998011'],
  ]

  for (const [label, listing, caption] of CLEAN) {
    it(`says nothing: ${label}`, () => {
      expect({ label, found: nothing(caption, listing) }).toEqual({ label, found: [] })
      expect({ label, blocked: blocksThePost(caption, listing) }).toEqual({ label, blocked: false })
    })
  }

  it('says nothing about an empty caption', () => {
    // (it is refused elsewhere, for having none of the listing's facts in it —
    // that is the MISSING walk's job, not this rule's)
    expect(nothing('', RENNA)).toEqual([])
  })

  it('reports how many of these publish clean', () => {
    const clean = CLEAN.filter(([, l, c]) => nothing(c, l).length === 0).length
    // eslint-disable-next-line no-console
    console.log(`TRANSACTION MUST-NOT-FIRE: ${clean}/${CLEAN.length}`)
    expect(clean).toBe(CLEAN.length)
    expect(CLEAN.length).toBeGreaterThanOrEqual(8)
  })
})

// ---------------------------------------------------------------------------
describe('a caption that declares the wrong transaction, in three languages', () => {
  const CAUGHT = [
    ['EN  a sale banner on a rental', RENNA,
      '🏡 FOR SALE\nRENNA RESIDENCE\nRM2,500/month\nLydia 0143998011', /FOR SALE/i],
    ['EN  a sale price heading over the rent', RENNA,
      'RENNA RESIDENCE\n💰 Selling Price\nRM2,500/month\nLydia 0143998011', /Selling Price/i],
    ['EN  a buy CTA on a rental', RENNA,
      'RENNA RESIDENCE — RM2,500/month\nWhy buy this property? Brand new and negotiable.\nLydia 0143998011', /Why buy/i],
    ['EN  a rent banner on a sale', CLEAN_SALE,
      '🏡 FOR RENT\nRiverine Diamond\nRM520,000\nJason 0128887766', /FOR RENT/i],
    ['EN  the ASKING PRICE labelled as a monthly rent', CLEAN_SALE,
      'Riverine Diamond\n💰 Monthly Rent\nRM520,000\n1,050 sq ft\nJason 0128887766', /Monthly Rent/i],
    ['EN  a rent CTA on a sale', CLEAN_SALE,
      'Riverine Diamond — RM520,000\nWhy rent this unit? Move in this month.\nJason 0128887766', /Why rent/i],
    ['EN  "TO LET" on a sale', CLEAN_SALE,
      'TO LET\nRiverine Diamond\nRM520,000\nJason 0128887766', /TO LET/i],

    ['MS  "DIJUAL" on a rental', MS_RENTAL,
      'Sri Anggerik — DIJUAL\nRM1,200 sebulan\n3 bilik tidur\nNurul 0195553333', /DIJUAL/i],
    ['MS  "harga jual" over the monthly rent', MS_RENTAL,
      'Sri Anggerik\nHarga jual\nRM1,200 sebulan\nNurul 0195553333', /harga jual/i],
    ['MS  "DISEWA" on a sale', MS_SALE,
      'Semi-D Green Heights — DISEWA\nRM980,000\n4 bilik tidur\nFaizal 0138887777', /DISEWA/i],

    ['ZH  售价 over the monthly rent', ZH_RENTAL,
      'Riverine Diamond 古晋\n售价 RM1,800\n2房2厕\n联络 王小姐 0128889999', /售价/],
    ['ZH  出售 on a rental', ZH_RENTAL,
      'Riverine Diamond 出售\nRM1,800\n2房2厕\n联络 王小姐 0128889999', /出售/],
    ['ZH  出租 on a sale', { listingType: 'sale', price: 680000, rawText: '古晋三层排屋出售，售价68万，联络陈先生 0126667777' },
      '古晋三层排屋出租\nRM680,000\n联络陈先生 0126667777', /出租/],
  ]

  for (const [label, listing, caption, re] of CAUGHT) {
    it(`refuses: ${label}`, () => {
      expect({ label, hit: re.test(blocked(caption, listing)) }).toEqual({ label, hit: true })
      expect({ label, blocked: blocksThePost(caption, listing) }).toEqual({ label, blocked: true })
    })
  }
})

// ---------------------------------------------------------------------------
describe('the hashtags', () => {
  it('refuses "#..._Sale" on a rental', () => {
    expect(blocked('RENNA RESIDENCE — RM2,500/month\n787 sqft\nLydia 0143998011\n#PCMY_Sale #Kuching', RENNA))
      .toMatch(/#PCMY_Sale/i)
  })

  it('refuses "#..._Rent" on a sale', () => {
    expect(blocked('Riverine Diamond — RM520,000\n1,050 sq ft\nJason 0128887766\n#PCMY_Rent', CLEAN_SALE))
      .toMatch(/#PCMY_Rent/i)
  })

  it('refuses "#ForSale" / "#KuchingForSale" on a rental', () => {
    for (const tag of ['#ForSale', '#KuchingForSale', '#dijual'])
      expect({ tag, hit: blocked(`RENNA RESIDENCE — RM2,500/month\nLydia 0143998011\n${tag}`, RENNA) })
        .toEqual({ tag, hit: expect.stringContaining(tag) })
  })

  it('does not read "#Wholesale" as a sale hashtag — no underscore, no "forsale"', () => {
    expect(nothing('RENNA RESIDENCE — RM2,500/month\nLydia 0143998011\n#Wholesale #Kuching', RENNA)).toEqual([])
  })

  it('leaves the RIGHT hashtag alone in both directions', () => {
    expect(nothing('RENNA RESIDENCE — RM2,500/month\nLydia 0143998011\n#PCMY_Rent', RENNA)).toEqual([])
    expect(nothing('Riverine Diamond — RM520,000\nJason 0128887766\n#PCMY_Sale', CLEAN_SALE)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// WARNINGS. A warning reaches the repair round and can NEVER refuse a post.
// Everything whose reading is genuinely ambiguous lands here on purpose: this
// project has shipped five silent-refusal bugs, and a rule that is right most
// of the time is not good enough to refuse a client's post on its own.
// ---------------------------------------------------------------------------
describe('what only warns, and therefore can never lose a post', () => {
  it('"FOR SALE OR RENT" — a real Malaysian listing type, and in this agent\'s own examples', () => {
    const cases = [
      [RENNA, 'RENNA RESIDENCE — FOR SALE OR RENT\nRM2,500/month\n2 Bed | 2 Bath | 787 Sqft\nLydia 0143998011'],
      [CLEAN_SALE, 'Riverine Diamond — FOR SALE OR RENT\nRM520,000\n1,050 sq ft\nJason 0128887766'],
    ]
    for (const [l, cap] of cases) {
      expect(findings(cap, l).invented).toEqual([])
      expect(warned(cap, l)).toMatch(/both for sale and for rent/i)
      expect(blocksThePost(cap, l)).toBe(false)
    }
  })

  it('a mixed caption that also declares the true type', () => {
    const cap = 'RENNA RESIDENCE — FOR RENT\nRM2,500/month\n2 Bed | 2 Bath | 787 Sqft\nThe owner is also open to a sale of this unit.\nLydia 0143998011'
    expect(findings(cap, RENNA).invented).toEqual([])
    expect(blocksThePost(cap, RENNA)).toBe(false)
  })

  it('an opposite-type declaration buried in prose, not in a heading', () => {
    const cap = 'Riverine Diamond — RM520,000\nThe unit is currently for rent, with vacant possession on completion.\n1,050 sq ft\nJason 0128887766'
    expect(findings(cap, CLEAN_SALE).invented).toEqual([])
    expect(warned(cap, CLEAN_SALE)).toMatch(/for rent/i)
    expect(blocksThePost(cap, CLEAN_SALE)).toBe(false)
  })

  it('"Vacant and ready for rent" on a sale — investor copy, warns, never refuses', () => {
    // 21 letters, short enough to read as a heading, so the label-line test
    // alone would have refused it. TXN_QUALIFIED catches "ready" in front of it.
    const cap = 'Riverine Diamond — RM520,000\nVacant and ready for rent\n1,050 sq ft\nJason 0128887766'
    expect(findings(cap, CLEAN_SALE).invented).toEqual([])
    expect(warned(cap, CLEAN_SALE)).toMatch(/for rent/i)
    expect(blocksThePost(cap, CLEAN_SALE)).toBe(false)
  })

  it('a loose word like "purchase" on a rental', () => {
    const cap = 'RENNA RESIDENCE — RM2,500/month\nNo purchase obligation, viewing anytime.\nLydia 0143998011'
    expect(findings(cap, RENNA).invented).toEqual([])
    expect(blocksThePost(cap, RENNA)).toBe(false)
  })

  it('every warning stays out of `invented`, so ingest.js can never refuse over one', () => {
    const cap = 'RENNA RESIDENCE — FOR SALE OR RENT\nRM2,500/month\nLydia 0143998011'
    const v = captionViolations(cap, RENNA)
    expect(v.invented).toEqual([])
    expect(v.warnings.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
describe('the rule wires into captionViolations without changing its shape', () => {
  it('still returns exactly missing / invented / warnings / marketing', () => {
    expect(Object.keys(captionViolations('x', RENNA)).sort())
      .toEqual(['invented', 'marketing', 'missing', 'warnings'])
  })

  it('puts a transaction contradiction in `invented`, where it blocks', () => {
    const v = captionViolations('🏡 FOR SALE\nRENNA RESIDENCE\nRM2,500/month\nLydia 0143998011', RENNA)
    expect(v.invented.join(' ')).toMatch(/FOR SALE/i)
  })
})

// ---------------------------------------------------------------------------
// THE PROMPT. The guard is the guarantee; this is what stops the model doing it
// in the first place. The style instruction itself must NOT be weakened —
// format matching is the feature agents pay for.
// ---------------------------------------------------------------------------
describe('buildContentPrompt: a style example is a FORMAT, the transaction is a FACT', () => {
  const STYLE = {
    style: 'Copy the EXACT layout, emojis, voice AND SPACING of the example captions below on EVERY listing.',
    examples: ['🏡 TROPICS CITY\n💰 Selling Price\nRM338,000\n\nWhy Buy This Property?\n✅ Below value\n\n#PCMY_Sale'],
  }
  const rentalPrompt = buildContentPrompt(RENNA, ['facebook_page'], ['en'], STYLE, { whatsapp: '60143998011' }, [])
  const salePrompt = buildContentPrompt(CLEAN_SALE, ['facebook_page'], ['en'], STYLE, { whatsapp: '60128887766' }, [])

  it('states the transaction as an instruction, not just a label', () => {
    expect(rentalPrompt).toMatch(/Listing type: RENTAL/)
    expect(rentalPrompt).toMatch(/It is NOT for sale/)
    expect(salePrompt).toMatch(/Listing type: SALE/)
    expect(salePrompt).toMatch(/It is NOT for rent/)
  })

  it('names the exact words the incident used, on the rental side', () => {
    for (const w of ['Selling Price', 'Why Buy', 'Own this', '#..._Sale', '出售', '售价', 'dijual', 'harga jual'])
      expect({ w, present: rentalPrompt.includes(w) }).toEqual({ w, present: true })
  })

  it('protects the tenanted sale rather than banning rent words outright', () => {
    expect(salePrompt).toMatch(/CURRENT TENANCY[\s\S]{0,200}KEEP that figure/)
    expect(salePrompt).toMatch(/gross ROI/)
  })

  it('tells the model a style example is a format and not a transaction', () => {
    expect(rentalPrompt).toMatch(/A STYLE EXAMPLE IS A FORMAT, NOT A FACT/)
    expect(rentalPrompt).toMatch(/not WHETHER IT WAS A SALE OR A RENTAL/)
    // keep the SHAPE, swap the WORDS — the point is not to drop the heading
    expect(rentalPrompt).toMatch(/keep the SHAPE and swap the WORDS/)
  })

  it('does NOT weaken the style instruction — format matching is the product', () => {
    expect(rentalPrompt).toMatch(/THE AGENT'S OWN STYLE — HIGHEST PRIORITY/)
    expect(rentalPrompt).toMatch(/REPRODUCE THAT FORMAT/)
    expect(rentalPrompt).toMatch(/if the style is a rigid template,\nfollow the template/)
    expect(rentalPrompt).toContain(STYLE.examples[0])
    expect(rentalPrompt).toContain(STYLE.style)
  })

  it('says nothing about the example contract when the agent has no examples', () => {
    const bare = buildContentPrompt(RENNA, ['facebook_page'], ['en'], null, {}, [])
    expect(bare).not.toMatch(/A STYLE EXAMPLE IS A FORMAT/)
    expect(bare).toMatch(/Listing type: RENTAL/)
  })
})
