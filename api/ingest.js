// WhatsApp ingest webhook — the "prepare & hold for ✅" path.
//
// An agent posts a listing in the WhatsApp group. OpenClaw (watching the group)
// forwards it here as { text, images[] }. SideKick parses it, writes a native
// caption, renders a branded card, and — by default — HOLDS the finished post
// for approval, returning a preview OpenClaw can send to a control chat. When
// the human replies ✅, OpenClaw calls /api/approve to actually publish.
//
// Modes (body):
//   (default)   review — prepare + hold; returns { pendingId, caption, card, cover }
//   auto:true   publish immediately, skipping approval
//   dry:true    parse + caption only; no card, no store, no post (wiring test)
//
// SECURITY: gated by INGEST_SECRET (header `x-ingest-secret` or ?secret=).
// With no secret configured it refuses to run. GET = readiness check.

import { buildParsePrompt, buildContentPrompt } from './_lib/prompts.js'
import { runModel, extractJson, providerStatus } from './_lib/providers.js'
import { demoParse, demoContent } from '../shared/demo.js'
import { renderBrandCard } from './_lib/brandcard.js'
import { appendFeed } from './_lib/feed.js'
import { putPending } from './_lib/pending.js'
import { connectedAccounts, postToConnected, DEFAULT_PROFILE } from './_lib/zernio.js'
import { put } from '@vercel/blob'

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

// Native caption for the brand account: FB-page copy per requested language,
// joined with a light divider (falls back to labelled demo copy without a key).
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

// A ≤90-char title for platforms that cap the caption (TikTok photo slideshows).
function shortCaption(listing) {
  const money = listing.price == null ? '' : (listing.listingType === 'rental'
    ? `RM${Number(listing.price).toLocaleString('en-MY')}/mo`
    : `RM${Number(listing.price).toLocaleString('en-MY')}`)
  const type = listing.propertyType || (listing.listingType === 'rental' ? 'Rental' : 'Property')
  const loc = listing.location || 'Kuching'
  const s = `${type} @ ${loc}${money ? ` — ${money}` : ''}`
  return s.length > 88 ? s.slice(0, 87) + '…' : s
}

// Best-effort branded card as the cover. Never throws — on any failure the
// original photos are used so a post is never blocked by the graphic.
async function withBrandCard(media, listing, brand, enabled) {
  if (!enabled) return { items: media }
  const first = media.find((m) => m.type === 'image')
  if (!first) return { items: media } // video-only — nothing to overlay
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
    return send(res, 200, {
      ready: !!key && accounts.length > 0,
      providerConfigured: status.configured,
      provider: status.provider,
      zernioKey: !!key,
      connectedAccounts: accounts.length,
      platforms: accounts.map((a) => a.platform),
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
  const meta = { sender: body?.sender || null, group: body?.group || null }
  // Per-tenant: post to the sender's own Zernio profile if one was passed
  // (the agent maps sender → profileId); otherwise the default profile.
  const postProfile = body?.profileId || profileId

  // Wiring test — parse + caption only. No card, no store, no post.
  if (body?.dry === true) {
    return send(res, 200, { ok: true, mode: 'dry', listing, caption, media, meta })
  }

  // A property post needs a photo.
  if (!media.length) {
    return send(res, 200, { ok: false, held: false, reason: 'No photo in the message — nothing prepared', listing, caption, meta })
  }

  // Render the branded cover + final media once (the approver sees the real thing).
  const { items: mediaItems, card, cardError } = await withBrandCard(media, listing, body?.brand, body?.card !== false)
  const captionShort = shortCaption(listing) // ≤90 chars for TikTok photo posts
  const feedBase = {
    location: listing.location || null,
    price: listing.price ?? null,
    listingType: listing.listingType,
    card: card || null,
    cover: card || media[0]?.url || null,
    caption: (caption || '').slice(0, 180),
    group: meta.group || null,
  }

  // AUTO mode — publish now, skipping approval.
  if (body?.auto === true) {
    const r = await postToConnected({ caption, captionShort, mediaItems, key, profileId: postProfile })
    if (!r.ok) return send(res, r.error ? 502 : 200, { ok: false, posted: false, reason: r.reason, error: r.error, listing, caption })
    await appendFeed({ ...feedBase, at: new Date().toISOString(), platforms: r.platforms, mediaCount: mediaItems.length })
    return send(res, 200, { ok: true, mode: 'auto', posted: r.platforms, listing, caption, card: card || null, ...(cardError ? { cardError } : {}), meta })
  }

  // REVIEW mode (default) — hold the finished post for a human ✅.
  try {
    const pendingId = await putPending({
      at: new Date().toISOString(),
      caption,
      captionShort,
      mediaItems,
      ...feedBase,
      mediaCount: mediaItems.length,
      sender: meta.sender,
      profileId: postProfile,
    })
    return send(res, 200, {
      ok: true, mode: 'review', pendingId,
      caption, card: card || null, cover: feedBase.cover,
      mediaCount: mediaItems.length, photoCount: media.length,
      ...(cardError ? { cardError } : {}), meta,
    })
  } catch (e) {
    return send(res, 502, { ok: false, error: 'Could not hold for approval: ' + (e?.message || String(e)), listing, caption })
  }
}
