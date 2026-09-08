// A TOWN THE LISTING DID NOT NAME MUST NOT APPEAR ON A CLIENT'S ADVERT.
//
// `listing.location || 'Kuching'` was removed from the reel script, the TikTok
// title and the price card on 2026-09-04/05. It survived in four more places,
// and one of them is worse than any of the originals because it fires when the
// location IS known, so it is guaranteed to contradict the listing for every
// property outside Kuching:
//
//   PropertyVideo.jsx:136   { big: listing.location, small: 'Kuching, Sarawak' }
//     measured 2026-09-06 -> reel frame ["Kota Kinabalu","KUCHING, SARAWAK"]
//     Kota Kinabalu is in Sabah, and this is burned into the encoded MP4.
//   shared/demo.js          20 x `|| 'Kuching'` / `|| '古晋'`, plus prose and
//     hashtags that named the town whatever the listing said:
//     measured -> "古晋Miri这间公寓只要 RM1,800/month" for a Miri listing.
//   PostPreview.jsx:96      "📍 {location || 'Kuching'}, Sarawak"
//     measured -> "📍 Johor Bahru, Sarawak"
//   prompts.js (OCR)        "an estate agent in Kuching, Sarawak sent:"
//
// These drive the REAL renderers and the REAL template generator.
import { describe, it, expect } from 'vitest'
import { buildBeats, statScene } from '../../src/components/PropertyVideo.jsx'
import { demoContent } from '../../shared/demo.js'
import { buildReadListingPrompt } from './prompts.js'

function recordingCtx() {
  const text = []
  const noop = () => {}
  return {
    text,
    save: noop, restore: noop, translate: noop, scale: noop, clip: noop, beginPath: noop,
    closePath: noop, moveTo: noop, lineTo: noop, arc: noop, arcTo: noop, quadraticCurveTo: noop,
    fill: noop, stroke: noop, fillRect: noop, clearRect: noop, drawImage: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    measureText: (s) => ({ width: String(s).length * 14 }),
    fillText: (s) => { text.push(String(s)) },
    font: '', fillStyle: '', textAlign: 'left', textBaseline: 'alphabetic',
    globalAlpha: 1, shadowColor: '', shadowBlur: 0, letterSpacing: '',
  }
}

// Real Malaysian towns outside Kuching, and one outside Sarawak entirely.
const ELSEWHERE = ['Miri', 'Sibu', 'Bintulu', 'Johor Bahru', 'Kota Kinabalu', 'Petaling Jaya']

describe('the reel states the town the listing gave, and no other', () => {
  it.each(ELSEWHERE)('a %s listing does not have "Kuching, Sarawak" under it', (location) => {
    const { beats } = buildBeats({ location, price: 1800 }, [])
    const stat = beats.find((b) => b.kind === 'stat' && b.big === location)
    expect(stat, 'the location beat is still rendered').toBeTruthy()
    const ctx = recordingCtx()
    statScene(ctx, stat, { listing: { location } }, '#fff', () => ({ y: 0, a: 1, s: 1 }))
    expect(ctx.text).toContain(location)
    expect(ctx.text.join(' ')).not.toMatch(/kuching/i)
    expect(ctx.text.join(' ')).not.toMatch(/sarawak/i)
  })
})

describe('the fallback captions never name a town the listing did not', () => {
  const PLATFORMS = ['facebook_page', 'marketplace', 'mudah', 'portals', 'tiktok', 'instagram']
  const LANGS = ['en', 'zh', 'ms']
  // The words that were hardcoded, in every script they were hardcoded in.
  const INVENTED = /Kuching|古晋|Sarawak|砂拉越/i

  it.each(ELSEWHERE)('a %s listing carries no Kuching/Sarawak in any of the 18 captions', (location) => {
    const content = demoContent({ propertyType: 'Apartment', location, bedrooms: 3, price: 1800, listingType: 'rental' }, PLATFORMS, LANGS)
    for (const p of PLATFORMS) {
      for (const lang of LANGS) {
        const cap = content[p][lang]
        expect(cap, `${p}/${lang}`).toBeTruthy()
        expect(cap, `${p}/${lang} names a town the listing did not`).not.toMatch(INVENTED)
        // and it still says where the property IS
        expect(cap, `${p}/${lang} dropped the real location`).toContain(location)
      }
    }
  })

  it('a listing with NO location names no town at all', () => {
    const content = demoContent({ propertyType: 'Apartment', bedrooms: 3, price: 1800, listingType: 'rental' }, PLATFORMS, LANGS)
    for (const p of PLATFORMS) {
      for (const lang of LANGS) {
        expect(content[p][lang], `${p}/${lang}`).not.toMatch(INVENTED)
      }
    }
  })

  it('a genuine Kuching listing still says Kuching', () => {
    const content = demoContent({ propertyType: 'Apartment', location: 'Kuching', bedrooms: 3, price: 1800, listingType: 'rental' }, PLATFORMS, ['en'])
    expect(content.facebook_page.en).toContain('Kuching')
  })
})

describe('the OCR prompt states no region', () => {
  it('does not tell the model the agent is in Kuching, Sarawak', () => {
    const p = buildReadListingPrompt(3)
    expect(p).not.toMatch(/Kuching/i)
    expect(p).not.toMatch(/Sarawak/i)
    // the hard rule it would have contradicted is still there
    expect(p).toContain('no area name')
  })
})
