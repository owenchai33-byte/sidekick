// Server-side branded POSTER renderer (Satori via @vercel/og).
//
// This used to be a cover: one photo, a gradient, a pill, a price. A paying
// client's verdict on 2026-09-10 was "slapping text on the photo and calling it
// a cover photo", and he was describing the code accurately — it was 83 lines
// and used exactly one of the six photos an agent had just sent.
//
// It is now a composed poster: hero, a strip of the agent's OTHER photos, a
// price band and a contact bar. Everything on it comes from the agent's own
// message. Nothing is generated, nothing is inferred, and every element
// disappears rather than guessing — a poster is the one surface where a wrong
// fact cannot be edited afterwards, because it is baked into a JPEG on someone
// else's page.
//
// WHY SATORI AND NOT AN IMAGE MODEL. The design is the part worth automating;
// the photographs are not. A generated or edited property image invents rooms,
// finishes and views — a fabricated picture of someone else's asset, published
// under a licensed agent's name, which nobody proofreads because pictures do not
// look like claims. Satori composes REAL photos with real type. No native deps
// and no network fonts: Inter (OFL) is bundled under _assets and read at module
// load. Callers must treat this as best-effort — on any failure the ingest path
// falls back to the original photos, never dead-ending a post.
//
// SATORI'S RULES, learned the hard way: flexbox only (no CSS grid), every
// element with more than one child needs an explicit display:flex, and only the
// bundled weights exist. There is no 400, so hierarchy is built from SIZE,
// COLOUR and LETTER-SPACING rather than weight — which is how property posters
// are typeset anyway.
import { ImageResponse } from '@vercel/og'
import { createElement as h } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolvePropertyName } from './postguard.js'

const font700 = readFileSync(fileURLToPath(new URL('../_assets/inter-700.woff', import.meta.url)))
const font800 = readFileSync(fileURLToPath(new URL('../_assets/inter-800.woff', import.meta.url)))

const GREEN = '#34a06b'
const W = 1080, H = 1080
const INK = '#0d1512'

function money(l) {
  if (l.price == null) return 'Price on ask'
  const n = Number(l.price).toLocaleString('en-MY')
  return l.listingType === 'rental' ? `RM${n}` : `RM${n}`
}
// The unit rides UNDER the number, not inside it, so the price reads as one
// figure at poster distance. Only for a stated rental — "/mo" on a listing that
// never said it was a rental is the same invented transaction the templates and
// the price card have both already had to have taken out of them.
export function priceUnit(l) {
  return String(l.listingType || '').toLowerCase() === 'rental' ? 'PER MONTH' : ''
}
/** Spec chips, each omitted when the listing did not give it. */
export function chips(l) {
  const out = []
  if (l.bedrooms != null) out.push([String(l.bedrooms), l.bedrooms === 1 ? 'BED' : 'BEDS'])
  if (l.bathrooms != null) out.push([String(l.bathrooms), l.bathrooms === 1 ? 'BATH' : 'BATHS'])
  if (l.sqft != null) out.push([Number(l.sqft).toLocaleString('en-MY'), 'SQ FT'])
  // LAND is its own line, never folded into built-up — they are different
  // numbers and a buyer prices off the wrong one.
  else if (l.landSqft != null) out.push([Number(l.landSqft).toLocaleString('en-MY'), 'SQ FT LAND'])
  return out.slice(0, 3)
}
/** The agent's own number, from their own message. Never composed. */
export function phoneFrom(listing) {
  const m = String(listing?.rawText || '').match(/\b(01\d[- ]?\d{3}[- ]?\d{4,5})\b/)
  if (!m) return ''
  // Printed the way a Malaysian reads one. An agent writes "0143998011" as
  // often as "014-399 8011", and the unspaced form on a poster is a wall of ten
  // digits that nobody can dial from a photo. Only the SPACING changes - the
  // digits are the agent's own, untouched.
  const d = m[1].replace(/\D/g, '')
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)} ${d.slice(6)}`
    : d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)} ${d.slice(7)}`
      : m[1].trim()
}

/**
 * Render a 1080×1080 branded poster PNG.
 * @param photos a photo URL, or an array of them — the first is the hero and
 *        the next three become the strip. One photo still renders; it just gets
 *        a taller hero instead of an empty band.
 */
export async function renderBrandCard(photos, listing, brand = {}) {
  const urls = (Array.isArray(photos) ? photos : [photos]).filter((u) => typeof u === 'string' && u)
  if (!urls.length) throw new Error('no photo to render')
  const hero = urls[0]
  const strip = urls.slice(1, 4)

  const accent = brand.color || process.env.BRAND_COLOR || GREEN
  const brandName = (brand.name || process.env.BRAND_NAME || '').trim()
  const logo = String(brand.logo || '').trim()

  // NO PILL WHEN THE TRANSACTION IS UNKNOWN. This read `=== 'rental' ? FOR RENT
  // : FOR SALE`, so a listing that never said which was stamped FOR SALE — the
  // same class as the hardcoded Kuching, and in the same place: burned into a
  // JPEG on a client's page, where it cannot be edited or repaired, produced
  // with no model in the loop so no caption guard would ever see it.
  const lt = String(listing.listingType || '').toLowerCase()
  const tag = /rent|sewa|租/.test(lt) ? 'FOR RENT' : (/sale|sell|jual|售/.test(lt) ? 'FOR SALE' : '')
  // NEVER SUBSTITUTE A LOCATION. This said `|| 'Kuching'`, so a Miri, Sibu or
  // Johor property had a Kuching address BURNED INTO THE IMAGE.
  const loc = String(listing.location || '').trim()
  // The building's name, only when it is grounded in the agent's own text —
  // resolvePropertyName is the same resolver the caption contract uses, so the
  // poster and the caption can never disagree about what the place is called.
  let title = ''
  try { title = (resolvePropertyName(listing)?.name || '').trim() } catch { title = '' }
  const spec = chips(listing)
  const phone = phoneFrom(listing)
  const unit = priceUnit(listing)

  // Heights adapt so there is never an empty band: with no second photo the
  // hero simply takes the strip's space.
  const BAR = 116
  const INFO = 232
  const STRIP = strip.length ? 168 : 0
  const HERO = H - STRIP - INFO - BAR

  const px = (n) => n

  const tree = h('div', {
    style: { width: W, height: H, display: 'flex', flexDirection: 'column', backgroundColor: INK, fontFamily: 'Inter' },
  },
    // ---- hero -------------------------------------------------------------
    h('div', { style: { position: 'relative', width: W, height: HERO, display: 'flex' } },
      h('img', { src: hero, width: W, height: HERO, style: { width: W, height: HERO, objectFit: 'cover' } }),
      h('div', { style: { position: 'absolute', left: 0, bottom: 0, width: W, height: Math.round(HERO * 0.62), display: 'flex', backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.35) 45%, rgba(6,12,10,0.93) 100%)' } }),
      tag ? h('div', { style: { position: 'absolute', top: 44, left: 48, display: 'flex', paddingTop: 12, paddingBottom: 12, paddingLeft: 26, paddingRight: 26, borderRadius: 8, backgroundColor: accent } },
        h('span', { style: { fontSize: 26, fontWeight: 800, color: '#ffffff', letterSpacing: 4 } }, tag)) : null,
      logo ? h('div', { style: { position: 'absolute', top: 38, right: 48, display: 'flex', width: 190, height: 90, alignItems: 'center', justifyContent: 'flex-end' } },
        h('img', { src: logo, style: { maxWidth: 190, maxHeight: 90, objectFit: 'contain' } })) : null,
      // Name and area sit ON the photo, which is what makes it read as a poster
      // rather than a photo with a caption bolted underneath.
      (title || loc) ? h('div', { style: { position: 'absolute', left: 48, right: 48, bottom: 36, display: 'flex', flexDirection: 'column' } },
        title ? h('span', { style: { fontSize: 62, fontWeight: 800, color: '#ffffff', lineHeight: 1.06, letterSpacing: -1 } }, title.toUpperCase()) : null,
        loc ? h('span', { style: { fontSize: 32, fontWeight: 700, color: 'rgba(255,255,255,0.82)', letterSpacing: 2, marginTop: title ? 10 : 0 } }, loc.toUpperCase()) : null,
      ) : null,
    ),
    // ---- the agent's other photos ----------------------------------------
    strip.length ? h('div', { style: { width: W, height: STRIP, display: 'flex', flexDirection: 'row' } },
      ...strip.map((u, i) => h('div', {
        key: String(i),
        style: { display: 'flex', width: Math.floor((W - (strip.length - 1) * 6) / strip.length), height: STRIP, marginRight: i === strip.length - 1 ? 0 : 6 },
      }, h('img', { src: u, style: { width: '100%', height: STRIP, objectFit: 'cover' } }))),
    ) : null,
    // ---- price + specs ----------------------------------------------------
    h('div', { style: { width: W, height: INFO, display: 'flex', flexDirection: 'row', alignItems: 'center', paddingLeft: 48, paddingRight: 48, backgroundColor: INK } },
      h('div', { style: { display: 'flex', flexDirection: 'column', flexGrow: 1 } },
        h('span', { style: { fontSize: 84, fontWeight: 800, color: '#ffffff', lineHeight: 1, letterSpacing: -2 } }, money(listing)),
        unit ? h('span', { style: { fontSize: 24, fontWeight: 700, color: accent, letterSpacing: 5, marginTop: 12 } }, unit) : null,
      ),
      spec.length ? h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center' } },
        ...spec.map(([v, k], i) => h('div', {
          key: k,
          style: {
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            marginLeft: i === 0 ? 0 : 20, paddingLeft: 22, paddingRight: 22, paddingTop: 18, paddingBottom: 18,
            borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.07)',
          },
        },
          h('span', { style: { fontSize: 42, fontWeight: 800, color: '#ffffff', lineHeight: 1 } }, v),
          h('span', { style: { fontSize: 19, fontWeight: 700, color: 'rgba(255,255,255,0.55)', letterSpacing: 2, marginTop: 8 } }, k),
        )),
      ) : null,
    ),
    // ---- contact bar ------------------------------------------------------
    h('div', { style: { width: W, height: BAR, display: 'flex', flexDirection: 'row', alignItems: 'center', paddingLeft: 48, paddingRight: 48, backgroundColor: accent } },
      h('span', { style: { fontSize: 30, fontWeight: 800, color: '#ffffff', letterSpacing: 3, flexGrow: 1 } }, (brandName || '').toUpperCase()),
      phone ? h('span', { style: { fontSize: 34, fontWeight: 800, color: '#ffffff', letterSpacing: 1 } }, phone) : null,
    ),
  )

  const resp = new ImageResponse(tree, {
    width: W,
    height: H,
    fonts: [
      { name: 'Inter', data: font700, weight: 700, style: 'normal' },
      { name: 'Inter', data: font800, weight: 800, style: 'normal' },
    ],
  })
  return Buffer.from(await resp.arrayBuffer())
}
