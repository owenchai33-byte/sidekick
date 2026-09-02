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

import { inventsPriceHistory, captionViolations } from './_lib/postguard.js'
import { buildParsePrompt, buildContentPrompt, buildReelPrompt } from './_lib/prompts.js'
import { runModel, extractJson, providerStatus } from './_lib/providers.js'
import { demoParse, demoContent } from '../shared/demo.js'
import { renderBrandCard } from './_lib/brandcard.js'
import { appendFeed } from './_lib/feed.js'
import { putPending } from './_lib/pending.js'
import { getStyle } from './_lib/style.js'
import { getBrand } from './_lib/brand.js'
import { connectedAccounts, postToConnected, defaultProfile } from './_lib/social.js'
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
// Returns { caption, degraded }. `degraded` means the model call FAILED and this is
// demo boilerplate, not the agent's real copy. It used to fall back silently, so a
// Gemini 429 meant every agent posted generic demo text with nothing to indicate it.
// A missing caption is obvious; a plausible wrong one is not.
async function writeCaption(listing, languages, status, styleGuide, contact) {
  const langs = languages.length ? languages : ['en']
  let content, degraded = false
  if (!status.configured) { content = demoContent(listing, ['facebook_page'], langs); degraded = true }
  else {
    try { content = extractJson(await runModel(buildContentPrompt(listing, ['facebook_page'], langs, styleGuide, contact))) }
    catch { content = demoContent(listing, ['facebook_page'], langs); degraded = true }
  }
  let parts = langs.map((l) => content?.facebook_page?.[l]).filter(Boolean)
  let caption = parts.join('\n\n• • •\n\n')

  // THE CAPTION CONTRACT. On 2026-09-02 "Fully Furnished" was published about a
  // unit whose listing never mentioned furnishing, while the listing's own hook
  // (RM100K below value) and the property name were dropped. Validate every
  // caption against the listing; give the model ONE shot to repair its own
  // violations; a caption that still breaks the contract is degraded and the
  // publish gate refuses it.
  if (!degraded) {
    let v = captionViolations(caption, listing)
    // Two repair rounds, not one. Measured on Edward's real listing: one round
    // recovered the property name, the below-value hook and the phone number
    // (2/6 -> 6/6), but a single figure - the annual rental - still slipped
    // half the time. The second pass is cheap next to publishing an advert
    // that quietly drops one of the agent's selling points.
    for (let attempt = 0; attempt < 2 && (v.missing.length || v.invented.length); attempt++) {
      try {
        const fix = await runModel(`${buildContentPrompt(listing, ['facebook_page'], langs, styleGuide, contact)}

YOUR PREVIOUS ATTEMPT BROKE THE LISTING CONTRACT. Fix ONLY these and return the
same JSON shape:
${v.missing.length ? `- MISSING (the listing states these; include every one): ${v.missing.join('; ')}` : ''}
${v.invented.length ? `- INVENTED (the listing never says this; REMOVE it): ${v.invented.join('; ')}` : ''}`)
        const repaired = extractJson(fix)
        const rparts = langs.map((l) => repaired?.facebook_page?.[l]).filter(Boolean)
        if (rparts.length) {
          const rcap = rparts.join('\n\n• • •\n\n')
          const rv = captionViolations(rcap, listing)
          if (rv.missing.length + rv.invented.length < v.missing.length + v.invented.length) { caption = rcap; v = rv }
        }
      } catch { break /* repair is best-effort; the verdict below still stands */ }
    }
    {
      // A missing MONEY figure is material - an advert that omits the annual
      // rental or the saving misrepresents the deal by omission. Anything
      // invented is refused outright. A single non-money omission is allowed
      // through rather than blocking the agent's post over a phrasing nit.
      // Blocking omissions: money figures, the below-value hook, and the
      // property's NAME. Owen's complaint about the published Tropics City post
      // was precisely that it never named the property. Chasing each leak with
      // more prompt text just moves it (annual rental 3/6 -> 6/6, name 6/6 ->
      // 4/6), so these are refused rather than coaxed: a caption the model will
      // not complete after two repair rounds does not get published.
      const blocking = v.missing.filter((m) => /^RM|hook|property name/i.test(m))
      if (v.invented.length || blocking.length || v.missing.length > 1) {
        return { caption, degraded: true,
          reason: `caption breaks the listing contract - ${[...v.invented.map((x)=>`invented "${x}"`), ...v.missing.map((x)=>`missing ${x}`)].join('; ').slice(0, 300)}` }
      }
    }
  }
  // A caption that invents a price cut is WORSE than a missing one: it is a
  // misleading claim about a client's property, published under their name.
  // Treat it exactly like a failed generation so the publish gate refuses it.
  if (!degraded && inventsPriceHistory(caption, listing)) {
    return { caption, degraded: true, reason: 'invented a price reduction the listing never mentioned' }
  }
  return { caption, degraded }
}

// Punchy TikTok reel script + short caption (falls back to a simple template).
async function reelScript(listing, status) {
  if (status.configured) {
    try {
      const j = extractJson(await runModel(buildReelPrompt(listing)))
      if (j && j.script) return { script: String(j.script), caption: String(j.caption || '') }
    } catch { /* fall through */ }
  }
  const money = listing.price != null ? `RM${Number(listing.price).toLocaleString('en-MY')}${listing.listingType === 'rental' ? ' a month' : ''}` : ''
  const loc = listing.location || 'Kuching'
  const script = `Looking for a place in ${loc}? This ${listing.propertyType || 'one'}${listing.bedrooms != null ? ` has ${listing.bedrooms} bedrooms` : ''}${money ? `, and it's ${money}` : ''}. Trust me, it won't last long. DM me now before it's gone.`
  return { script, caption: `${listing.propertyType || 'Property'} in ${loc} ${money ? '— ' + money : ''} 🏡 #KuchingProperty #Sarawak #PropertyMalaysia` }
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
  const profileId = defaultProfile()

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

  const meta = { sender: body?.sender || null, group: body?.group || null }
  // Per-tenant: post to the sender's OWN profile (the agent maps sender → profileId
  // from tools/tenants.json). There is no safe fallback — the wrong profile means
  // the wrong accounts AND the wrong caption style, and both fail quietly.
  const postProfile = body?.profileId || profileId
  if (!postProfile) {
    return send(res, 400, { ok: false, error: 'no profile for this sender — add their phone → profileId in tools/tenants.json' })
  }
  // Optional platform filter (e.g. ['facebook','instagram']) — post only to these.
  const platforms = Array.isArray(body?.platforms) && body.platforms.length ? body.platforms : null

  // Branding is per-agent for the same reason the caption style is: 100 agents on
  // one system must not share one look. Loaded BEFORE the reel branch so the reel's
  // card is branded too. An explicit body.brand still wins (the app preview passes
  // one); otherwise the agent's saved brand; env vars are the last resort.
  const savedBrand = await getBrand(postProfile)
  const brand = { ...savedBrand, ...(body?.brand || {}) }
  const brandApplied = !!(savedBrand.color || savedBrand.name)

  // 1) Parse the message  2) write the caption in THIS agent's trained style
  const fields = await parseText(text, status)
  const listing = { ...fields, listingType: fields.listingType || 'sale', rawText: text }

  // TikTok reel mode: return a punchy script + short caption + a rendered card.
  // The Mac (sidekick.mjs reel) builds the actual video and holds it for approval.
  if (body?.mode === 'reel') {
    if (!media.length) return send(res, 200, { ok: false, reason: 'A reel needs photos', listing })
    const { card } = await withBrandCard(media.slice(0, 1), listing, brand, true)
    const rs = await reelScript(listing, status)
    return send(res, 200, {
      ok: true, mode: 'reel', script: rs.script, caption: rs.caption,
      card: card || media[0]?.url || null, profileId: postProfile, brandApplied,
      listing: { price: listing.price ?? null, location: listing.location || null, bedrooms: listing.bedrooms ?? null, bathrooms: listing.bathrooms ?? null, sqft: listing.sqft ?? null, propertyType: listing.propertyType || null, listingType: listing.listingType },
    })
  }

  const styleGuide = await getStyle(postProfile)
  // Report whether a trained style was actually found. A missing style does not
  // error — it silently produces generic copy, which is exactly how an orphaned
  // style went unnoticed after a provider switch. Surface it so the agent can say so.
  const styleApplied = !!(styleGuide.style || (styleGuide.examples || []).length)
  // WhatsApp click-to-chat link is HELD FOR FUTURE (Owen asked to remove it for now).
  // Re-enable by passing { whatsapp: meta.sender }; buildContentPrompt still supports it.
  const contact = null
  const { caption, degraded: captionDegraded } = await writeCaption(listing, languages, status, styleGuide, contact)

  // Wiring test — parse + caption only. No card, no store, no post.
  if (body?.dry === true) {
    // Report the same flags as a real post — the dry path is what the health check
    // and any wiring test uses, so it must not look healthier than the real thing.
    return send(res, 200, { ok: true, mode: 'dry', listing, caption, media, meta, styleApplied, brandApplied, captionDegraded, profileId: postProfile })
  }

  // A property post needs a photo.
  if (!media.length) {
    return send(res, 200, { ok: false, held: false, reason: 'No photo in the message — nothing prepared', listing, caption, meta })
  }

  // Render the branded cover + final media once (the approver sees the real thing).
  const { items: mediaItems, card, cardError } = await withBrandCard(media, listing, brand, body?.card !== false)
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
    // AUTO has no human in the loop, so the degraded check MUST happen here.
    // Without it a Gemini outage publishes demo boilerplate straight to a
    // client's page with nobody ever seeing it.
    if (captionDegraded) {
      return send(res, 503, {
        ok: false, posted: false, blocked: 'captionDegraded', listing, caption,
        error: 'the AI caption engine failed — refusing to auto-publish generic demo text. Retry once the engine is back.',
      })
    }
    const r = await postToConnected({ caption, captionShort, mediaItems, key, profileId: postProfile, platforms })
    if (!r.ok) return send(res, r.error ? 502 : 200, { ok: false, posted: false, reason: r.reason, error: r.error, listing, caption })
    await appendFeed({ ...feedBase, at: new Date().toISOString(), platforms: r.platforms, mediaCount: mediaItems.length })
    return send(res, 200, { ok: true, mode: 'auto', posted: r.platforms, listing, caption, card: card || null, ...(cardError ? { cardError } : {}), meta })
  }

  // REVIEW mode (default) — hold the finished post for a human ✅.
  try {
    const pendingId = await putPending({
      at: new Date().toISOString(),
      captionShort,
      mediaItems,
      ...feedBase,
      caption, // FULL caption — MUST come after ...feedBase (feedBase.caption is only the 180-char feed-log preview)
      mediaCount: mediaItems.length,
      sender: meta.sender,
      profileId: postProfile,
      platforms,
      // Persisted so approve.js can refuse server-side. The agent is TOLD not to
      // publish a degraded caption (AGENTS.md), but instructions are not a
      // guarantee — approve must be able to check for itself.
      captionDegraded,
    })
    return send(res, 200, {
      ok: true, mode: 'review', pendingId,
      caption, card: card || null, cover: feedBase.cover,
      mediaCount: mediaItems.length, photoCount: media.length,
      styleApplied, brandApplied, profileId: postProfile, captionDegraded,
      ...(captionDegraded ? { captionWarning: 'the AI caption engine failed — this is generic demo text, NOT this agent\'s style. Do not publish it.' } : {}),
      ...(styleApplied ? {} : { styleWarning: 'no trained caption style found for this agent — using the default format' }),
      ...(cardError ? { cardError } : {}), meta,
    })
  } catch (e) {
    return send(res, 502, { ok: false, error: 'Could not hold for approval: ' + (e?.message || String(e)), listing, caption })
  }
}
