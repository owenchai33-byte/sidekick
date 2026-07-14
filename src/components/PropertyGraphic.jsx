import { useRef, useEffect, useState } from 'react'
import { formatPrice, listingLabel } from '../lib/format.js'

// Generates a branded "property card" graphic on a canvas — the agent's real
// photo (or a brand-colour gradient) with price, specs, a FOR SALE/RENT badge
// and their Brand Kit (logo/monogram + name + WhatsApp). No dependencies, no
// cost — pure canvas. Exports a full-resolution PNG.

const SIZES = { square: [1080, 1080], story: [1080, 1920], portrait: [1080, 1350] }

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function initials(name) {
  return (name || 'SK').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

function shade(hex, amt) {
  const n = parseInt((hex || '#2d6a4f').replace('#', ''), 16)
  const c = (v) => Math.max(0, Math.min(255, v))
  return `rgb(${c(((n >> 16) & 255) + amt)},${c(((n >> 8) & 255) + amt)},${c((n & 255) + amt)})`
}

function coverDraw(ctx, img, x, y, w, h) {
  const ir = img.width / img.height
  const r = w / h
  let sw, sh, sx, sy
  if (ir > r) { sh = img.height; sw = sh * r; sx = (img.width - sw) / 2; sy = 0 }
  else { sw = img.width; sh = sw / r; sx = 0; sy = (img.height - sh) / 2 }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return }
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawCard(ctx, W, H, listing, brand, photo, logo) {
  const pad = 64
  const color = brand.color || '#2d6a4f'
  ctx.clearRect(0, 0, W, H)

  // Background: photo (cover) or brand gradient
  if (photo) {
    coverDraw(ctx, photo, 0, 0, W, H)
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H)
    g.addColorStop(0, shade(color, 18))
    g.addColorStop(1, shade(color, -46))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }

  // Legibility scrims
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

  // Badge (top-left)
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

  // Brand bar (bottom)
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

  // Price / specs / location (bottom-left, stacked upward)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 16
  let y = by - 46
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

export default function PropertyGraphic({ listing, brand, format = 'square' }) {
  const canvasRef = useRef(null)
  const [ready, setReady] = useState(false)
  const key = JSON.stringify([
    listing.id, listing.price, listing.listingType, listing.location, listing.propertyType,
    listing.bedrooms, listing.bathrooms, listing.sqft, listing.photos?.[0]?.slice(0, 60),
    brand.agency, brand.name, brand.phone, brand.color, !!brand.logo, brand.logo?.slice(0, 40), format,
  ])

  useEffect(() => {
    let alive = true
    setReady(false)
    const [W, H] = SIZES[format] || SIZES.square
    Promise.all([loadImage(listing.photos?.[0]), loadImage(brand.logo)]).then(([photo, logo]) => {
      if (!alive) return
      const c = canvasRef.current
      if (!c) return
      c.width = W
      c.height = H
      drawCard(c.getContext('2d'), W, H, listing, brand, photo, logo)
      setReady(true)
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  function download() {
    const url = canvasRef.current.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = `${listingLabel(listing).replace(/[^\w]+/g, '-').toLowerCase()}-${format}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div className={`pg pg-${format}`}>
      <canvas ref={canvasRef} className="pg-canvas" />
      <button className="btn btn-subtle btn-sm pg-dl" onClick={download} disabled={!ready}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
        Download PNG
      </button>
      <style>{`
        .pg { display: flex; flex-direction: column; align-items: center; gap: 10px; }
        .pg-canvas { width: 100%; border-radius: 12px; display: block; box-shadow: var(--shadow-md); background: var(--surface-sunk); }
        .pg-square .pg-canvas { max-width: 320px; }
        .pg-portrait .pg-canvas { max-width: 280px; }
        .pg-story .pg-canvas { max-width: 220px; }
      `}</style>
    </div>
  )
}
