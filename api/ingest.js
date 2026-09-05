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

import { inventsPriceHistory, captionViolations, ruleViolations} from './_lib/postguard.js'
import { buildParsePrompt, buildContentPrompt, buildReelPrompt } from './_lib/prompts.js'
import { runModel, extractJson, providerStatus } from './_lib/providers.js'
import { demoParse, demoContent } from '../shared/demo.js'
import { renderBrandCard } from './_lib/brandcard.js'
import { appendFeed } from './_lib/feed.js'
import { putPending, getPending } from './_lib/pending.js'
import { sourceFrom } from './hold.js'
import { getStyle, getRules } from './_lib/style.js'
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
// Returns { caption, degraded, warnings }. `degraded` means the model call FAILED and this is
// demo boilerplate, not the agent's real copy. It used to fall back silently, so a
// Gemini 429 meant every agent posted generic demo text with nothing to indicate it.
// A missing caption is obvious; a plausible wrong one is not. `warnings` are
// advisory and never refuse anything - see the property-name note in postguard.js.
async function writeCaption(listing, languages, status, styleGuide, contact, rules) {
  const langs = languages.length ? languages : ['en']
  let content, degraded = false, warnings = []
  if (!status.configured) { content = demoContent(listing, ['facebook_page'], langs); degraded = true }
  else {
    try { content = extractJson(await runModel(buildContentPrompt(listing, ['facebook_page'], langs, styleGuide, contact, rules))) }
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
    // The agent's own trained rules are checked too, not just the facts. They
    // were in the prompt and being ignored: measured 2026-09-04, "Never use
    // emoji in captions" was stated plainly and the caption came back with
    // emoji. An instruction is a hope; a check the repair round can quote back
    // is a correction. These are STYLE breaches and never block a publish on
    // their own - only the factual contract does that.
    let rv = ruleViolations(caption, rules, 'facebook_page')
    for (let attempt = 0; attempt < 2 && (v.missing.length || v.invented.length || rv.length || (v.marketing || []).length); attempt++) {
      try {
        // The repair resends the prompt WITHOUT the style examples. Measured
        // 2026-09-04: the style guide plus its worked examples is ~966 tokens,
        // resent on every repair round, and two rounds are 43% of the ~13,000
        // tokens a listing costs. On a free tier that allows 200,000 a day that
        // is the difference between roughly 15 listings and 22. The examples
        // teach the model the format; by the repair round it has already written
        // in that format and is being asked to fix named facts, so the format
        // instruction earns its place and the examples no longer do.
        const leanStyle = styleGuide ? { ...styleGuide, examples: [] } : styleGuide
        const fix = await runModel(`${buildContentPrompt(listing, ['facebook_page'], langs, leanStyle, contact, rules)}

YOUR PREVIOUS ATTEMPT BROKE THE LISTING CONTRACT. Fix ONLY these and return the
same JSON shape:
${v.missing.length ? `- MISSING (the listing states these; include every one): ${v.missing.join('; ')}` : ''}
${v.invented.length ? `- INVENTED (the listing never says this; REMOVE it): ${v.invented.join('; ')}` : ''}
${v.warnings.length ? `- CHECK (a guess, not a requirement — include only if the listing really says it): ${v.warnings.join('; ')}` : ''}
${rv.length ? `- THEIR OWN RULES, broken (fix every one, they taught you these): ${rv.join('; ')}` : ''}
${(v.marketing || []).length ? `- MARKETING LANGUAGE THEY NEVER USED (delete it; describe only what they wrote): ${v.marketing.join('; ')}` : ''}`)
        const repaired = extractJson(fix)
        const rparts = langs.map((l) => repaired?.facebook_page?.[l]).filter(Boolean)
        if (rparts.length) {
          const rcap = rparts.join('\n\n• • •\n\n')
          const rvv = captionViolations(rcap, listing)
          const rrules = ruleViolations(rcap, rules, 'facebook_page')
          const before = v.missing.length + v.invented.length + rv.length + (v.marketing || []).length
          const after = rvv.missing.length + rvv.invented.length + rrules.length + (rvv.marketing || []).length
          if (after < before) { caption = rcap; v = rvv; rv = rrules }
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
      //
      // "property name" reaches v.missing ONLY when the parser named the
      // property (listing.propertyName). A name the capitalisation heuristic
      // guessed arrives in v.warnings instead and can never appear here, because
      // that guess refused three good captions in two days - "Sqft Fully
      // Furnished", "City Mall" off a landmark line, and "Jason" off "Call
      // Jason" - each time silently, with the agent's post simply never going
      // out. A guess may warn. Only the parser may refuse.
      // Anchored. `^` bound only to the RM alternative, so ANY missing entry
      // containing the word "hook" or "property name" anywhere blocked - and
      // this filter is the one thing standing between a bad name and a
      // permanent refusal, so it does not get to match loosely.
      const blocking = v.missing.filter((m) => /^(?:RM|the below-value hook|property name)\b/i.test(m))
      if (v.invented.length || blocking.length || v.missing.length > 1) {
        return { caption, degraded: true, warnings: v.warnings,
          reason: `caption breaks the listing contract - ${[...v.invented.map((x)=>`invented "${x}"`), ...v.missing.map((x)=>`missing ${x}`)].join('; ').slice(0, 300)}` }
      }
    }
    warnings = v.warnings
  }
  // A caption that invents a price cut is WORSE than a missing one: it is a
  // misleading claim about a client's property, published under their name.
  // Treat it exactly like a failed generation so the publish gate refuses it.
  if (!degraded && inventsPriceHistory(caption, listing)) {
    return { caption, degraded: true, warnings, reason: 'invented a price reduction the listing never mentioned' }
  }
  return { caption, degraded, warnings }
}

// Punchy TikTok reel script + short caption (falls back to a simple template).
// Returns { script, caption, degraded, reason }. `degraded` means the model never
// wrote this and it is the template below. It used to come back unmarked, so the
// Mac rendered it, /api/hold stored it with nothing to flag, and approve.js had
// nothing to refuse: pending e5f48cc5 sat one ✅ away from putting "Property in
// Kuching — RM1,300 a month" on TikTok while the same listing's FB/IG post was
// correctly blocked. The FB caption path has said `degraded` since the Gemini 429s;
// the reel is the same advert, under the same agent's name, and needs to say it too.
// Hashtags for the fallback reel caption. #KuchingProperty and #Sarawak used to
// be hardcoded here, so every agent's TikTok claimed Sarawak whatever the listing
// said. Derived from the listing's own location instead, and when there is no
// location the geographic tags are simply left off — a hashtag is a claim.
function geoTags(loc) {
  const slug = String(loc || '').replace(/[^a-z0-9]/gi, '')
  return `${slug ? `#${slug}Property ` : ''}#PropertyMalaysia`
}

async function reelScript(listing, status, styleGuide, rules) {
  if (status.configured) {
    try {
      const j = extractJson(await runModel(buildReelPrompt(listing, styleGuide, rules)))
      if (j && j.script) return { script: String(j.script), caption: String(j.caption || ''), degraded: false }
    } catch { /* fall through */ }
  }
  const money = listing.price != null ? `RM${Number(listing.price).toLocaleString('en-MY')}${listing.listingType === 'rental' ? ' a month' : ''}` : ''
  // NO SUBSTITUTE LOCATION. This used to fall back to 'Kuching', which put a town
  // the listing never named into a spoken video and a TikTok caption — for a Miri,
  // Sibu, Bintulu or Johor property, a false fact about a real address on a paying
  // client's account. And there is no model on this path, so no repair round and
  // no fact guard would ever have caught it. An omitted location reads as
  // incomplete; a wrong one is a lie, and only one of those is recoverable.
  const loc = String(listing.location || '').replace(/\s+/g, ' ').trim()
  const script = `Looking for ${loc ? `a place in ${loc}` : 'a new place'}? This ${listing.propertyType || 'one'}${listing.bedrooms != null ? ` has ${listing.bedrooms} bedrooms` : ''}${money ? `, and it's ${money}` : ''}. Trust me, it won't last long. DM me now before it's gone.`
  return {
    script,
    caption: `${listing.propertyType || 'Property'}${loc ? ` in ${loc}` : ''} ${money ? '— ' + money : ''} 🏡 ${geoTags(loc)}`,
    degraded: true,
    reason: status.configured
      ? 'the reel writer failed — this is the deterministic template script, not this agent\'s voice'
      : 'no AI provider configured — this is the deterministic template script, not this agent\'s voice',
  }
}

// A ≤90-char title for platforms that cap the caption (TikTok photo slideshows).
function shortCaption(listing) {
  const money = listing.price == null ? '' : (listing.listingType === 'rental'
    ? `RM${Number(listing.price).toLocaleString('en-MY')}/mo`
    : `RM${Number(listing.price).toLocaleString('en-MY')}`)
  const type = listing.propertyType || (listing.listingType === 'rental' ? 'Rental' : 'Property')
  // Same rule as the reel above: never name a town the listing did not. This is
  // the title TikTok actually publishes.
  const loc = String(listing.location || '').replace(/\s+/g, ' ').trim()
  const s = `${type}${loc ? ` @ ${loc}` : ''}${money ? ` — ${money}` : ''}`
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
    // THE CARD REPLACES THE PHOTO IT WAS MADE FROM — it does not sit in front of
    // it. renderBrandCard takes a listing photo and draws the price panel ON it,
    // so prepending the result to the full list published the same photo twice:
    // once carded, once raw, side by side. Seen on Facebook 2026-09-05, the
    // bedroom shot appearing as image 1 and image 2 of the album.
    //
    // `first` is whichever item the card was actually rendered from, which is
    // not always index 0 — a video can come first — so it is removed by
    // identity rather than by position.
    return {
      items: [{ url: blob.url, type: 'image' }, ...media.filter((m) => m !== first)],
      card: blob.url,
      // Remembered so a later cover change can put this photo back in the album
      // instead of losing it: once it has been folded into a card, its raw URL
      // is nowhere else on the record.
      cardFrom: first.url,
    }
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
    // connectedAccounts takes ONE argument (api/_lib/social.js). This passed the
    // API key as the profile id, so the readiness check has been reporting the
    // account count for a profile that does not exist — to the person deciding
    // whether the system is safe to run. It also read a Zernio-era env var while
    // production runs PostPeer, so `ready` was false on a working install.
    if (profileId) { try { accounts = await connectedAccounts(profileId) } catch (e) { zerr = e.message } }
    return send(res, 200, {
      ready: !!profileId && accounts.length > 0,
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

  // RECOVER — change WHICH PHOTO is the cover on a post already composed,
  // without touching one word of the caption.
  //
  // THE HOLE THIS CLOSES. On 2026-09-05 Owen sent a photo captioned "this is the
  // first photo". The agent answered "Got it — this will be the cover photo for
  // the reel & posts", he said "post it lesgo", and the ORIGINAL cover went out
  // on Facebook, Instagram and TikTok. The model had not disobeyed: the cover is
  // positional (photo[0], see withBrandCard below), AGENTS.md said only "want a
  // different cover? send it first", and there was no command that could change
  // one afterwards. AGENTS.md even listed the cover under "what is trainable",
  // which was simply untrue. So the model was told a capability existed, had no
  // way to use it, and said yes — the same shape as the invented captions.
  //
  // THE CAPTION IS READ FROM THE STORED RECORD, NEVER FROM THE CALLER. That is
  // deliberate: an endpoint that accepted a caption would be a way to hand-write
  // one, which is the thing the whole guard chain exists to prevent. It also
  // means an agent who spent four rounds tuning their caption keeps it.
  if (body?.mode === 'recover') {
    const id = String(body?.pendingId || '').trim()
    if (!id) return send(res, 400, { ok: false, error: 'pendingId is required' })
    const item = await getPending(id)
    if (!item) return send(res, 404, { ok: false, error: 'that post is no longer waiting — it was published or skipped' })

    const fresh = mediaFrom(body)
    if (!fresh.length) return send(res, 400, { ok: false, error: 'a cover needs at least one photo' })

    // Drop the card the previous composition prepended, or it would be carried
    // along as an ordinary photo and the album would grow a stale price panel
    // every time the cover changed.
    const kept = (Array.isArray(item.mediaItems) ? item.mediaItems : [])
      .filter((m) => m && m.url && m.url !== item.cover)
    // The previous cover was folded INTO the old card, so its raw URL is on no
    // other item. Put it back, or changing the cover would quietly delete a
    // photo from the album.
    if (item.cardFrom && !kept.some((m) => m.url === item.cardFrom)) {
      kept.unshift({ url: item.cardFrom, type: 'image' })
    }
    const seen = new Set(fresh.map((m) => m.url))
    const media = [...fresh, ...kept.filter((m) => !seen.has(m.url))].slice(0, 10)

    // Only what renderBrandCard reads. The source is the listing the caption was
    // written from, so the panel keeps saying what it always said.
    const src = item.source || {}
    const listing = {
      price: src.price ?? item.price ?? null,
      location: src.location ?? item.location ?? null,
      listingType: src.listingType ?? item.listingType ?? null,
      bedrooms: src.bedrooms ?? null, bathrooms: src.bathrooms ?? null, sqft: src.sqft ?? null,
      propertyName: src.propertyName ?? null,
    }
    const brand = await getBrand(item.profileId).catch(() => ({}))
    const { items, card, cardError, cardFrom } = await withBrandCard(media, listing, brand, body?.card !== false)

    await putPending({ ...item, mediaItems: items, mediaCount: items.length, cover: card || items[0]?.url || null, cardFrom: cardFrom || null }, id)
    return send(res, 200, {
      ok: true, mode: 'recover', pendingId: id,
      cover: card || items[0]?.url || null, mediaCount: items.length,
      caption: item.caption,
      ...(cardError ? { cardError } : {}),
    })
  }

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
    // The branded card (renders a PNG from the cover) and the spoken script (a
    // model call on the listing text) share nothing, so they run together rather
    // than one after the other. Measured 2026-09-04: the card render and the
    // model call were ~2s and ~7s sequential; overlapped, the reel starts
    // rendering ~2s sooner with byte-identical output.
    // The reel gets the same trained voice and learned rules as the caption -
    // without them an agent's correction fixed only half their output.
    const cardP = withBrandCard(media.slice(0, 1), listing, brand, true)
    const [reelStyle, reelRulesRes] = await Promise.all([getStyle(postProfile), getRules(postProfile)])
    const reelRules = reelRulesRes.rules
    let rs = await reelScript(listing, status, reelStyle, reelRules)
    // The spoken script and the TikTok caption publish under the agent's name
    // too, so they answer to the same contract as the Facebook caption. A reel
    // saying "modern finishes" about a listing that never mentioned them is the
    // same lie, read aloud. One repair attempt naming the offending phrases.
    {
      const rv = captionViolations(`${rs.script || ''}\n${rs.caption || ''}`, listing)
      if (rv.invented.length) {
        const retry = await reelScript(listing, status, reelStyle,
          [...(reelRules || []), `NEVER say any of these - the listing does not support them: ${rv.invented.join('; ')}`])
        const rv2 = captionViolations(`${retry.script || ''}\n${retry.caption || ''}`, listing)
        // `!retry.degraded` matters as much as the count. A retry that fell back
        // returns the deterministic template, which has ZERO inventions by
        // construction - so without this the repair swaps the agent's real copy
        // for the template whenever the retry hits a rate limit, and flags the
        // result degraded. Measured 2026-09-04: a good Riveria Residence caption
        // became "Condo in Kuching - RM498,000" and was refused at the tick.
        if (!retry.degraded && rv2.invented.length < rv.invented.length) rs = retry
      }
    }
    // THE HOLD BODY, ASSEMBLED HERE. The reel caller used to build its own /api/hold
    // request out of this response, and it silently left two fields out of it:
    // captionDegraded (so hold.js defaulted it to false and the ✅ saw a clean
    // record) and the listing text (so approve.js had no source and its fact check
    // returned nothing for every reel ever held). A TikTok reel therefore reached a
    // paying client's account with the checks not weakened but entirely absent.
    //
    // Prose could not fix that: the comment that used to sit here TOLD the caller
    // to forward the flag, and the caller did not. So the body is built on this
    // side and handed over whole. The caller adds only what it alone knows — the
    // rendered mp4 and the cover — and cannot drop a field it never had to copy.
    // Callers that still assemble their own body keep working: every field below
    // is also returned at the top level, exactly as before.
    const holdBody = {
      caption: rs.caption, script: rs.script, platforms: ['tiktok'],
      profileId: postProfile,
      // Assembled here for the same reason as everything else in this object:
      // a caller that has to remember to copy a field is a caller that drops it.
      // /api/approve can now be told who is approving, and a reel pending with
      // no sender is one it can never check.
      sender: meta.sender || null,
      captionDegraded: !!rs.degraded,
      ...(rs.degraded ? { captionDegradedReason: rs.reason } : {}),
      // The agent's own message, so approve.js can measure the caption against it
      // at the ✅ instead of trusting a flag. hold.js takes `sourceText`/`rawText`
      // and deliberately not a bare `text`.
      sourceText: listing.rawText || text || '',
      price: listing.price ?? null, location: listing.location || null,
      listingType: listing.listingType,
    }
    return send(res, 200, {
      ok: true, mode: 'reel', script: rs.script, caption: rs.caption,
      captionDegraded: !!rs.degraded,
      ...(rs.degraded ? {
        captionDegradedReason: rs.reason,
        captionWarning: `the reel writer failed — this is generic template copy, NOT this agent's voice. Do not publish it; POST the holdBody below to /api/hold and the ✅ will refuse it.`,
      } : {}),
      holdBody,
      card: (await cardP).card || media[0]?.url || null, profileId: postProfile, brandApplied,
      listing: { price: listing.price ?? null, location: listing.location || null, bedrooms: listing.bedrooms ?? null, bathrooms: listing.bathrooms ?? null, sqft: listing.sqft ?? null, propertyType: listing.propertyType || null, listingType: listing.listingType },
    })
  }

  const styleGuide = await getStyle(postProfile)

  // Per-agent rules travel with the style: same profile, same isolation.

  const agentRules = (await getRules(postProfile)).rules
  // Report whether a trained style was actually found. A missing style does not
  // error — it silently produces generic copy, which is exactly how an orphaned
  // style went unnoticed after a provider switch. Surface it so the agent can say so.
  const styleApplied = !!(styleGuide.style || (styleGuide.examples || []).length)
  // WhatsApp click-to-chat link is HELD FOR FUTURE (Owen asked to remove it for now).
  // Re-enable by passing { whatsapp: meta.sender }; buildContentPrompt still supports it.
  const contact = null
  // `captionWarnings` are advisory and NEVER block: today they carry the
  // heuristic property-name guess, which used to refuse the post outright.
  const { caption, degraded: captionDegraded, reason: captionDegradedReason = null, warnings: captionWarnings = [] } = await writeCaption(listing, languages, status, styleGuide, contact, agentRules)

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
  const { items: mediaItems, card, cardError, cardFrom } = await withBrandCard(media, listing, brand, body?.card !== false)
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
    await appendFeed({ ...feedBase, at: new Date().toISOString(), profileId: postProfile, platforms: r.platforms, mediaCount: mediaItems.length })
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
      // guarantee — approve must be able to check for itself. The reason travels
      // with it so a refused ✅ can say WHICH failure this was, the same shape
      // /api/hold now writes.
      captionDegraded,
      captionDegradedReason: captionDegraded ? captionDegradedReason : null,
      // The agent's own message, stored the same way /api/hold stores it, so the
      // ✅ can measure this caption against the listing instead of only trusting
      // the flag above. Until now only the reel path could be re-checked at the
      // tick; the review path — the one nearly every post takes — was written,
      // repaired and then published on trust. The write-path check has repair
      // rounds this does not, so this is a second reading of the same evidence,
      // not a replacement for it.
      source: sourceFrom({ sourceText: listing.rawText || text || '', listing }),
      // The photo the price card was drawn on, so a later cover change can restore it.
      cardFrom: cardFrom || null,
    })
    return send(res, 200, {
      ok: true, mode: 'review', pendingId,
      caption, card: card || null, cover: feedBase.cover,
      mediaCount: mediaItems.length, photoCount: media.length,
      styleApplied, brandApplied, profileId: postProfile, captionDegraded,
      ...(captionWarnings.length ? { captionWarnings } : {}),
      ...(captionDegraded ? { captionWarning: 'the AI caption engine failed — this is generic demo text, NOT this agent\'s style. Do not publish it.' } : {}),
      ...(styleApplied ? {} : { styleWarning: 'no trained caption style found for this agent — using the default format' }),
      ...(cardError ? { cardError } : {}), meta,
    })
  } catch (e) {
    return send(res, 502, { ok: false, error: 'Could not hold for approval: ' + (e?.message || String(e)), listing, caption })
  }
}
