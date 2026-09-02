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
const REDUCTION_CLAIM = /\b(now only|was rm|reduced from|price\s*(reduced|reduction|drop|dropped|slashed|cut))\b/i

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
    const name = m[1].trim()
    // generic listing vocabulary is not a name - "Bedroom Unit For Sale" etc.
    if (/\b(For|Sale|Rent|Unit|Bedroom|Bathroom|Rare|Price|Value|Details|Location|Investment|Property|Selling|Below|Bank|Current|Rental|Annual|Gross|Yield|Contact|Lister|Prime)\b/i.test(name)) continue
    // The AREA is already its own field - "Tabuan Dayak" is where it is, not
    // what it is called. Treating it as a property name made the validator
    // demand it twice and muddied the real name.
    if (listing?.location && name.toLowerCase() === String(listing.location).toLowerCase()) continue
    out.push(name)
  }
  return [...new Set(out)]
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
  if (/below (?:bank )?value|below market/i.test(src) && !/below (?:bank )?value|below market|save[sd]? rm/i.test(cap)) {
    missing.push('the below-value hook')
  }
  for (const name of propertyNames(src, listing)) {
    if (!capLow.includes(name.toLowerCase())) missing.push(`property name "${name}"`)
  }

  // -- INVENTED --------------------------------------------------------------
  const known = `${srcLow} ${String(listing?.furnishing || '').toLowerCase()} ${String(listing?.tenure || '').toLowerCase()}`
  for (const [claim, grounds] of MATERIAL_CLAIMS) {
    if (claim.test(cap) && !grounds.test(known)) invented.push(cap.match(claim)[0])
  }
  // distances/amenities the listing never mentioned ("5 mins to X", "near Y")
  for (const m of cap.matchAll(/\b(\d+\s*min(?:ute)?s?\s+(?:to|from)\s+[^\n,.]{3,30})/gi)) {
    const place = m[1].toLowerCase().replace(/\s+/g, ' ')
    if (!srcLow.replace(/\s+/g, ' ').includes(place.slice(place.indexOf('to ') + 3, place.indexOf('to ') + 13))) invented.push(m[1].trim())
  }
  return { missing, invented }
}
