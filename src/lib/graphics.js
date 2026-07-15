// Shared canvas rendering for all branded post assets — the single-image
// "property card" (square/portrait/story) AND the multi-slide carousel.
// Pure canvas, no dependencies, no cost. Used by PropertyGraphic, the carousel,
// and the "Download whole kit" bundler so every asset shares one visual system.
import { formatPrice, listingLabel } from './format.js'

export const SIZES = { square: [1080, 1080], story: [1080, 1920], portrait: [1080, 1350] }

// Render at 2× the logical size for crisp, high-resolution output. All drawing
// code works in the logical 1080-wide space; the context is scaled so the
// actual pixels are doubled (e.g. a square exports at 2160×2160).
export const RENDER_SCALE = 2

// A canvas pre-scaled for high-res output with high-quality image smoothing so
// downscaled photos stay sharp instead of soft.
export function makeCanvas(W, H, scale = RENDER_SCALE) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(W * scale)
  canvas.height = Math.round(H * scale)
  const ctx = canvas.getContext('2d')
  ctx.scale(scale, scale)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return { canvas, ctx }
}

// The branded single-image card as a ready-to-export high-res canvas.
export function renderGraphicCanvas({ listing, brand, format = 'square', photo, logo, scale = RENDER_SCALE }) {
  const [W, H] = SIZES[format] || SIZES.square
  const { canvas, ctx } = makeCanvas(W, H, scale)
  drawCard(ctx, W, H, listing, brand, photo, logo)
  return canvas
}

export function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

export function initials(name) {
  return (name || 'SK').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

export function shade(hex, amt) {
  const n = parseInt((hex || '#2d6a4f').replace('#', ''), 16)
  const c = (v) => Math.max(0, Math.min(255, v))
  return `rgb(${c(((n >> 16) & 255) + amt)},${c(((n >> 8) & 255) + amt)},${c((n & 255) + amt)})`
}

export function coverDraw(ctx, img, x, y, w, h) {
  const ir = img.width / img.height
  const r = w / h
  let sw, sh, sx, sy
  if (ir > r) { sh = img.height; sw = sh * r; sx = (img.width - sw) / 2; sy = 0 }
  else { sw = img.width; sh = sw / r; sx = 0; sy = (img.height - sh) / 2 }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

export function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return }
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function wrapLines(ctx, text, maxW) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const w of words) {
    const t = line ? line + ' ' + w : w
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w } else line = t
  }
  if (line) lines.push(line)
  return lines
}

// ── The single-image branded card (square/portrait/story) ──────────────
export function drawCard(ctx, W, H, listing, brand, photo, logo) {
  const pad = 64
  const color = brand.color || '#2d6a4f'
  ctx.clearRect(0, 0, W, H)

  if (photo) {
    coverDraw(ctx, photo, 0, 0, W, H)
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H)
    g.addColorStop(0, shade(color, 18))
    g.addColorStop(1, shade(color, -46))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }

  const bottom = ctx.createLinearGradient(0, H * 0.42, 0, H)
  bottom.addColorStop(0, 'rgba(0,0,0,0)')
  bottom.addColorStop(1, 'rgba(0,0,0,0.86)')
  ctx.fillStyle = bottom
  ctx.fillRect(0, 0, W, H)
  const top = ctx.createLinearGradient(0, 0, 0, 240)
  top.addColorStop(0, 'rgba(0,0,0,0.35)')
  top.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = top
  ctx.fillRect(0, 0, W, 240)

  const label = listing.listingType === 'rental' ? 'FOR RENT' : 'FOR SALE'
  ctx.font = '700 34px Inter, system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  const bw = ctx.measureText(label).width + 48
  roundRect(ctx, pad, pad, bw, 62, 31)
  ctx.fillStyle = color
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.fillText(label, pad + 24, pad + 33)

  drawBrandBar(ctx, W, H, brand, logo)

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 16
  let y = H - 132 - 46
  const locLine = [listing.propertyType, listing.location].filter(Boolean).join(' · ')
  if (locLine) {
    ctx.font = '500 32px Inter, system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.fillText(locLine, pad, y)
    y -= 54
  }
  const specs = [
    listing.bedrooms != null && `${listing.bedrooms} bed`,
    listing.bathrooms != null && `${listing.bathrooms} bath`,
    listing.sqft != null && `${listing.sqft} sqft`,
  ].filter(Boolean).join('    ')
  if (specs) {
    ctx.font = '600 38px Inter, system-ui, sans-serif'
    ctx.fillStyle = '#fff'
    ctx.fillText(specs, pad, y)
    y -= 88
  }
  ctx.font = '800 100px Inter, system-ui, sans-serif'
  ctx.fillStyle = '#fff'
  ctx.fillText(formatPrice(listing.price, listing.listingType), pad, y)
  ctx.shadowBlur = 0
}

// Shared bottom brand bar (logo/monogram + name + WhatsApp) on a dark strip.
function drawBrandBar(ctx, W, H, brand, logo) {
  const pad = 64
  const color = brand.color || '#2d6a4f'
  const barH = 132
  const by = H - barH
  ctx.fillStyle = 'rgba(0,0,0,0.34)'
  ctx.fillRect(0, by, W, barH)
  const ms = 76
  const mx = pad
  const my = by + (barH - ms) / 2
  if (logo) {
    ctx.save()
    roundRect(ctx, mx, my, ms, ms, 16)
    ctx.clip()
    coverDraw(ctx, logo, mx, my, ms, ms)
    ctx.restore()
  } else {
    ctx.beginPath()
    ctx.arc(mx + ms / 2, my + ms / 2, ms / 2, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = '800 32px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(initials(brand.agency || brand.name), mx + ms / 2, my + ms / 2 + 2)
  }
  const bname = brand.agency || brand.name || 'SideKick Property'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#fff'
  ctx.font = '700 32px Inter, system-ui, sans-serif'
  ctx.fillText(bname, mx + ms + 22, by + barH / 2)
  if (brand.phone) {
    ctx.textAlign = 'right'
    ctx.font = '600 30px Inter, system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.fillText('WhatsApp  ' + brand.phone, W - pad, by + barH / 2)
  }
}

// Page dots at the bottom-centre (which slide you're on).
function pageDots(ctx, W, total, index, y, light = true) {
  const r = 7, gap = 22
  const totalW = total * (r * 2) + (total - 1) * (gap - r * 2)
  let x = (W - totalW) / 2 + r
  for (let i = 0; i < total; i++) {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = i === index
      ? (light ? '#fff' : 'rgba(0,0,0,0.85)')
      : (light ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.28)')
    ctx.fill()
    x += gap
  }
}

// ── Carousel slides (square 1080) ──────────────────────────────────────
// Builds an ordered list of slide "specs" from the listing + its photos.
function slidePlan(listing, photos) {
  const facts = [
    listing.bedrooms != null && { k: 'Bedrooms', v: String(listing.bedrooms) },
    listing.bathrooms != null && { k: 'Bathrooms', v: String(listing.bathrooms) },
    listing.sqft != null && { k: 'Built-up', v: `${Number(listing.sqft).toLocaleString('en-MY')} sq ft` },
    listing.tenure && { k: 'Tenure', v: listing.tenure },
    listing.furnishing && { k: 'Furnishing', v: listing.furnishing },
  ].filter(Boolean)

  const plan = [{ type: 'cover' }]
  const extraPhotos = (photos || []).slice(1, 4) // up to 3 more photos
  extraPhotos.forEach((_, i) => plan.push({ type: 'photo', photoIndex: i + 1, fact: facts[i] || null }))
  plan.push({ type: 'highlights', facts })
  plan.push({ type: 'cta' })
  return plan
}

export function carouselSlideCount(listing, photos) {
  return slidePlan(listing, photos).length
}

function drawScrims(ctx, S) {
  const bottom = ctx.createLinearGradient(0, S * 0.4, 0, S)
  bottom.addColorStop(0, 'rgba(0,0,0,0)')
  bottom.addColorStop(1, 'rgba(0,0,0,0.88)')
  ctx.fillStyle = bottom
  ctx.fillRect(0, 0, S, S)
  const top = ctx.createLinearGradient(0, 0, 0, 220)
  top.addColorStop(0, 'rgba(0,0,0,0.4)')
  top.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = top
  ctx.fillRect(0, 0, S, 220)
}

function drawIndexPill(ctx, S, index, total, color) {
  const pad = 64
  ctx.font = '800 28px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const txt = `${index + 1} / ${total}`
  const w = ctx.measureText(txt).width + 40
  const x = S - pad - w
  roundRect(ctx, x, pad, w, 52, 26)
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.fillText(txt, x + w / 2, pad + 27)
}

export function renderCarousel({ listing, brand, photos, logo }) {
  const S = 1080
  const pad = 64
  const color = brand.color || '#2d6a4f'
  const plan = slidePlan(listing, photos)
  const total = plan.length

  return plan.map((slide, index) => {
    const { canvas: c, ctx } = makeCanvas(S, S)

    if (slide.type === 'cover' || slide.type === 'photo') {
      const photo = photos?.[slide.type === 'cover' ? 0 : slide.photoIndex]
      if (photo) coverDraw(ctx, photo, 0, 0, S, S)
      else {
        const g = ctx.createLinearGradient(0, 0, S, S)
        g.addColorStop(0, shade(color, 18)); g.addColorStop(1, shade(color, -46))
        ctx.fillStyle = g; ctx.fillRect(0, 0, S, S)
      }
      drawScrims(ctx, S)

      if (slide.type === 'cover') {
        const label = listing.listingType === 'rental' ? 'FOR RENT' : 'FOR SALE'
        ctx.font = '700 34px Inter, system-ui, sans-serif'
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
        const bw = ctx.measureText(label).width + 48
        roundRect(ctx, pad, pad, bw, 62, 31); ctx.fillStyle = color; ctx.fill()
        ctx.fillStyle = '#fff'; ctx.fillText(label, pad + 24, pad + 33)

        // Stacked bottom-left: price (hero), specs, then title above.
        // Gaps are baseline-to-baseline; keep them larger than the font's cap
        // height so the big price never crowds the specs line above it.
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
        ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 18
        const priceBaseline = S - 176
        ctx.font = '800 104px Inter, system-ui, sans-serif'; ctx.fillStyle = '#fff'
        ctx.fillText(formatPrice(listing.price, listing.listingType), pad, priceBaseline)
        const specs = [
          listing.bedrooms != null && `${listing.bedrooms} bed`,
          listing.bathrooms != null && `${listing.bathrooms} bath`,
          listing.sqft != null && `${listing.sqft} sqft`,
        ].filter(Boolean).join('    ')
        let sy = priceBaseline - 104
        if (specs) {
          ctx.font = '600 34px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.92)'
          ctx.fillText(specs, pad, sy); sy -= 60
        } else sy -= 10
        ctx.font = '700 44px Inter, system-ui, sans-serif'; ctx.fillStyle = '#fff'
        const title = wrapLines(ctx, listingLabel(listing), S - pad * 2)
        let ty = sy - (title.length - 1) * 52
        for (const line of title) { ctx.fillText(line, pad, ty); ty += 52 }
        ctx.shadowBlur = 0
      } else if (slide.fact) {
        // one clean fact on the photo — sits above the mini-brand bar
        ctx.textAlign = 'left'; ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 16
        ctx.textBaseline = 'alphabetic'
        ctx.font = '600 34px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.9)'
        ctx.fillText(slide.fact.k, pad, S - 250)
        ctx.font = '800 96px Inter, system-ui, sans-serif'; ctx.fillStyle = '#fff'
        ctx.fillText(slide.fact.v, pad, S - 170)
        ctx.shadowBlur = 0
      }
      drawIndexPill(ctx, S, index, total, color)
      pageDots(ctx, S, total, index, S - 40, true)
      drawMiniBrand(ctx, S, brand, logo, '#fff')
    }

    if (slide.type === 'highlights') {
      const g = ctx.createLinearGradient(0, 0, S, S)
      g.addColorStop(0, shade(color, 22)); g.addColorStop(1, shade(color, -54))
      ctx.fillStyle = g; ctx.fillRect(0, 0, S, S)

      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '700 30px Inter, system-ui, sans-serif'
      ctx.fillText('AT A GLANCE', pad, 150)
      ctx.fillStyle = '#fff'; ctx.font = '800 56px Inter, system-ui, sans-serif'
      const heads = wrapLines(ctx, listingLabel(listing), S - pad * 2)
      let hy = 226
      for (const line of heads) { ctx.fillText(line, pad, hy); hy += 64 }

      let y = Math.max(hy + 40, 380)
      const rows = slide.facts.length ? slide.facts : [{ k: 'Location', v: listing.location || '—' }]
      if (listing.location && !rows.find((r) => r.k === 'Location')) rows.push({ k: 'Location', v: listing.location })
      for (const f of rows.slice(0, 6)) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '600 32px Inter, system-ui, sans-serif'
        ctx.fillText(f.k, pad, y)
        ctx.fillStyle = '#fff'; ctx.font = '700 38px Inter, system-ui, sans-serif'
        ctx.textAlign = 'right'; ctx.fillText(f.v, S - pad, y); ctx.textAlign = 'left'
        y += 34
        ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(S - pad, y); ctx.stroke()
        y += 52
      }
      drawIndexPill(ctx, S, index, total, color)
      pageDots(ctx, S, total, index, S - 40, true)
      drawMiniBrand(ctx, S, brand, logo, '#fff')
    }

    if (slide.type === 'cta') {
      const g = ctx.createLinearGradient(0, 0, 0, S)
      g.addColorStop(0, shade(color, 10)); g.addColorStop(1, shade(color, -60))
      ctx.fillStyle = g; ctx.fillRect(0, 0, S, S)

      // logo / monogram, centred
      const ms = 168, mx = (S - ms) / 2, my = 214
      if (logo) {
        ctx.save(); roundRect(ctx, mx, my, ms, ms, 34); ctx.clip()
        ctx.fillStyle = '#fff'; ctx.fillRect(mx, my, ms, ms)
        coverDraw(ctx, logo, mx, my, ms, ms); ctx.restore()
      } else {
        ctx.beginPath(); ctx.arc(S / 2, my + ms / 2, ms / 2, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fill()
        ctx.fillStyle = '#fff'; ctx.font = '800 72px Inter, system-ui, sans-serif'
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(initials(brand.agency || brand.name), S / 2, my + ms / 2 + 4)
      }

      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = '#fff'; ctx.font = '800 60px Inter, system-ui, sans-serif'
      ctx.fillText('Interested?', S / 2, my + ms + 120)
      ctx.font = '500 38px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.9)'
      const sub = wrapLines(ctx, 'Message me to arrange a viewing', S - pad * 3)
      let sy = my + ms + 180
      for (const line of sub) { ctx.fillText(line, S / 2, sy); sy += 50 }

      // contact pill
      const who = brand.name || brand.agency || 'SideKick Property'
      if (brand.phone) {
        ctx.font = '800 40px Inter, system-ui, sans-serif'
        const t = 'WhatsApp  ' + brand.phone
        const w = ctx.measureText(t).width + 72
        const x = (S - w) / 2, py = sy + 44
        roundRect(ctx, x, py, w, 88, 44); ctx.fillStyle = '#fff'; ctx.fill()
        ctx.fillStyle = shade(color, -40); ctx.textBaseline = 'middle'
        ctx.fillText(t, S / 2, py + 46); ctx.textBaseline = 'alphabetic'
        ctx.font = '600 32px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.fillText(who + (brand.agency && brand.name ? ' · ' + brand.agency : ''), S / 2, py + 150)
      } else {
        ctx.font = '700 40px Inter, system-ui, sans-serif'; ctx.fillStyle = '#fff'
        ctx.fillText(who, S / 2, sy + 60)
      }
      pageDots(ctx, S, total, index, S - 40, true)
    }

    return c
  })
}

// small brand mark bottom-left used on photo/highlights slides
function drawMiniBrand(ctx, S, brand, logo, textColor) {
  const pad = 64
  const ms = 52
  const y = S - 108
  if (logo) {
    ctx.save(); roundRect(ctx, pad, y, ms, ms, 12); ctx.clip()
    ctx.fillStyle = '#fff'; ctx.fillRect(pad, y, ms, ms)
    coverDraw(ctx, logo, pad, y, ms, ms); ctx.restore()
  } else {
    ctx.beginPath(); ctx.arc(pad + ms / 2, y + ms / 2, ms / 2, 0, Math.PI * 2)
    ctx.fillStyle = brand.color || '#2d6a4f'; ctx.fill()
    ctx.fillStyle = '#fff'; ctx.font = '800 22px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(initials(brand.agency || brand.name), pad + ms / 2, y + ms / 2 + 1)
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.fillStyle = textColor; ctx.font = '700 30px Inter, system-ui, sans-serif'
  ctx.fillText(brand.agency || brand.name || 'SideKick Property', pad + ms + 18, y + ms / 2 + 1)
  ctx.textBaseline = 'alphabetic'
}
