// WhatsApp auto-ingest webhook — the hands-off path.
//
// An agent posts a listing in the WhatsApp group. OpenClaw (watching the group)
// forwards it here as { text, images[] }. SideKick parses the listing, writes a
// native caption with the content engine, and — in full-auto mode — posts it
// straight to the central brand account's connected socials. No taps.
//
// SECURITY: this URL can fire real posts, so it is gated by a shared secret.
// Set INGEST_SECRET in the environment and send it as the `x-ingest-secret`
// header (or ?secret=). With no secret configured the endpoint refuses to run,
// so a leaked URL alone can't post anything.
//
// Contract:
//   POST /api/ingest          headers: x-ingest-secret: <secret>
//   body { text, images:[url...], sender?, group?, languages?, auto? }
//     - text     the WhatsApp message (price / specs / location, free-form)
//     - images   PUBLIC http(s) URLs of the listing photos/video (OpenClaw hosts them)
//     - auto     default true = post now; false = parse + caption only (dry run)
//   GET  /api/ingest          headers: x-ingest-secret: <secret>
//     → readiness check (is a provider live? is the brand account connected?)

import { buildParsePrompt, buildContentPrompt } from './_lib/prompts.js'
import { runModel, extractJson, providerStatus } from './_lib/providers.js'
import { demoParse, demoContent } from '../shared/demo.js'
import { renderBrandCard } from './_lib/brandcard.js'
import { put } from '@vercel/blob'

const ZERNIO = 'https://zernio.com/api/v1'
const DEFAULT_PROFILE = '6a6c498971a67c109cfcae06' // central brand profile

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}) } catch (e) { reject(e) } })
    req.on('error', reject)
  })
}

// Collect public media URLs from the various shapes OpenClaw might send.
function mediaFrom(body) {
  const raw = []
  if (Array.isArray(body?.images)) raw.push(...body.images)
  if (Array.isArray(body?.media)) raw.push(...body.media.map((m) => (typeof m === 'string' ? m : m?.url)))
  if (body?.image) raw.push(body.image)
  if (body?.mediaUrl) raw.push(body.mediaUrl)
  return raw
    .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
    .slice(0, 10)
    .map((url) => ({ url, type: /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(url) ? 'video' : 'image' }))
}

async function parseText(text, status) {
  if (!text) return {}
  if (!status.configured) return demoParse(text)
  try { return extractJson(await runModel(buildParsePrompt(text))) } catch { return demoParse(text) }
}

// One caption for the brand account. Generates FB-page copy per requested
// language (native, not translated) and joins them with a light divider.
async function writeCaption(listing, languages, status) {
  const langs = languages.length ? languages : ['en']
  let content
  if (!status.configured) content = demoContent(listing, ['facebook_page'], langs)
  else {
    try { content = extractJson(await runModel(buildContentPrompt(listing, ['facebook_page'], langs))) }
    catch { content = demoContent(listing, ['facebook_page'], langs) }
  }
  const parts = langs.map((l) => content?.facebook_page?.[l]).filter(Boolean)
  return parts.join('\n\n• • •\n\n')
}

// Best-effort: render a branded price card from the first photo and prepend it
// as the cover. Never throws — on any failure the original photos are used.
async function withBrandCard(media, listing, brand, enabled) {
  if (!enabled) return { items: media }
  const first = media.find((m) => m.type === 'image')
  if (!first) return { items: media } // video-only post — nothing to overlay
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { items: media, cardError: 'no BLOB token' }
  try {
    const png = await renderBrandCard(first.url, listing, brand || {})
    const blob = await put('ingest/card.png', png, {
      access: 'public', addRandomSuffix: true, contentType: 'image/png',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    })
    return { items: [{ url: blob.url, type: 'image' }, ...media], card: blob.url }
  } catch (e) {
    return { items: media, cardError: e?.message || String(e) }
  }
}

// Query the central profile's connected accounts on Zernio.
async function connectedAccounts(key, profileId) {
  const ar = await fetch(`${ZERNIO}/accounts?profileId=${encodeURIComponent(profileId)}`, {
    headers: { authorization: `Bearer ${key}` },
  })
  const ad = await ar.json().catch(() => ({}))
  if (!ar.ok) throw new Error(`Zernio accounts ${ar.status}`)
  return ad.accounts || []
}

export default async function handler(req, res) {
  const secret = process.env.INGEST_SECRET
  const provided = req.headers['x-ingest-secret'] || (new URL(req.url, 'http://x').searchParams.get('secret')) || ''
  if (!secret) return send(res, 501, { error: 'INGEST_SECRET not set — configure it before enabling auto-ingest' })
  if (provided !== secret) return send(res, 401, { error: 'Bad or missing x-ingest-secret' })

  const status = providerStatus()
  const key = process.env.ZERNIO_API_KEY
  const profileId = process.env.ZERNIO_PROFILE_ID || DEFAULT_PROFILE

  // Readiness check — verify wiring without posting.
  if (req.method === 'GET') {
    let accounts = []
    let zerr = null
    if (key) { try { accounts = await connectedAccounts(key, profileId) } catch (e) { zerr = e.message } }
    const platforms = accounts.map((a) => a.platform)
    return send(res, 200, {
      ready: !!key && accounts.length > 0,
      providerConfigured: status.configured,
      provider: status.provider,
      zernioKey: !!key,
      connectedAccounts: accounts.length,
      platforms,
      ...(zerr ? { zernioError: zerr } : {}),
    })
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'POST or GET only' })

  let body
  try { body = req.body ?? (await readJson(req)) } catch { return send(res, 400, { error: 'Invalid JSON' }) }

  const text = (body?.text || body?.caption || '').trim()
  const media = mediaFrom(body)
  if (!text && !media.length) return send(res, 400, { error: 'Nothing to ingest — need text or images' })

  const languages = Array.isArray(body?.languages) && body.languages.length
    ? body.languages
    : (process.env.INGEST_LANGS ? process.env.INGEST_LANGS.split(',').map((s) => s.trim()).filter(Boolean) : ['en'])

  // 1) Parse the free-form message  2) write the caption
  const fields = await parseText(text, status)
  const listing = { ...fields, listingType: fields.listingType || 'sale', rawText: text }
  const caption = await writeCaption(listing, languages, status)

  const meta = { sender: body?.sender || null, group: body?.group || null, at: null }

  // Dry run — parse + caption only, no posting. Lets us test wiring safely.
  if (body?.auto === false) {
    return send(res, 200, { ok: true, posted: false, dryRun: true, listing, caption, media, meta })
  }

  // A property post needs a photo. Text-only listings are held (not posted).
  if (!media.length) {
    return send(res, 200, { ok: false, posted: false, reason: 'No photo in the message — nothing posted', listing, caption, meta })
  }
  if (!key) {
    return send(res, 200, { ok: false, posted: false, reason: 'ZERNIO_API_KEY not set', listing, caption, media, meta })
  }

  // 3) Full-auto post to the central brand account's connected socials.
  try {
    const accounts = await connectedAccounts(key, profileId)
    if (!accounts.length) {
      return send(res, 200, { ok: false, posted: false, reason: 'No connected accounts on the central profile yet', listing, caption, media, meta })
    }
    const platforms = accounts.map((a) => ({ platform: a.platform, accountId: a._id }))
    const { items: mediaItems, card, cardError } = await withBrandCard(media, listing, body?.brand, body?.card !== false)
    const post = { content: caption, mediaItems, platforms, publishNow: true }
    const pr = await fetch(`${ZERNIO}/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(post),
    })
    const ptext = await pr.text().catch(() => '')
    if (!pr.ok) return send(res, 502, { ok: false, posted: false, error: `Zernio post ${pr.status}: ${ptext.slice(0, 200)}`, listing, caption })
    return send(res, 200, { ok: true, posted: platforms.map((p) => p.platform), listing, caption, mediaCount: mediaItems.length, card: card || null, ...(cardError ? { cardError } : {}), meta })
  } catch (e) {
    return send(res, 502, { ok: false, posted: false, error: 'Zernio unreachable: ' + (e?.message || String(e)), listing, caption })
  }
}
