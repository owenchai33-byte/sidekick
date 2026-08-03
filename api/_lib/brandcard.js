// Server-side branded price-card renderer (Satori via @vercel/og). Turns a
// listing photo into a polished cover: the photo, a gradient scrim, a FOR SALE /
// FOR RENT pill, and the price + location + specs — so the auto-posts look like
// a professional listing card, not a raw phone photo.
//
// No native deps and no network fonts: Inter (OFL) is bundled under _assets and
// read at module load. Callers must treat this as best-effort — on any failure
// the ingest path falls back to the original photos, never dead-ending a post.

import { ImageResponse } from '@vercel/og'
import { createElement as h } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const font700 = readFileSync(fileURLToPath(new URL('../_assets/inter-700.woff', import.meta.url)))
const font800 = readFileSync(fileURLToPath(new URL('../_assets/inter-800.woff', import.meta.url)))

const GREEN = '#34a06b'

function money(l) {
  if (l.price == null) return 'Price on ask'
  const n = Number(l.price).toLocaleString('en-MY')
  return l.listingType === 'rental' ? `RM${n}/mo` : `RM${n}`
}
function specLine(l) {
  const p = []
  if (l.bedrooms != null) p.push(`${l.bedrooms} bed`)
  if (l.bathrooms != null) p.push(`${l.bathrooms} bath`)
  if (l.sqft != null) p.push(`${Number(l.sqft).toLocaleString('en-MY')} sqft`)
  return p.join('   ·   ')
}

/** Render a 1080×1080 branded card PNG. Returns a Buffer, or throws. */
export async function renderBrandCard(photoUrl, listing, brand = {}) {
  const accent = brand.color || process.env.BRAND_COLOR || GREEN
  const brandName = (brand.name || process.env.BRAND_NAME || '').trim()
  const tag = listing.listingType === 'rental' ? 'FOR RENT' : 'FOR SALE'
  const loc = listing.location || 'Kuching'
  const specs = specLine(listing)

  const tree = h('div', { style: { position: 'relative', width: 1080, height: 1080, display: 'flex', backgroundColor: '#0f1a14', fontFamily: 'Inter' } },
    h('img', { src: photoUrl, width: 1080, height: 1080, style: { position: 'absolute', top: 0, left: 0, width: 1080, height: 1080, objectFit: 'cover' } }),
    h('div', { style: { position: 'absolute', left: 0, bottom: 0, width: 1080, height: 640, display: 'flex', backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.5) 42%, rgba(0,0,0,0.92) 100%)' } }),
    h('div', { style: { position: 'absolute', top: 54, left: 56, display: 'flex', paddingTop: 14, paddingBottom: 14, paddingLeft: 30, paddingRight: 30, borderRadius: 999, backgroundColor: accent } },
      h('span', { style: { fontSize: 30, fontWeight: 800, color: '#ffffff', letterSpacing: 3 } }, tag),
    ),
    h('div', { style: { position: 'absolute', left: 56, right: 56, bottom: 68, display: 'flex', flexDirection: 'column' } },
      h('span', { style: { fontSize: 46, fontWeight: 700, color: '#ffffff' } }, loc),
      h('span', { style: { fontSize: 104, fontWeight: 800, color: '#ffffff', lineHeight: 1.05, marginTop: 4 } }, money(listing)),
      specs ? h('span', { style: { fontSize: 34, fontWeight: 700, color: 'rgba(255,255,255,0.9)', marginTop: 16 } }, specs) : null,
      brandName ? h('div', { style: { display: 'flex', marginTop: 28 } },
        h('span', { style: { fontSize: 30, fontWeight: 800, color: accent, letterSpacing: 1 } }, brandName)) : null,
    ),
  )

  const resp = new ImageResponse(tree, {
    width: 1080,
    height: 1080,
    fonts: [
      { name: 'Inter', data: font700, weight: 700, style: 'normal' },
      { name: 'Inter', data: font800, weight: 800, style: 'normal' },
    ],
  })
  return Buffer.from(await resp.arrayBuffer())
}
