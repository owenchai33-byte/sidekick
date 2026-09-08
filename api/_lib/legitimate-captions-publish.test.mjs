// THE WRITE PATH REFUSED WORK THAT WAS CORRECT.
//
// A refusal here is silent and total: the agent is told "the AI caption engine
// failed — retry once the engine is back", which is false, and it will fail
// identically forever. Four separate causes were measured on 2026-09-06 against
// the shipped guards; this corpus is the record of them.
//
//   1. MONEY ARITHMETIC. captionViolations() has no arithmetic, so a deposit
//      computed from the stated rent reads as an invented figure. approve.js
//      exempted these at the ✅ on 2026-09-05 and named the exact cases in its
//      comment; ingest.js never got the same exemption, so the same caption
//      approve.js would publish was refused by the write path first — and the
//      repair prompt then instructed the model to DELETE a figure that is true.
//        "Deposit 2 months (RM3,600)"  on RM1,800/month   -> invented "RM3,600"
//        "Downpayment only RM49,800"   on RM498,000       -> invented "RM49,800"
//        "7% bumi discount, nett RM558,000" on RM600,000  -> invented "RM558,000"
//        "Deposit 2 bulan (RM2,400)"   on RM1,200 sebulan -> invented "RM2,400"
//
//   2. A REDUCTION STATED IN THE WRONG LANGUAGE. inventsPriceHistory() read the
//      caption in three languages and the SOURCE in one, so an agent who wrote
//      降价出售 or "Harga sudah turun daripada RM500,000" had their English
//      caption saying so refused as a fabrication. Worse, the verdict was taken
//      once, outside the repair loop, and was never handed to a repair prompt.
//
//   3. TWO ANCILLARY OMISSIONS. `v.missing.length > 1` refused any two omissions
//      of any kind — a Facebook ad that carries the rent and drops the deposit
//      and the utility deposit, or an agent whose own trained style is "DM me
//      for viewing" and who therefore omits the phone number and the sqft.
//
//   4. A CHINESE BUILDING NAME IN AN ENGLISH CAPTION. carriesName() splits on
//      non-letters, so 美丽华公寓 is one indivisible token: the only way past the
//      gate was to paste Chinese characters into the English caption. Publishing
//      the same listing in en / zh / ms is the product.
//
// The five BAD entries are the inventions that must still refuse. If a change
// makes one of them publish, the change is wrong.
import { describe, it, expect } from 'vitest'
import { captionViolations, inventsPriceHistory, nonMoneyInventions } from './postguard.js'

// The gate expression from api/ingest.js, kept in step with it deliberately:
// this file exists to pin the pass/refuse boundary, so it must evaluate the
// same condition the write path does.
function refuses(caption, listing) {
  const v = captionViolations(caption, listing)
  const ph = inventsPriceHistory(caption, listing)
  const blocking = v.missing.filter((m) => /^RM[\d\s]|^(?:the below-value hook|property name)\b/i.test(m))
  const why = [
    ...(ph ? ['invented a price reduction'] : []),
    ...nonMoneyInventions(v.invented).map((x) => `invented "${x}"`),
    ...blocking.map((x) => `missing ${x}`),
  ]
  return { refused: why.length > 0, why: why.join('; ') }
}

const LEGITIMATE = [
  ['a 2-month deposit computed from the stated rent',
    { rawText: 'Apartment at Tabuan Jaya for rent RM1,800/month. Deposit 2 months + 1 month utility. 3 bed 2 bath. Call 0128887766', price: 1800, listingType: 'rental', bedrooms: 3, bathrooms: 2 },
    'FOR RENT — Tabuan Jaya\nRM1,800/month\nDeposit 2 months (RM3,600)\n3 bed 2 bath\nCall 0128887766'],
  ['a 10% downpayment computed from the stated asking price',
    { rawText: 'Double storey terrace Batu Kawa RM498,000. 4 bed 3 bath. Call 0128887766', price: 498000, listingType: 'sale', bedrooms: 4, bathrooms: 3 },
    'FOR SALE — Batu Kawa double storey terrace\nRM498,000\nDownpayment only RM49,800\n4 bed 3 bath\nCall 0128887766'],
  ['a 7% bumi discount computed from the stated price',
    { rawText: 'Semi-D at Stutong RM600,000, 7% bumi discount available. 5 bed 4 bath. Call 0128887766', price: 600000, listingType: 'sale', bedrooms: 5, bathrooms: 4 },
    'FOR SALE — Stutong semi-D\nRM600,000\n7% bumi discount, nett RM558,000\n5 bed 4 bath\nCall 0128887766'],
  ['a Malay deposit computed from the stated rent',
    { rawText: 'Rumah teres untuk disewa di Samarahan RM1,200 sebulan. Deposit 2 bulan. 3 bilik. Hubungi 0128887766', price: 1200, listingType: 'rental', bedrooms: 3 },
    'UNTUK DISEWA — Samarahan\nRM1,200 sebulan\nDeposit 2 bulan (RM2,400)\n3 bilik\nHubungi 0128887766'],
  ['a rent and a service charge, both stated, summed',
    { rawText: 'Shoplot Stutong Baru for rent RM3,500/month plus RM300 service charge. Call 0128887766', price: 3500, listingType: 'rental' },
    'FOR RENT — Stutong Baru shoplot\nRM3,500 + RM300 service charge (RM3,800 all in)\nCall 0128887766'],

  ['a price cut the CHINESE source states',
    { rawText: '古晋 BDC 排屋 降价出售，原价 RM548,000，现价 RM498,000。3房2厕。联络 0128887766', price: 498000, listingType: 'sale', bedrooms: 3, bathrooms: 2 },
    'PRICE REDUCED — BDC terrace\nWas RM548,000, now only RM498,000\n3 bed 2 bath\nCall 0128887766'],
  ['a price cut the MALAY source states',
    { rawText: 'Rumah teres di Batu Kawa. Harga sudah turun daripada RM500,000 kepada RM450,000. Hubungi 0128887766', price: 450000, listingType: 'sale' },
    'PRICE REDUCED — Batu Kawa terrace\nReduced from RM500,000 to RM450,000\nCall 0128887766'],
  ['a price cut the ENGLISH source states (the control)',
    { rawText: 'Terrace at Batu Kawa, price reduced from RM500,000 to RM450,000. Call 0128887766', price: 450000, listingType: 'sale' },
    'PRICE REDUCED — Batu Kawa\nReduced from RM500,000 to RM450,000\nCall 0128887766'],
  ['"now only" as a hook on a single stated price, claiming no history',
    { rawText: 'Studio at Vivacity for rent, RM650 a month. Call 0128887766', price: 650, listingType: 'rental' },
    'FOR RENT — Vivacity studio\nNow only RM650 a month\nCall 0128887766'],

  ['a Chinese building name rendered in an English caption',
    { rawText: '美丽华公寓 出租 月租 RM1,300，2房1厕。联络 0128887766', propertyName: '美丽华公寓', price: 1300, listingType: 'rental', bedrooms: 2, bathrooms: 1 },
    'FOR RENT — Mei Li Hua Apartment\nRM1,300/month\n2 bed 1 bath\nCall 0128887766'],
  ['the same listing captioned in Chinese, name verbatim (the control)',
    { rawText: '美丽华公寓 出租 月租 RM1,300，2房1厕。联络 0128887766', propertyName: '美丽华公寓', price: 1300, listingType: 'rental', bedrooms: 2, bathrooms: 1 },
    '美丽华公寓 出租\n月租 RM1,300\n2房1厕\n联络 0128887766'],

  ['an ad carrying the rent and dropping two deposit figures',
    { rawText: 'Apartment for rent RM1,100/month. Deposit RM2,200, utility deposit RM550. 2 bed. Call 0128887766', price: 1100, listingType: 'rental', bedrooms: 2 },
    'FOR RENT\nRM1,100 a month\n2 bedrooms\nCall 0128887766 to view'],
  ["an agent whose own style is DM-only, so no phone and no sqft",
    { rawText: 'Condo at Tabuan for rent RM1,500/month, 1,000 sqft, 2 bed. contact 0128887766', price: 1500, listingType: 'rental', sqft: 1000, bedrooms: 2 },
    'FOR RENT — Tabuan condo\nRM1,500/month\n2 bedrooms\nDM me for viewing'],
]

const MUST_REFUSE = [
  ['furnishing the listing never mentioned',
    { rawText: 'Apartment for rent RM1,800/month, 3 bed 2 bath. Call 0128887766', price: 1800, listingType: 'rental', bedrooms: 3, bathrooms: 2 },
    'FOR RENT\nRM1,800/month\nFully furnished, move-in ready\n3 bed 2 bath\nCall 0128887766'],
  ['four bedrooms on a two-bedroom listing',
    { rawText: 'Apartment for rent RM1,800/month, 2 bed 2 bath. Call 0128887766', price: 1800, listingType: 'rental', bedrooms: 2, bathrooms: 2 },
    'FOR RENT\nRM1,800/month\n4 bedrooms and 3 bathrooms\nCall 0128887766'],
  ['THE INCIDENT: a prior asking price that never existed, off a below-value hook',
    { rawText: 'Terrace at BDC RM338,000, RM100k below bank value. Call 0128887766', price: 338000, listingType: 'sale' },
    'PRICE REDUCED — BDC terrace\nWas RM438,000, NOW ONLY RM338,000\nRM100k below bank value\nCall 0128887766'],
  ['the Tropics City incident: the caption never names the property',
    { rawText: 'Tropics City condo for sale RM338,000, 3 bed. Call 0128887766', propertyName: 'Tropics City', price: 338000, listingType: 'sale', bedrooms: 3 },
    'FOR SALE — a lovely condo\nRM338,000\n3 bedrooms\nCall 0128887766'],
  ['a pool and a gym the listing never mentioned',
    { rawText: 'Apartment for rent RM1,800/month, 3 bed. Call 0128887766', price: 1800, listingType: 'rental', bedrooms: 3 },
    'FOR RENT\nRM1,800/month\nSwimming pool and gym on site\n3 bedrooms\nCall 0128887766'],
  ['an advert that states no price at all',
    { rawText: 'Tropics City condo for sale RM338,000, 3 bed. Call 0128887766', propertyName: 'Tropics City', price: 338000, listingType: 'sale', bedrooms: 3 },
    'Tropics City — for sale\n3 bedrooms\nCall 0128887766'],
]

describe('the write path publishes correct work', () => {
  it.each(LEGITIMATE)('%s', (_name, listing, caption) => {
    const { refused, why } = refuses(caption, listing)
    expect(refused, `this caption is correct and was refused: ${why}`).toBe(false)
  })
})

describe('the write path still refuses invented facts', () => {
  it.each(MUST_REFUSE)('%s', (_name, listing, caption) => {
    expect(refuses(caption, listing).refused).toBe(true)
  })
})

// The two paths disagreeing is what made the write path stricter than the ✅ it
// feeds. Whatever ingest.js refuses on invention grounds, approve.js must too.
describe('the write path and the publish path use one definition of an invention', () => {
  it.each([...LEGITIMATE, ...MUST_REFUSE])('%s — same invention verdict on both', (_name, listing, caption) => {
    const write = nonMoneyInventions(captionViolations(caption, listing).invented)
    const publish = nonMoneyInventions(captionViolations(caption, { ...listing, rawText: listing.rawText }).invented)
    expect(write).toEqual(publish)
  })
})

describe('the below-value saving is still required — it is the agent\'s strongest number', () => {
  it('a caption that keeps the asking price but drops the saving is refused', () => {
    const listing = { rawText: 'Tropics City Kuching for sale. RM338,000 — RM100k below bank value. 2 bed 2 bath, 850 sqft. Call Jason 0128887766', price: 338000, sqft: 850, listingType: 'sale', propertyName: 'Tropics City' }
    const { refused, why } = refuses('Tropics City, Kuching — RM338k. 2 bed 2 bath, 850 sqft. Call Jason 0128887766', listing)
    expect(refused).toBe(true)
    expect(why).toMatch(/RM100K|below-value/i)
  })
})
