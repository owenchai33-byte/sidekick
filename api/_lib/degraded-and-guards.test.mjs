// FOUR DEFECTS FOUND BY A 12-AGENT DIAGNOSIS, 2026-09-09.
//
// Three of them were in guards added in the previous 48 hours — this codebase's
// documented failure class B, a guard that refuses legitimate work. The fourth
// is the opposite: a gate that let boilerplate through in every language but one.
import { describe, it, expect } from 'vitest'
import { looksLikeDemoCaption, captionViolations } from './postguard.js'
import { propertyTypeStated } from './prompts.js'
import { demoContent, demoParse } from '../../shared/demo.js'

// ---------------------------------------------------------------------------
describe('the demo gate knows every fallback, not just the English one', () => {
  // demoContent builds a fallback for six platforms in three languages. The gate
  // held four phrases and all four came from facebook_page/en. Measured: zh, ms
  // and all three tiktok variants published freely. That matters most on
  // /api/social-broadcast, which publishes a RAW caption with no pendingId — the
  // approve pipeline never sees it, so this is the only thing in the way.
  const LISTINGS = [
    { propertyType: null, listingType: 'rental', price: 2500, location: 'Kuching', bedrooms: 2, bathrooms: 2, sqft: 787 },
    { propertyType: 'Condo', listingType: 'sale', price: 450000, location: 'Kota Samarahan', bedrooms: 3, bathrooms: 2, sqft: 1200 },
    { propertyType: null, listingType: null, price: null, location: null, bedrooms: null, bathrooms: null, sqft: null },
  ]
  const PLATFORMS = ['facebook_page', 'tiktok', 'instagram', 'marketplace', 'mudah', 'portals']

  for (const plat of PLATFORMS) {
    for (const lang of ['en', 'zh', 'ms']) {
      it(`catches ${plat}/${lang}`, () => {
        for (const L of LISTINGS) {
          const c = (demoContent(L, [plat], [lang])[plat] || {})[lang]
          if (c) expect(looksLikeDemoCaption(c), `${plat}/${lang} :: ${c.slice(0, 60)}`).toBe(true)
        }
      })
    }
  }

  it.each([
    ['Owen\'s published RENNA caption', '🏡 RENNA RESIDENCE – FOR RENT\n\n📍 THE NORTHBANK, KUCHING\n\nRM2,500/month (negotiable)\n\nCOMMISSION\n1 month + 8% SST\n\n📲 Lydia 0143998011\n\n#PCMY_Rent'],
    ['Edward\'s Stapok caption', 'Stapok Oaks 23 Residence – Semi-D FOR SALE\n\nRM1,500,000\n\n4 bedrooms • 4 bathrooms\n\n📍 STAPOK\n\n#PCMY_Sale'],
    ['a real Chinese caption', '🏠 古晋 RENNA 公寓出租\n\n月租 RM2,500（可议）\n\n2房2厕 787平方尺\n\n押金两个月\n\n有意请联络 Lydia 0143998011'],
    ['a real Chinese caption with fullwidth spec labels', '🏠 古晋公寓出租\n\n月租：RM2,500\n\n房间：2\n\n私信我了解详情'],
    ['a real Malay caption', 'Rumah teres untuk disewa di Kuching\n\nSewa RM1,800 sebulan\n\n3 bilik tidur 2 bilik air\n\nHubungi Ahmad 016-921 9859'],
    ['a real caption whose price is withheld', 'Bungalow in Kuching. Price on request — DM me. 5 bedrooms, freehold.'],
  ])('does not fire on %s', (_l, caption) => {
    expect(looksLikeDemoCaption(caption)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('an agent\'s own pasted WhatsApp link is not an invention', () => {
  // wa.me/message/ABCD… is WhatsApp's official short-link form and carries no
  // phone number, so a digits-only grounding rule called every one of them
  // invented and refused the agent's real contact line.
  const L = (rawText) => ({ rawText, price: 1800, listingType: 'rental' })

  it('accepts a wa.me/message short link the agent pasted', () => {
    const src = 'For rent RM1,800. https://wa.me/message/ABCD1234EFGH1'
    expect(captionViolations('Contact me https://wa.me/message/ABCD1234EFGH1', L(src)).invented).toEqual([])
  })

  it('accepts a prefilled api.whatsapp link the agent pasted', () => {
    const src = 'For rent RM1,800 https://api.whatsapp.com/send?phone=60169219859&text=Hi'
    expect(captionViolations('https://api.whatsapp.com/send?phone=60169219859&text=Hi', L(src)).invented).toEqual([])
  })

  it('still refuses a link the agent never wrote', () => {
    expect(captionViolations('wa.me/YourNumber', L('For rent RM1,800, no phone given')).invented.length).toBeGreaterThan(0)
    expect(captionViolations('wa.me/60123456789', L('For rent RM1,800, no phone given')).invented.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
describe('a property type the agent wrote in Malay is not stripped', () => {
  // "Apartmen" is the standard Malay spelling and was missing, so the type an
  // agent actually stated was dropped and the caption said "Property".
  it.each(['Apartmen untuk disewa di Kuching', 'Apartments for rent', 'Pangsapuri untuk disewa', 'Kondominium mewah', '公寓出租', '排屋出售'])(
    'recognises %s', (text) => { expect(propertyTypeStated({ rawText: text })).toBe(true) })

  it('still does not let a building name vouch for its own type', () => {
    expect(propertyTypeStated({ rawText: 'THE NORTHBANK residences, Kuching' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('RM520,000 Kuching is not RM520 million', () => {
  // The unit group had no right-hand boundary, so the optional "k" matched the
  // first letter of the next word — and the next word in a Kuching listing is
  // Kuching. 12 of 42 production runs fell back to demoParse on 2026-09-09, and
  // every sale line among them was inflated a thousandfold.
  it.each([
    ['Double storey terrace for sale, RM520,000 Kuching', 520000],
    ['Terrace for sale RM438,000 Kota Samarahan', 438000],
    ['Semi-D RM1,250,000 Kenyalang Park', 1250000],
    ['For rent RM1,800 Kuching city centre', 1800],
    ['For sale RM338,000. Kuching', 338000],
    ['MYR 750,000 Kuching', 750000],
  ])('%s -> %d', (text, want) => { expect(demoParse(text).price).toBe(want) })

  it.each([
    ['For sale RM450k nego', 450000],
    ['RM2.5 juta bungalow', 2500000],
    ['Asking RM 1.2 mil', 1200000],
    ['Harga RM250 ribu', 250000],
    ['RM 88k', 88000],
    ['RM2.5k (nego) for rent', 2500],
  ])('real units still multiply: %s -> %d', (text, want) => { expect(demoParse(text).price).toBe(want) })

  it.each([
    ['rm338,000nego', 338000],
    ['For rent rm1,800sebulan', 1800],
  ])('a glued word does not truncate the number: %s -> %d', (text, want) => {
    // The obvious fix — `(k|juta|mil|jt)?(?![a-z])` — puts the lookahead OUTSIDE
    // the optional group, so a failed match backtracks into the digits and
    // truncates: 338,000 became 33800. The lookahead has to sit inside.
    expect(demoParse(text).price).toBe(want)
  })
})
