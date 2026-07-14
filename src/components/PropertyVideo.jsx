import { useRef, useState, useEffect } from 'react'
import { formatPrice, listingLabel } from '../lib/format.js'

// Generates a branded vertical Reel/TikTok video (9:16) from the listing:
// a price-reveal intro, Ken-Burns photo slides with captions, and a contact
// outro — all on-brand. Recorded straight off a canvas with MediaRecorder as
// mp4 where supported (webm fallback). No dependencies, no cost.

const W = 720
const H = 1280
const INTRO = 1500
const SLIDE = 1700
const OUTRO = 1800

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}
function initials(name) { return (name || 'SK').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() }
function shade(hex, amt) {
  const n = parseInt((hex || '#2d6a4f').replace('#', ''), 16)
  const c = (v) => Math.max(0, Math.min(255, v))
  return `rgb(${c(((n >> 16) & 255) + amt)},${c(((n >> 8) & 255) + amt)},${c((n & 255) + amt)})`
}
function coverDraw(ctx, img, x, y, w, h, zoom = 1, panX = 0) {
  const ir = img.width / img.height
  const r = w / h
  let sw, sh, sx, sy
  if (ir > r) { sh = img.height; sw = sh * r; sx = (img.width - sw) / 2; sy = 0 }
  else { sw = img.width; sh = sw / r; sx = 0; sy = (img.height - sh) / 2 }
  sw /= zoom; sh /= zoom
  sx += (img.width - sw) / 2 * panX * 0.0
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}
const easeOut = (t) => 1 - Math.pow(1 - t, 3)

function brandBg(ctx, color) {
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, shade(color, 22))
  g.addColorStop(1, shade(color, -50))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
}
function brandBar(ctx, brand, logo, color) {
  const barH = 96
  const by = H - barH
  ctx.fillStyle = 'rgba(0,0,0,0.32)'
  ctx.fillRect(0, by, W, barH)
  const ms = 56, mx = 40, my = by + (barH - ms) / 2
  if (logo) { ctx.save(); ctx.beginPath(); ctx.arc(mx + ms / 2, my + ms / 2, ms / 2, 0, 7); ctx.clip(); ctx.drawImage(logo, mx, my, ms, ms); ctx.restore() }
  else { ctx.beginPath(); ctx.arc(mx + ms / 2, my + ms / 2, ms / 2, 0, 7); ctx.fillStyle = color; ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = '800 22px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(initials(brand.agency || brand.name), mx + ms / 2, my + ms / 2 + 1) }
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.font = '700 24px Inter, sans-serif'
  ctx.fillText(brand.agency || brand.name || 'SideKick Property', mx + ms + 16, by + barH / 2)
}

function draw(ctx, t, listing, brand, photos, logo, color, scenes) {
  ctx.clearRect(0, 0, W, H)
  const scene = scenes.find((s) => t >= s.start && t < s.end) || scenes[scenes.length - 1]
  const local = (t - scene.start) / (scene.end - scene.start)

  if (scene.type === 'intro' || scene.type === 'outro') {
    brandBg(ctx, color)
    ctx.textAlign = 'center'
    const p = easeOut(Math.min(1, local * 1.6))
    ctx.globalAlpha = p
    if (scene.type === 'intro') {
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = '700 30px Inter, sans-serif'
      ctx.fillText((listing.listingType === 'rental' ? 'FOR RENT' : 'FOR SALE'), W / 2, H / 2 - 120)
      ctx.fillStyle = '#fff'; ctx.font = '800 92px Inter, sans-serif'
      ctx.fillText(formatPrice(listing.price, listing.listingType), W / 2, H / 2 + 10)
      ctx.font = '500 30px Inter, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.fillText([listing.propertyType, listing.location].filter(Boolean).join(' · '), W / 2, H / 2 + 70)
    } else {
      ctx.fillStyle = '#fff'; ctx.font = '800 54px Inter, sans-serif'
      ctx.fillText('Book a viewing', W / 2, H / 2 - 40)
      ctx.font = '600 30px Inter, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.92)'
      if (brand.name || brand.agency) ctx.fillText(brand.name || brand.agency, W / 2, H / 2 + 20)
      if (brand.phone) { ctx.font = '700 34px Inter, sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('WhatsApp ' + brand.phone, W / 2, H / 2 + 74) }
    }
    ctx.globalAlpha = 1
    return
  }

  // Photo slide
  const img = photos[scene.idx]
  if (img) coverDraw(ctx, img, 0, 0, W, H, 1 + local * 0.09)
  else brandBg(ctx, color)
  const scrim = ctx.createLinearGradient(0, H * 0.5, 0, H)
  scrim.addColorStop(0, 'rgba(0,0,0,0)')
  scrim.addColorStop(1, 'rgba(0,0,0,0.85)')
  ctx.fillStyle = scrim; ctx.fillRect(0, 0, W, H)

  const slideIn = easeOut(Math.min(1, local * 2.2))
  ctx.save()
  ctx.translate(0, (1 - slideIn) * 30)
  ctx.globalAlpha = slideIn
  ctx.textAlign = 'left'
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 12
  let y = H - 150
  if (scene.idx === 0) {
    ctx.fillStyle = '#fff'; ctx.font = '800 76px Inter, sans-serif'
    ctx.fillText(formatPrice(listing.price, listing.listingType), 40, y)
    const specs = [listing.bedrooms != null && `${listing.bedrooms} bed`, listing.bathrooms != null && `${listing.bathrooms} bath`, listing.sqft != null && `${listing.sqft} sqft`].filter(Boolean).join('   ')
    ctx.font = '600 30px Inter, sans-serif'; ctx.fillText(specs, 40, y + 46)
  } else {
    ctx.fillStyle = '#fff'; ctx.font = '700 40px Inter, sans-serif'
    ctx.fillText(listingLabel(listing), 40, y + 20)
    ctx.font = '500 28px Inter, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.fillText([listing.propertyType, listing.location].filter(Boolean).join(' · '), 40, y + 60)
  }
  ctx.shadowBlur = 0
  ctx.restore()
  brandBar(ctx, brand, logo, color)
}

export default function PropertyVideo({ listing, brand }) {
  const [status, setStatus] = useState('idle') // idle | rendering | done | error
  const [progress, setProgress] = useState(0)
  const [url, setUrl] = useState(null)
  const [ext, setExt] = useState('mp4')
  const videoRef = useRef(null)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  async function generate() {
    setStatus('rendering'); setProgress(0); setUrl(null)
    try {
      const photos = (await Promise.all((listing.photos || []).slice(0, 4).map(loadImage))).filter(Boolean)
      const logo = await loadImage(brand.logo)
      const color = brand.color || '#2d6a4f'
      const slideCount = photos.length || 2
      const scenes = [{ type: 'intro', start: 0, end: INTRO }]
      let cursor = INTRO
      for (let i = 0; i < slideCount; i++) { scenes.push({ type: 'slide', idx: i, start: cursor, end: cursor + SLIDE }); cursor += SLIDE }
      scenes.push({ type: 'outro', start: cursor, end: cursor + OUTRO })
      const total = cursor + OUTRO

      const canvas = document.createElement('canvas')
      canvas.width = W; canvas.height = H
      const ctx = canvas.getContext('2d')
      const mime = window.MediaRecorder && MediaRecorder.isTypeSupported('video/mp4;codecs=avc1') ? 'video/mp4' : 'video/webm'
      const stream = canvas.captureStream(30)
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 })
      const chunks = []
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      rec.start()

      const start = performance.now()
      // Timer-driven (not requestAnimationFrame) so the render always completes,
      // even if the tab is backgrounded mid-recording (rAF pauses when hidden).
      await new Promise((resolve) => {
        const tick = () => {
          if (!mounted.current) return resolve()
          const t = performance.now() - start
          draw(ctx, Math.min(t, total - 1), listing, brand, photos, logo, color, scenes)
          setProgress(Math.min(1, t / total))
          if (t < total) setTimeout(tick, 33)
          else resolve()
        }
        tick()
      })
      rec.stop()
      await new Promise((r) => { rec.onstop = r })
      if (!mounted.current) return
      const blob = new Blob(chunks, { type: mime })
      setUrl(URL.createObjectURL(blob))
      setExt(mime === 'video/mp4' ? 'mp4' : 'webm')
      setStatus('done')
    } catch {
      if (mounted.current) setStatus('error')
    }
  }

  function download() {
    const a = document.createElement('a')
    a.href = url
    a.download = `${listingLabel(listing).replace(/[^\w]+/g, '-').toLowerCase()}-reel.${ext}`
    document.body.appendChild(a); a.click(); a.remove()
  }

  return (
    <div className="pvid">
      {url ? (
        <video ref={videoRef} className="pvid-player" src={url} controls playsInline autoPlay loop muted />
      ) : (
        <div className="pvid-stage">
          {status === 'rendering' ? (
            <div className="pvid-progress">
              <div className="pvid-spinner" />
              <div className="pvid-progress-label num">{Math.round(progress * 100)}%</div>
              <div className="muted" style={{ fontSize: 12 }}>Recording your Reel…</div>
            </div>
          ) : (
            <div className="pvid-empty">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m10 8 6 4-6 4V8z" /><rect x="3" y="4" width="18" height="16" rx="3" /></svg>
              <span className="muted">A 9:16 Reel for TikTok / Instagram / Status</span>
            </div>
          )}
        </div>
      )}
      <div className="pvid-actions">
        <button className="btn btn-primary btn-sm" onClick={generate} disabled={status === 'rendering'}>
          {status === 'rendering' ? 'Rendering…' : url ? 'Regenerate' : 'Generate video'}
        </button>
        {url && <button className="btn btn-subtle btn-sm" onClick={download}>Download {ext.toUpperCase()}</button>}
      </div>
      {status === 'error' && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Couldn't render the video in this browser. Try Chrome, or generate the graphics instead.</p>}
      <style>{`
        .pvid { display: flex; flex-direction: column; align-items: center; gap: 12px; }
        .pvid-player, .pvid-stage { width: 100%; max-width: 240px; aspect-ratio: 9 / 16; border-radius: 12px; box-shadow: var(--shadow-md); }
        .pvid-player { display: block; background: #000; object-fit: cover; }
        .pvid-stage { background: var(--surface-sunk); border: 1px dashed var(--line-strong); display: grid; place-items: center; }
        .pvid-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--ink-400); padding: 20px; text-align: center; }
        .pvid-empty span { font-size: 12px; max-width: 22ch; }
        .pvid-progress { display: flex; flex-direction: column; align-items: center; gap: 8px; }
        .pvid-progress-label { font-size: 22px; font-weight: 800; color: var(--green-700); }
        @media (prefers-color-scheme: dark) { .pvid-progress-label { color: var(--green-400); } }
        .pvid-spinner { width: 34px; height: 34px; border-radius: 50%; border: 3px solid var(--line); border-top-color: var(--green-600); animation: pvid-spin 0.8s linear infinite; }
        @keyframes pvid-spin { to { transform: rotate(360deg); } }
        .pvid-actions { display: flex; gap: 8px; }
      `}</style>
    </div>
  )
}
