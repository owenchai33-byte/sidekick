// THE SIX THINGS THE ADVERSARIAL REVIEW FOUND.
//
// The fixes for "stop guessing" overshot into "refuses legitimate work" — the
// exact way a class-A fix becomes a class-B bug. Two of them were also
// UNTESTED: the reviewer broke them deliberately and all 866 tests still passed.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { demoParse } from '../../shared/demo.js'
import { transactionTag, isRentalType } from '../../shared/txn.js'
import { formatPrice } from '../../src/lib/format.js'
import { ownershipVerdict } from './tenant.js'

// F1 --------------------------------------------------------------------------
// `rental` was tested before `sale`, and "month" is a rental marker — so
// "For sale … Maintenance fee RM250/month" was typed a RENTAL and priced at the
// MINIMUM figure, RM250. The caption then stated the real RM450,000, the guard
// measured it against RM250, and the post was refused. 4 of 6 realistic
// second-figure listings flipped from publish to refuse.
describe('a second money figure does not capture the listing', () => {
  it.each([
    ['sale + maintenance fee', 'For sale: condo at Kuching city centre. RM450,000. Maintenance fee RM250/month. 3 rooms, 1,100 sqft.', 'sale', 450000],
    ['sale + legal fee', 'Terrace for sale RM320,000. Legal fee RM4,000. 4 bed 3 bath.', 'sale', 320000],
    ['sale + renovation', 'Semi-D for sale RM600,000. Renovation cost RM80,000.', 'sale', 600000],
    ['rent + service charge', 'Shoplot for rent RM3,500/month plus RM300 service charge.', 'rental', 3500],
    ['rent + deposits', 'Condo for rent RM1,200/month. Deposit RM2,400. Utilities RM300.', 'rental', 1200],
    ['rent, price abbreviated', 'Brand New RENNA RESIDENCE for Rent. RM2.5k (nego). 787 sqft.', 'rental', 2500],
    ['Malay, sebulan + deposit', 'Bilik disewa RM800 sebulan. Deposit RM1,600.', 'rental', 800],
    ['Chinese, 月租 + 押金', '公寓出租 月租 RM1,800。押金 RM3,600。', 'rental', 1800],
    ['rental that mentions a sale price', 'Tenanted unit for rent RM1,300/month. Owner may sell at RM338,000.', 'rental', 1300],
  ])('%s', (_n, text, type, price) => {
    const d = demoParse(text)
    expect(d.listingType).toBe(type)
    expect(d.price).toBe(price)
  })
})

// F2 --------------------------------------------------------------------------
// txnLine got an unknown branch; the rule-6 checklist added by the same diff did
// not, so the prompt's FINAL instruction asserted the guess the FACTS block had
// just refused to make. The reviewer's mutation of this survived all 866 tests.
describe('the prompt never asserts a transaction the listing did not state', () => {
  const build = async (listingType) => {
    const { buildContentPrompt } = await import('./prompts.js')
    return buildContentPrompt(
      { rawText: 'Condo at Kuching. RM1,800. 3 rooms, 900 sqft. Call 012-345 6789', price: 1800, location: 'Kuching', listingType },
      ['facebook_page'], ['en'], {}, null, [])
  }

  it('an unknown type produces no SALE claim anywhere, checklist included', async () => {
    const p = await build(null)
    expect(p).toMatch(/NOT STATED/)
    // The exact contradiction: "this listing is a SALE" as the last instruction.
    expect(p).not.toMatch(/because this listing is\s+a SALE/)
    expect(p).not.toMatch(/call to action says SALE/)
  })

  it('and a known type still gets the strong instruction', async () => {
    expect(await build('rental')).toMatch(/call to action says RENT/)
    expect(await build('sale')).toMatch(/call to action says SALE/)
  })
})

// F3 --------------------------------------------------------------------------
// The stranger's photograph was patched on /api/social-post; the app's PRIMARY
// Post button goes to /api/social-broadcast and reached the seed pool through
// coverPhoto(). Same defect, same severity, different endpoint.
describe('no publish route can reach a seed photograph', () => {
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

  it('the broadcast button uses publishCover, and refuses without a real photo', () => {
    const src = read('../../src/pages/ListingDetailPage.jsx')
    expect(src).toMatch(/const cover = publishCover\(listing\)/)
    expect(src).toMatch(/post it with a stock picture/)
    expect(src).not.toMatch(/loadImage\(coverPhoto\(listing\)\)/)
  })

  it('the publish sheet and the download kit use real photos only', () => {
    expect(read('../../src/pages/ListingDetailPage.jsx')).toMatch(/photos=\{publishPhotos\(listing\)\}/)
    expect(read('../../src/lib/kit.js')).toMatch(/publishPhotos\(listing\)/)
    expect(read('../../src/lib/kit.js')).not.toMatch(/listingPhotos\(listing\)/)
  })

  it('and the publish helpers cannot fall back', () => {
    const src = read('../../src/lib/photos.js')
    expect(src).toMatch(/export function publishCover[\s\S]{0,200}realPhotos\(listing\)\[0\] \|\| null/)
    expect(src).toMatch(/export function publishPhotos[\s\S]{0,120}return realPhotos\(listing\)/)
  })
})

// F4 --------------------------------------------------------------------------
// The carousel's cover-slide pill was the one renderer nobody covered: the
// reviewer replaced it with `transactionTag(listing) || 'FOR SALE'` and all 866
// tests still passed.
describe('every renderer agrees the pill can be absent', () => {
  it('no renderer re-adds a FOR SALE default', () => {
    for (const f of ['../../src/lib/graphics.js', '../../src/components/PropertyVideo.jsx', './brandcard.js']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8')
      expect(src, f).not.toMatch(/\|\|\s*'FOR SALE'/)
      expect(src, f).not.toMatch(/\?\s*'FOR RENT'\s*:\s*'FOR SALE'/)
    }
  })

  it('and the shared source of truth never guesses', () => {
    expect(transactionTag({ listingType: null })).toBe('')
    expect(transactionTag({})).toBe('')
    expect(transactionTag({ listingType: 'rental' })).toBe('FOR RENT')
    expect(transactionTag({ listingType: 'sale' })).toBe('FOR SALE')
  })
})

// F5 --------------------------------------------------------------------------
// `skip` + `force:true` ignored ownership entirely, so any holder of the shared
// INGEST_SECRET could discard any tenant's post at any age.
describe('ownership: publishing needs every claim, discarding needs one', () => {
  const rec = { profileId: 'P_OLD', sender: '+60128570000' }

  it('a re-onboarded agent matches on their phone', () => {
    const v = ownershipVerdict({ claimProfile: 'P_NEW', claimSender: '+60128570000', item: rec })
    expect(v.verdict).toBe('match')
    expect(v.strict).toBe(false)     // enough to discard, not to publish
  })

  it('all claims agreeing is what publishing takes', () => {
    const v = ownershipVerdict({ claimProfile: 'P_OLD', claimSender: '+60128570000', item: rec })
    expect(v.verdict).toBe('match')
    expect(v.strict).toBe(true)
  })

  it('a stranger matches neither field', () => {
    const v = ownershipVerdict({ claimProfile: 'P_X', claimSender: '+60111111111', item: rec })
    expect(v.verdict).toBe('mismatch')
  })

  it('and an untagged record behaves exactly as it always did', () => {
    const v = ownershipVerdict({ claimProfile: 'P_NEW', claimSender: '+60128570000', item: {} })
    expect(v.verdict).toBe('unknown')
    expect(v.strict).toBe(true)
  })
})

// F6 --------------------------------------------------------------------------
// transactionTag accepted sewa / 出租 / RENTAL; formatPrice tested
// `=== 'rental'`. A card could print FOR RENT above "RM1,800" — the pill saying
// rental and the figure shaped like an asking price.
describe('the price and the pill read the same field the same way', () => {
  it.each([['rental'], ['sewa'], ['出租'], ['RENTAL'], ['disewa']])('%s keeps /mo', (lt) => {
    expect(transactionTag({ listingType: lt })).toBe('FOR RENT')
    expect(isRentalType(lt)).toBe(true)
    expect(formatPrice(1800, lt)).toBe('RM1,800/mo')
  })

  it.each([['sale'], ['dijual'], ['出售'], [null], [undefined]])('%s does not', (lt) => {
    expect(isRentalType(lt)).toBe(false)
    expect(formatPrice(1800, lt)).toBe('RM1,800')
  })
})
