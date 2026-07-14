import { useRef, useState, useEffect } from 'react'
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { formatPrice, listingLabel } from '../lib/format.js'

// Generates a smooth, branded vertical Reel (9:16) from the listing.
// One continuous slow zoom per photo (no jarring resets), text-only crossfades
// when the photo stays the same, one clear fact per beat, and a contact outro.
// Encoded deterministically via WebCodecs → mp4 (MediaRecorder fallback).

const W = 1080          // logical drawing space
const H = 1920
const OUT_W = 720       // encoded output
const OUT_H = 1280
const FPS = 30
const INTRO = 2600
const BEAT = 2100
const OUTRO = 2800
const TR = 650          // crossfade overlap
const MAX_PHOTOS = 8

async function pickCodec() {
  if (typeof VideoEncoder === 'undefined') return null
  for (const codec of ['avc1.42001f', 'avc1.42E01F', 'avc1.4d0028', 'avc1.640028']) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec, width: OUT_W, height: OUT_H, bitrate: 6_000_000, framerate: FPS })
      if (s.supported) return codec
    } catch { /* next */ }
  }
  return null
}

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
function initials(name) { return (name || 'SK').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() }
function shade(hex, amt) {
  const n = parseInt((hex || '#2d6a4f').replace('#', ''), 16)
  const c = (v) => Math.max(0, Math.min(255, v))
  return `rgb(${c(((n >> 16) & 255) + amt)},${c(((n >> 8) & 255) + amt)},${c((n & 255) + amt)})`
}
function coverDraw(ctx, img, zoom, panX, panY) {
  const ir = img.width / img.height
  const r = W / H
  let sw, sh
  if (ir > r) { sh = img.height; sw = sh * r } else { sw = img.width; sh = sw / r }
  sw /= zoom; sh /= zoom
  const maxX = img.width - sw
  const maxY = img.height - sh
  let sx = clamp(maxX * (0.5 + panX * 0.5), 0, maxX)
  let sy = clamp(maxY * (0.5 + panY * 0.5), 0, maxY)
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H)
}
function text(ctx, str, x, y, font, fill, alpha, align = 'left') {
  if (!str || alpha <= 0.01) return
  ctx.save()
  ctx.globalAlpha = clamp(alpha)
  ctx.translate(0, (1 - clamp(alpha)) * 22)
  ctx.font = font; ctx.fillStyle = fill; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 22
  ctx.fillText(str, x, y)
  ctx.restore()
}

// Build the beat list: intro (price) → one fact per beat → outro (contact).
function buildBeats(listing, photos) {
  const stats = []
  if (listing.bedrooms != null) stats.push({ big: String(listing.bedrooms), small: listing.bedrooms == 1 ? 'Bedroom' : 'Bedrooms' })
  if (listing.bathrooms != null) stats.push({ big: String(listing.bathrooms), small: listing.bathrooms == 1 ? 'Bathroom' : 'Bathrooms' })
  if (listing.sqft != null) stats.push({ big: Number(listing.sqft).toLocaleString('en-MY'), small: 'sq ft built-up' })
  if (listing.tenure) stats.push({ big: listing.tenure, small: 'Tenure' })
  if (listing.furnishing) stats.push({ big: listing.furnishing, small: null })
  if (listing.location) stats.push({ big: listing.location, small: 'Kuching, Sarawak' })
  if (stats.length === 0) stats.push({ big: 'Enquire', small: 'for full details' })

  const beats = [{ kind: 'intro' }, ...stats.map((s) => ({ kind: 'stat', ...s })), { kind: 'outro' }]
  const n = photos.length
  let cursor = 0
  beats.forEach((b, i) => {
    b.photoIdx = n ? i % n : -1
    const dur = b.kind === 'intro' ? INTRO : b.kind === 'outro' ? OUTRO : BEAT
    b.start = cursor
    b.end = cursor + dur
    cursor += dur - TR
  })
  // Contiguous same-photo runs → continuous zoom (no reset within a run).
  beats.forEach((b, i) => {
    let s = i; while (s > 0 && beats[s - 1].photoIdx === b.photoIdx) s--
    let e = i; while (e < beats.length - 1 && beats[e + 1].photoIdx === b.photoIdx) e++
    b.runStart = beats[s].start; b.runEnd = beats[e].end; b.runIdx = s
  })
  return { beats, total: beats[beats.length - 1].end }
}

function drawBg(ctx, beat, t, D) {
  const img = beat.photoIdx >= 0 ? D.photos[beat.photoIdx] : null
  if (img) {
    const rp = clamp((t - beat.runStart) / Math.max(1, beat.runEnd - beat.runStart))
    const dir = beat.runIdx % 2 === 0 ? 1 : -1
    coverDraw(ctx, img, lerp(1.05, 1.15, rp), lerp(-0.14 * dir, 0.14 * dir, rp), 0)
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H)
    g.addColorStop(0, shade(D.color, 26)); g.addColorStop(1, shade(D.color, -54))
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  }
  if (beat.kind === 'stat') {
    const g = ctx.createLinearGradient(0, H * 0.48, 0, H)
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.9)')
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fillRect(0, 0, W, H)
    const g = ctx.createLinearGradient(0, H * 0.5, 0, H)
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)')
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  }
}

function drawText(ctx, beat, alpha, D) {
  const { listing, brand } = D
  if (beat.kind === 'intro') {
    text(ctx, listing.listingType === 'rental' ? 'FOR RENT' : 'FOR SALE', W / 2, H / 2 - 150, '700 44px Inter, sans-serif', 'rgba(255,255,255,0.95)', alpha, 'center')
    text(ctx, formatPrice(listing.price, listing.listingType), W / 2, H / 2 + 20, '800 130px Inter, sans-serif', '#fff', alpha, 'center')
    text(ctx, [listing.propertyType, listing.location].filter(Boolean).join(' · '), W / 2, H / 2 + 100, '500 42px Inter, sans-serif', 'rgba(255,255,255,0.92)', alpha, 'center')
  } else if (beat.kind === 'outro') {
    text(ctx, 'Book a viewing', W / 2, H / 2 - 60, '800 82px Inter, sans-serif', '#fff', alpha, 'center')
    text(ctx, formatPrice(listing.price, listing.listingType), W / 2, H / 2 + 20, '700 56px Inter, sans-serif', 'rgba(255,255,255,0.92)', alpha, 'center')
    if (brand.name || brand.agency) text(ctx, brand.name || brand.agency, W / 2, H / 2 + 96, '600 42px Inter, sans-serif', 'rgba(255,255,255,0.92)', alpha, 'center')
    if (brand.phone) text(ctx, 'WhatsApp ' + brand.phone, W / 2, H / 2 + 158, '700 46px Inter, sans-serif', '#fff', alpha, 'center')
  } else {
    text(ctx, beat.big, 60, H - 210, '800 128px Inter, sans-serif', '#fff', alpha)
    if (beat.small) text(ctx, beat.small, 66, H - 210 + 56, '600 44px Inter, sans-serif', 'rgba(255,255,255,0.9)', alpha)
  }
}

function brandBar(ctx, D) {
  const { brand, logo, color } = D
  const barH = 132, by = H - barH
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, by, W, barH)
  const ms = 76, mx = 56, my = by + (barH - ms) / 2
  if (logo) { ctx.save(); ctx.beginPath(); ctx.arc(mx + ms / 2, my + ms / 2, ms / 2, 0, 7); ctx.clip(); ctx.drawImage(logo, mx, my, ms, ms); ctx.restore() }
  else { ctx.beginPath(); ctx.arc(mx + ms / 2, my + ms / 2, ms / 2, 0, 7); ctx.fillStyle = color; ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = '800 30px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(initials(brand.agency || brand.name), mx + ms / 2, my + ms / 2 + 1) }
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.font = '700 34px Inter, sans-serif'
  ctx.fillText(brand.agency || brand.name || 'SideKick Property', mx + ms + 22, by + barH / 2)
}

function render(ctx, t, beats, D) {
  const active = beats.filter((b) => t >= b.start && t < b.end).slice(0, 2)
  const cur = active[0] || beats[beats.length - 1]
  const nxt = active[1]
  const trRaw = nxt ? clamp((t - nxt.start) / TR) : 0

  // Background: crossfade only when the photo actually changes; otherwise the
  // shared photo stays continuous and only the text transitions.
  drawBg(ctx, cur, t, D)
  if (nxt && nxt.photoIdx !== cur.photoIdx) {
    ctx.save(); ctx.globalAlpha = easeInOut(trRaw); drawBg(ctx, nxt, t, D); ctx.restore()
  }
  // Staggered text: outgoing fades out over the first half of the transition,
  // incoming fades in over the second half — so captions never overlap in place.
  let curAlpha = nxt ? clamp(1 - trRaw * 2) : 1
  if (cur.start === 0) curAlpha *= clamp(t / 450) // intro entrance
  drawText(ctx, cur, curAlpha, D)
  if (nxt) drawText(ctx, nxt, clamp(trRaw * 2 - 1), D)
  brandBar(ctx, D)

  // Cinematic open / close.
  if (t < 350) { ctx.save(); ctx.globalAlpha = 1 - t / 350; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.restore() }
  else if (t > D.total - 350) { ctx.save(); ctx.globalAlpha = clamp((t - (D.total - 350)) / 350); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.restore() }
}

export default function PropertyVideo({ listing, brand }) {
  const [status, setStatus] = useState('idle')
  const [progress, setProgress] = useState(0)
  const [url, setUrl] = useState(null)
  const [ext, setExt] = useState('mp4')
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  // Dev-only: draw a single frame at time `sec` to a visible canvas (bypasses
  // the encoder) so frames can be inspected. Stripped from production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__pvidFrame = async (sec) => {
      const photos = (await Promise.all((listing.photos || []).slice(0, MAX_PHOTOS).map(loadImage))).filter(Boolean)
      const logo = await loadImage(brand.logo)
      const { beats, total } = buildBeats(listing, photos)
      const D = { listing, brand, photos, logo, color: brand.color || '#2d6a4f', total }
      let cv = document.getElementById('__pvidcv')
      if (!cv) { cv = document.createElement('canvas'); cv.id = '__pvidcv'; cv.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);height:88vh;z-index:99999;border-radius:12px;box-shadow:0 0 0 3px #1b4332'; document.body.appendChild(cv) }
      cv.width = OUT_W; cv.height = OUT_H
      const ctx = cv.getContext('2d'); ctx.setTransform(OUT_W / W, 0, 0, OUT_H / H, 0, 0)
      render(ctx, Math.min(sec * 1000, total - 1), beats, D)
      return JSON.stringify({ totalSec: Math.round(total / 100) / 10, beats: beats.length })
    }
  }, [listing, brand])

  async function generate() {
    setStatus('rendering'); setProgress(0); setUrl(null)
    try {
      const photos = (await Promise.all((listing.photos || []).slice(0, MAX_PHOTOS).map(loadImage))).filter(Boolean)
      const logo = await loadImage(brand.logo)
      const color = brand.color || '#2d6a4f'
      const { beats, total } = buildBeats(listing, photos)
      const D = { listing, brand, photos, logo, color, total }

      const canvas = document.createElement('canvas')
      canvas.width = OUT_W; canvas.height = OUT_H
      const ctx = canvas.getContext('2d')
      ctx.scale(OUT_W / W, OUT_H / H)

      const codec = await pickCodec()
      let blob, extension
      if (codec) { blob = await encodeWebCodecs(canvas, ctx, beats, total, D, codec); extension = 'mp4' }
      else { const r = await recordRealtime(canvas, ctx, beats, total, D); blob = r.blob; extension = r.ext }
      if (!mounted.current || !blob) return
      setUrl(URL.createObjectURL(blob)); setExt(extension); setStatus('done')
    } catch {
      if (mounted.current) setStatus('error')
    }
  }

  async function encodeWebCodecs(canvas, ctx, beats, total, D, codec) {
    const totalFrames = Math.max(1, Math.ceil((total / 1000) * FPS))
    const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: OUT_W, height: OUT_H }, fastStart: 'in-memory' })
    let encErr = null
    const encoder = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { encErr = e } })
    encoder.configure({ codec, width: OUT_W, height: OUT_H, bitrate: 6_000_000, framerate: FPS })
    for (let f = 0; f < totalFrames; f++) {
      if (!mounted.current || encErr) break
      render(ctx, Math.min(f * (1000 / FPS), total - 1), beats, D)
      const frame = new VideoFrame(canvas, { timestamp: Math.round((f * 1e6) / FPS), duration: Math.round(1e6 / FPS) })
      encoder.encode(frame, { keyFrame: f % 60 === 0 })
      frame.close()
      setProgress(f / totalFrames)
      if (f % 24 === 23) await encoder.flush()
    }
    if (encErr) throw encErr
    await encoder.flush(); encoder.close(); muxer.finalize()
    setProgress(1)
    return new Blob([muxer.target.buffer], { type: 'video/mp4' })
  }

  async function recordRealtime(canvas, ctx, beats, total, D) {
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
        render(ctx, Math.min(t, total - 1), beats, D)
        setProgress(clamp(t / total))
        if (t < total) setTimeout(tick, 33); else resolve()
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
