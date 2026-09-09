// THE FALLBACK MADE CLAIMS NOBODY GAVE IT.
//
// demo.js runs whenever the model is unavailable — a good part of the afternoon
// on the free tier, 12 of 42 production runs on 2026-09-09. Its whole job is to
// be the SAFE answer, so a claim invented here is worse than one invented
// anywhere else in the system: there is no model downstream to catch it and no
// repair round to argue it back out.
//
// Three it made, all removed:
//   - "ready for its next OWNER" printed for a RENTAL. A tenant does not become
//     the owner. The Malay half said it harder: "tuan baharu", a new master.
//   - "— great value for the area" appended to every non-sale caption. That is a
//     market judgement about someone else's property, and no listing this system
//     has received ever contained it.
//   - 地点优越 / 地点方便，生活机能齐全 / lokasi memang best / 交通便利, asserted even
//     when location was null — a claim about the quality of a place nobody named.
//
// The last one is why api/_lib/postguard.js's DEMO_MARKERS had to be rebuilt in
// the same commit: those sentences WERE the markers for six templates, so
// deleting them let the boilerplate publish. Markers now key on scaffolding that
// does not depend on any field being known.
import { describe, it, expect } from 'vitest'
import { demoContent } from './demo.js'
import { looksLikeDemoCaption } from '../api/_lib/postguard.js'

const PLATFORMS = ['facebook_page', 'tiktok', 'instagram', 'marketplace', 'mudah', 'portals']
const LANGS = ['en', 'zh', 'ms']
const PLACE_CLAIM = /地点优越|地点方便|生活机能齐全|lokasi memang best|地点超方便|交通便利|邻近各项生活设施|Well-located|Lokasi strategik|convenient access to local amenities|akses mudah ke kemudahan/i

describe('no claim about a place nobody named', () => {
  for (const plat of PLATFORMS) {
    for (const lang of LANGS) {
      it(`${plat}/${lang} says nothing about the location when there is none`, () => {
        for (const lt of ['rental', 'sale', null]) {
          const c = (demoContent({ listingType: lt, price: 2500, location: null, bedrooms: 2, bathrooms: 2, sqft: 787, propertyType: 'Condo' }, [plat], [lang])[plat] || {})[lang]
          if (c) expect(c, `${plat}/${lang}/${lt}`).not.toMatch(PLACE_CLAIM)
        }
      })
    }
  }

  it('and says it again as soon as there IS a location', () => {
    // Removing a guess must not remove a fact.
    for (const [plat, lang] of [['facebook_page', 'zh'], ['mudah', 'zh'], ['portals', 'zh'], ['tiktok', 'zh'], ['tiktok', 'ms'], ['mudah', 'en'], ['portals', 'en']]) {
      const c = (demoContent({ listingType: 'rental', price: 2500, location: 'Kuching', bedrooms: 2, propertyType: 'Condo' }, [plat], [lang])[plat] || {})[lang]
      expect(c, `${plat}/${lang}`).toMatch(PLACE_CLAIM)
    }
  })
})

describe('no owner for a rental, and no valuation at all', () => {
  it('a rental is ready for its next TENANT', () => {
    const c = demoContent({ listingType: 'rental', price: 2500, location: 'Kuching', bedrooms: 2, propertyType: 'Condo' }, ['facebook_page'], ['en']).facebook_page.en
    expect(c).toMatch(/next tenant/)
    expect(c).not.toMatch(/next owner/)
  })

  it('a sale still says owner', () => {
    const c = demoContent({ listingType: 'sale', price: 450000, location: 'Kuching', bedrooms: 3, propertyType: 'Terrace' }, ['facebook_page'], ['en']).facebook_page.en
    expect(c).toMatch(/next owner/)
  })

  it('an unstated transaction claims neither', () => {
    const c = demoContent({ listingType: null, price: 450000, location: 'Kuching', bedrooms: 3, propertyType: 'Terrace' }, ['facebook_page'], ['en']).facebook_page.en
    expect(c).not.toMatch(/next owner|next tenant/)
    expect(c).toMatch(/available now/)
  })

  it('the Malay half follows the same rule', () => {
    const rent = demoContent({ listingType: 'rental', price: 2500, location: 'Kuching', bedrooms: 2, propertyType: 'Condo' }, ['facebook_page'], ['ms']).facebook_page.ms
    expect(rent).toMatch(/penyewa baharu/)
    expect(rent).not.toMatch(/tuan baharu/)
  })

  it('never values the property for the agent', () => {
    for (const lt of ['rental', 'sale', null]) {
      const c = demoContent({ listingType: lt, price: 2500, location: 'Kuching', bedrooms: 2, propertyType: 'Condo' }, ['facebook_page'], ['en']).facebook_page.en
      expect(c, String(lt)).not.toMatch(/great value|good value|bargain|below market/i)
    }
  })
})

describe('the demo gate still catches every template it just changed', () => {
  // Deleting the location sentences deleted six templates' markers along with
  // them. This is the half that keeps that from happening silently.
  const BASES = [
    { price: 450000, location: 'Kuching', bedrooms: 3, bathrooms: 2, sqft: 1200, propertyType: 'Terrace' },
    { price: 2500, location: null, bedrooms: 2, bathrooms: 2, sqft: 787, propertyType: 'Condo' },
    { price: null, location: null, bedrooms: null, bathrooms: null, sqft: null, propertyType: null },
    { price: 1800, location: 'Batu Kawa', bedrooms: null, bathrooms: null, sqft: null, propertyType: null },
  ]
  for (const plat of PLATFORMS) {
    for (const lang of LANGS) {
      it(`catches ${plat}/${lang} in every field and transaction combination`, () => {
        for (const lt of ['rental', 'sale', null]) {
          for (const base of BASES) {
            const c = (demoContent({ ...base, listingType: lt }, [plat], [lang])[plat] || {})[lang]
            if (c) expect(looksLikeDemoCaption(c), `${plat}/${lang}/${lt} :: ${c.slice(0, 60)}`).toBe(true)
          }
        }
      })
    }
  }

  it.each([
    ['a label-styled English caption', 'Double storey terrace, Batu Kawa\n\nAsking: RM520,000\n\nBedrooms: 4\n\nWhatsApp 016-921 9859 to arrange a viewing'],
    ['a label-styled Malay caption', 'Rumah teres di Kuching\n\nHarga: RM520,000\n\nBilik tidur: 3\n\nHubungi Ahmad 016-921 9859'],
    ['a label-styled Chinese caption', '🏠 古晋公寓出租\n\n月租：RM2,500\n\n房间：2\n\n私信我了解详情'],
    ['a pipe-styled caption', 'RM520,000 | Double storey terrace, Batu Kawa\n4 bedrooms, freehold\nWhatsApp 016-921 9859'],
    ['one that says "available now"', 'Condo in Kuching is available now. RM2,500/month. WhatsApp me to view.'],
    ['one that says "kini tersedia"', 'Rumah teres di Kuching kini tersedia. Sewa RM1,800 sebulan. Hubungi Ahmad.'],
  ])('does not refuse %s', (_l, caption) => {
    // The markers now include label scaffolding, which is closer to real agent
    // copy than the old sentences were. Two are still required to fire.
    expect(looksLikeDemoCaption(caption)).toBe(false)
  })
})
