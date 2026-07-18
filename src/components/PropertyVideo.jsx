import { useRef, useState, useEffect } from 'react'
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { formatPrice, listingLabel } from '../lib/format.js'
import { listingPhotos } from '../lib/photos.js'
import { shareToApps, shareFiles } from '../lib/share.js'
import { putVideo, getVideoUrl } from '../lib/media.js'

// Generates a smooth, branded vertical Reel (9:16) from the listing.
// One continuous slow zoom per photo (no jarring resets), text-only crossfades
// when the photo stays the same, one clear fact per beat, and a contact outro.
// Encoded deterministically via WebCodecs → mp4 (MediaRecorder fallback).

const W = 1080          // logical drawing space
const H = 1920
const OUT_W = 720       // encoded output
const OUT_H = 1280
const FPS = 30
const INTRO = 2800
const BEAT = 2100
const OUTRO = 3000
const TR = 680          // crossfade overlap
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
// ---- easing + colour helpers -------------------------------------------------
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)
const easeInCubic = (t) => t * t * t
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2) }
const smooth = (t) => t * t * (3 - 2 * t)
function mix(a, b, t) {
  const pa = parseInt(String(a).replace('#', ''), 16), pb = parseInt(String(b).replace('#', ''), 16)
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t))
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t))
  const bl = Math.round(lerp(pa & 255, pb & 255, t))
  return `rgb(${r},${g},${bl})`
}
// A bright mint accent derived from the brand colour — pops on dark photos.
function accentOf(color) { return mix(color || '#2d6a4f', '#a9f0ce', 0.5) }

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

// Low-level text — composes with the group alpha already on the context.
function label(ctx, str, x, y, font, fill, alpha, align = 'left', tracking = 0) {
  if (!str || alpha <= 0.01) return
  ctx.save()
  ctx.globalAlpha = clamp(alpha) * ctx.globalAlpha
  ctx.font = font; ctx.fillStyle = fill; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'
  if (tracking) ctx.letterSpacing = tracking + 'px'
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 2
  ctx.fillText(str, x, y)
  ctx.restore()
}

// Shrink a font until the string fits maxW (keeps long words / prices on-canvas).
function fitFont(ctx, str, weight, maxPx, maxW) {
  let px = maxPx
  ctx.font = `${weight} ${px}px Inter, sans-serif`
  while (ctx.measureText(str).width > maxW && px > 42) { px -= 4; ctx.font = `${weight} ${px}px Inter, sans-serif` }
  return `${weight} ${px}px Inter, sans-serif`
}

// A centred outlined pill (e.g. FOR SALE) with an optional pop scale.
function pill(ctx, cx, cy, str, font, tracking, textColor, alpha, scale = 1) {
  if (alpha <= 0.01) return
  ctx.save()
  ctx.globalAlpha = clamp(alpha) * ctx.globalAlpha
  ctx.translate(cx, cy); ctx.scale(scale, scale)
  ctx.font = font; ctx.letterSpacing = tracking + 'px'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const w = ctx.measureText(str).width + 60, h = 62
  roundRect(ctx, -w / 2, -h / 2, w, h, h / 2)
  ctx.fillStyle = 'rgba(8,20,15,0.35)'; ctx.fill()
  ctx.lineWidth = 2.5; ctx.strokeStyle = textColor; ctx.stroke()
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 14
  ctx.fillStyle = textColor; ctx.fillText(str, 0, 2)
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

function drawBg(ctx, beat, t, D, pop = 0) {
  const img = beat.photoIdx >= 0 ? D.photos[beat.photoIdx] : null
  if (img) {
    // Continuous, multi-directional Ken Burns: each photo run alternates a slow
    // zoom-in / zoom-out and drifts along its own diagonal; smoothstep keeps the
    // motion from starting or stopping abruptly at run edges.
    const rp = smooth(clamp((t - beat.runStart) / Math.max(1, beat.runEnd - beat.runStart)))
    const seed = beat.runIdx
    const zoom = (seed % 2 === 0 ? lerp(1.05, 1.19, rp) : lerp(1.19, 1.05, rp)) * (1 + 0.06 * pop)
    const dirX = (seed % 3) - 1
    const dirY = ((seed >> 1) % 3) - 1 || 1
    coverDraw(ctx, img, zoom, lerp(-0.13 * dirX, 0.13 * dirX, rp), lerp(-0.09 * dirY, 0.09 * dirY, rp))
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H)
    g.addColorStop(0, shade(D.color, 30)); g.addColorStop(1, shade(D.color, -60))
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    const rg = ctx.createRadialGradient(W / 2, H * 0.4, 100, W / 2, H * 0.4, H * 0.7)
    rg.addColorStop(0, 'rgba(255,255,255,0.12)'); rg.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H)
  }
  if (beat.kind === 'stat') {
    const g = ctx.createLinearGradient(0, H * 0.42, 0, H)
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.9)')
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fillRect(0, 0, W, H)
    const g = ctx.createLinearGradient(0, H * 0.5, 0, H)
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)')
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  }
}

// Cinematic depth: darken corners + a soft top scrim so the story bar stays legible.
function vignette(ctx) {
  const g = ctx.createRadialGradient(W / 2, H * 0.42, H * 0.28, W / 2, H * 0.52, H * 0.78)
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.32)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  const tg = ctx.createLinearGradient(0, 0, 0, H * 0.16)
  tg.addColorStop(0, 'rgba(0,0,0,0.34)'); tg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = tg; ctx.fillRect(0, 0, W, H * 0.16)
}

// Instagram/TikTok-style segmented progress across the top — one segment per beat.
function storyBar(ctx, beats, t) {
  const padX = 54, top = 60, gap = 8, h = 7, n = beats.length
  const seg = (W - padX * 2 - gap * (n - 1)) / n
  for (let i = 0; i < n; i++) {
    const x = padX + i * (seg + gap)
    const spanEnd = beats[i + 1] ? beats[i + 1].start : beats[n - 1].end
    const f = clamp((t - beats[i].start) / Math.max(1, spanEnd - beats[i].start))
    roundRect(ctx, x, top, seg, h, h / 2); ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fill()
    if (f > 0) { roundRect(ctx, x, top, seg * f, h, h / 2); ctx.fillStyle = '#fff'; ctx.fill() }
  }
}

// One scene's foreground, with a group fade + horizontal slide applied on top of
// each element's own staggered spring-style entrance (rise from `beat.start`).
function drawScene(ctx, beat, t, groupAlpha, slideX, D, A) {
  if (groupAlpha <= 0.01) return
  ctx.save()
  ctx.globalAlpha = clamp(groupAlpha)
  ctx.translate(slideX, 0)
  const since = t - beat.start
  const rise = (delay, dur = 540) => {
    const p = clamp((since - delay) / dur)
    return { a: p, y: (1 - easeOutCubic(p)) * 34, s: lerp(0.9, 1, easeOutBack(p)) }
  }
  if (beat.kind === 'intro') introScene(ctx, beat, D, A, rise)
  else if (beat.kind === 'outro') outroScene(ctx, beat, D, A, rise)
  else statScene(ctx, beat, D, A, rise)
  ctx.restore()
}

function introScene(ctx, beat, D, A, rise) {
  const { listing } = D, cx = W / 2
  const a = rise(0, 460), b = rise(140, 560), c = rise(300, 560)
  pill(ctx, cx, H / 2 - 214 + a.y, listing.listingType === 'rental' ? 'FOR RENT' : 'FOR SALE', '800 38px Inter, sans-serif', 3, A, a.a, a.s)
  ctx.save(); ctx.translate(0, b.y)
  label(ctx, formatPrice(listing.price, listing.listingType), cx, H / 2 + 20, fitFont(ctx, formatPrice(listing.price, listing.listingType), 800, 132, W - 140), '#fff', b.a, 'center')
  ctx.restore()
  // accent underline draws out from centre
  ctx.save(); ctx.globalAlpha = b.a * ctx.globalAlpha
  const uw = lerp(0, 132, easeOutCubic(b.a))
  roundRect(ctx, cx - uw / 2, H / 2 + 54, uw, 6, 3); ctx.fillStyle = A; ctx.fill()
  ctx.restore()
  ctx.save(); ctx.translate(0, c.y)
  label(ctx, [listing.propertyType, listing.location].filter(Boolean).join('   ·   '), cx, H / 2 + 122, '500 42px Inter, sans-serif', 'rgba(255,255,255,0.92)', c.a, 'center')
  ctx.restore()
}

function statScene(ctx, beat, D, A, rise) {
  const baseY = H - 250
  const a = rise(0, 520), b = rise(130, 560)
  // accent bar grows up from the number's baseline
  ctx.save(); ctx.globalAlpha = a.a * ctx.globalAlpha
  const barH = 150 * clamp(easeOutCubic(a.a))
  roundRect(ctx, 60, baseY + 30 - barH, 10, barH, 5); ctx.fillStyle = A; ctx.fill()
  ctx.restore()
  ctx.save(); ctx.translate(0, a.y)
  label(ctx, beat.big, 96, baseY, fitFont(ctx, beat.big, 800, 132, W - 200), '#fff', a.a, 'left')
  ctx.restore()
  if (beat.small) {
    ctx.save(); ctx.translate(0, b.y)
    label(ctx, beat.small.toUpperCase(), 100, baseY + 54, '700 40px Inter, sans-serif', A, b.a, 'left', 2)
    ctx.restore()
  }
}

function outroScene(ctx, beat, D, A, rise) {
  const { listing, brand } = D, cx = W / 2
  const a = rise(0, 480), b = rise(130, 540), c = rise(280, 560)
  ctx.save(); ctx.translate(0, a.y)
  label(ctx, 'Book a viewing', cx, H / 2 - 70, '800 84px Inter, sans-serif', '#fff', a.a, 'center')
  ctx.restore()
  ctx.save(); ctx.translate(0, b.y)
  label(ctx, formatPrice(listing.price, listing.listingType), cx, H / 2 + 6, fitFont(ctx, formatPrice(listing.price, listing.listingType), 700, 56, W - 160), 'rgba(255,255,255,0.92)', b.a, 'center')
  ctx.restore()
  if (brand.phone) {
    ctx.save(); ctx.globalAlpha = c.a * ctx.globalAlpha
    ctx.translate(cx, H / 2 + 116 + c.y); ctx.scale(c.s, c.s)
    ctx.font = '700 44px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const txt = 'WhatsApp  ' + brand.phone
    const w = ctx.measureText(txt).width + 96, h = 84
    roundRect(ctx, -w / 2, -h / 2, w, h, h / 2)
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 22; ctx.fillStyle = A; ctx.fill()
    ctx.shadowBlur = 0; ctx.fillStyle = mix(D.color, '#06140d', 0.4); ctx.fillText(txt, 0, 2)
    ctx.restore()
  } else if (brand.name || brand.agency) {
    ctx.save(); ctx.translate(0, c.y)
    label(ctx, brand.name || brand.agency, cx, H / 2 + 120, '600 46px Inter, sans-serif', A, c.a, 'center')
    ctx.restore()
  }
}

function brandBar(ctx, D) {
  const { brand, logo, color } = D
  const barH = 128, by = H - barH
  const g = ctx.createLinearGradient(0, by, 0, H)
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.4, 'rgba(0,0,0,0.28)'); g.addColorStop(1, 'rgba(0,0,0,0.5)')
  ctx.fillStyle = g; ctx.fillRect(0, by, W, barH)
  const ms = 74, mx = 56, my = by + (barH - ms) / 2 + 6
  if (logo) { ctx.save(); ctx.beginPath(); ctx.arc(mx + ms / 2, my + ms / 2, ms / 2, 0, 7); ctx.clip(); ctx.drawImage(logo, mx, my, ms, ms); ctx.restore() }
  else { ctx.beginPath(); ctx.arc(mx + ms / 2, my + ms / 2, ms / 2, 0, 7); ctx.fillStyle = color; ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = '800 30px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(initials(brand.agency || brand.name), mx + ms / 2, my + ms / 2 + 1) }
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.font = '700 34px Inter, sans-serif'
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 10
  ctx.fillText(brand.agency || brand.name || 'SideKick Property', mx + ms + 22, my + ms / 2 + 1)
}

function render(ctx, t, beats, D) {
  const A = D.accent || (D.accent = accentOf(D.color))
  const active = beats.filter((b) => t >= b.start && t < b.end).slice(0, 2)
  const cur = active[0] || beats[beats.length - 1]
  const nxt = active[1]
  const trRaw = nxt ? clamp((t - nxt.start) / TR) : 0
  const tr = easeInOut(trRaw)

  // Background: crossfade only when the photo actually changes; otherwise the
  // shared photo stays continuous. Incoming photo gets a subtle settle-pop zoom.
  drawBg(ctx, cur, t, D, 0)
  if (nxt && nxt.photoIdx !== cur.photoIdx) {
    ctx.save(); ctx.globalAlpha = tr; drawBg(ctx, nxt, t, D, 1 - tr); ctx.restore()
  }
  vignette(ctx)

  // Staggered, directional captions: current exits (fade + slide left) while the
  // next enters (fade + slide in from the right) — they never overlap in place.
  const outA = nxt ? clamp(1 - trRaw * 1.7) : 1
  drawScene(ctx, cur, t, outA, nxt ? -70 * easeInCubic(trRaw) : 0, D, A)
  if (nxt) drawScene(ctx, nxt, t, clamp(trRaw * 1.7 - 0.4), 80 * (1 - easeOutCubic(trRaw)), D, A)

  storyBar(ctx, beats, t)
  brandBar(ctx, D)

  // Cinematic open / close.
  if (t < 360) { ctx.save(); ctx.globalAlpha = 1 - t / 360; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.restore() }
  else if (t > D.total - 420) { ctx.save(); ctx.globalAlpha = clamp((t - (D.total - 420)) / 420); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.restore() }
}

export default function PropertyVideo({ listing, brand, onVideo }) {
  const [status, setStatus] = useState('idle')
  const [progress, setProgress] = useState(0)
  const [url, setUrl] = useState(null)
  const [ext, setExt] = useState('mp4')
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  // Load a previously-saved reel (persisted to IndexedDB) so it survives reloads
  // and is available to the publish flow / kit.
  useEffect(() => {
    const v = listing.videos?.[0]
    if (!v) return
    getVideoUrl(v.id).then((u) => {
      if (u && mounted.current) { setUrl(u); if (v.name?.endsWith('webm')) setExt('webm'); setStatus('done') }
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing.id])

  // Dev-only: draw a single frame at time `sec` to a visible canvas (bypasses
  // the encoder) so frames can be inspected. Stripped from production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__pvidFrame = async (sec) => {
      const photos = (await Promise.all(listingPhotos(listing).slice(0, MAX_PHOTOS).map(loadImage))).filter(Boolean)
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
      const photos = (await Promise.all(listingPhotos(listing).slice(0, MAX_PHOTOS).map(loadImage))).filter(Boolean)
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
      // Persist the reel so the publish flow can attach it (TikTok / IG / Status).
      const slug = listingLabel(listing).replace(/[^\w]+/g, '-').toLowerCase()
      putVideo(blob).then((id) => { if (mounted.current) onVideo?.({ id, name: `${slug}-reel.${extension}` }) }).catch(() => {})
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

  async function share() {
    const blob = await fetch(url).then((r) => r.blob())
    const file = new File([blob], `${listingLabel(listing).replace(/[^\w]+/g, '-').toLowerCase()}-reel.${ext}`, { type: blob.type || 'video/mp4' })
    await shareFiles({ title: listingLabel(listing), text: listingLabel(listing), files: [file] })
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
        {url && <button className="btn btn-subtle btn-sm" onClick={download}>Download</button>}
        {url && shareToApps() && (
          <button className="btn btn-primary btn-sm" onClick={share}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8h16v-8M12 3v13M8 7l4-4 4 4" /></svg>
            Share
          </button>
        )}
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
