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

import { inventsPriceHistory, captionViolations, ruleViolations, nonMoneyInventions, fixWaLinks } from './_lib/postguard.js'
import { buildParsePrompt, buildContentPrompt, buildRepairPrompt, buildReelPrompt, propertyTypeStated } from './_lib/prompts.js'
import { dropSpokenSize } from './_lib/spoken-size.js'
import { formatLost, dropEmptySections } from './_lib/format.js'
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

// What publishes is what gets checked: the agent's own WhatsApp number made
// dialable, and no section heading left standing with nothing under it.
const finish = (text, listing) => dropEmptySections(fixWaLinks(text, listing))

// Which model answered, from a runModel trace array.
const answeredBy = (t) => {
  const a = Array.isArray(t) && t.length ? t[t.length - 1] : null
  return a ? `${a.provider}/${a.model}${a.fellBackFrom ? ` (backup — ${a.fellBackFrom})` : ''}` : null
}

// The findings a caption would be REFUSED for as it stands, as opposed to style
// findings it may publish with. Same rule as the verdict at the end of
// writeCaption; used to decide whether a repair that lost the agent's format is
// still better than the caption it replaces.
const wouldRefuse = (v, ph) => !!ph
  || nonMoneyInventions(v.invented).length > 0
  || v.missing.some((m) => /^RM[\d\s]|^(?:the below-value hook|property name)\b/i.test(m))

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
  let engineError = null
  // WHO WROTE THIS CAPTION, and what each repair round did to it. Returned with
  // the caption. On 2026-09-11 a caption lost its agent's format and nothing
  // could say whether the backup model, the repair round or the first pass had
  // written it; the answer had to be read off the text. Now it is recorded.
  const trace = []
  if (!status.configured) { content = demoContent(listing, ['facebook_page'], langs); degraded = true; engineError = 'no AI provider is configured'; trace.push({ step: 'write', by: 'demo template', why: engineError }) }
  else {
    const t = []
    try { content = extractJson(await runModel(buildContentPrompt(listing, ['facebook_page'], langs, styleGuide, contact, rules), t)); trace.push({ step: 'write', by: answeredBy(t) }) }
    catch (e) {
      // THE ERROR USED TO DIE HERE. `degraded` said THAT the engine failed and
      // nothing anywhere said WHY, so every WhatsApp reply read "the AI caption
      // engine failed — retry once the engine is back": no provider, no status,
      // no timing, and nothing retries. Kept in its OWN field, deliberately not
      // in `captionDegradedReason`: that field's presence is what approve.js and
      // both branches below use to say "the engine is fine, this is the agent's
      // own caption", and putting an engine failure in it would make them tell a
      // human that demo boilerplate is the agent's real copy.
      content = demoContent(listing, ['facebook_page'], langs)
      degraded = true
      engineError = String(e?.message || e).slice(0, 300)
      console.error('[ingest] caption engine failed:', engineError)
      trace.push({ step: 'write', by: 'demo template', why: engineError.slice(0, 160) })
    }
  }
  let parts = langs.map((l) => content?.facebook_page?.[l]).filter(Boolean)
  // A wa.me link built from the agent's own number as they TYPE it opens
  // nothing (Edward's caption carried wa.me/0183929100). The number is theirs,
  // so only its format is wrong — corrected here, before the contract check, so
  // what is checked is what publishes. See fixWaLinks in postguard.js.
  let caption = finish(parts.join('\n\n• • •\n\n'), listing)

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
    // The invented-reduction verdict used to be taken ONCE, after this loop, and
    // was never handed to a repair prompt — so a caption it caught could not be
    // fixed, only refused, and the agent was told the engine had failed. It is a
    // caption violation like any other; it joins the loop and gets the same two
    // rounds to be corrected.
    let ph = inventsPriceHistory(caption, listing)
    for (let attempt = 0; attempt < 2 && (v.missing.length || v.invented.length || rv.length || ph || (v.marketing || []).length); attempt++) {
      // THE REPAIR EDITS THE CAPTION; IT DOES NOT REWRITE IT. It used to resend
      // the whole prompt with the style examples stripped (a token saving) and
      // "fix ONLY these" — without the caption to fix. So it wrote a fresh one
      // from the style's one-paragraph description, and on 2026-09-11 Owen's
      // rental came back with a single "━", its details on one line and its
      // DEPOSIT & TERMS and COMMISSION sections gone. The caption carries the
      // format, so the caption is what gets sent back. See buildRepairPrompt.
      const problems = [
        ...v.missing.map((m) => `MISSING — the listing states this; include it: ${m}`),
        ...v.invented.map((x) => `INVENTED — the listing never says this; remove it: ${x}`),
        ...v.warnings.map((x) => `CHECK — a guess, not a requirement; keep it only if the listing really says it: ${x}`),
        ...rv.map((r) => `THEIR OWN RULE, broken — fix it, they taught you this: ${r}`),
        // A finding that carries its own instruction (a repeated line, a moved
        // qualifier) is passed as it is: "delete it" would remove BOTH copies of
        // a fact the agent gave, when the fix is to keep one.
        ...(v.marketing || []).map((m) => (m.includes(' — ') ? `CORRECT THIS: ${m}` : `MARKETING LANGUAGE THEY NEVER USED — delete it; describe only what they wrote: ${m}`)),
        ...(ph ? ['INVENTED PRICE HISTORY — you claimed this price was reduced. The listing never says so, and there is no earlier or higher asking price. Remove the reduction claim and any earlier figure; state the one price the listing gives.'] : []),
      ]
      const previous = { facebook_page: Object.fromEntries(langs.map((l) => [l, content?.facebook_page?.[l]]).filter(([, c]) => c)) }
      const t = []
      try {
        const repaired = extractJson(await runModel(buildRepairPrompt(listing, previous, problems, rules), t))
        const rparts = langs.map((l) => repaired?.facebook_page?.[l]).filter(Boolean)
        if (rparts.length) {
          const rcap = finish(rparts.join('\n\n• • •\n\n'), listing)
          const rvv = captionViolations(rcap, listing)
          const rrules = ruleViolations(rcap, rules, 'facebook_page')
          const rph = inventsPriceHistory(rcap, listing)
          const before = v.missing.length + v.invented.length + rv.length + (v.marketing || []).length + (ph ? 1 : 0)
          const after = rvv.missing.length + rvv.invented.length + rrules.length + (rvv.marketing || []).length + (rph ? 1 : 0)
          // Fewer findings is necessary, not sufficient: a repair that threw the
          // agent's format away only wins when the caption it replaces would be
          // refused outright. A style finding is never worth the format.
          const lost = formatLost(caption, rcap)
          const accepted = after < before && (!lost || wouldRefuse(v, ph))
          trace.push({ step: `repair ${attempt + 1}`, by: answeredBy(t), findings: `${before} → ${after}`, ...(lost ? { formatLost: lost } : {}), accepted })
          if (accepted) { caption = rcap; content = repaired; v = rvv; rv = rrules; ph = rph }
        } else trace.push({ step: `repair ${attempt + 1}`, by: answeredBy(t), accepted: false, failed: 'no caption in the reply' })
      } catch (e) {
        trace.push({ step: `repair ${attempt + 1}`, by: answeredBy(t), accepted: false, failed: String(e?.message || e).slice(0, 160) })
        break /* repair is best-effort; the verdict below still stands */
      }
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
      //
      // THE MONEY HALF OF THIS FILTER NEVER FIRED. `\b` after `RM` requires a
      // non-word character next, and every entry it was written to catch is
      // "RM" followed by a digit — so /^RM\b/ matched "RM338,000" not at all,
      // and the comment above described a rule that did not exist. What actually
      // blocked was `missing.length > 1`: any two omissions of any kind, which
      // is how two dropped deposit figures and a "DM me" caption with no sqft
      // were refused, while a caption stating NO PRICE AT ALL published clean as
      // long as it dropped nothing else. Both halves are corrected here: money
      // blocks, and a pile of non-material omissions does not.
      const blocking = v.missing.filter((m) => /^RM[\d\s]|^(?:the below-value hook|property name)\b/i.test(m))
      // A BARE MONEY FIGURE IS NOT AN INVENTION — the same exemption approve.js
      // already applies at the ✅. captionViolations() has no arithmetic, so a
      // deposit computed from the stated rent, a 10% downpayment or a 7% bumi
      // discount all read as invented. The model is still handed every one of
      // them BY NAME in the two repair rounds above; what changes is that a
      // figure it declines to delete because the figure is true no longer ends
      // the agent's post with "the AI caption engine failed".
      // What the caption still carries after the repairs, so a finding that
      // survived both rounds is in the trace rather than silently published.
      const left = [...v.missing.map((m) => `missing ${m}`), ...v.invented.map((x) => `invented ${x}`),
        ...rv, ...(v.marketing || []).map((m) => `marketing "${m}"`), ...(ph ? ['invented price history'] : [])]
      if (left.length) trace.push({ step: 'left in', findings: left.slice(0, 6).map((x) => String(x).slice(0, 120)) })
      const refusable = nonMoneyInventions(v.invented)
      if (refusable.length || blocking.length || ph) {
        return { caption, degraded: true, warnings: v.warnings, trace,
          reason: `caption breaks the listing contract - ${[...(ph ? ['invented a price reduction the listing never mentions'] : []), ...refusable.map((x)=>`invented "${x}"`), ...blocking.map((x)=>`missing ${x}`)].join('; ').slice(0, 300)}` }
      }
    }
    warnings = v.warnings
  }
  // A caption that invents a price cut is WORSE than a missing one: it is a
  // misleading claim about a client's property, published under their name — so
  // it still refuses. It is now decided INSIDE the repair loop above (see `ph`),
  // where the model is told what it invented and gets two rounds to take it
  // back, instead of being judged once here with no way to fix it. This line
  // remains for the degraded path, where no contract check ran at all.
  if (degraded && inventsPriceHistory(caption, listing)) {
    return { caption, degraded: true, warnings, engineError, trace, reason: 'invented a price reduction the listing never mentioned' }
  }
  return { caption, degraded, warnings, engineError, trace }
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
      // The TikTok caption is where the dead link actually reached a client:
      // Edward's read "WhatsApp: https://wa.me/0183929100" on 2026-09-12.
      if (j && j.script) return { script: String(j.script), caption: fixWaLinks(String(j.caption || ''), listing), degraded: false }
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
    // ALL the images, not just the hero. renderBrandCard composes a poster now:
    // the first photo is the hero and the next three become the strip along its
    // base. Passing one URL is what made every post use one of the six photos an
    // agent had just sent, and it is what a paying client called "slapping text
    // on the photo". Order is the agent's own order, so the hero is whatever
    // they led with - or whatever `cover` set.
    const png = await renderBrandCard(media.filter((m) => m.type === 'image').map((m) => m.url), listing, brand || {})
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
  // DIAGNOSTICS ONLY, and scoped to the GET branch so it cannot reach a publish.
  // It used to be declared here and used as the fallback for `body.profileId`
  // further down — see the refusal at the POST branch for what that cost.
  const profileId = req.method === 'GET' ? defaultProfile() : ''

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
    const { items, card, cardError, cardFrom } = await withBrandCard(media, listing, brand, brand?.cardEnabled !== false && body?.card !== false)

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
  // Per-tenant: post as the sender's OWN agent (the agent maps sender → agentId
  // in tools/tenants.json). There is no safe fallback — the wrong agent means the
  // wrong accounts AND the wrong caption style, and both fail quietly.
  //
  // THE FALLBACK IS GONE, and this is the line it was on. It read
  // `body?.profileId || defaultProfile()`. With POSTING_PROVIDER=zernio and
  // ZERNIO_PROFILE_ID set to anything, every unmapped sender resolved to that one
  // profile and published to whoever owns it — the wrong Facebook, the wrong
  // Instagram, the wrong TikTok, in the wrong caption style, with the wrong brand
  // and the wrong rules, and reported to the sending agent as a success. The
  // sender arriving unmapped needs no attacker and no mistake by Owen:
  // sidekick.mjs looks tenants.json up by EXACT phone string, so a number that
  // reaches us as "60169219859" instead of "+60169219859" simply misses.
  //
  // An unmapped sender is now refused, in words that name the file to fix.
  const postProfile = body?.profileId || ''
  if (!postProfile) {
    return send(res, 400, { ok: false, error: 'no profile for this sender — add their phone → profileId in tools/tenants.json' })
  }
  // Optional platform filter (e.g. ['facebook','instagram']) — post only to these.
  const platforms = Array.isArray(body?.platforms) && body.platforms.length ? body.platforms : null

  // THIS AGENT'S SAVED SETTINGS - FETCHED TOGETHER, AND BEFORE THE PARSE.
  //
  // Branding is per-agent for the same reason the caption style is: 100 agents on
  // one system must not share one look. An explicit body.brand still wins (the
  // app preview passes one); otherwise the agent's saved brand; env vars last.
  //
  // All three are blob reads keyed on nothing but the profile id, so none of
  // them depends on the message, on the parse, or on each other - yet they used
  // to run one after another with the model call wedged in the middle:
  //   getBrand -> parseText(model) -> getStyle -> getRules -> writeCaption(model)
  // Started here, all three ride along under the parse and are already in hand
  // when the caption is written. Same reads, same values, ~3 round trips of dead
  // air removed from every listing.
  //
  // The .catch() marks each promise as handled. It does NOT swallow anything:
  // every one of them is still awaited below, so a genuine failure still lands
  // where it is read. Without it, the `A reel needs photos` return two branches
  // down would leave style and rules unawaited and turn a degraded blob read
  // into an unhandled rejection that takes out the whole function.
  const brandP = getBrand(postProfile); brandP.catch(() => {})
  const styleP = getStyle(postProfile); styleP.catch(() => {})
  const rulesP = getRules(postProfile); rulesP.catch(() => {})

  // 1) Parse the message  2) write the caption in THIS agent's trained style
  const fields = await parseText(text, status)

  const savedBrand = await brandP
  const brand = { ...savedBrand, ...(body?.brand || {}) }
  const brandApplied = !!(savedBrand.color || savedBrand.name)
  const listing = { ...fields, // NO DEFAULT. A guessed transaction type is worse than none: the rule below
    // returns silently when the type is unknown, but a WRONG type turns a correct
    // caption into a contradiction. demoParse — the fallback used every time the
    // free tier rate-limits — could not read 出租 at all, so every Chinese rental
    // defaulted to 'sale' and its correct caption was refused.
    listingType: fields.listingType || null, rawText: text }

  // AN INFERRED TYPE IS DROPPED HERE, NOT FURTHER DOWN.
  //
  // Gating the facts block in buildContentPrompt was not enough, and production
  // said so on 2026-09-09: with the model rate-limited - which on the free tier
  // is most of the afternoon - demoContent runs instead, and it renders
  // `${l.propertyType || 'Property'}` straight into the caption. Two runs in six
  // came back "✨ Condo in The Northbank, Kuching — now available" with the
  // prompt fix already deployed, because the fallback never reads the prompt.
  //
  // Every renderer downstream already has a correct answer for null - "Property",
  // "one", "Rental" - so removing the guess once, here, fixes the prompt, both
  // fallback caption sets, the reel script and the price card together. The
  // alternative was patching six renderers and finding the seventh in a client's
  // published post.
  if (!propertyTypeStated(listing)) listing.propertyType = null

  // NOTHING TO SAY, SAID CONFIDENTLY.
  //
  // Measured 2026-09-08. Six photos reached the agent eight seconds before the
  // listing text did - media is never debounced, so the run started without it -
  // and this endpoint composed anyway. With text:'' it returned ok:true and a
  // finished reel script: "Looking for a new place? This one. Trust me, it won't
  // last long. DM me now before it's gone." Voiced over a stranger's photos,
  // that is a complete, publishable TikTok about a property the system knows
  // nothing whatsoever about. The feed path did the same, filling in
  // "[Specify Location]" and tagging it #PCMY_Sale - a transaction type nobody
  // anywhere had stated.
  //
  // Every other guard in this file checks a caption against the listing. None of
  // them fire here, because with no listing there is nothing to contradict: an
  // empty source makes every invention unfalsifiable. So the refusal has to
  // happen before the model is asked, not after it answers.
  //
  // NARROW ON PURPOSE, AND IT COSTS SOMETHING TO GET WRONG. This file has
  // shipped seven guards that refused real work, so this one refuses only when
  // ALL THREE are true - any one of them alone means there is something real to
  // write from:
  //   - the parse recovered no fact (price, size, location, rooms, type), AND
  //   - the text contains no digit anywhere, AND
  //   - there is no substantial text either.
  //
  // The digit clause is the one that matters most. Every real property listing
  // carries a number - a price, a size, a floor, a room count, a phone - so a
  // message with none of them is not a listing that the parser missed. Without
  // it this guard refused "For rent in Kuching, RM1,300 per month, 3 rooms" the
  // moment the parse came back empty, which is exactly what a rate-limited free
  // tier does several times a day. That is the eighth silent refusal, caught in
  // its own test file rather than in someone's chat.
  //
  // The length clause covers the rest: when an agent writes real prose about a
  // unit and the parser recovers nothing, their words are still there and the
  // model has something true to paraphrase.
  const parsedAnything = [fields.price, fields.bedrooms, fields.bathrooms, fields.sqft,
    fields.location, fields.propertyName, fields.title, fields.propertyType, fields.furnishing]
    .some((v) => v !== null && v !== undefined && v !== '')
  // Emoji and punctuation are not a listing. Count letters and digits only, so
  // "📸📸" and "-----" read as the empty messages they are.
  // MEASURED IN INFORMATION, NOT CHARACTERS.
  //
  // A plain character count quietly refuses Chinese. The same listing -
  // location, type, room count, price on request - is 91 characters in English
  // and 22 in Chinese:
  //     出租 古晋 公寓 两房两厅 价格面议 请私信
  // so the English one passed this guard and the Chinese one was refused, for
  // no reason but its script. Half this market writes in Chinese, and Chinese
  // rentals have already cost this codebase one silent refusal (demoParse could
  // not read 出租, so every one of them was typed as a SALE).
  //
  // One CJK character carries about what an English word does, so it counts for
  // about as many characters as a word: enough that a real listing clears the
  // bar in either script.
  const CJK = /[\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/gu
  const raw = String(text || '')
  const cjkCount = (raw.match(CJK) || []).length
  const words = raw.replace(CJK, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().length + cjkCount * 4
  const hasNumber = /\d/.test(raw)
  if (!parsedAnything && !hasNumber && words < 60) {
    return send(res, 200, {
      ok: false,
      reason: 'no listing to post — this message has photos but no property details. Ask the agent to send the listing text (price, size, location), then run this again with it.',
      listing, meta,
    })
  }

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
    const [reelStyle, reelRulesRes] = await Promise.all([styleP, rulesP])
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
    // The floor area is on the reel's price bar for the whole video, so the voice
    // does not also read it out — see spoken-size.js. The TikTok caption keeps it.
    const spokenBefore = rs.script
    rs = { ...rs, script: dropSpokenSize(rs.script, listing) }
    const sizeRemovedFromScript = rs.script !== spokenBefore
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
      // Whether the backstop had to act — how often the model still says the size.
      ...(sizeRemovedFromScript ? { sizeRemovedFromScript: true } : {}),
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

  const styleGuide = await styleP

  // Per-agent rules travel with the style: same profile, same isolation.

  const rulesRes = await rulesP
  const agentRules = rulesRes.rules
  // Report whether a trained style was actually found. A missing style does not
  // error — it silently produces generic copy, which is exactly how an orphaned
  // style went unnoticed after a provider switch. Surface it so the agent can say so.
  const styleApplied = !!(styleGuide.style || (styleGuide.examples || []).length)
  // WHERE the style came from, not just whether there was one. 'primary' is the
  // agent's own key; 'legacy:<oldId>' means the read-through fallback fired and
  // this agent is still being served from a key they used to be known by — true
  // and worth knowing, because it is the difference between "the migration is
  // working" and "the migration has not happened yet". 'degraded' means the blob
  // store failed and empty is NOT proof the agent is untrained.
  const styleSource = styleGuide.source || 'none'
  const rulesSource = rulesRes.source || 'none'
  // A degraded read must never be reported as "no style" — that is the sentence
  // that would send someone off to retrain a style that was never lost.
  const settingsDegraded = !!(styleGuide.degraded || rulesRes.degraded || savedBrand.degraded)
  // Spliced into every response shape below, so "did the fallback fire?" and
  // "was this empty or merely unreadable?" are answered by the response instead
  // of by someone guessing after the fact.
  const settingsReport = {
    styleSource, rulesSource,
    ...(settingsDegraded ? { settingsDegraded: true } : {}),
    ...(styleSource.startsWith('legacy:') || rulesSource.startsWith('legacy:')
      ? { settingsNote: `served from a previous profile id (style: ${styleSource}, rules: ${rulesSource}) — the settings are intact but not yet re-keyed` }
      : {}),
  }
  // The warning an agent actually reads. A DEGRADED read is not "no style": it is
  // "we could not tell", and saying "no trained style" there is how somebody ends
  // up retraining a style that was never lost.
  const styleWarn = settingsDegraded
    ? 'could not read this agent\'s saved settings (the store did not answer) — this caption may not be in their trained format. Do NOT retrain: nothing has been lost, the read failed.'
    : styleApplied ? null
      : 'no trained caption style found for this agent — using the default format'
  // WhatsApp click-to-chat link is HELD FOR FUTURE (Owen asked to remove it for now).
  // Re-enable by passing { whatsapp: meta.sender }; buildContentPrompt still supports it.
  const contact = null
  // `captionWarnings` are advisory and NEVER block: today they carry the
  // heuristic property-name guess, which used to refuse the post outright.
  // THE CARD DOES NOT WAIT FOR THE CAPTION.
  //
  // renderBrandCard draws the price panel onto the cover photo from `listing`
  // and `brand`. It has never read the caption - it cannot, the caption is not
  // one of its arguments - yet it ran strictly after writeCaption, which is two
  // model calls plus up to two repair rounds. Measured 2026-09-08 against the
  // live function: the card render and its blob write are ~3.2s of the ~8s an
  // agent spends staring at a silent chat, and every one of those seconds was
  // spent waiting for something the card does not use.
  //
  // The reel branch has overlapped these two since 2026-09-04 (see cardP above);
  // this is the same move on the path that actually carries every listing.
  //
  // Started only when it will be used. `dry` returns before any card is made and
  // a listing with no photo returns too, so starting it on those paths would
  // burn a blob write on a result nobody reads. withBrandCard cannot reject -
  // every failure comes back as { items, cardError } - so there is no unhandled
  // rejection to guard even on the paths that return without awaiting it.
  const wantsCard = brand?.cardEnabled !== false && body?.card !== false
  const socialCardP = (body?.dry !== true && media.length)
    ? withBrandCard(media, listing, brand, wantsCard)
    : null

  const { caption, degraded: captionDegraded, reason: captionDegradedReason = null, warnings: captionWarnings = [], engineError: captionEngineError = null, trace: captionTrace = [] } = await writeCaption(listing, languages, status, styleGuide, contact, agentRules)
  // One log line per caption naming the model and every repair, so the next
  // "it forgot my format" is answered from the log, not read off the text.
  console.log('[ingest] caption trace', JSON.stringify({ sender: meta.sender || null, trace: captionTrace }))

  // Wiring test — parse + caption only. No card, no store, no post.
  if (body?.dry === true) {
    // Report the same flags as a real post — the dry path is what the health check
    // and any wiring test uses, so it must not look healthier than the real thing.
    // The healthcheck's only attempt to name a cause reads `error`/`captionWarning`
    // off this response, and neither has ever been in it — so an operator alert
    // could say DEGRADED and never say why. Both causes are reported here now,
    // in the same fields the review path already uses.
    return send(res, 200, { ok: true, mode: 'dry', listing, caption, captionTrace, media, meta, styleApplied, brandApplied, captionDegraded, profileId: postProfile, ...settingsReport,
      ...(captionDegraded ? { captionDegradedReason, captionEngineError,
        captionWarning: captionDegradedReason
          ? `✅ would refuse this: ${captionDegradedReason}`
          : `the caption engine failed: ${captionEngineError || 'cause not reported'}` } : {}),
      ...(styleWarn ? { styleWarning: styleWarn } : {}) })
  }

  // A property post needs a photo.
  if (!media.length) {
    return send(res, 200, { ok: false, held: false, reason: 'No photo in the message — nothing prepared', listing, caption, meta })
  }

  // Render the branded cover + final media once (the approver sees the real thing).
  const { items: mediaItems, card, cardError, cardFrom } = await socialCardP
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
      // TWO DIFFERENT CAUSES, ONE MESSAGE. `captionDegraded` is set either
      // because the model call really failed (and this IS demo boilerplate), or
      // because the caption broke the listing contract — in which case it is the
      // agent's real styled copy and the engine worked perfectly. Telling them
      // "the engine failed, retry once it is back" in the second case is false
      // AND unactionable: it will fail identically forever, and it sends whoever
      // reads it to debug the wrong system. writeCaption() already returns the
      // true reason; it just was not being said out loud anywhere.
      return send(res, 503, {
        ok: false, posted: false, blocked: 'captionDegraded', listing, caption, captionTrace,
        captionDegradedReason,
        ...(captionEngineError ? { captionEngineError } : {}),
        error: captionDegradedReason
          ? `refusing to auto-publish: ${captionDegradedReason}. The caption engine is fine — this caption does not match the listing, so retrying will produce the same refusal.`
          : `the AI caption engine failed — refusing to auto-publish generic demo text. Cause: ${captionEngineError || 'not reported'}.${status.configured ? ' Re-send this listing in about a minute; the free per-minute budget refills.' : ' No re-send will help until a provider key is set.'}`,
      })
    }
    const r = await postToConnected({ caption, captionShort, mediaItems, key, profileId: postProfile, platforms })
    if (!r.ok) return send(res, r.error ? 502 : 200, { ok: false, posted: false, reason: r.reason, error: r.error, listing, caption })
    await appendFeed({ ...feedBase, at: new Date().toISOString(), profileId: postProfile, platforms: r.platforms, mediaCount: mediaItems.length })
    // The auto path publishes immediately, so its report is the ONLY chance anyone
    // has to notice the caption did not come out in this agent's trained format —
    // AND the only chance to notice a platform they asked for never went out.
    //
    // postToConnected has two callers and only approve.js carried `skipped`
    // through. Asking for facebook+instagram here with only Facebook connected
    // answered `{ok:true, posted:['facebook']}` and never mentioned Instagram.
    // This is the path with NO HUMAN IN THE LOOP, so a silent omission here is
    // the one nobody ever finds.
    return send(res, 200, { ok: true, mode: 'auto', posted: r.platforms, ...(r.skipped?.length ? { skipped: r.skipped } : {}), ...(r.partialErrors?.length ? { partialErrors: r.partialErrors } : {}), listing, caption, card: card || null, ...(cardError ? { cardError } : {}), styleApplied, ...settingsReport, ...(styleWarn ? { styleWarning: styleWarn } : {}), meta })
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
      caption, captionTrace, card: card || null, cover: feedBase.cover,
      mediaCount: mediaItems.length, photoCount: media.length,
      styleApplied, brandApplied, profileId: postProfile, captionDegraded,
      ...settingsReport,
      ...(captionWarnings.length ? { captionWarnings } : {}),
      ...(captionDegraded ? { captionDegradedReason } : {}),
      // Same two causes as the AUTO branch above — say which one it was.
      ...(captionDegraded ? { captionWarning: captionDegradedReason
        ? `✅ will refuse this: ${captionDegradedReason}. This is the agent's real caption and the engine is fine, so re-sending will not change it — fix the caption or the listing text.`
        : 'the AI caption engine failed — this is generic demo text, NOT this agent\'s style. Do not publish it. '
        + 'It is held, not lost: discard it with `approve <id> skip` and send the listing again once the engine is back.' } : {}),
      ...(styleWarn ? { styleWarning: styleWarn } : {}),
      ...(cardError ? { cardError } : {}), meta,
    })
  } catch (e) {
    return send(res, 502, { ok: false, error: 'Could not hold for approval: ' + (e?.message || String(e)), listing, caption })
  }
}
