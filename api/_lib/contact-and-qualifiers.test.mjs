// A LINK THAT OPENS, AND A QUALIFIER ON THE RIGHT FIGURE.
//
// Both measured on 2026-09-12, both on live client posts:
//
//   Edward's TikTok caption ended "WhatsApp: https://wa.me/0183929100". His
//   trained rule is "Never show phone number in captions, only show the
//   WhatsApp link", so the model built one out of the number as he writes it.
//   wa.me needs the international form; that link opens nothing. The digits are
//   his, so every provenance check passed it.
//
//   Owen's RENNA caption printed "Comm: 1 month + 8% SST (Negotiable)". His
//   listing says "Rental price: RM2.5k (nego)" — the RENT is negotiable, his
//   commission is not, and he never said it was. Every figure was real and the
//   word was in the source; only its owner had changed.
import { describe, it, expect } from 'vitest'
import { waNumberFrom, waLinkFor, fixWaLinks, movedQualifiers, captionViolations } from './postguard.js'

const EDWARD = { rawText: 'PINES SQUARE SHOPLOT FOR SALE\nRM1,600,000\nLister: Edward\n0183929100' }
const SPACED = { rawText: 'Call me at 014-399 8011 for viewing' }
const INTL = { rawText: 'WhatsApp +60 12-345 6789' }
const NO_PHONE = { rawText: 'Shoplot for sale, RM1,600,000. PM for details.' }

describe("the agent's own number, as a link that opens", () => {
  it('reads a local Malaysian number into the form wa.me needs', () => {
    expect(waNumberFrom(EDWARD)).toBe('60183929100')
    expect(waNumberFrom(SPACED)).toBe('60143998011')
    expect(waNumberFrom(INTL)).toBe('60123456789')
    expect(waLinkFor(EDWARD)).toBe('https://wa.me/60183929100')
  })

  it('builds nothing when the listing gives no number', () => {
    expect(waNumberFrom(NO_PHONE)).toBe('')
    expect(waLinkFor(NO_PHONE)).toBe('')
    expect(fixWaLinks('PM me: https://wa.me/0123456789', NO_PHONE)).toBe('PM me: https://wa.me/0123456789')
  })

  it("repairs Edward's dead link, keeping everything around it", () => {
    const caption = 'PINES SQUARE COMMERCIAL SHOPLOT FOR SALE\n\nRM1,600,000\n\n📲 WhatsApp: https://wa.me/0183929100\n\n#PCMY_Sale'
    expect(fixWaLinks(caption, EDWARD)).toBe(
      'PINES SQUARE COMMERCIAL SHOPLOT FOR SALE\n\nRM1,600,000\n\n📲 WhatsApp: https://wa.me/60183929100\n\n#PCMY_Sale')
  })

  it('leaves a link that already works exactly as it is', () => {
    const ok = 'Message me https://wa.me/60183929100'
    expect(fixWaLinks(ok, EDWARD)).toBe(ok)
  })

  it("never rewrites somebody else's number — that stays an invention to refuse", () => {
    const other = 'https://wa.me/0199999999'
    expect(fixWaLinks(other, EDWARD)).toBe(other)
    expect(captionViolations(`Shoplot RM1,600,000 ${other}`, EDWARD).invented.join(' ')).toMatch(/wa\.me\/0199999999/)
  })

  it('handles the bare and www forms too', () => {
    expect(fixWaLinks('wa.me/0183929100', EDWARD)).toBe('wa.me/60183929100')
    expect(fixWaLinks('https://www.wa.me/0183929100', EDWARD)).toBe('https://www.wa.me/60183929100')
  })
})

const RENNA = { rawText: 'Brand New RENNA RESIDENCE for Rent\n- Rental price: RM2.5k (nego)\nComm: 1 month + 8% SST\nLydia 0143998011' }

describe('a qualifier belongs to the figure it was written on', () => {
  it("catches the commission that became negotiable on its own", () => {
    const out = movedQualifiers('💰 Monthly Rent\n\nRM2,500 /month\n\n📌 Comm: 1 month + 8% SST (Negotiable)', RENNA)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatch(/Comm/)
    expect(out[0]).toMatch(/Rental price/)
  })

  it('it reaches the repair round as marketing, and never blocks the post', () => {
    const v = captionViolations('RENNA RESIDENCE for rent\nRM2,500/month\nComm: 1 month + 8% SST (Negotiable)', RENNA)
    expect(v.marketing.join(' ')).toMatch(/Comm/)
    expect(v.invented).toEqual([])
  })

  it('leaves the rent negotiable where it belongs', () => {
    expect(movedQualifiers('💰 Monthly Rent\n\nRM2,500 /month (nego)\n\n📌 Comm: 1 month + 8% SST', RENNA)).toEqual([])
  })

  it('says nothing when the agent really did negotiate the fee', () => {
    const feeNego = { rawText: 'Shop for rent RM3,500/month\nCommission: 1 month (negotiable)' }
    expect(movedQualifiers('RM3,500/month\nCommission: 1 month (negotiable)', feeNego)).toEqual([])
  })

  it('says nothing when the listing never used the word at all', () => {
    const plain = { rawText: 'Shop for rent RM3,500/month\nCommission: 1 month' }
    expect(movedQualifiers('RM3,500/month\nCommission: 1 month', plain)).toEqual([])
  })
})
