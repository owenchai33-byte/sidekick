// "RM1/month" FOR A RM2,500 UNIT.
//
// Found 2026-09-09 while verifying a deploy. The model parse was unavailable, so
// demoParse ran — the fallback used every time the free tier rate-limits, which
// on this account is several times a day — and it answered price: 1 for Owen's
// RENNA listing.
//
// Every Malaysian rental states its terms in months:
//     Security Deposit: 2 months
//     Advance Rental: 1 month
//     Utilities Deposit: 1 month
//     Comm: 1 month + 8% SST
// Each matches "<figure> month", so all four were collected as candidate rents.
// The real figure, RM2.5k, carries no "/month" and was never a candidate at all.
//
// It matters past the caption: the reel burns the price into the MP4 and the
// feed card draws it, so a wrong number travels into media that outlives the
// text. captionDegraded does block the publish — but a fallback whose job is to
// be the safe answer should not be inventing the most material fact in the ad.
import { describe, it, expect } from 'vitest'
import { demoParse } from './demo.js'

const RENNA = `Brand New RENNA RESIDENCE for Rent

📍The Northbank, Kuching

• 2 Bedrooms | 2 Bathrooms
- Size: 787 Sqft | Fully Furnished
- Level: 12th Floor
- Rental price: RM2.5k (nego)

Deposit & Terms:
• Security Deposit: 2 months
• Advance Rental: 1 month
• Utilities Deposit: 1 month
• Tenancy stamping fee: shared equally

Comm: 1 month + 8% SST
Lydia 0143998011`

describe('a count of months is not a rent', () => {
  it("reads Owen's RENNA listing as RM2,500, not RM1", () => {
    expect(demoParse(RENNA).price).toBe(2500)
  })

  it.each([
    ['commission in months', 'For rent RM2,500. Comm: 1 month + 8% SST', 2500],
    ['security deposit', 'For rent RM1,800\nSecurity Deposit: 2 months', 1800],
    ['advance rental', 'For rent RM3,000\nAdvance Rental: 1 month', 3000],
    ['a label nobody has invented yet', 'For rent RM2,200\nTenancy stamping fee: 1 month', 2200],
    ['every term at once', 'For Rent RM2.5k\nDeposit: 2 months\nAdvance: 1 month\nUtilities: 1 month\nComm: 1 month', 2500],
  ])('%s', (_l, text, want) => {
    // The discriminator is deliberately not a list of labels — a new one turns
    // up in every third listing. It is that a rent is money.
    expect(demoParse(text).price).toBe(want)
  })
})

describe('real rents still parse', () => {
  it.each([
    ['explicit per-month', 'RM2,500/month 2 bedrooms for rent', 2500],
    ['k suffix', 'For rent RM1.2k/month', 1200],
    ['Chinese, deposit larger than rent', '月租 RM1,800 押金 RM3,600 出租', 1800],
    ['rent plus a smaller service charge', 'Shoplot for rent RM3,500/month plus RM300 service charge', 3500],
    ['no per-month marker at all', 'For rent, asking RM1,500', 1500],
  ])('%s', (_l, text, want) => {
    expect(demoParse(text).price).toBe(want)
  })

  it('a sale with a monthly maintenance fee is still a sale at the asking price', () => {
    const r = demoParse('For sale RM450,000. Maintenance fee RM250/month')
    expect(r.listingType).toBe('sale')
    expect(r.price).toBe(450000)
  })

  it('never returns a rent that is obviously a month count', () => {
    for (const text of [RENNA, 'For rent RM1,800\nDeposit 2 months', 'Disewa RM900 sebulan\nDeposit 2 bulan']) {
      const p = demoParse(text).price
      if (p != null) expect(p).toBeGreaterThan(6)
    }
  })
})
