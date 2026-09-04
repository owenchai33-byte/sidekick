// Last line of defence before anything reaches a client's public page.
//
// On 2026-09-01 a single listing went out to Facebook and Instagram THREE times
// (06:33:13, 06:34:16, 06:35:23) carrying demo boilerplate, after the operator
// merely ASKED "fb and ig posted?". Two things made that possible:
//
//   1. api/social-broadcast.js does its own fetch instead of postToConnected,
//      so it had no duplicate protection and no degraded-caption check.
//   2. The agent has an `exec` tool, so it can call any endpoint directly and
//      skip the approve pipeline whenever it dislikes the tool's output - which
//      is exactly what it did ("using your approved caption ... since the tool
//      generates generic versions").
//
// Guards that live in approve.js therefore protect nothing. They have to live
// where the post actually happens, and every posting path has to share them.
import { put, list, del } from '@vercel/blob'
import { createHash } from 'node:crypto'

const SEEN = 'post-once/'
// Long enough to swallow an agent retry storm or a double-tap, short enough that
// a deliberate repost later in the day still works.
const WINDOW_MS = Number(process.env.POST_DEDUPE_WINDOW_MS || 10 * 60 * 1000)

const token = () => process.env.BLOB_READ_WRITE_TOKEN || ''

/** Stable id for "this exact post to these exact accounts". */
export function postFingerprint({ profileId, caption, platforms, mediaItems }) {
  const media = (mediaItems || []).map((m) => m?.url || '').sort().join('|')
  const plats = [...(platforms || [])].map(String).sort().join(',')
  return createHash('sha256')
    .update(`${profileId || ''} ${plats} ${(caption || '').trim().slice(0, 400)} ${media}`)
    .digest('hex').slice(0, 32)
}

/**
 * True if this caller may publish. False means an identical post went out
 * within the window - almost always a retry or a confused re-send.
 * Fails OPEN when Blob is unavailable: refusing to post because the dedupe
 * store is down would be a worse failure than a rare duplicate.
 */
export async function claimPostOnce(fp) {
  const t = token()
  if (!t) return true
  const key = `${SEEN}${fp}.json`
  try {
    await put(key, JSON.stringify({ at: Date.now() }), {
      access: 'public', token: t, contentType: 'application/json',
      addRandomSuffix: false, allowOverwrite: false,
    })
    return true
  } catch {
    try {
      const { blobs } = await list({ prefix: key, token: t, limit: 1 })
      const b = blobs[0]
      if (!b) return true
      if (Date.now() - new Date(b.uploadedAt).getTime() > WINDOW_MS) {
        await del(b.url, { token: t })
        return true          // the window has passed; a deliberate repost is fine
      }
      return false           // identical post, moments ago
    } catch { return true }
  }
}

/** Undo the claim when the publish failed, so a real retry is not blocked. */
export async function releasePostOnce(fp) {
  const t = token()
  if (!t) return
  try {
    const { blobs } = await list({ prefix: `${SEEN}${fp}.json`, token: t, limit: 1 })
    if (blobs[0]) await del(blobs[0].url, { token: t })
  } catch { /* best effort */ }
}

// The exact shape demoContent() produces when the model call fails. Publishing
// this under an agent's name is worse than publishing nothing.
const DEMO_MARKERS = [
  /Property in .+ — now available/,
  /Looking for a place that just feels right\?/i,
  /ready for its next owner/i,
  /send over the full details and viewing times/i,
]

/** True if this caption is the demo fallback rather than a real, styled caption. */
export function looksLikeDemoCaption(caption) {
  const c = String(caption || '')
  return DEMO_MARKERS.filter((re) => re.test(c)).length >= 2
}


// Fabricated price history.
//
// Measured 2026-09-02 across 16 generations: given "RM338,000, RM100k below
// value", the model wrote "RM438,000 / NOW ONLY RM338,000 / PRICE REDUCED" in
// EIGHT of eight sale captions. "Below value" is a comparison to a valuation;
// it is not a previous asking price, and advertising a reduction that never
// happened is a misleading claim about someone else's property.
//
// A prompt rule did not stop it — this is the enforcement. Anything that claims
// a reduction the listing never mentioned is treated as a degraded caption, and
// the existing publish gate then refuses it.
// Two halves, because the trailing \b is what made the original "was rm" dead
// letter: in "Was RM438,000" the character after "rm" is a digit, so there is no
// word boundary there and the alternative never fired. The rm-prefixed phrasings
// therefore end at "rm" with nothing after them.
const REDUCTION_CLAIM = /\b(?:now only|reduced from|reduced by|slashed|off the asking price|price\s*(?:reduced|reduction|drop|dropped|slashed|cut))\b|\b(?:was|down from|originally|previously)\s*(?:priced\s*at\s*)?rm/i

/**
 * True when the caption claims a price cut the source listing never made.
 * Only fires when the listing itself says nothing about a reduction, so a
 * genuinely reduced listing still advertises normally.
 */
export function inventsPriceHistory(caption, listing) {
  const cap = String(caption || '')
  if (!REDUCTION_CLAIM.test(cap)) return false
  // The agent's own words are the authority. If THEY said it was reduced, fine.
  const source = `${listing?.rawText || ''} ${listing?.title || ''}`
  return !REDUCTION_CLAIM.test(source)
}


// The caption contract, enforced.
//
// 2026-09-02, live on the client's page: "Fully Furnished" and "Move-in Ready"
// on a unit whose listing never mentioned furnishing - while the listing's OWN
// selling points (RM100K below value, the property name, every location perk)
// were dropped. The owner's instruction was explicit: include what the listing
// says, invent nothing. Prompt rules and spot-checks caught the LAST failure
// each time; this checks the contract itself, on every caption, in code.
//
// MISSING: the facts a buyer decides on. Every RM amount, the size, the
// contact, the below-value hook, the property name - if the listing says it,
// the caption must carry it.
// INVENTED: material claims about the property (furnishing, condition, views,
// tenure, being newly renovated) that the listing never made.
const MATERIAL_CLAIMS = [
  [/fully[ -]furnished|semi[ -]furnished|partially[ -]furnished|unfurnished/i, /furnish/i],
  [/move[- ]?in ready/i, /move[- ]?in ready|vacant|ready/i],
  [/newly renovated|renovated/i, /renovat/i],
  [/freehold/i, /freehold/i],
  [/leasehold/i, /leasehold/i],
  [/(stunning|sea|city|river|mountain|panoramic) view/i, /view/i],
  [/corner (lot|unit)/i, /corner/i],
]

/** Multi-word proper names from the listing's opening lines ("Tropics City"). */
export function propertyNames(rawText, listing) {
  const head = String(rawText || '').split('\n').slice(0, 5).join(' ')
  const out = []
  for (const m of head.matchAll(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)+|[A-Z]{3,}(?: [A-Z]{3,})+)\b/g)) {
    let name = m[1].trim()
    // Generic listing vocabulary is not part of a name, but it usually arrives
    // ATTACHED to one: "Tropics City For Sale" is the property "Tropics City".
    // Discarding the whole phrase lost the name entirely; trim the generic words
    // off the edges and keep the core.
    const GENERIC = /^(for|sale|rent|unit|bedroom|bedrooms|bathroom|bathrooms|rare|price|value|details|location|investment|property|selling|below|bank|current|rental|annual|gross|yield|contact|lister|prime|kuching|sarawak|sqft|sq|ft|bed|beds|bath|baths|floor|storey|story|carpark|month|nego|furnished|furnishing|land|lot|commercial|residential|area|acre|acres|agent|zone|freehold|call|hubungi|whatsapp|wasap|tel|telefon|hp|per|room|rooms|studio|apartment|condo|condominium|terrace|teres|semi|detached|bungalow|shoplot|shop|office|house|rumah|bilik|tanah|homestay|penthouse|duplex|townhouse)$/i
    let parts = name.split(/\s+/)
    while (parts.length && GENERIC.test(parts[0])) parts.shift()
    while (parts.length && GENERIC.test(parts[parts.length - 1])) parts.pop()
    if (parts.length < 2) continue          // a single bare word is too weak to be a name
    name = parts.join(' ')
    // The AREA is already its own field - "Tabuan Dayak" is where it is, not
    // what it is called. Treating it as a property name made the validator
    // demand it twice and muddied the real name.
    if (listing?.location && name.toLowerCase() === String(listing.location).toLowerCase()) continue
    out.push(name)
  }
  // RANK the candidates. "Brand New RENNA RESIDENCE for Rent" yields both
  // "Brand New" and "RENNA RESIDENCE", and taking the first meant telling the
  // model the property was called "Brand New" — which is exactly how the name
  // went missing from a caption. Marketing filler is never a name, and an
  // ALL-CAPS phrase almost always is.
  const FILLER = /^(brand|new|rare|beautiful|spacious|modern|luxury|prime|freehold|leasehold|the|this|fully|semi|partially|super|mega|hot|best|good|nice)$/i
  // A contact line is not a property name. "Call Jason 0128887766" and
  // "Hubungi Azlan 0198887766" were both being returned as REQUIRED names, and
  // because a missing name blocks in ingest.js, a perfectly good caption that
  // wrote the contact as "Jason 0128887766" was refused every time. Verified
  // 2026-09-04 on three ordinary listings - English, Malay and an all-caps room
  // ad - all three blocked. Same shape as the one-line bug the day before: the
  // extractor reading whatever is capitalised near the top as a name.
  const CONTACT_LEAD = /^(call|contact|hubungi|whatsapp|wasap|dm|pm|tel|telefon|hp|lister|agent|sila)\b/i
  const scored = [...new Set(out)].filter((n) => !CONTACT_LEAD.test(n))
    .filter((n) => !n.split(/\s+/).every((w) => FILLER.test(w)))
    .map((n) => {
      let score = 0
      if (/^[A-Z0-9 ]+$/.test(n)) score += 3                       // ALL CAPS reads as a name
      if (/\b(residence|residency|city|park|heights|court|villa|tower|suites|garden|point|square|place|hill|view|homes?)\b/i.test(n)) score += 3
      // filler words dragged along by the regex ("Brand New RENNA") weaken it
      score -= n.split(/\s+/).filter((w) => FILLER.test(w)).length
      return { n, score }
    })
    .sort((a, b) => b.score - a.score)
  // Only the BEST candidate is the name. The caller treats every returned name
  // as REQUIRED in the caption, and a listing written on one line hands this
  // regex several capitalised runs: "Brand New RENNA RESIDENCE for Rent. ... 787
  // Sqft Fully Furnished 12th Floor" yields both "RENNA RESIDENCE" and "Sqft
  // Fully Furnished", and demanding the second one degraded every caption for
  // that listing, every time. The multi-line fixtures this was measured on never
  // showed it. A property has one name; return the winner and, only when the
  // ranking is genuinely tied, the joint winners.
  if (!scored.length) return []
  const best = scored[0].score
  return scored.filter((x) => x.score === best).map((x) => x.n)
}

// Invented NUMBERS.
//
// The guard read every material claim except the two a buyer actually acts on:
// how many rooms, and how much money. Verified 2026-09-03 against a 2-bed/2-bath
// listing, these all published clean: "4 bedrooms and 3 bathrooms", "Deposit
// RM10,000", "Originally RM438,000 - yours for RM338,000".
//
// The first attempt at the money half was reverted the same day, and the reason
// is the whole design of what follows. It built its set of known amounts by
// regexing "RM" out of rawText alone. A listing written "450k nego" carries no
// "RM" at all, so the set came back empty while the parser had already produced
// price = 450000 and prompts.js had already told the model "Asking price:
// RM450,000". The model obeyed, and the guard called the agent's own asking
// price an invention - after which the repair loop in ingest.js instructed it to
// DELETE the price, and a price-less advert published as clean. A guard that
// wrongly refuses is worse than one that misses, because the refusal is silent
// and total. So: the known set is built from rawText AND every number the parser
// produced, matched numerically rather than as text, with room for the figures a
// caption legitimately computes.

const MULTIPLIER = { k: 1e3, juta: 1e6, jt: 1e6, mil: 1e6, million: 1e6, m: 1e6, '万': 1e4, '萬': 1e4 }
// buildParsePrompt accepts "RM 450k", "2.5k/month", "juta"/"mil"/"m" for
// millions, so the guard has to read every notation the parser does.
// The leading \b is load-bearing: without it "form 3 bedrooms" reads as "rm 3"
// the guard reads an invented amount out of the word "form".
// The trailing boundary is a negative lookahead, NOT \b. \b is defined on
// [A-Za-z0-9_], so a multiplier that is not an ASCII word character - 万 and
// 萬 - only satisfied \b when an ASCII character happened to follow it.
// Measured: 'RM43万 3房' matched 'RM43' and dropped the 万, turning 430,000
// into 43, so the caption's own asking price looked invented and the repair
// loop then told the model to delete it. Chinese listings are a large share
// of this market, so that is not an edge case. The ASCII multipliers keep their
// boundary (so 'form 3' is not read as 'rm 3'); the CJK ones need none, because
// '43万3房' is ordinary and a lookahead there drops the 万 again.
const RM_AMOUNT = /\brm\s*(\d[\d,]*(?:\.\d+)?)\s*((?:k|juta|jt|mil|million|m)\b|万|萬)?/gi
// Bare figures in the SOURCE only, and never a bare "m" - "12 m" is far more
// likely a measurement than twelve million, and every entry here only ever
// makes the guard more permissive.
const BARE_AMOUNT = /(?<![\w.,])(\d[\d,]*(?:\.\d+)?)\s*((?:k|juta|jt|mil|million)\b|万|萬)?/gi

function amountOf(digits, suffix) {
  const n = parseFloat(String(digits).replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  const s = String(suffix || '').toLowerCase()
  return s && MULTIPLIER[s] ? n * MULTIPLIER[s] : n
}

/** Every money figure this listing can justify, as numbers. Generous on purpose. */
export function knownAmounts(listing) {
  const src = String(listing?.rawText || '')
  const out = new Set()
  const add = (v) => { if (Number.isFinite(v) && v > 0) out.add(v) }

  for (const m of src.matchAll(RM_AMOUNT)) add(amountOf(m[1], m[2]))
  for (const m of src.matchAll(BARE_AMOUNT)) {
    // a bare one- or two-digit number is a bedroom count or a floor, not a price
    if (!m[2] && m[1].replace(/[,.].*$/, '').length < 3) continue
    add(amountOf(m[1], m[2]))
  }
  // THE PART THE REVERTED ATTEMPT MISSED: what the parser produced. prompts.js
  // hands the model listing.price verbatim, so listing.price is by definition a
  // legitimate figure for the caption to carry, however the source spelled it.
  for (const [k, v] of Object.entries(listing || {})) {
    if (typeof v === 'number' && /price|rent|value|deposit|fee|amount|psf|monthly|annual|cost/i.test(k)) add(v)
  }
  const price = Number(listing?.price)
  if (Number.isFinite(price) && price > 0) {
    add(price)
    add(price * 12)                       // annual rental, computed from the monthly asking price
    for (const area of [listing?.sqft, listing?.landSqft]) {
      const a = Number(area)
      if (!Number.isFinite(a) || a <= 0) continue
      const psf = price / a
      add(psf)
      for (const step of [10, 50, 100]) add(Math.round(psf / step) * step)  // agents quote psf rounded
    }
  }
  return [...out]
}

/** 1% either way, so a caption that rounds a figure has not invented one. */
function matchesKnown(v, known) {
  return known.some((k) => Math.abs(k - v) <= Math.max(1, k * 0.01))
}

// Room counts. Compared against the PARSED fields, which the parser has already
// normalised across "2 Bed", "2 bilik tidur" and "2房" - never against rawText,
// where a bare regex would read "3 storey" or "2+1" as a bedroom count.
const BED_STATED = /(\d+)\s*[-–]?\s*(?:bedrooms?|bed\b|beds\b|rooms?\b|bilik\s+tidur|bilik(?!\s*(?:air|mandi))\b|房(?:间|間)?|室)/gi
const BATH_STATED = /(\d+)\s*[-–]?\s*(?:bathrooms?|baths?\b|toilets?|washrooms?|bilik\s+(?:air|mandi)|tandas|厕(?:所)?|浴室?|卫(?:生间|浴)?)/gi

function statedCounts(text, re) {
  const out = new Set()
  for (const m of String(text || '').matchAll(re)) {
    const n = Number(m[1])
    if (Number.isFinite(n)) out.add(n)
  }
  return out
}

/**
 * Room counts in the caption that contradict the parsed listing.
 * Silent whenever the parsed field is absent - an unknown truth cannot be
 * contradicted - and silent when the SOURCE itself states the caption's number,
 * so a parser slip can never make the guard refuse a faithful caption.
 */
export function contradictsRoomCounts(caption, listing) {
  const cap = String(caption || '')
  const out = []
  // "2+1 rooms" is one Malaysian listing's way of writing a utility room; the
  // second number is not a bedroom and this is not the pass to interpret it.
  const plusRooms = /\d\s*\+\s*\d/.test(cap)
  const fields = [
    ['bedroom', listing?.bedrooms, BED_STATED, plusRooms],
    ['bathroom', listing?.bathrooms, BATH_STATED, false],
  ]
  for (const [label, parsed, re, skip] of fields) {
    const n = Number(parsed)
    if (skip || parsed == null || !Number.isFinite(n)) continue
    const inSource = statedCounts(listing?.rawText, re)
    for (const stated of statedCounts(cap, re)) {
      if (stated === n || inSource.has(stated)) continue
      out.push(`${stated} ${label}${stated === 1 ? '' : 's'} (the listing says ${n})`)
    }
  }
  return out
}

/**
 * Returns { missing: [...], invented: [...] } - both empty means the caption
 * honours the listing. `listing` is the parsed listing incl. rawText.
 */
export function captionViolations(caption, listing) {
  const cap = String(caption || '')
  const capLow = cap.toLowerCase()
  const src = `${listing?.rawText || ''}`
  const srcLow = src.toLowerCase()
  const missing = [], invented = []

  // -- MISSING ---------------------------------------------------------------
  // every distinct money amount the listing states (RM338,000 / RM1,300 / RM15,600 / RM100K)
  for (const m of new Set([...src.matchAll(/rm\s?([\d,]+(?:\.\d+)?\s*k?)/gi)].map((x) => x[1].replace(/\s/g, '').toLowerCase()))) {
    const canon = m.endsWith('k') ? String(parseFloat(m) * 1000) : m.replace(/,/g, '')
    const inCap = capLow.includes(m) || cap.replace(/,/g, '').includes(canon)
    if (!inCap) missing.push(`RM${m.toUpperCase()}`)
  }
  const sq = src.match(/([\d,]+)\s*(?:sq\s?ft|sqft|square feet)/i)
  if (sq && !cap.replace(/,/g, '').includes(sq[1].replace(/,/g, ''))) missing.push(`${sq[1]} sqft`)
  const phone = src.match(/\b(01\d[- ]?\d{7,8})\b/)
  if (phone && !cap.replace(/[- ]/g, '').includes(phone[1].replace(/[- ]/g, ''))) missing.push(`contact ${phone[1]}`)
  // The hook is a CONCEPT, and agents publish in English, Chinese and Malay.
  // An English-only test scored a Chinese caption that plainly said 低于市价 as
  // having dropped the hook, and the repair loop then chased a phrase that was
  // already there.
  const HOOK_SRC = /below (?:bank )?value|below market|低于|市价|bawah nilai|harga pasaran/i
  const HOOK_CAP = /below (?:bank )?value|below market|save[sd]? rm|低于|市价|省下|优惠|bawah nilai|harga pasaran|jimat/i
  if (HOOK_SRC.test(src) && !HOOK_CAP.test(cap)) missing.push('the below-value hook')
  for (const name of propertyNames(src, listing)) {
    if (!capLow.includes(name.toLowerCase())) missing.push(`property name "${name}"`)
  }

  // -- INVENTED --------------------------------------------------------------
  const known = `${srcLow} ${String(listing?.furnishing || '').toLowerCase()} ${String(listing?.tenure || '').toLowerCase()}`
  for (const [claim, grounds] of MATERIAL_CLAIMS) {
    if (claim.test(cap) && !grounds.test(known)) invented.push(cap.match(claim)[0])
  }
  // room counts that contradict the parsed listing (2-bed sold as "4 bedrooms")
  invented.push(...contradictsRoomCounts(cap, listing))
  // money the listing cannot justify. Skipped entirely when there is nothing to
  // check against: with no source text and no parsed price, every figure would
  // look invented and the caption would be refused for having a price at all.
  const knownMoney = knownAmounts(listing)
  if (knownMoney.length) {
    const seen = new Set()
    for (const m of cap.matchAll(RM_AMOUNT)) {
      const v = amountOf(m[1], m[2])
      if (v == null || v <= 0 || matchesKnown(v, knownMoney)) continue
      const text = m[0].trim()
      if (seen.has(text)) continue
      seen.add(text)
      invented.push(text)
    }
  }
  // distances/amenities the listing never mentioned ("5 mins to X", "near Y")
  for (const m of cap.matchAll(/\b(\d+\s*min(?:ute)?s?\s+(?:to|from)\s+[^\n,.]{3,30})/gi)) {
    const place = m[1].toLowerCase().replace(/\s+/g, ' ')
    if (!srcLow.replace(/\s+/g, ' ').includes(place.slice(place.indexOf('to ') + 3, place.indexOf('to ') + 13))) invented.push(m[1].trim())
  }
  return { missing, invented }
}
