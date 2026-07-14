import { useRef, useState, useEffect } from 'react'
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { formatPrice, listingLabel } from '../lib/format.js'

const FPS = 30
async function pickCodec() {
  if (typeof VideoEncoder === 'undefined') return null
  for (const codec of ['avc1.42001f', 'avc1.42E01F', 'avc1.4d0028', 'avc1.640028']) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec, width: OUT_W, height: OUT_H, bitrate: 5_000_000, framerate: FPS })
      if (s.supported) return codec
    } catch { /* try next */ }
  }
  return null
}

// Generates a premium, branded vertical Reel (9:16) from the listing:
// a cinematic price-reveal intro, crossfading Ken-Burns photo slides with
// per-slide feature captions, and a contact outro. Recorded off a canvas with
// MediaRecorder — mp4 where supported, webm fallback. No deps, no cost, offline.

// Logical drawing space (all coords below use these); the canvas backing store
// is smaller (OUT_W/OUT_H) and the context is scaled — lighter to encode and
// far more reliable to capture in real time on phones.
const W = 1080
const H = 1920
const OUT_W = 720
const OUT_H = 1280
const INTRO = 2000
const SLIDE = 1900
const OUTRO = 2200
const TR = 550 // crossfade overlap
const MAX_PHOTOS = 6

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const lerp = (a, b, t) => a + (b - a) * t
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOut = (t) => 1 - Math.pow(1 - t, 3)
function initials(name) { return (name || 'SK').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() }
function shade(hex, amt) {
  const n = parseInt((hex || '#2d6a4f').replace('#', ''), 16)
  const c = (v) => Math.max(0, Math.min(255, v))
  return `rgb(${c(((n >> 16) & 255) + amt)},${c(((n >> 8) & 255) + amt)},${c((n & 255) + amt)})`
}
// Cover-fit draw with zoom + normalised pan (-1..1) for the Ken Burns effect.
function coverDraw(ctx, img, zoom, panX, panY) {
  const ir = img.width / img.height
  const r = W / H
  let sw, sh
  if (ir > r) { sh = img.height; sw = sh * r } else { sw = img.width; sh = sw / r }
  sw /= zoom; sh /= zoom
  const maxX = img.width - sw
  const maxY = img.height - sh
  let sx = maxX * (0.5 + panX * 0.5)
  let sy = maxY * (0.5 + panY * 0.5)
  sx = clamp(sx, 0, maxX); sy = clamp(sy, 0, maxY)
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H)
}
function scrim(ctx, from, strength) {
  const g = ctx.createLinearGradient(0, H * from, 0, H)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, `rgba(0,0,0,${strength})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
}
function brandGradient(ctx, color) {
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, shade(color, 26))
  g.addColorStop(1, shade(color, -54))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
}
function brandBar(ctx, brand, logo, color) {
  const barH = 130
  const by = H - barH
  ctx.fillStyle = 'rgba(0,0,0,0.28)'
  ctx.fillRect(0, by, W, barH)
  const ms = 76, mx = 56, my = by + (barH - ms) / 2
  if (logo) { ctx.save(); ctx.beginPath(); ctx.arc(mx + ms / 2, my + ms / 2, ms / 2, 0, 7); ctx.clip(); ctx.drawImage(logo, mx, my, ms, ms); ctx.restore() }
  else { ctx.beginPath(); ctx.arc(mx + ms / 2, my + ms / 2, ms / 2, 0, 7); ctx.fillStyle = color; ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = '800 30px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(initials(brand.agency || brand.name), mx + ms / 2, my + ms / 2 + 1) }
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.font = '700 34px Inter, sans-serif'
  ctx.fillText(brand.agency || brand.name || 'SideKick Property', mx + ms + 22, by + barH / 2)
}
function revealText(ctx, text, x, y, font, fill, p, align = 'left') {
  const e = easeOut(clamp(p))
  ctx.save()
  ctx.globalAlpha = e
  ctx.translate(0, (1 - e) * 26)
  ctx.font = font; ctx.fillStyle = fill; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 20
  ctx.fillText(text, x, y)
  ctx.restore()
}

function drawScene(ctx, scene, p, ctxData) {
  const { listing, brand, photos, logo, color, facts } = ctxData
  ctx.clearRect(0, 0, W, H)

  if (scene.type === 'intro') {
    if (photos[0]) { coverDraw(ctx, photos[0], lerp(1.06, 1.14, easeInOut(p)), lerp(-0.15, 0.15, p), 0); scrim(ctx, 0.0, 0.6) }
    else brandGradient(ctx, color)
    ctx.textAlign = 'center'
    revealText(ctx, listing.listingType === 'rental' ? 'FOR RENT' : 'FOR SALE', W / 2, H / 2 - 150, '700 42px Inter, sans-serif', 'rgba(255,255,255,0.92)', p * 2, 'center')
    revealText(ctx, formatPrice(listing.price, listing.listingType), W / 2, H / 2 + 10, '800 132px Inter, sans-serif', '#fff', p * 2 - 0.25, 'center')
    revealText(ctx, [listing.propertyType, listing.location].filter(Boolean).join(' · '), W / 2, H / 2 + 90, '500 42px Inter, sans-serif', 'rgba(255,255,255,0.92)', p * 2 - 0.5, 'center')
    return
  }
  if (scene.type === 'outro') {
    if (photos[photos.length - 1]) { coverDraw(ctx, photos[photos.length - 1], lerp(1.12, 1.04, easeInOut(p)), 0, 0); scrim(ctx, 0.0, 0.72) }
    else brandGradient(ctx, color)
    ctx.textAlign = 'center'
    revealText(ctx, 'Book a viewing', W / 2, H / 2 - 40, '800 78px Inter, sans-serif', '#fff', p * 2, 'center')
    if (brand.name || brand.agency) revealText(ctx, brand.name || brand.agency, W / 2, H / 2 + 34, '600 44px Inter, sans-serif', 'rgba(255,255,255,0.95)', p * 2 - 0.3, 'center')
    if (brand.phone) revealText(ctx, 'WhatsApp ' + brand.phone, W / 2, H / 2 + 108, '700 48px Inter, sans-serif', '#fff', p * 2 - 0.5, 'center')
    return
  }

  // Photo / feature slide
  const img = photos[scene.idx]
  const dir = scene.idx % 2 === 0 ? 1 : -1
  if (img) coverDraw(ctx, img, lerp(1.04, 1.16, easeInOut(p)), lerp(-0.28 * dir, 0.28 * dir, p), lerp(-0.1, 0.1, p))
  else brandGradient(ctx, color)
  scrim(ctx, 0.45, 0.86)
  const rp = p * 2.4 // text reveals early in the slide
  if (scene.idx === 0) {
    revealText(ctx, formatPrice(listing.price, listing.listingType), 56, H - 190, '800 108px Inter, sans-serif', '#fff', rp)
    const specs = [listing.bedrooms != null && `${listing.bedrooms} bed`, listing.bathrooms != null && `${listing.bathrooms} bath`, listing.sqft != null && `${listing.sqft} sqft`].filter(Boolean).join('   ')
    revealText(ctx, specs, 56, H - 150 + 12, '600 42px Inter, sans-serif', 'rgba(255,255,255,0.95)', rp - 0.2)
  } else {
    const fact = facts[(scene.idx - 1) % facts.length]
    revealText(ctx, fact.big, 56, H - 190, '800 92px Inter, sans-serif', '#fff', rp)
    if (fact.sub) revealText(ctx, fact.sub, 56, H - 150 + 12, '500 40px Inter, sans-serif', 'rgba(255,255,255,0.9)', rp - 0.2)
  }
  brandBar(ctx, brand, logo, color)
}

function render(ctx, t, scenes, ctxData) {
  const active = scenes.filter((s) => t >= s.start && t < s.end)
  if (active.length === 0) { drawScene(ctx, scenes[scenes.length - 1], 1, ctxData); return }
  const base = active[0]
  drawScene(ctx, base, clamp((t - base.start) / (base.end - base.start)), ctxData)
  if (active[1]) {
    const inc = active[1]
    ctx.save()
    ctx.globalAlpha = easeInOut(clamp((t - inc.start) / TR))
    drawScene(ctx, inc, clamp((t - inc.start) / (inc.end - inc.start)), ctxData)
    ctx.restore()
  }
}

export default function PropertyVideo({ listing, brand }) {
  const [status, setStatus] = useState('idle')
  const [progress, setProgress] = useState(0)
  const [url, setUrl] = useState(null)
  const [ext, setExt] = useState('mp4')
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  async function generate() {
    setStatus('rendering'); setProgress(0); setUrl(null)
    try {
      const photos = (await Promise.all((listing.photos || []).slice(0, MAX_PHOTOS).map(loadImage))).filter(Boolean)
      const logo = await loadImage(brand.logo)
      const color = brand.color || '#2d6a4f'
      const facts = [
        listing.bedrooms != null && { big: `${listing.bedrooms} Bedrooms`, sub: listing.bathrooms != null ? `${listing.bathrooms} bathrooms` : null },
        listing.sqft != null && { big: `${listing.sqft} sq ft`, sub: 'Built-up area' },
        listing.tenure && { big: listing.tenure, sub: listing.furnishing || null },
        listing.location && { big: listing.location, sub: 'Kuching, Sarawak' },
        listing.furnishing && { big: listing.furnishing, sub: null },
      ].filter(Boolean)
      if (facts.length === 0) facts.push({ big: 'Enquire now', sub: null })

      const slideCount = photos.length || 3
      const scenes = [{ type: 'intro', start: 0, end: INTRO }]
      let cursor = INTRO - TR
      for (let i = 0; i < slideCount; i++) { scenes.push({ type: 'slide', idx: i, start: cursor, end: cursor + SLIDE }); cursor += SLIDE - TR }
      scenes.push({ type: 'outro', start: cursor, end: cursor + OUTRO })
      const total = cursor + OUTRO

      const canvas = document.createElement('canvas')
      canvas.width = OUT_W; canvas.height = OUT_H
      const ctx = canvas.getContext('2d')
      ctx.scale(OUT_W / W, OUT_H / H) // draw in 1080×1920 logical space, output 720×1280
      const ctxData = { listing, brand, photos, logo, color, facts }

      const codec = await pickCodec()
      let blob, extension
      if (codec) {
        blob = await encodeWebCodecs(canvas, ctx, scenes, total, ctxData, codec)
        extension = 'mp4'
      } else {
        const r = await recordRealtime(canvas, ctx, scenes, total, ctxData)
        blob = r.blob; extension = r.ext
      }
      if (!mounted.current || !blob) return
      setUrl(URL.createObjectURL(blob))
      setExt(extension)
      setStatus('done')
    } catch {
      if (mounted.current) setStatus('error')
    }
  }

  // Fast, deterministic path: encode every frame with explicit timestamps via
  // WebCodecs, then mux to mp4. Not real-time — never stalls on a hidden tab.
  async function encodeWebCodecs(canvas, ctx, scenes, total, ctxData, codec) {
    const totalFrames = Math.max(1, Math.ceil((total / 1000) * FPS))
    const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: OUT_W, height: OUT_H }, fastStart: 'in-memory' })
    let encErr = null
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { encErr = e },
    })
    encoder.configure({ codec, width: OUT_W, height: OUT_H, bitrate: 5_000_000, framerate: FPS })
    for (let f = 0; f < totalFrames; f++) {
      if (!mounted.current || encErr) break
      render(ctx, Math.min(f * (1000 / FPS), total - 1), scenes, ctxData)
      const frame = new VideoFrame(canvas, { timestamp: Math.round((f * 1e6) / FPS), duration: Math.round(1e6 / FPS) })
      encoder.encode(frame, { keyFrame: f % 60 === 0 })
      frame.close()
      setProgress(f / totalFrames)
      // Drain periodically so queued frames don't pile up in memory. flush()
      // is promise-based (not a timer), so it resolves even on a hidden tab.
      if (f % 24 === 23) await encoder.flush()
    }
    if (encErr) throw encErr
    await encoder.flush()
    encoder.close()
    muxer.finalize()
    setProgress(1)
    return new Blob([muxer.target.buffer], { type: 'video/mp4' })
  }

  // Fallback for browsers without WebCodecs: real-time canvas capture.
  async function recordRealtime(canvas, ctx, scenes, total, ctxData) {
    const mime = window.MediaRecorder && MediaRecorder.isTypeSupported('video/mp4;codecs=avc1') ? 'video/mp4' : 'video/webm'
    const stream = canvas.captureStream(FPS)
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 })
    const chunks = []
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    rec.start()
    const start = performance.now()
    await new Promise((resolve) => {
      const tick = () => {
        if (!mounted.current) return resolve()
        const t = performance.now() - start
        render(ctx, Math.min(t, total - 1), scenes, ctxData)
        setProgress(clamp(t / total))
        if (t < total) setTimeout(tick, 33)
        else resolve()
      }
      tick()
    })
    rec.stop()
    await new Promise((r) => { rec.onstop = r })
    return { blob: new Blob(chunks, { type: mime }), ext: mime === 'video/mp4' ? 'mp4' : 'webm' }
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
        <video className="pvid-player" src={url} controls playsInline autoPlay loop muted />
      ) : (
        <div className="pvid-stage">
          {status === 'rendering' ? (
            <div className="pvid-progress">
              <div className="pvid-spinner" />
              <div className="pvid-progress-label num">{Math.round(progress * 100)}%</div>
              <div className="muted" style={{ fontSize: 12 }}>Rendering your Reel…</div>
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
      {status === 'error' && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Couldn't render the video in this browser. Try Chrome, or use the graphic instead.</p>}
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
