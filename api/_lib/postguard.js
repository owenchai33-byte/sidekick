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
// THE GATE KNEW ONE TEMPLATE OUT OF EIGHTEEN.
//
// demoContent builds a fallback for six platforms in three languages. Every one
// of those eighteen is what an agent gets when the model is unavailable - which
// on the free tier is a good part of the afternoon. This list held four phrases,
// and all four came from the ENGLISH facebook_page template.
//
// Measured 2026-09-09: facebook_page/en was caught; facebook_page/zh,
// facebook_page/ms and all three tiktok variants sailed through. That matters
// most on /api/social-broadcast, which publishes a RAW caption with no pendingId
// - the approve pipeline's guards never see it, and this is the ONLY thing
// standing between demo boilerplate and a client's page. Chinese and Malay
// agents had no gate at all.
//
// TWO MARKERS ARE STILL REQUIRED TO FIRE, and every template below contributes
// at least two. That threshold is the false-positive protection, and it has to
// stay: an agent whose trained style was learned from these captions could
// legitimately echo one phrase. The instagram templates are only a few lines, so
// their second marker is the bare "." separator lines the template emits - an
// artifact of the boilerplate, not something a person types.
const DEMO_MARKERS = [
  // demo.js money() emits this exact string whenever price is null, on every
  // platform and language at once. It is the one marker that survives a listing
  // so empty the templates collapse to two lines.
  /Price on ask/,

  // facebook_page. The Chinese and Malay openers interpolate the property type,
  // so they must not be matched literally - `/优质房产，诚意出/` only ever fired
  // when the type was unknown, and every typed listing walked past it.
  /Property in .+ — now available/,
  /Looking for a place that just feels right\?/i,
  /ready for its next (?:owner|tenant)/i,
  /\bis available now\. RM/i,
  /send over the full details and viewing times/i,
  /优质.{0,10}，诚意出/,
  /有兴趣欢迎私信我/,
  /Sedang cari rumah yang selesa untuk keluarga\?/i,
  /sedia untuk (?:tuan|penyewa) baharu/i,
  /\bkini tersedia\./i,
  /PM saya untuk maklumat penuh dan masa untuk lihat rumah/i,

  // tiktok
  /POV: you just found a/i,
  /POV: kau jumpa /i,
  /Comment "INFO" (?:and I'll send details|nanti PM details)/i,
  /留言「资料」我私你详情/,
  /这间.{0,10}只要 /,

  // instagram - short templates, so the second marker is the bare "." separator
  // lines the template emits between the copy and the hashtags.
  /DM to arrange a viewing\./i,
  /私信预约看房。/,
  /PM untuk tempahan lihat rumah\./i,
  /\n\.\n\.\n/,

  // marketplace. The "<price> | " header is the one part that does not depend on
  // any field being known - it is what still identifies the template once an
  // unstated transaction stopped printing "for sale."
  /Message now to view\./i,
  /^RM[\d,]+(?:\/month)? \| /m,
  /\w+ property for (?:rent|sale)\.\s*$/i,
  /Untuk di(?:sewa|jual) di .+\. PM untuk tempahan/i,
  /｜/,

  // mudah and portals. These are label-block templates, and the labels are the
  // scaffolding: an agent writes "2 bedrooms", not "Bedrooms: 2" on its own line.
  // They matter because the location-quality sentences that used to carry these
  // templates are now printed only when a location is actually known.
  /Well-located in /i,
  /Contact for viewing\./i,
  /地点优越，/,
  /欢迎来电安排看房/,
  /Lokasi strategik di /i,
  /Hubungi untuk tempahan melihat/i,
  /offering convenient access to local amenities/i,
  /Please contact the marketing agent to arrange an inspection/i,
  /交通便利，邻近各项生活设施/,
  /有意者请联络经纪安排看房/,
  /dengan akses mudah ke kemudahan setempat/i,
  /Sila hubungi ejen pemasaran/i,
  /^(?:Type|Bedrooms|Bathrooms|Built-up|Asking): /m,
  /^(?:Jenis|Bilik tidur|Bilik air|Keluasan|Harga): /m,
  /(?:类型|睡房|浴室|建筑面积|月租|售价|价格)：/,
]

// A MONEY FIGURE IN A CAPTION IS NOT AUTOMATICALLY AN INVENTION.
//
// Malaysian property captions state a great deal of arithmetic, all of it
// computed off figures the listing really gives:
//     "Deposit: 2 months (RM3,600)"        (rent x 2)
//     "Downpayment only RM49,800"          (asking x 10%)
//     "7% bumi discount, nett RM558,000"   (asking x 0.93)
//     "RM3,500 + RM300 service charge (RM3,800 all in)"
// captionViolations() has no arithmetic, so every one of those reads as an
// invented figure. approve.js worked this out on 2026-09-05 and exempted them
// at the ✅. The write path never got the same exemption, so the same caption
// that approve.js would publish was marked degraded by ingest.js first — and
// the repair prompt then instructed the model to DELETE a figure that is true.
//
// This is the shared definition so the two paths cannot drift apart again.
const MONEY_INVENTION = /^rm\s*[\d.,]/i

/** The invented claims that are NOT bare money figures — the ones that may refuse a post. */
export function nonMoneyInventions(invented) {
  return (invented || []).filter((v) => !MONEY_INVENTION.test(String(v).trim()))
}

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
// THE SOURCE SIDE READS THREE LANGUAGES, NOT ONE.
//
// REDUCTION_CLAIM above is English-only, and it was being run against BOTH the
// caption and the agent's own listing text. A Chinese agent who wrote 降价出售
// (原价 RM548,000) and a Malay agent who wrote "Harga sudah turun daripada
// RM500,000" had genuinely reduced their price — and their English caption
// saying so was refused as a fabrication. The verdict is also terminal: it is
// checked once, outside the repair loop, so it fails identically forever.
//
// Widening only: this can make MORE captions pass, never fewer.
const REDUCTION_SRC = new RegExp(
  REDUCTION_CLAIM.source +
  '|降价|降價|减价|減價|割价|劈价|下调|下調|原价|原價|原本|特价|特價|减了|優惠前' +
  '|\\bturun\\s*harga\\b|\\bharga\\s*(?:sudah\\s*)?turun\\b|\\bditurunkan\\b|\\bdikurangkan\\b|\\bpotongan\\s*harga\\b|\\bdaripada\\s*rm',
  'i')

/**
 * True when the caption claims a price cut the source listing never made.
 * Only fires when the listing itself says nothing about a reduction, so a
 * genuinely reduced listing still advertises normally — in any of the three
 * languages this product publishes in.
 */
export function inventsPriceHistory(caption, listing) {
  const cap = String(caption || '')
  if (!REDUCTION_CLAIM.test(cap)) return false
  // "NOW ONLY RM650" ON A SINGLE-PRICE LISTING IS A HOOK, NOT A HISTORY.
  //
  // The incident this guard exists for is the model writing a PRIOR price that
  // never existed: "RM438,000 / NOW ONLY RM338,000 / PRICE REDUCED". What makes
  // that a lie is the second figure. A caption whose only money figure is the
  // listing's own price has asserted no history at all, and refusing it took out
  // "Now only RM650 a month" — an ordinary caption for an ordinary studio.
  // The two-figure case is still caught here AND independently by
  // captionViolations(), which reports RM438,000 as invented.
  // Every member of REDUCTION_CLAIM except "now only" asserts a history on its
  // own. "Now only" does not, so it is the only one that needs a second figure
  // before it counts.
  const STRONG_REDUCTION = /\b(?:reduced from|reduced by|slashed|off the asking price|price\s*(?:reduced|reduction|drop|dropped|slashed|cut))\b|\b(?:was|down from|originally|previously)\s*(?:priced\s*at\s*)?rm/i
  if (!STRONG_REDUCTION.test(cap)) {
    const figures = new Set()
    for (const m of cap.matchAll(RM_AMOUNT)) { const v = amountOf(m[1], m[2]); if (Number.isFinite(v) && v > 0) figures.add(v) }
    if (figures.size <= 1) return false
  }
  // The agent's own words are the authority. If THEY said it was reduced, fine.
  const source = `${listing?.rawText || ''} ${listing?.title || ''}`
  return !REDUCTION_SRC.test(source)
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
  // Added 2026-09-05. Title and lot status are LEGALLY material in Malaysia -
  // a bumi lot a non-bumi buyer cannot purchase, or an individual title a
  // strata property does not have, is a claim with consequences past marketing.
  [/individual title|geran individu|hakmilik individu/i, /individual\s*title|geran|hakmilik|个别地契|個別地契/i],
  [/strata title|hakmilik strata/i, /strata|分层地契|分層地契/i],
  [/master title|hakmilik induk/i, /master\s*title|induk|母地契/i],
  [/\bnon[- ]?bumi\b|bukan\s*bumi/i, /bumi|non[- ]?bumi|bukan\s*bumi/i],
  [/(?<!non[- ])(?<!bukan\s)\bbumi\s*(?:lot|unit)\b|lot\s*bumi/i, /bumi/i],
  [/malay reserve|rizab melayu|tanah rizab/i, /reserve|rizab/i],
  // AN ABBREVIATION EXPANDED INTO THE WRONG WORD IS AN INVENTED FACT.
  // Measured live 2026-09-08: the listing said "Comm: 1 month + 8% SST" — which
  // in every Malaysian property ad means COMMISSION — and the caption published
  // "Commencement: 1 month + 8% SST", a different thing said with the same
  // confidence. The guard saw nothing, because every number and every other word
  // was faithful.
  // ONLY the measured one. A companion rule for "vacant possession / completion"
  // was added on a hunch at the same time and instantly refused ordinary sale
  // copy — "The unit is currently for rent, with vacant possession on
  // completion" is how Malaysian investor listings are written. A blocker
  // without a worked false-positive case is the mistake this file keeps making;
  // it came straight back out.
  [/commencement/i, /commencement|commencing|commence/i],
]

// A contact line is not a property name. "Call Jason 0128887766" and "Hubungi
// Azlan 0198887766" were both being returned as REQUIRED names, and because a
// missing name blocks in ingest.js, a good caption that wrote the contact as
// "Jason 0128887766" was refused every time. Verified 2026-09-04 on three
// ordinary listings - English, Malay and an all-caps room ad - all three
// blocked. Module scope because resolvePropertyName() has to apply it to the
// PARSER's answer too: the parser is the same model, reading the same text, and
// "Call Jason" is exactly as available to it as it was to the regex.
const CONTACT_LEAD = /^(call|contact|hubungi|whatsapp|wasap|dm|pm|tel|telefon|hp|lister|agent|sila)\b/i

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
  // CONTACT_LEAD (module scope) drops "Call Jason" and "Hubungi Azlan".
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

// WHOSE NAME IS IT, AND IS IT EVEN IN THE LISTING?
//
// The first cut of this change made listing.propertyName the authority and
// required it verbatim. Review on 2026-09-04 measured what that costs: the
// parser is the SAME model reading the SAME text that produced the three
// heuristic incidents, and nothing checked its answer against the source. All
// of these blocked every caption for their listing, permanently, after burning
// two repair calls per attempt:
//   propertyName "Sunway Vivaldi" on a listing that never says it   -> refused
//   propertyName "N/A" / "Unknown" / "null" / "-"                    -> refused
//   propertyName "Call Jason"                                        -> refused
// Worse than the refusal: prompts.js was printing that same unverified name as
// "it MUST appear in the caption", so a hallucinated building name would have
// gone out on a client's public page. The heuristic could never do that - its
// guesses were at least literally present in rawText.
//
// So the parser's answer is a fact only when the LISTING contains it. Anything
// else falls back to the heuristic, whose guess is a warning and can never
// refuse. Prompt and gate share this function, so they cannot disagree about
// either the name or its strength.
const NAME_PLACEHOLDER = /^(?:n\s*\/?\s*a|nil|none|null|undefined|unknown|not\s+\w+|tidak\s+\w+|tiada|无|沒有|没有|[-–—.?_\s]+)$/i
const flatten = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * { name, from } where `from` is 'parser' (a fact - the listing says it, so the
 * caption must too), 'guess' (advisory only) or null (this property has no
 * name, which is the ordinary answer for a room ad, a plot of land or an
 * unnamed terrace - the answer the capitalisation regex could never give).
 */
export function resolvePropertyName(listing) {
  const src = String(listing?.rawText || '')
  const raw = typeof listing?.propertyName === 'string' ? listing.propertyName.trim() : ''
  const grounded = raw
    && !NAME_PLACEHOLDER.test(raw)
    && !CONTACT_LEAD.test(raw)
    && flatten(src).includes(flatten(raw))
    && flatten(raw) !== flatten(listing?.location)   // the area is its own field
  if (grounded) return { name: raw, from: 'parser' }
  const guess = propertyNames(src, listing)[0]
  return guess ? { name: guess, from: 'guess' } : { name: null, from: null }
}

// Words that are the GENERIC half of a project name. "RENNA RESIDENCE" written
// as "RENNA @ The Northbank", and "Vivacity Megamall Residence" written as
// "Vivacity Residence", are both the same building - the parser is told to copy
// the name exactly as written, so it returns the full marketing string while
// the agent's house style writes the short form. Demanding the long form
// refused both (measured 2026-09-04; the second is a regression the heuristic
// did not have, because it returned the shorter form itself).
// Han / kana, for deciding whether two strings are even in the same script.
const HAS_CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const NAME_GENERIC = /^(?:the|and|at|de|di|residences?|residency|apartments?|condo|condominium|court|suites?|towers?|parks?|city|gardens?|heights|villas?|point|square|place|homes?|house|hills?|views?|phase|block|jaya|indah|permai|utama|baru|kuching|sarawak)$/i

/**
 * True when the caption carries the property's name. Full containment, or ANY
 * distinctive word of it: a caption that says "RENNA" has not dropped the name,
 * and the incident this rule exists for is a caption that names the property
 * NOWHERE at all.
 */
export function carriesName(caption, name) {
  const cap = flatten(caption)
  if (!name) return true
  if (cap.includes(flatten(name))) return true
  const distinctive = String(name).split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 4 && !NAME_GENERIC.test(t))
  if (distinctive.some((t) => cap.includes(t.toLowerCase()))) return true
  // A CJK NAME CANNOT BE CHECKED AGAINST A CAPTION IN ANOTHER SCRIPT.
  //
  // The split above is on non-letters, so a Chinese building name is ONE
  // indivisible token: 美丽华公寓 either appears verbatim or it does not. An
  // English caption for that listing — "FOR RENT — Mei Li Hua Apartment" — was
  // therefore scored as having dropped the name, which lands in v.missing, which
  // the `property name` filter in ingest.js:156 blocks on. The only way past was
  // to paste Chinese characters into the English caption.
  //
  // Cross-language captioning IS the product: the same listing is published in
  // en, zh and ms. This guard has no transliteration table and cannot get one,
  // so on a mixed-script pair it does not know the answer — and an unverifiable
  // check must not refuse. It stays strict in the direction it CAN check: a
  // Latin name is still required in a Chinese caption, because agents do carry
  // "RENNA" through verbatim, and a name written in the caption's own script is
  // still required to be there.
  if (HAS_CJK.test(String(name)) && !HAS_CJK.test(cap)) return true
  return false
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
// Shared by the room-count rule below and the lease-term rule further down.
const CJK_NUM = { 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

// A COUNT IS A COUNT IN ANY SCRIPT.
//
// These read ASCII digits only, which is a hole with the shape of the product:
// SideKick's selling point is writing the caption in a DIFFERENT language from
// the listing, and every non-digit form was therefore invisible. Measured
// against a 2-bed listing: "4 bedrooms" was caught, while "Three bedrooms",
// "Empat bilik tidur", "四房两厕" and "3BR unit" all published clean.
//
// CJK_NUM already existed further down this file for lease terms and was not
// reused here. Now one number vocabulary serves both.
const WORD_NUM = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, lapan: 8, delapan: 8, sembilan: 9, sepuluh: 10,
}
const NUM_WORDS = Object.keys(WORD_NUM).join('|')
const NUM_TOKEN = `(\\d+|${NUM_WORDS}|[一二两兩三四五六七八九十])`

// `br` covers the "3BR" shorthand; `\b` keeps it off "brick" and "Brunei".
const BED_STATED = new RegExp(`${NUM_TOKEN}\\s*[-–]?\\s*(?:bedrooms?|bed\\b|beds\\b|br\\b|rooms?\\b|bilik\\s+tidur|bilik(?!\\s*(?:air|mandi))\\b|房(?:间|間)?|室)`, 'gi')
const BATH_STATED = new RegExp(`${NUM_TOKEN}\\s*[-–]?\\s*(?:bathrooms?|baths?\\b|toilets?|washrooms?|bilik\\s+(?:air|mandi)|tandas|厕(?:所)?|浴室?|卫(?:生间|浴)?)`, 'gi')

function statedCounts(text, re) {
  const out = new Set()
  for (const m of String(text || '').matchAll(re)) {
    const raw = String(m[1] || '').toLowerCase()
    const n = /^\d+$/.test(raw) ? Number(raw) : (WORD_NUM[raw] ?? CJK_NUM[m[1]] ?? NaN)
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

// Checkable claims the caption makes and the listing never made.
//
// The INVENTED half was a fixed list of material claims plus money and room
// counts. Nothing walked the caption BACK to the listing, so these three
// published clean on 2026-09-04 against listings that state none of them:
// "Guaranteed 8% rental yield", "2-year lease", "Gated and guarded, 24-hour
// security, swimming pool, gym". Each is a promise a tenant or buyer acts on.
//
// Only CHECKABLE claims are added here. Open-ended adjectives ("modern",
// "spacious", "prime") stay out on purpose: the prompt already bans them, they
// cannot be verified against a listing, and a rule that tries would refuse good
// captions - which is the failure mode this whole file is being rewritten to
// stop.

// -- yields ------------------------------------------------------------------
// A yield figure only counts as a claim when the caption says, right there,
// that the figure IS a yield.
//
// The first cut used a 24-character proximity window around any percentage.
// Review on 2026-09-04 measured what that catches in this market, all against
// a listing stating no percentage at all, all refused:
//   "10% deposit, great return."            "Only 10% downpayment. Rental return is steady."
//   "Strong yield here. Bank loan up to 90%."   "ROI is excellent. 90% margin of financing."
//   "Deposit 10%, pulangan menarik."        "首付10%，回报稳定。"
// "Loan up to 90%" is on a large share of Malaysian sale ads and "首付10%，回报
// 稳定" is boilerplate Chinese agent copy, so this was not an edge case - and
// the cascade is the reverted money bug verbatim: the repair prompt says
// REMOVE "10% yield", there is no such phrase, the model deletes the true "10%
// deposit" instead, the violation count drops and ingest.js accepts it.
//
// So: adjacency, not proximity. The figure and the yield word must sit in one
// noun phrase with nothing between them but modifiers - no punctuation, no
// other nouns. "8% rental yield" and "Gross ROI 4.62% p.a." are claims;
// "10% deposit, great return" is not, in any of the three languages.
const YIELD_MOD = '(?:gross|nett?|annual|annualised|rental|projected|estimated|guaranteed|expected|current)'
const YIELD_NOUN = `(?:${YIELD_MOD}\\s+){0,3}(?:yield|roi|return\\s+on\\s+investment|rental\\s+returns?)\\b`
const YIELD_CLAIM = [
  // "gross yield of 4.6%", "ROI 4.62%", "yield ~ 5%"
  new RegExp(`\\b${YIELD_NOUN}\\s*(?:of|at|is|:|=|~|≈|about|around|approx\\.?)?\\s*(\\d+(?:\\.\\d+)?)\\s*%`, 'gi'),
  // "4.2% gross yield", "8% rental yield", "4.62% p.a. ROI"
  new RegExp(`(\\d+(?:\\.\\d+)?)\\s*%\\s*(?:p\\.?\\s?a\\.?\\s*)?${YIELD_NOUN}`, 'gi'),
  // 率 is load-bearing: 回报率 is a yield, 回报 on its own is "returns" and is
  // ordinary copy ("回报稳定" = returns are steady).
  /(?:回报率|收益率|租金回报率|投资回报率)\s*(?:约|大约|为|是)?\s*(\d+(?:\.\d+)?)\s*%/g,
  /(\d+(?:\.\d+)?)\s*%\s*(?:的)?(?:回报率|收益率|租金回报率|投资回报率)/g,
  // "sewa" likewise: "pulangan sewa 6%" is a yield, "pulangan menarik" is not.
  /(?:pulangan|hasil)\s+sewa\s*(?:sebanyak\s+|kira-kira\s+)?(\d+(?:\.\d+)?)\s*%/gi,
  /(\d+(?:\.\d+)?)\s*%\s*(?:pulangan|hasil)\s+sewa/gi,
]

// A figure the listing itself calls a rent. Clause-scoped, because the first
// cut fed knownYields() from knownAmounts(), which returns square footage, psf
// and any 3+ digit number - so "completed 2024" on a RM338,000 unit silently
// authorised a 7.19% yield, and psf authorised three more. Every figure here
// only ever WIDENS what a caption may say, so the loose end of this is a miss,
// never a refusal.
// 出租 and 招租 are how a Chinese listing SAYS "for rent" — without them the
// source gate was blind to the plainest Chinese rental text, so a correct
// Chinese rental caption was refused with three findings.
const RENT_MARKER = /rent(?:al|ed)?|sewa|租金|月租|年租|出租|招租|房屋出租|per\s*month|\/\s*month|a\s+month|sebulan|per\s*annum|setahun|monthly|annual/i
const MONEY_TOKEN = /(?:\brm\s*)?(\d[\d,]*(?:\.\d+)?)\s*((?:k|juta|jt|mil|million)\b|万|萬)?/gi

function rentFigures(listing) {
  const out = new Set()
  const add = (v) => { if (Number.isFinite(v) && v >= 100 && v < 1e6) out.add(v) }
  for (const [k, v] of Object.entries(listing || {})) {
    if (typeof v === 'number' && /rent|sewa|monthly/i.test(k)) add(v)
  }
  if (/rental/i.test(String(listing?.listingType || ''))) add(Number(listing?.price))
  // one clause at a time, so "800 sqft. Rental 1,300/month" does not make 800 a rent
  for (const frag of String(listing?.rawText || '').split(/[\n。；;]+|(?<=[a-z0-9)])\.\s/gi)) {
    if (!RENT_MARKER.test(frag)) continue
    for (const m of frag.matchAll(MONEY_TOKEN)) add(amountOf(m[1], m[2]))
  }
  return [...out]
}

/**
 * Every yield percentage this listing can justify: the ones it states outright,
 * plus the ones a caption can honestly COMPUTE - a rent the listing names
 * against a price the listing names, read both as a monthly rent and as an
 * already-annual one. Deliberately generous: a yield the agent worked out
 * themselves must never be called a lie.
 */
export function knownYields(listing) {
  const src = String(listing?.rawText || '')
  const out = new Set()
  for (const m of src.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) out.add(parseFloat(m[1]))
  // 50,000 splits "a price" from "a rent" in this market.
  const prices = knownAmounts(listing).filter((a) => a >= 50000)
  for (const p of prices) {
    for (const r of rentFigures(listing)) {
      out.add((r * 12 / p) * 100)   // a monthly rental against the asking price
      out.add((r / p) * 100)        // the same sum when the rent is already annual
    }
  }
  return [...out].filter((v) => Number.isFinite(v))
}

/** 0.3 of a percentage point, so 4.6% and 4.62% are the same claim. */
const yieldKnown = (v, known) => known.some((k) => Math.abs(k - v) <= 0.3)

// -- lease / tenancy terms ---------------------------------------------------
//
// A caption that invents "2-year lease" is inventing a CONTRACTUAL term nobody
// agreed to, which is worse than most marketing puff - a tenant can hold the
// landlord to it. So this rule earns its place, but a first version was deleted
// on 2026-09-04 for refusing ordinary copy, and both of its false-positive
// families have to stay excluded:
//
//   TENURE. "99-year lease", "99 years lease remaining" is how a leasehold
//   listing is written, and the source states its tenure as a WORD
//   ("Leasehold"), so a duration match could never ground it. Excluded by
//   length: nobody rents for twenty years, so a term that long is tenure. Also
//   excluded when a tenure word sits next to it, in any of the three languages.
//
//   A TERM THE SOURCE DOES STATE, in any wording. "Minimum 1 year", "sewa
//   minimum 2 tahun", "租期两年" all ground a caption's term, and so does a bare
//   mention of a tenancy period without a number - if the landlord raised the
//   subject at all, the caption repeating it is not an invention.
//
// And it reads all three languages now. The English-only version refused honest
// English while letting "Kontrak 2 tahun" and "两年租约" through unchecked, which
// is the worst of both.
const numOf = (raw) => {
  const t = String(raw || '').trim()
  if (/^\d+$/.test(t)) return Number(t)
  if (CJK_NUM[t]) return CJK_NUM[t]
  return NaN
}

// [pattern, unit] — the capture group is the duration.
const LEASE_CLAIM = [
  [/(\d+)[\s-]*(?:year|yr)s?[\s-]*(?:lease|tenancy|contract|rental agreement)/gi, 'y'],
  [/(?:lease|tenancy|contract)[\s-]*(?:of|for)?[\s-]*(\d+)[\s-]*(?:year|yr)s?/gi, 'y'],
  [/(\d+)[\s-]*months?[\s-]*(?:lease|tenancy|contract|rental agreement)/gi, 'm'],
  [/(?:lease|tenancy|contract)[\s-]*(?:of|for)?[\s-]*(\d+)[\s-]*months?/gi, 'm'],
  [/(?:kontrak|sewa|tempoh)[\s-]*(?:minimum|min)?[\s-]*(\d+)[\s-]*tahun/gi, 'y'],
  [/(\d+)[\s-]*tahun[\s-]*(?:kontrak|sewa|tempoh)/gi, 'y'],
  [/(?:kontrak|sewa|tempoh)[\s-]*(?:minimum|min)?[\s-]*(\d+)[\s-]*bulan/gi, 'm'],
  [/([\d一二两三四五六七八九十]+)\s*年\s*(?:租约|租期|合约|合同)/g, 'y'],
  [/(?:租约|租期|合约|合同)\s*([\d一二两三四五六七八九十]+)\s*年/g, 'y'],
  [/([\d一二两三四五六七八九十]+)\s*(?:个)?月\s*(?:租约|租期|合约|合同)/g, 'm'],
  // "minimum 12 months" / "min 1 year" / "minimum 2 tahun" — a term stated
  // without ever using the word lease, which is how most Malaysian rental ads
  // write it. Without these the SOURCE side missed its own term and the caption
  // repeating it read as an invention.
  [/\b(?:minimum|min\.?|at least)[\s-]*(\d+)[\s-]*(?:year|yr|tahun)s?\b/gi, 'y'],
  [/\b(?:minimum|min\.?|at least)[\s-]*(\d+)[\s-]*(?:month|bulan)s?\b/gi, 'm'],
  [/(\d+)[\s-]*(?:month|bulan)s?[\s-]*(?:minimum|min\.?)\b/gi, 'm'],
  [/(\d+)[\s-]*(?:year|yr|tahun)s?[\s-]*(?:minimum|min\.?)\b/gi, 'y'],
  [/(?:最少|至少|最短)\s*([\d一二两三四五六七八九十]+)\s*年/g, 'y'],
  [/(?:最少|至少|最短)\s*([\d一二两三四五六七八九十]+)\s*(?:个)?月/g, 'm'],
]

// Tenure words in all three languages. Near a duration, it is not a tenancy.
const TENURE_NEAR = /leasehold|freehold|tenure|geran|hakmilik|pegangan|地契|产权|永久|租赁地/i
// The source raised the subject of a term at all — a number is not required.
const SOURCE_HAS_TERM = /\b(lease|tenancy|contract|minimum|min\.?|at least)\b|kontrak|tempoh\s*sewa|sewa\s*minimum|租约|租期|合约|合同|最少|至少|最短/i

/** Every lease/tenancy term stated in a text, normalised to months. */
function leaseTermsIn(text) {
  const t = String(text || '')
  const out = new Set()
  for (const [re, unit] of LEASE_CLAIM) {
    re.lastIndex = 0
    for (const m of t.matchAll(re)) {
      const n = numOf(m[1])
      if (!Number.isFinite(n) || n <= 0) continue
      const months = unit === 'y' ? n * 12 : n
      // Twenty years is not a tenancy, it is tenure. And a tenure word beside
      // the match settles it whatever the length.
      if (months >= 240) continue
      const around = t.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)
      if (TENURE_NEAR.test(around)) continue
      out.add(months)
    }
  }
  return out
}

// -- facilities --------------------------------------------------------------
// A CLOSED list. Each entry is [what the caption claimed, how the caption says
// it, what would ground it in the listing]. The grounds are deliberately wide -
// any mention "of that sort", in any of the three languages, clears the claim.
// "Security" is the one that needs care: "security deposit" is a rental term,
// not a guard, so the claim pattern never matches the bare word.
//
// The GROUNDS are where this rule goes wrong, and the whole point of the
// product is a caption written in a different language from the listing.
// Measured 2026-09-04, all refused: a Malay listing saying "berpengawal" or
// "kawalan keselamatan" against an English "gated and guarded", and "gimnasium"
// or "gim" against "gym on site". `pengawal` was in the security grounds and
// missing from both gated and guarded; `gim`/`gimnasium` were missing outright
// while the grounds carried `kecergasan`, which no listing writes. Widening a
// grounds list can only ever make this guard more permissive, so when in doubt
// the word goes in.
const FACILITY_CLAIMS = [
  ['swimming pool', /\b(?:swimming\s*pool|infinity\s*pool|lap\s*pool|pool)\b|游泳池|泳池|kolam\s*renang/i, /pool|泳池|游泳|kolam/i],
  ['gym', /\bgym(?:nasium)?\b|\bfitness\s*(?:centre|center|room|studio)\b|健身/i, /gym|gim\b|gimnasium|fitness|健身|kecergasan|senaman/i],
  ['24-hour security', /\b24[\s-]?(?:hour|hr|jam)s?\s*(?:security|surveillance|cctv|guard)|\bsecurity\s*(?:guard|post|patrol|system|personnel)\b|round[\s-]the[\s-]clock\s*security|保安|pengawal\s*keselamatan|kawalan\s*keselamatan/i, /security|sekuriti|guard|cctv|保安|警卫|警衛|keselamatan|pengawal|pengawas|kawalan|berkawal|berpengawal|gated|门禁|門禁/i],
  ['gated', /\bgated\b|门禁|門禁|berpagar/i, /gated|guarded|guard|门禁|門禁|berpagar|\bpagar\b|berkawal|berpengawal|kawalan|pengawal|sekuriti|保安|警卫|警衛|security|keselamatan/i],
  ['guarded', /\bguarded\b/i, /guarded|gated|guard|保安|警卫|警衛|security|sekuriti|keselamatan|berpagar|\bpagar\b|berkawal|berpengawal|kawalan|pengawal/i],
  ['playground', /\bplayground\b|\bchildren'?s?\s*play\s*area\b|游乐场|遊樂場|taman\s*permainan/i, /playground|play\s*area|游乐|遊樂|permainan/i],
  ['clubhouse', /\bclub\s?house\b|会所|會所|rumah\s*kelab/i, /club\s?house|会所|會所|俱乐部|kelab/i],
  ['lift', /\b(?:lift|elevator)\b|电梯|電梯|升降机|\blif\b/i, /lift|elevator|电梯|電梯|升降|\blif\b/i],
  ['parking', /\bcar\s?park(?:ing)?\b|\bparking\b|车位|車位|停车|停車|tempat\s*letak\s*kereta/i, /car\s?park|parking|garage|porch|车位|車位|停车|停車|泊车|letak\s*kereta|parkir/i],
  // Added 2026-09-05. Each of these published clean against a one-line room ad
  // that promised none of them. Same shape as the entries above: a claim regex
  // and a deliberately WIDE grounds regex, because widening grounds can only
  // make this guard more permissive.
  ['air-conditioning', /\bair[\s-]?con(?:d|ditioning|ditioner)?\b|\ba\/c\b|冷气|冷氣|空调|空調|penghawa\s*dingin|pendingin/i, /air[\s-]?con|a\/c|aircond|冷气|冷氣|空调|空調|penghawa|pendingin|hawa\s*dingin/i],
  ['water heater', /\bwater\s*heater\b|\bheater\b|热水器|熱水器|pemanas\s*air/i, /heater|热水|熱水|pemanas|water\s*heat/i],
  ['kitchen cabinets', /\bkitchen\s*cabinets?\b|\bcabinetry\b|橱柜|櫥櫃|kabinet\s*dapur/i, /cabinet|kabinet|橱柜|櫥櫃|kitchen\s*fitted|dapur\s*siap/i],
  ['rooftop deck', /\broof\s?top\s*(?:deck|garden|terrace|lounge|pool)\b|\bsky\s*(?:deck|garden|lounge)\b|天台|空中花园|空中花園/i, /roof\s?top|sky\s*(?:deck|garden|lounge)|天台|空中花园|空中花園|bumbung/i],
  ['sauna', /\bsauna\b|\bsteam\s*room\b|桑拿|蒸氣室|蒸汽室/i, /sauna|steam\s*room|桑拿|蒸氣|蒸汽/i],
  ['BBQ area', /\bbbq\b|\bbarbe?cue\b|烧烤|燒烤|kawasan\s*bbq/i, /bbq|barbe?cue|烧烤|燒烤/i],
  ['covered parking', /\bcovered\s*(?:car\s*)?(?:bay|park(?:ing)?|porch)\b|有盖车位|有蓋車位|tempat\s*letak\s*kereta\s*berbumbung/i, /covered|porch|garage|sheltered|有盖|有蓋|berbumbung|bumbung|car\s?park|parking|车位|車位/i],
]

// -- SALE versus RENT: the transaction itself --------------------------------
//
// Live on a client's Facebook page 2026-09-05. A RM2,500/month RENTAL (RENNA
// RESIDENCE) published under the heading "💰 Selling Price", with a section
// titled "Why Buy This Property?" and the hashtag "#PCMY_Sale". Three
// statements of the wrong transaction, in one caption, about the single most
// material fact after the price.
//
// The model was doing exactly what it was told. The agent's trained style says
// "Copy the EXACT layout, emojis, voice AND SPACING of the example captions
// below on EVERY listing", and BOTH stored examples are SALES carrying a "💰
// Selling Price" heading. A style example is a FORMAT; the transaction is a
// FACT. prompts.js now says so; this is the check behind it. Before this,
// `listingType` was read in exactly one place in this file (rentFigures), and
// only to ground a rent figure.
//
// THE LINE THIS RULE DRAWS, and it is the whole design. A caption may
// legitimately MENTION the other transaction:
//     a sale stating its tenancy       "Currently tenanted at RM1,300/month"
//     an investment line               "RM1,800/month — about 4.2% gross yield"
//     a genuine dual listing           "FOR SALE OR RENT"
// so a mention is never enough. Only a caption that DECLARES the transaction to
// be the opposite type is refused. Four gates stand in front of every blocking
// finding; any one of them downgrades it to a warning or drops it entirely:
//
//   DUAL     the caption offers both ("FOR SALE OR RENT"). A real Malaysian
//            listing type, and it is in this very agent's stored style
//            examples - blocking it would strip the format they pay for.
//   MIXED    the caption also declares the TRUE type. Then it is a mixed
//            caption, not a contradiction, and mixed only ever warns.
//   SOURCE   the agent's own listing text talks that way. Their words are the
//            authority (the same rule inventsPriceHistory uses), and this is
//            also what makes a MIS-PARSED listingType harmless: a shoplot whose
//            text says "for sale" can never be refused for writing "for sale",
//            whatever the parser decided it was.
//   NEGATED  "not for sale", "bukan untuk dijual", 不出售.
//
// The two directions are deliberately NOT symmetric in strength, because their
// false positives are not symmetric. Rental listings almost never discuss
// selling, so the SOURCE gate rarely fires there and the rental direction
// (the direction of the incident) stays sharp. Sale listings discuss rent
// constantly - tenancy, rental income, yield - so the sale direction is
// gated by a deliberately WIDE rent marker and misses more. That is the right
// trade: a miss reaches the repair round as a warning; a wrong refusal is
// silent, total, and this project has shipped five of them.

// A negation immediately in front of a match. "Not for sale" is a statement
// about the transaction being the TRUE type.
const TXN_NEGATED = /(?:\bnot\b|\bno\b|\bnever\b|\bbukan\b|\btidak\b|\bjangan\b|不|非|勿|未)\s*(?:available\s+)?(?:for\s+)?$/i

// A declaration preceded by one of these is about a POSSIBILITY or a second
// option, not about what this listing IS. "Vacant and ready for rent" on a sale
// is ordinary investor copy, and at 21 letters its line is short enough to read
// as a heading - so without this it would have been refused. Downgraded to a
// warning rather than dropped: the repair round should still look at it.
// The \b matters: without it the "or" alternative matched inside "12th Floor",
// so "12th Floor for rent" quietly downgraded itself. CJK needs no boundary.
const TXN_QUALIFIED = /(?:\b(?:ready|available|vacant|suitable|perfect|ideal|good|great|potential|option|opportunity|also|too|either|whether|or|instead|sedia|boleh|sesuai|juga|atau|pilihan)\b|可以|也|或|适合|適合)\s*(?:to\s+|be\s+|is\s+)?$/i

// BOTH transactions offered at once. Not a contradiction - a superset, and a
// real listing type here ("FOR SALE OR RENT", "jual/sewa"). Never blocks.
const TXN_DUAL = /\b(?:for\s+)?sale\s*(?:or|and|&|\/|,)\s*(?:for\s+)?rent(?:al)?\b|\b(?:for\s+)?rent(?:al)?\s*(?:or|and|&|\/|,)\s*(?:for\s+)?sale\b|\bdijual\s*(?:atau|dan|&|\/|,)\s*disewa\b|\bdisewa\s*(?:atau|dan|&|\/|,)\s*dijual\b|\bjual\s*\/\s*sewa\b|\bsewa\s*\/\s*jual\b|出售\s*(?:或|和|与|與|、|\/)\s*出租|出租\s*(?:或|和|与|與|、|\/)\s*出售|售\s*\/\s*租|租\s*\/\s*售|#for\s?sale\s?or\s?rent\b/i

// Each side of the transaction, in the three languages this product writes in.
//
//   decl       the caption DECLARES the transaction to be this type
//   priceLabel the half of `decl` that labels a PRICE - the RENNA heading
//   cta        a call to action only this transaction can make
//   hashtag    the category tag; a tag is not prose, so it has no ambiguity
//   sourceAny  WIDE. "does the agent's own text talk this way at all?" Only
//              ever makes the guard more permissive, so when in doubt it goes in
//   loose      words that lean this way but are not a declaration - WARN only
const TXN_SALE = {
  type: 'SALE', other: 'sale',
  decl: /\bfor\s+sale\b|\bon\s+sale\b|\bnow\s+selling\b|\bselling\s+price\b|\bsales?\s+price\b|\buntuk\s+dijual\b|\bdijual\b|\bharga\s+jual(?:an)?\b|出售|待售|出讓|出让|售价|售價/i,
  priceLabel: /\bselling\s+price\b|\bsales?\s+price\b|\bharga\s+jual(?:an)?\b|售价|售價|出售价|出售價/i,
  cta: /\bwhy\s+buy\b|\bbuy\s+(?:this|it|now|today)\b|\bown\s+this\b|\bpurchase\s+this\b|\bkenapa\s+(?:nak\s+)?beli\b|\bbeli\s+(?:rumah\s+|unit\s+)?ini\b|\bmiliki\s+(?:rumah|unit|hartanah)\s+ini\b|为什么(?:要)?买|為什麼(?:要)?買|为何(?:要)?买|买下这|買下這|购买此|購買此/i,
  // #Sale, #SALE and #Sales are the plainest sale tags in this market and the
  // old pattern could not see any of them: it demanded a literal "_sale" or
  // "forsale". The tag body is now matched whole, which is what keeps
  // #Wholesale out — "wholesale" is one word, not a boundary followed by sale.
  hashtag: /#[A-Za-z0-9]*[_-]sales?\b|#(?:for)?sales?\d*\b|#[A-Za-z0-9]*forsale\w*\b|#(?:dijual|rumahdijual|hartanahdijual|jualrumah|propertydijual|hartanahjual)\b|#[^\s#]*(?:出售|待售|售)/i,
  sourceAny: /\bsale\b|\bsell(?:s|ing)?\b|\bsold\b|\bbuy(?:s|er|ers|ing)?\b|\bpurchas(?:e|ed|ing)\b|\bjual\b|dijual|\bbeli\b|pembeli|售|买|買|购|購/i,
  loose: /\bpurchase\b|\bownership\b|\bbuyers?\b|\bbeli\b|\bpembeli\b|购买|購買|买房|買房|买家|買家/i,
}
const TXN_RENT = {
  type: 'RENTAL', other: 'rental',
  // "to let" needs the pronoun guard or it fires on "to let you know".
  decl: /\bfor\s+rent\b|\bfor\s+lease\b|\bto\s+let\b(?!\s+(?:you|us|me|him|her|them|it)\b)|\brental\s+price\b|\brent\s+price\b|\bmonthly\s+rent(?:al)?\b|\brent\s+per\s+month\b|\buntuk\s+disewa\b|\bdisewa(?:kan)?\b|\bharga\s+sewa\b|\bsewa\s+bulanan\b|出租|招租|月租|租金/i,
  priceLabel: /\brental\s+price\b|\brent\s+price\b|\bmonthly\s+rent(?:al)?\b|\brent\s+per\s+month\b|\bharga\s+sewa\b|\bsewa\s+bulanan\b|月租金?|租金/i,
  cta: /\bwhy\s+rent\b|\brent\s+(?:this|it)\b|\bkenapa\s+(?:nak\s+)?sewa\b|\bsewa\s+(?:rumah\s+|unit\s+)?ini\b|为什么(?:要)?租|為什麼(?:要)?租|为何(?:要)?租|租下这|租下這/i,
  hashtag: /#[A-Za-z0-9]*[_-]rent(?:als?)?\b|#(?:for|to)?rent(?:als?)?\d*\b|#[A-Za-z0-9]*forrent\w*\b|#(?:disewa|rumahsewa|sewarumah|sewa)\b|#[^\s#]*(?:出租|招租|租)/i,
  // RENT_MARKER already exists for rentFigures() and is exactly the wide
  // "this text talks about rent" test needed here. It matches "/month",
  // "monthly", "annual", "Current Rental" and "tenanted at ... /month", which
  // is what clears every tenanted-sale caption in the corpus.
  sourceAny: RENT_MARKER,
  // NOT "tenant"/"tenancy": a sale stating its tenancy is the commonest
  // legitimate both-mention in this market and must not even warn.
  loose: /\bleasing\b|\bletting\b|\bpenyewa\b|租客|承租/i,
}

/** The first match of `re` in `text` that is not directly negated. */
function firstUnnegated(text, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  for (const m of String(text).matchAll(g)) {
    if (TXN_NEGATED.test(String(text).slice(Math.max(0, m.index - 14), m.index))) continue
    return m
  }
  return null
}

/**
 * Money figures the SOURCE itself puts in a clause that talks this way.
 * Clause-scoped like rentFigures(), and the reason T1 below can be trusted:
 * on a tenanted sale the source's rent figure is the TENANCY (RM1,300), never
 * the asking price (RM520,000), so labelling the asking price as rent is still
 * a contradiction - while a MIS-PARSED listing whose text calls that very
 * amount a rent is cleared.
 */
function amountsLabelled(rawText, marker) {
  const out = new Set()
  for (const frag of String(rawText || '').split(/[\n。；;]+|(?<=[a-z0-9)])\.\s/gi)) {
    if (!marker.test(frag)) continue
    for (const m of frag.matchAll(MONEY_TOKEN)) {
      const v = amountOf(m[1], m[2])
      if (Number.isFinite(v) && v > 0) out.add(v)
    }
  }
  return [...out]
}

const near1pc = (a, b) => Math.abs(a - b) <= Math.max(1, b * 0.01)

/** Letters and digits only - a heading is short, a sentence is not. */
const alnumLen = (s) => String(s).replace(/[^\p{L}\p{N}]/gu, '').length

/**
 * A caption that states the wrong transaction. Returns { invented, warnings }.
 *
 * Silent when listingType is absent or unrecognised: an unknown truth cannot be
 * contradicted, exactly as contradictsRoomCounts() is silent without a count.
 */
export function transactionTypeConflicts(caption, listing) {
  const cap = String(caption || '')
  const out = { invented: [], warnings: [] }
  if (!cap.trim()) return out

  const t = String(listing?.listingType || '').toLowerCase()
  const isRental = /rent|sewa|租/.test(t)
  const isSale = !isRental && /sale|sell|jual|售/.test(t)
  if (!isRental && !isSale) return out

  const TRUE_T = isRental ? TXN_RENT : TXN_SALE
  const OPP = isRental ? TXN_SALE : TXN_RENT
  const src = `${listing?.rawText || ''} ${listing?.title || ''}`

  const dual = TXN_DUAL.test(cap)                 // "FOR SALE OR RENT"
  const mixed = TRUE_T.decl.test(cap)             // the caption also says the truth
  const grounded = OPP.sourceAny.test(src)        // the agent's own words

  // TWO SOFTENERS, AND THEY ARE NOT THE SAME STRENGTH.
  //
  // `dual` is a real listing type: "FOR SALE OR RENT" appears in this agent's
  // own stored style examples, and nothing about it may ever refuse a post.
  //
  // `mixed` used to be just as strong, and that made the guard blind to the
  // incident's nearest neighbour. Measured: the published RENNA caption with
  // one word changed — the headline reading "RENNA RESIDENCE — FOR RENT" —
  // PUBLISHED with "💰 Selling Price / RM2,500/month", "Why Buy This Property?"
  // and "#PCMY_Sale" all intact, because that one true-type phrase downgraded
  // every finding to a warning. The new prompt pushes the model to put FOR RENT
  // in the headline, so the rule was sharpest against a caption we had just
  // made rarer and blind to the one we had made commoner.
  //
  // Worse, it disarmed the REPAIR ROUND: fixing only the price heading CREATES
  // a true-type phrase, which turned the two remaining findings into warnings
  // and published a rental still asking the reader to buy it.
  //
  // So `mixed` now softens only the PROSE rules, where a caption discussing
  // both transactions really is ambiguous. A price label on the asking price, a
  // category hashtag and a buy/rent CTA are structural: saying "FOR RENT"
  // elsewhere does not make "Why Buy This Property?" true.
  const soften = dual || mixed                    // prose: may warn, never refuse
  const softenHard = dual                         // structural: only a dual listing

  const say = (hit, why) => `"${String(hit).trim().replace(/\s+/g, ' ')}" — this listing is a ${TRUE_T.type}, ${why}`
  const file = (msg) => (soften ? out.warnings : out.invented).push(msg)
  const fileHard = (msg) => (softenHard ? out.warnings : out.invented).push(msg)
  // T1 and T3 read the same words ("Selling Price" is both a price label and a
  // declaration). One finding per phrase, or the repair prompt is told to fix
  // the same three characters twice.
  const said = new Set()
  const once = (hit) => {
    const k = String(hit).trim().toLowerCase()
    if (said.has(k)) return false
    said.add(k); return true
  }

  // T1 - BLOCKS. AN OPPOSITE-TYPE PRICE LABEL ON THE LISTING'S OWN ASKING PRICE.
  // The RENNA heading exactly: "💰 Selling Price" over "RM2,500/month", where
  // 2,500 IS listing.price. This is the one pattern that needs no judgement -
  // the asking price of a rental is its rent and cannot also be a selling
  // price, and the number proves which figure is being labelled.
  // FALSE POSITIVE NAMED: a sale that quotes its tenancy ("Current Rental :
  // RM1,300/month" on a RM338,000 unit) labels a DIFFERENT figure, so it cannot
  // match. A listing the parser mis-typed - text says "RM1,300/month for rent",
  // parser says sale - is cleared by amountsLabelled(), which finds the source
  // itself calling that same amount a rent.
  const price = Number(listing?.price)
  if (Number.isFinite(price) && price > 0) {
    const m = firstUnnegated(cap, OPP.priceLabel)
    if (m) {
      // The figure a label labels is the NEXT one, and only the next one.
      // Measured on the Chinese corpus entry "售价 RM338,000 … 现租金 RM1,300/月":
      // a symmetric window around 租金 reached back a line and read RM338,000 as
      // the labelled figure, turning a faithful tenanted-sale caption into a
      // finding. Forward-only, nearest token, at most one line break - which is
      // the RENNA layout, a heading with its value underneath.
      const tail = m.index + m[0].length
      const nl = cap.indexOf('\n', tail)
      const stop = Math.min(cap.length, tail + 60, nl === -1 ? cap.length : (cap.indexOf('\n', nl + 1) === -1 ? cap.length : cap.indexOf('\n', nl + 1)))
      const first = [...cap.slice(tail, stop).matchAll(MONEY_TOKEN)]
        .map((mm) => amountOf(mm[1], mm[2])).find((v) => Number.isFinite(v) && v > 0)
      const onAskingPrice = first != null && near1pc(first, price)
      const srcCallsItThat = amountsLabelled(listing?.rawText, OPP.sourceAny).some((v) => near1pc(v, price))
      // `!grounded` — THE SAME GATE T2, T3 AND T4 ALREADY HAD, and leaving it off
      // here made this the sixth silent refusal. listingType comes from the
      // parser, ingest.js defaults it to 'sale' when the parser says nothing,
      // and demoParse — the fallback used every time the free tier rate-limits —
      // could not read 出租 at all. So a correct Chinese rental caption was
      // refused with three findings, and the agent was told the caption ENGINE
      // had failed, which sent them to debug the wrong system forever.
      //
      // srcCallsItThat alone was not enough: it needs the amount and the rent
      // word in one clause, and real listings say "for Rent" in sentence one and
      // "RM2.5k nego" three sentences later. Measured: 4 of 5 realistic
      // mis-parses newly refused a caption that was entirely correct.
      //
      // This only ever widens. On the real incident the source is a rental and
      // says no sale words at all, so `grounded` is false and T1 still fires.
      if (onAskingPrice && !srcCallsItThat && !grounded && once(m[0])) {
        fileHard(say(m[0], `RM${price.toLocaleString('en-MY')} is its ${isRental ? 'monthly rent' : 'asking price'}, not a ${OPP.other} price`))
      }
    }
  }

  // T2 - BLOCKS. THE OPPOSITE-TYPE HASHTAG ("#PCMY_Sale" on a rental).
  // A hashtag is a category, not prose: it puts the post in the wrong search
  // bucket and it cannot be a passing mention.
  // FALSE POSITIVE NAMED: "#Wholesale" - the tag BODY is matched whole, and
  // "wholesale" is one word, so there is no boundary before "sale". A dual tag
  // (#ForSaleOrRent) is caught by TXN_DUAL first and only warns.
  // Structural, so a FOR RENT line elsewhere does not excuse it: the tag still
  // files the post in the wrong search bucket.
  if (!grounded && !dual) {
    const h = firstUnnegated(cap, OPP.hashtag)
    if (h && once(h[0])) fileHard(say(h[0], `not for ${isRental ? 'sale' : 'rent'} — use the ${TRUE_T.type.toLowerCase()} hashtag`))
  }

  // T3 - BLOCKS ON A LABEL LINE, WARNS IN PROSE. THE TRANSACTION DECLARATION.
  // A style template's banner ("🏡 FOR SALE" on its own line) declares what the
  // listing IS. The same words inside a sentence usually do not.
  // FALSE POSITIVES NAMED, and each is real Malaysian sale copy:
  //   "Vacant and ready for rent"      21 letters, short enough to read as a
  //                                    heading - caught instead by TXN_QUALIFIED
  //   "Currently for rent at RM1,800/month, asking RM520,000"   >48 -> warns
  //   "现租金 RM1,300/月，年租 RM15,600"  a heading-length tenancy line, cleared
  //                                    by the SOURCE gate: the listing says it
  // while "FOR SALE" (7), "🏡 FOR SALE" (7) and "Riverine Diamond — for rent"
  // (22, and the caption's first line) are headings, and refuse.
  if (!grounded && !dual) {
    const lines = cap.split('\n')
    const firstIdx = lines.findIndex((l) => l.trim())
    let filed = false
    for (let i = 0; i < lines.length && !filed; i++) {
      const m = firstUnnegated(lines[i], OPP.decl)
      if (!m || !once(m[0])) continue
      const qualified = TXN_QUALIFIED.test(lines[i].slice(Math.max(0, m.index - 20), m.index))
      const isLabelLine = alnumLen(lines[i]) <= 24
      const isHeadline = i === firstIdx && alnumLen(lines[i]) <= 48
      const msg = say(m[0], `not for ${isRental ? 'sale' : 'rent'}`)
      // A BANNER is structural; the same words inside a sentence are not.
      if (!qualified && (isLabelLine || isHeadline)) fileHard(msg)
      else out.warnings.push(msg)
      filed = true
    }
  }

  // T4 - BLOCKS. A CALL TO ACTION NAMING THE WRONG TRANSACTION.
  // "Why Buy This Property?" on a rental asks a reader to do something they
  // cannot do. Second person, and about this property - a tenancy mention
  // never takes this shape.
  // FALSE POSITIVE NAMED: "Why buy when you can rent?" is real rental copy and
  // would match `why buy`. It is cleared by the CLAUSE test below - the line it
  // sits on also names the true transaction, so it is a comparison, not a
  // declaration. Same for "Why rent when you can buy?" on a sale.
  if (!grounded && !dual) {
    const c = firstUnnegated(cap, OPP.cta)
    if (c && once(c[0])) {
      const start = cap.lastIndexOf('\n', c.index) + 1
      const end = cap.indexOf('\n', c.index)
      const clause = cap.slice(start, end === -1 ? cap.length : end)
      const TRUE_LOOSE = isRental ? /\brent|\bsewa|租/i : /\bbuy|\bsale|\bsell|\bjual|\bbeli|售|买|買/i
      if (!TRUE_LOOSE.test(clause)) {
        // Structural: a headline saying FOR RENT does not make "Why Buy This
        // Property?" true. The clause test above is what protects the real
        // comparison copy ("Why buy when you can rent?").
        fileHard(say(c[0], `do not ask the reader to ${isRental ? 'buy' : 'rent'} it`))
      }
    }
  }

  // W1 - WARNS ONLY. Words that lean the wrong way without declaring anything:
  // "purchase", "ownership", 购买, "leasing". Too ordinary to refuse a client's
  // post over, specific enough that the repair round should look.
  if (!grounded && !soften) {
    const l = firstUnnegated(cap, OPP.loose)
    if (l && !OPP.decl.test(cap) && !OPP.cta.test(cap)) {
      out.warnings.push(say(l[0], `check this reads as a ${TRUE_T.type.toLowerCase()}`))
    }
  }

  // W2 - WARNS ONLY. "FOR SALE OR RENT" on a listing the agent offered only one
  // way. It is a real listing type and it is in this agent's stored style
  // examples, so it never refuses - but if the agent never offered both, the
  // repair round should hear about it.
  if (dual && !TXN_DUAL.test(src) && !grounded) {
    out.warnings.push(`the caption offers this both for sale and for rent — the listing is a ${TRUE_T.type} only`)
  }

  return { invented: [...new Set(out.invented)], warnings: [...new Set(out.warnings)] }
}

/**
 * Returns { missing, invented, warnings } - the first two empty means the
 * caption honours the listing. `warnings` are advisory ONLY and must never
 * refuse a post; see the property-name note below. `listing` is the parsed
 * listing incl. rawText.
 */
// Figures an agent states as a cost of transacting rather than as the price of
// the property: deposits, utility deposits, service charges, booking fees. A
// Facebook ad that carries the rent and leaves these out is normal copy.
const ANCILLARY_MONEY = /deposit|utilit|service\s*charge|maintenance|booking|earnest|cagaran|wang\s*pendahuluan|caj\s*perkhidmatan|押金|訂金|订金|定金|管理费|管理費|杂费|雜費|服务费|服務費/i

// THE AGENT'S OWN CONTACT, TAUGHT ONCE. Edward, 2026-09-15: "Please add on my
// WhatsApp link https://wa.me/60183929100". It was saved as a rule, so every
// caption after it carried the link — and every one was refused as "invented",
// because the check below only looked in the listing, and a listing rarely
// repeats the agent's own number. A rule is the agent's own words, saved on
// purpose, so a WhatsApp link or phone number written IN a rule grounds the
// same number in a caption. Only contact numbers: a price or size in a rule
// grounds nothing.
const RULE_CONTACT = /(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)\+?(\d{9,13})|(?:^|[^\d])(\+?6?0?1\d[-\s]?\d{3,4}[-\s]?\d{4})(?!\d)/g
/** Digits of every WhatsApp link or Malaysian mobile number written in the agent's rules. */
export function contactNumbersFromRules(rules) {
  const out = new Set()
  for (const r of Array.isArray(rules) ? rules : []) {
    for (const m of String(r || '').matchAll(RULE_CONTACT)) {
      const d = String(m[1] || m[2] || '').replace(/\D/g, '')
      if (d.length >= 9) out.add(d.replace(/^60/, '').replace(/^0/, ''))
    }
  }
  return [...out]
}

export function captionViolations(caption, listing) {
  const cap = String(caption || '')
  const capLow = cap.toLowerCase()
  const src = `${listing?.rawText || ''}`
  const srcLow = src.toLowerCase()
  const missing = [], invented = [], warnings = []

  // -- MISSING ---------------------------------------------------------------
  // THE SAME PRICE, SPELLED TWO WAYS, IS NOT A MISSING PRICE.
  //
  // This walk canonicalised the SOURCE side only: a listing saying RM338,000
  // looked for the literal "338,000" or "338000" in the caption. A caption
  // writing that price the way agents actually write it — "RM338k" — matched
  // neither, landed in `missing`, and `missing` beginning with RM is what blocks
  // at ingest.js and marks the caption degraded. So the guard refused a caption
  // that was perfectly correct, silently, and the repair loop then chased a
  // figure that was already on the page.
  //
  // knownAmounts() has parsed k / juta / jt / mil / million / 万 / 萬 correctly
  // all along (see amountOf above); this walk simply never used it. Now the
  // caption's own figures are canonicalised through the same parser and checked
  // first.
  //
  // NOTE THE DIRECTION. This is an extra way to ACCEPT, added in front of the
  // two literal tests, which are untouched. It can only ever shrink `missing`,
  // never grow it — so no caption that published before can start refusing
  // because of this change.
  const capValues = new Set()
  {
    const add = (v) => { if (Number.isFinite(v) && v > 0) capValues.add(v) }
    for (const m of cap.matchAll(RM_AMOUNT)) add(amountOf(m[1], m[2]))
    for (const m of cap.matchAll(BARE_AMOUNT)) {
      // a bare one- or two-digit number is a bedroom count or a floor, not a price
      if (!m[2] && m[1].replace(/[,.].*$/, '').length < 3) continue
      add(amountOf(m[1], m[2]))
    }
  }
  // AN ADVERT MUST STATE A PRICE. IT NEED NOT STATE EVERY FIGURE IN THE WHATSAPP
  // MESSAGE.
  //
  // This walk pushed EVERY RM figure in the source into `missing`, all of them
  // equally required. A real listing carries several — the rent, then the
  // deposit, then the utility deposit, then the service charge — and a Facebook
  // ad that carries the rent and drops the two deposits is normal copy, not a
  // misrepresentation. Two such omissions tripped ingest.js's `missing.length >
  // 1` and the agent's post silently never went out.
  //
  // So: when the caption carries the listing's OWN headline price, a figure the
  // agent's own text labels as a DEPOSIT or a CHARGE is a warning. Everything
  // else still refuses — in particular the below-value saving, which is the
  // agent's strongest number and stays required (see money-spelling.test.mjs).
  // When the caption carries no price at all, every figure stays missing: an
  // advert with no price is the thing this check is for.
  const headline = Number(listing?.price)
  const capHasHeadline = Number.isFinite(headline) && headline > 0 && capValues.has(headline)
  const seenRaw = new Set()
  for (const m of src.matchAll(/rm\s?([\d,]+(?:\.\d+)?\s*k?)/gi)) {
    const raw = m[1].replace(/\s/g, '').toLowerCase()
    if (seenRaw.has(raw)) continue
    seenRaw.add(raw)
    const canon = raw.endsWith('k') ? String(parseFloat(raw) * 1000) : raw.replace(/,/g, '')
    const asNumber = Number(canon)
    const sameMoney = Number.isFinite(asNumber) && asNumber > 0 && capValues.has(asNumber)
    const inCap = sameMoney || capLow.includes(raw) || cap.replace(/,/g, '').includes(canon)
    if (inCap) continue
    // The words around the figure in the AGENT'S OWN TEXT, which is the only
    // thing that says what the figure is for.
    const around = src.slice(Math.max(0, m.index - 44), m.index + m[0].length + 28)
    const isHeadline = Number.isFinite(asNumber) && asNumber === headline
    if (capHasHeadline && !isHeadline && ANCILLARY_MONEY.test(around)) {
      warnings.push(`the listing also mentions RM${raw.toUpperCase()} (${'a deposit or charge — include it only if it belongs in the ad'})`)
    } else {
      missing.push(`RM${raw.toUpperCase()}`)
    }
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

  // THE PROPERTY NAME COMES FROM THE PARSER, NOT FROM CAPITALISATION.
  //
  // propertyNames() guesses a name by regexing capitalised runs out of the top
  // of rawText, and in two days that produced three separate silent refusals -
  // each one a good caption blocked with no error anyone saw:
  //   2026-09-03  a one-line listing yielded "Sqft Fully Furnished" as a name
  //   2026-09-03  "walking distance to Kuching City Mall" yielded "City Mall"
  //   2026-09-04  "Call Jason" / "Hubungi Azlan" yielded "Jason" / "Azlan"
  // Each was fixed as a symptom - another exclusion list, another rank tweak -
  // and the next listing shape broke it again. The approach was the bug: a
  // regex over capitalisation cannot tell a name from a landmark, and it can
  // never return "this listing has no name", which is the correct answer for a
  // room ad, a plot of land or an unnamed terrace.
  //
  // buildParsePrompt now asks the model for `propertyName`, which CAN be null.
  // When the parser names the property, that name - and nothing else - is
  // required. Otherwise the heuristic still runs, because it is right often
  // enough to be worth telling the model about, but its guess is a WARNING and
  // ingest.js may not refuse a post over it.
  // A parser name is required ONLY when the listing text actually contains it -
  // see resolvePropertyName(). Everything else is a warning ingest.js may not
  // refuse over.
  const { name: propName, from: nameFrom } = resolvePropertyName(listing)
  if (propName && !carriesName(cap, propName)) {
    if (nameFrom === 'parser') missing.push(`property name "${propName}"`)
    else warnings.push(`possible property name "${propName}" (heuristic guess, not from the parser)`)
  }

  // --- WARNINGS, NOT REFUSALS ------------------------------------------------
  //
  // Both rules below catch real inventions and neither may block, because
  // neither can tell a genuine claim from a coincidence often enough to be
  // trusted with a silent, total refusal. A blocker that is right 70% of the
  // time refuses a real listing three times in ten; a warning that is right 70%
  // of the time still reaches the repair round, which is where a model can look
  // at it and decide. That is the whole difference.

  // A PLACE THE LISTING NEVER NAMED. Only the "N mins to X" shape was checked,
  // so "Walking distance to Vivacity Megamall and SJK Chung Hua", "Near Kuching
  // International Airport" and a street the listing never gave all published
  // clean — and a location perk is exactly the line a model reaches for when it
  // wants one more bullet.
  //
  // It warns rather than blocks because the boundary of a place name is genuinely
  // ambiguous: "near the market" is not a claim about a named landmark, and an
  // area the parser already stored is not an invention at all.
  const NEARBY = /\b(?:walking distance (?:to|from)|next to|opposite|beside|adjacent to|near(?:by| to)?|steps (?:to|from)|a short (?:walk|drive) (?:to|from))\s+([^\n,.;!?]{3,40})/gi
  const known_places = `${srcLow} ${String(listing?.location || '').toLowerCase()} ${String(listing?.propertyName || '').toLowerCase()}`
  for (const m of cap.matchAll(NEARBY)) {
    const place = m[1].trim().replace(/\s+/g, ' ')
    // A place with no capitalised word is a description ("the market", "shops"),
    // not a named landmark, and naming one is what makes this a factual claim.
    if (!/[A-Z\u4e00-\u9fff]/.test(place)) continue
    const head = place.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 2)
    if (!head.length || head.some((w) => known_places.includes(w))) continue
    warnings.push(`"${place}" — the listing never mentions it`)
  }

  // AN INVENTED BUILDING OR DEVELOPER. carriesName only ever checked that the
  // real name is PRESENT, never that a second one is absent, so "by Ibraco
  // Berhad" or "Sunway Vivaldi @ Tropics City" attached a company to a property
  // that never named one. The developer suffixes make this narrow enough to be
  // worth saying out loud, and vague enough that it must not refuse a post.
  const DEVELOPER = /\bby\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3}?\s+(?:Berhad|Bhd|Sdn\s*Bhd|Group|Development(?:s)?|Properties|Holdings|Corporation|Corp))\b/g
  for (const m of cap.matchAll(DEVELOPER)) {
    const dev = m[1].trim()
    const firstWord = dev.split(/\s+/)[0].toLowerCase()
    if (srcLow.includes(firstWord)) continue
    warnings.push(`developer "${dev}" — the listing never names one`)
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
  // A YIELD the listing neither states nor implies. "Guaranteed 8% rental
  // yield" published clean against a listing carrying no percentage at all;
  // an investor buys on that number.
  {
    const knownY = knownYields(listing)
    const seen = new Set()
    for (const re of YIELD_CLAIM) {
      for (const m of cap.matchAll(re)) {
        const v = parseFloat(m[1])
        if (!Number.isFinite(v) || yieldKnown(v, knownY)) continue
        const text = `${v}% yield`
        if (seen.has(text)) continue
        seen.add(text)
        invented.push(text)
      }
    }
  }
  // LEASE / TENANCY TERM the listing never agreed to. A term is a contractual
  // promise a tenant can hold the landlord to, so an invented one is worse than
  // most marketing puff. Cleared by the same term in the source, or by the
  // source raising a term at all - if the landlord mentioned a tenancy period
  // in any wording, the caption repeating it is not an invention. Tenure is
  // excluded inside leaseTermsIn, by length and by the words around it.
  if (srcLow.trim() && !SOURCE_HAS_TERM.test(src)) {
    const srcTerms = leaseTermsIn(src)
    for (const months of leaseTermsIn(cap)) {
      if (srcTerms.has(months)) continue
      const label = months % 12 === 0 ? `${months / 12}-year lease` : `${months}-month lease`
      if (!invented.includes(label)) invented.push(label)
    }
  }
  // FACILITIES from the closed list above, where the listing mentions nothing
  // of the sort. "Gated and guarded, 24-hour security, swimming pool, gym" is
  // four promises about a building the agent described in one line.
  // Skipped when the listing has no source text at all: `known` would be empty
  // and every facility in the caption would read as invented. ingest.js always
  // sets rawText, but nothing enforces that, and the failure would be silent.
  if (srcLow.trim()) {
    for (const [label, claim, grounds] of FACILITY_CLAIMS) {
      if (claim.test(cap) && !grounds.test(known)) invented.push(label)
    }
  }
  // distances/amenities the listing never mentioned ("5 mins to X", "near Y")
  for (const m of cap.matchAll(/\b(\d+\s*min(?:ute)?s?\s+(?:to|from)\s+[^\n,.]{3,30})/gi)) {
    const place = m[1].toLowerCase().replace(/\s+/g, ' ')
    if (!srcLow.replace(/\s+/g, ' ').includes(place.slice(place.indexOf('to ') + 3, place.indexOf('to ') + 13))) invented.push(m[1].trim())
  }
  // A CONTACT LINK NOBODY GAVE.
  //
  // Edward, 2026-09-08. His Stapok Oaks listing carried no phone number at all,
  // and the reel caption came back ending:
  //     📲 WhatsApp for more info: https://wa.me/YourNumber
  // Three times. Every other check passed it - it is not money, not a room
  // count, not a material claim, not a distance - so a caption with a dead link
  // to nobody was one ✅ away from a paying client's TikTok, under his name.
  //
  // A contact link is the one line in a property post that exists to be acted
  // on. Getting it wrong is worse than a typo: the listing looks legitimate,
  // the buyer taps, and the agent never learns the enquiry was lost.
  //
  // THE RULE IS THE SAME ONE THE REST OF THIS FILE USES: a number that is not
  // in the listing was not given by the agent. wa.me/YourNumber has no digits
  // at all, so it can never be grounded; wa.me/60123456789 is grounded only if
  // those digits appear in what the agent actually wrote. Local formatting is
  // ignored on both sides - agents write 012-345 6789 and the link needs
  // 60123456789 - so the comparison is on digits, with a leading 60 optional.
  for (const m of cap.matchAll(/(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?([^\s/?#)\]]*)/gi)) {
    const raw = (m[1] || '').trim()
    const digits = raw.replace(/\D/g, '')
    // No digits at all is a placeholder by definition - YourNumber, XXX, [phone].
    // Fewer than 7 cannot be a Malaysian mobile either way.
    // The agent's OWN link, pasted verbatim, is grounded whatever it looks like.
    // wa.me/message/ABCD1234EFGH1 is WhatsApp's official short-link form and
    // carries no phone number at all, so a digits-only rule called every one of
    // them invented and refused the agent's real contact line.
    const pastedByAgent = raw.length > 0 && srcLow.includes(raw.toLowerCase())
    const taught = digits.length >= 9 && (Array.isArray(listing?.contactLinks) ? listing.contactLinks : [])
      .some((n) => String(n).replace(/\D/g, '') === digits.replace(/^60/, '').replace(/^0/, ''))
    const grounded = pastedByAgent || taught || (digits.length >= 7 && (() => {
      const srcDigits = String(known).replace(/\D/g, '')
      const bare = digits.replace(/^60/, '')
      return srcDigits.includes(digits) || srcDigits.includes(bare)
    })())
    if (!grounded) invented.push(m[0].trim())
  }
  // UNFILLED PLACEHOLDERS, whatever they are standing in for.
  // The same run that produced wa.me/YourNumber also produced
  // "📍 Location: [Specify Location]" on the feed path when a listing arrived
  // with no text. A bracketed slot or a YourThing token is never something an
  // agent wrote; it is the model showing its own scaffolding.
  for (const m of cap.matchAll(/\[(?:your|specify|insert|enter|add)\b[^\]]{0,40}\]|\byour(?:number|name|phone|link|website|contact)\b/gi)) {
    if (!srcLow.includes(m[0].toLowerCase())) invented.push(m[0].trim())
  }

  // SALE versus RENT. A caption that states the wrong transaction is making a
  // false claim about the most material fact after the price - and unlike the
  // walks above, the truth is a field the parser already produced. See the long
  // note at transactionTypeConflicts(): it fires on a CONTRADICTION, never on a
  // mention, and hands back its own blocking/warning split.
  {
    const txn = transactionTypeConflicts(cap, listing)
    invented.push(...txn.invented)
    warnings.push(...txn.warnings)
  }

  // `marketing` is separate from `invented` on purpose. Both drive the repair
  // round, but only `invented` blocks: a wrong price is a factual error nobody
  // should publish, while a stray "spacious" that survived two repair attempts
  // is not worth losing the listing over. Refusing costs more than the word.
  const marketing = [...inventedMarketing(cap, listing), ...movedQualifiers(cap, listing), ...repeatedLines(cap)]
  return { missing, invented, warnings, marketing }
}

// THE SAME FACT, TWICE, TO FILL A TEMPLATE.
//
// Edward, 2026-09-13, Penview Hotel shoplot. His listing gave a price, a size,
// a floor and two remarks ("SNP and MOT legal fee and stamp duty half shared…",
// "MOC, Valuation borne by purchaser"). His template has a "✨" highlight line
// AND a "Why Buy This Property?" section, the model had nothing else to put in
// either, and both remarks were printed in full under each — word for word. The
// contract found nothing: every word was his, no figure was wrong. He asked
// "SNP MOT repeat 3 times — is it normal?". It is not.
//
// Counted within one language part only: the same phone number in the English
// and Chinese versions is correct. Only lines with substance (20+ letters and
// digits) count, so short template lines — "2 Bedrooms", a divider, a hashtag —
// can never trip it. Marketing, not invented: it drives the repair round, which
// edits in place, and never blocks a post.
//
// WORDS, NOT LINES. The first version compared whole lines, and the very next
// live run walked straight past it: the model joined both remarks into ONE
// all-caps highlight ("✨ SNP AND MOT LEGAL FEE & STAMP DUTY … • MOC, VALUATION
// BORNE BY PURCHASER") and repeated them again as bullets. No line matched a
// line; the facts still appeared twice. So a line counts as a repeat when at
// most of its words already appear in another line of the same caption.
//
// AND NOT EVERY RESTATEMENT. Measured over the 19 real captions in the chat
// history: a 4-word threshold flagged 7, and 6 of them were the house style —
// "Why Buy / Why Rent" restating a short detail ("✅ 2 Bedrooms, 2 Bathrooms",
// "✅ Built-up 787 sqft", "✅ Current Rental: RM1,300/month"). Owen's own trained
// examples do exactly that, and a repair that strips those bullets would take
// away a format he likes. What set Edward's apart was LENGTH: a whole sentence
// of remarks printed twice. So two rules, counting only words with no digit in
// them (a figure is what a style restatement usually repeats):
//   exact   the same line twice, 4+ words      — "MOC, Valuation borne by purchaser"
//   folded  a 7+ word line, 90% inside another — the remarks inside the ✨ line
// Over that corpus this flags one caption: Edward's.
const REPEAT_STOP = new Set(['and', 'the', 'a', 'an', 'of', 'to', 'for', 'in', 'on', 'by', 'with', 'is', 'are', 'at', 'or', 'dan', 'yang', 'untuk', 'di'])
const repeatWords = (s) => String(s).toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u)
  .filter((w) => w && !REPEAT_STOP.has(w) && !/\d/.test(w))

export function repeatedLines(caption) {
  const out = []
  for (const part of String(caption || '').split(/\n\s*•\s*•\s*•\s*\n/)) {
    const lines = part.split('\n').map((raw) => ({ raw: raw.trim(), words: repeatWords(raw), key: raw.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() }))
      .filter((l) => l.words.length >= 4)
    const reported = new Set()
    for (let i = 0; i < lines.length; i++) {
      for (let j = 0; j < lines.length; j++) {
        if (i === j || reported.has(i)) continue
        const a = lines[i], b = lines[j]
        // `a` is the fact, `b` the line that already says it: the shorter one is
        // the repeat, and of two equal lines only the later is reported.
        if (a.words.length > b.words.length || (a.words.length === b.words.length && i < j)) continue
        const exact = a.key === b.key
        const inB = new Set(b.words)
        const folded = a.words.length >= 7 && a.words.filter((w) => inB.has(w)).length / a.words.length >= 0.9
        if (!exact && !folded) continue
        reported.add(i)
        out.push(`"${a.raw.slice(0, 80)}" is already said in "${b.raw.slice(0, 60)}" — say it once, in the section it belongs to, and remove any heading left with nothing under it`)
      }
    }
  }
  return out
}

// A QUALIFIER BELONGS TO THE FIGURE IT WAS WRITTEN ON.
//
// Owen's RENNA listing says "Rental price: RM2.5k (nego)". Live on 2026-09-12
// the caption dropped it from the rent and printed "Comm: 1 month + 8% SST
// (Negotiable)" — his commission is not negotiable, and he never said it was.
// Nothing caught it: every figure was real, the word was in the source, and
// only its OWNER had changed.
//
// Narrow by design. It fires only when a caption line says negotiable ABOUT a
// commission, fee, deposit or stamp duty while the listing attaches the word to
// none of those. A caption that marks the price negotiable, or that repeats a
// negotiable the listing really did put on a fee, is untouched. Marketing, not
// invented: it is a misplaced word, and losing the whole post over it would
// cost the agent more than the word does.
const NEGOTIABLE = /\b(?:nego|negotiable|negotiate|boleh\s+runding|runding)\b|可议|面议/i
const NOT_THE_PRICE = /\b(?:comm(?:ission)?|fee|deposit|stamp(?:ing)?\s*duty|sst|legal|utilit)/i
export function movedQualifiers(caption, listing) {
  const src = String(listing?.rawText || '')
  if (!src.trim() || !NEGOTIABLE.test(String(caption || ''))) return []
  // Which lines of the AGENT'S OWN text carry the qualifier?
  const srcLines = src.split('\n').filter((l) => NEGOTIABLE.test(l))
  if (!srcLines.length) return []                       // never said it: inventedMarketing's job, not this one
  const srcOnAFee = srcLines.some((l) => NOT_THE_PRICE.test(l))
  if (srcOnAFee) return []                              // they really did negotiate a fee
  const out = []
  for (const line of String(caption).split('\n')) {
    if (!NEGOTIABLE.test(line) || !NOT_THE_PRICE.test(line)) continue
    out.push(`"${line.trim().slice(0, 80)}" — the listing says negotiable about ${srcLines[0].trim().slice(0, 40)}, not about this`)
  }
  return out
}

// THE AGENT'S OWN NUMBER, AS A LINK THAT ACTUALLY OPENS.
//
// Edward's trained rule is "Never show phone number in captions, only show the
// WhatsApp link", so the model built one from his number exactly as he writes
// it: https://wa.me/0183929100. That link opens nothing — wa.me needs the
// international form, country code first and no leading zero. The digits are
// his, so the provenance walk above passes it happily; whether it DIALS is a
// different question, and this is the answer to it.
//
// Nothing is composed from thin air. A link is only ever built from a number
// the listing itself carries, and only its FORMAT changes.
const MY_MOBILE = /(?:\+?60[- ]?|\b0)(1\d)[- ]?(\d{3})[- ]?(\d{4,5})\b/

/** The agent's WhatsApp number in the form wa.me needs, or '' when unknown. */
export function waNumberFrom(listing) {
  const m = String(listing?.rawText || '').match(MY_MOBILE)
  if (!m) return ''
  const local = `${m[1]}${m[2]}${m[3]}`
  return local.length >= 9 && local.length <= 10 ? `60${local}` : ''
}

/** The link itself, or '' — for the prompt, so the model never has to build one. */
export function waLinkFor(listing) {
  const n = waNumberFrom(listing)
  return n ? `https://wa.me/${n}` : ''
}

/**
 * Repair a wa.me link that carries the agent's own number in a form that cannot
 * open. Only their number, only the format — an unrelated number is left alone
 * for the invented-contact walk to refuse.
 */
export function fixWaLinks(text, listing) {
  const want = waNumberFrom(listing)
  if (!want || !text) return text
  const bareWant = want.slice(2)                        // drop the 60
  // No \s in the digit class: it would swallow the newline after the link and
  // glue the next line onto it.
  return String(text).replace(/((?:https?:\/\/)?(?:www\.)?wa\.me\/)(\+?\d[\d -]{6,}\d)/gi, (whole, head, digits) => {
    const d = digits.replace(/\D/g, '')
    if (d === want) return whole                        // already dialable
    const bare = d.replace(/^60/, '').replace(/^0/, '')
    return bare === bareWant ? `${head}${want}` : whole
  })
}

// -- the agent's OWN trained rules, enforced ---------------------------------
//
// An agent teaches a rule once ("never use emoji in my captions") and it goes
// into the prompt. Measured 2026-09-04 on the real model: the rule was in the
// prompt, plainly worded, and the caption came back with emoji anyway. That is
// the same shape as every other failure this file exists for — an instruction
// is a hope, a check is a guarantee.
//
// Only MECHANICALLY CHECKABLE rules are handled. "Make it punchier" is not
// checkable and is deliberately ignored; an unrecognised rule produces no
// violation, so a rule this cannot read can never refuse a caption.
//
// These are STYLE violations, not factual ones. They feed the repair round so
// the model fixes its own output, but they must never block a publish on their
// own: an emoji the agent dislikes is not worth refusing a listing over, and a
// silent refusal is the failure mode this project keeps paying for.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u

// Named emoji an agent actually asks about. Only used to enforce a rule about
// ONE emoji - it never widens into a blanket ban, which is the mistake that
// flattened a real agent's captions.
const EMOJI_BY_NAME = {
  fire: '🔥', flame: '🔥',
  heart: '❤️🧡💛💚💙💜🤍🖤❣️💕💖',
  star: '⭐🌟✨',
  money: '💰💵💸🤑',
  house: '🏡🏠🏘️',
  home: '🏡🏠',
  rocket: '🚀',
  siren: '🚨', alarm: '🚨',
  party: '🎉🎊',
  clap: '👏',
  'thumbs up': '👍', thumb: '👍',
  check: '✅☑️✔️', tick: '✅✔️',
  car: '🚗🚙',
  eyes: '👀',
  bell: '🔔',
  pin: '📍', location: '📍',
  phone: '📲📱☎️',
  sparkle: '✨', sparkles: '✨',
}

// WHICH WORD DID THE AGENT BAN?
//
// This is the one rule-parse with a PUBLISHED consequence, which is why it is
// read by structure and not by phrasing. Its answer does two things: it drives
// the repair round, and — through bannedByRules in prompts.js — it decides
// whether a forbidden word is handed to the model as a stated LISTING FACT.
// Edward's rule is "never call a condo an apartment"; his listing said neither
// word, the parser inferred propertyType "Apartment", and the facts block
// asserted it. The model wrote the word he had forbidden and two repair rounds
// could not argue it back out, because the prompt was stating as fact the thing
// the rule was asking it to avoid.
//
// The old parse was two regexes anchored to end-of-string, so it read exactly
// the four phrasings AGENTS.md teaches the model to write and nothing else.
// Measured 2026-09-08, all four of these LEAKED "Property type: Apartment"
// into the facts block while the rule saved, listed and displayed normally:
//     "Don't call it an apartment, it's a condo"
//     "Never use the word apartment — it is a condo"
//     "Always say condo, never apartment"
//     "Never describe a property as an apartment"
// Only the taught phrasing was enforced. Nothing logged the other three.
//
// THE SHAPE. A ban is a NEGATION, then optionally a naming verb, then the word.
// Read clause by clause, because which side of the comma the word sits on is
// decided by where the negation is, not by position:
//     "Don't call it an apartment, it's a condo"  -> ban the FIRST clause's word
//     "Always say condo, never apartment"         -> ban the SECOND clause's
// Only clauses carrying a negation are read at all, so the positive half of a
// "say X, not Y" rule can never be mistaken for the ban.
const BAN_NEG = /\b(?:never|not|no|don'?t|dont|do not|avoid|stop|refrain from|jangan|elak)\b/
// Everything that may sit between the negation and the word: an optional naming
// verb, then an optional run ending in an article. A BARE `the` counts — without
// it "Never say the price is negotiable" left four words for the word matcher,
// which takes at most three, and the whole rule silently stopped firing. That
// phrasing worked before the parse was rewritten, so it is a regression, and a
// style rule that quietly stops applying is exactly what an agent never notices.
// The run is GREEDY on purpose
// so the LAST article wins — "never call a condo an apartment" bans "apartment",
// not "condo" — and both parts are optional so "never apartment" still parses.
const BAN_VERB =
  /(?:say|saying|use|using|write|writing|mention|mentioning|call|calling|describe|describing|refer\s+to|label|labelling|labeling|put|guna|gunakan|menggunakan|sebut|menyebut|panggil|tulis)/
const BAN_LEAD = new RegExp(
  /\b(?:never|not|no|don'?t|dont|do not|avoid|stop|refrain from|jangan|elak)\b/.source +
  `\\s*(?:${BAN_VERB.source}\\s+)?(?:.*\\b(?:as|a|an|the\\s+word|the\\s+term|the|word|term|perkataan)\\s+)?`,
)
// The word itself: one to three plain words. It ends at a clause boundary or at
// a function word that starts a new phrase ("...apartment in captions"), so a
// trailing qualifier cannot be swallowed into the ban.
const BAN_WORD =
  /["'“”]?([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,2}?)["'“”]?\s*(?:$|[,;:.!?]|\s+\b(?:in|on|for|when|while|it|its|it'?s|unless|because|instead|use|say|write|always|and|or|but|to|of|at|with|please|anywhere|ever)\b)/
// Naming verbs are scaffolding, never the banned word themselves.
const BAN_NOT_A_WORD = new Set([
  'say', 'saying', 'use', 'using', 'write', 'writing', 'mention', 'mentioning',
  'call', 'calling', 'describe', 'describing', 'refer', 'label', 'put', 'include',
  'add', 'make', 'be', 'have', 'do', 'word', 'term', 'the', 'a', 'an', 'as', 'it',
  'this', 'that', 'them', 'anything', 'ever', 'any',
  // A NAMED EMOJI IS NOT A WORD BAN. "never use the fire emoji" is handled by
  // the emoji arm, which knows 🔥; treated as a word ban it would hunt the
  // letters "fire emoji" in the caption and never find them, while the real
  // rule went unenforced. This became reachable the moment a bare `the` counted
  // as scaffolding — before that, 'the' itself rejected the capture — and the
  // fire-emoji rule is the one that has already cost a client their whole
  // caption format once.
  'emoji', 'emojis',
])

/**
 * The word an agent's rule forbids, or null when the rule bans no single word.
 *
 * Deliberately answers null for anything it cannot read mechanically: a wrong
 * ban strips a true field out of the facts block and sends every caption into a
 * repair round it cannot win, so "I could not tell" is the safe answer.
 */
export function bannedWord(rule) {
  const r = String(rule || '').toLowerCase().trim()
  if (!r) return null
  let found = null
  // Split on clause boundaries, keeping only the clauses that negate something.
  for (const clause of r.split(/[,;—–]|\s+-\s+/)) {
    const c = clause.trim()
    if (!c || !BAN_NEG.test(c)) continue
    const m = c.match(new RegExp(BAN_LEAD.source + BAN_WORD.source))
    if (!m) continue
    const w = m[1].trim().replace(/\s+/g, ' ')
    if (!w || w.length < 3 || w.length > 24) continue
    if (BAN_NOT_A_WORD.has(w)) continue
    // A multi-word capture whose last word is scaffolding is a mis-parse.
    if (w.split(' ').some((p) => BAN_NOT_A_WORD.has(p))) continue
    found = w
  }
  return found
}

/**
 * Style-rule breaches in a caption, as plain sentences the repair prompt can
 * quote back. `rules` is the agent's own list; `platform` narrows the ones that
 * name a platform. Never throws, never blocks — the caller decides.
 */
export function ruleViolations(caption, rules, platform = '') {
  const cap = String(caption || '')
  const out = []
  if (!cap.trim()) return out
  const plat = String(platform || '').toLowerCase()

  for (const raw of Array.isArray(rules) ? rules : []) {
    const r = String(raw || '').toLowerCase()
    if (!r.trim()) continue

    // Emoji, and the distinction that matters: a BLANKET ban versus ONE emoji.
    //
    // The first version matched /never.*emoji/, so Edward's rule "never use the
    // fire emoji" was read as "remove every emoji" and the repair round stripped
    // every emoji out of a caption whose whole format is built on them. His
    // posts went out as flat block capitals. Measured live 2026-09-04 - the
    // rule enforcement shipped that morning and this was its first casualty.
    //
    // A blanket ban needs "emoji" to follow the negation directly ("no emoji",
    // "never use emojis", "without any emoji"). Anything with a name in between
    // is a rule about ONE emoji and is handled below.
    const BLANKET_EMOJI = /\b(?:no|never use|never|without|avoid|don'?t use|do not use)\s+(?:any\s+|all\s+)?emojis?\b|不要(?:任何)?表情|jangan\s+(?:guna\s+)?emoji/i
    if (BLANKET_EMOJI.test(r) && EMOJI.test(cap)) {
      out.push(`they asked for no emoji at all — remove every emoji`)
    } else {
      // ONE named emoji. Only the named character is a breach; the rest of the
      // agent's format stays exactly as they built it.
      const named = r.match(/(?:no|never use|never|without|avoid|don'?t use|do not use)\s+(?:the\s+)?([a-z ]{2,18}?)\s+emojis?\b/)
      if (named) {
        const key = named[1].trim().replace(/\s+/g, ' ')
        // Compare with the variation selector (U+FE0F) stripped from BOTH sides.
        // Spreading '❤️' by code point yields '❤' AND the selector, and that
        // selector also lives inside '‼️' - so a caption with no heart in it
        // matched the heart rule on an invisible character.
        const strip = (t) => String(t).replace(/\uFE0F/g, '')
        const chars = EMOJI_BY_NAME[key]
        const capBare = strip(cap)
        if (chars && [...strip(chars)].some((ch) => ch.trim() && capBare.includes(ch))) {
          out.push(`they asked you not to use the ${key} emoji — remove it (keep their other emoji)`)
        }
      }
    }

    // no hashtags, optionally scoped to a platform
    if (/\bno\b.*hashtag|never.*hashtag|jangan.*hashtag|不要.*标签/.test(r) && /(^|\s)#\w/.test(cap)) {
      const named = r.match(/facebook|instagram|tiktok/)
      if (!named || !plat || named[0] === plat.replace('_page', '')) {
        out.push(`they asked for no hashtags${named ? ` on ${named[0]}` : ''} — remove them`)
      }
    }

    // a line cap: "keep captions under 5 lines", "max 8 lines"
    const lineCap = r.match(/(?:under|below|max(?:imum)?|no more than|less than)\s*(\d+)\s*lines?/)
    if (lineCap) {
      const limit = Number(lineCap[1])
      const lines = cap.split('\n').filter((l) => l.trim()).length
      if (Number.isFinite(limit) && lines > limit) {
        out.push(`they asked for under ${limit} lines — this is ${lines}, cut it down`)
      }
    }

    // the price near the top: "put the price in the first two lines"
    const pricePos = r.match(/price.*first\s*(\w+)\s*lines?/)
    if (pricePos) {
      const words = { one: 1, two: 2, three: 3, four: 4, five: 5 }
      const n = Number(pricePos[1]) || words[pricePos[1]] || 2
      const head = cap.split('\n').filter((l) => l.trim()).slice(0, n).join(' ')
      if (/rm\s?[\d,]/i.test(cap) && !/rm\s?[\d,]/i.test(head)) {
        out.push(`they asked for the price in the first ${n} lines — move it up`)
      }
    }

    // a language preference: "write captions in Chinese" / "in Malay"
    if (/\b(write|caption).*\b(in )?(chinese|中文|mandarin)\b|用中文/.test(r)) {
      if (!/[一-鿿]/.test(cap)) out.push(`they asked for Chinese captions — write it in Chinese`)
    }
    if (/\b(write|caption).*\b(in )?(malay|bahasa|bm)\b/.test(r) && /[一-鿿]/.test(cap)) {
      out.push(`they asked for Malay captions — write it in Malay`)
    }

    // a forbidden word — see bannedWord() for the shapes and why they are read
    // by structure rather than by a phrase list.
    const word = bannedWord(r)
    if (word) {
      if (word.length > 2 && new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(cap)) {
        out.push(`they asked you never to say "${word}" — take it out`)
      }
    }
  }
  return [...new Set(out)]
}

// -- marketing language the listing never used --------------------------------
//
// The prompt tells the model to add no facts, and it obeys on facts. It still
// reaches for atmosphere: measured 2026-09-04, a listing that said only "Room
// for rent Tabuan Jaya. RM1,500/month. Wifi included. Walking distance to
// ICATS" came back as "Prime Location | Wifi Included | Walking distance to
// ICATS". "Prime Location" is a claim about the property that nobody made.
//
// A CLOSED list, like the facilities walk, and grounded the same way: if the
// agent used the word - in any of the three languages - the caption may use it.
// This is deliberately NOT "any adjective". A rule that judged adjectives in
// general would refuse ordinary captions, and a silent refusal costs more than
// a stray word. Structural language ("FOR SALE", "Contact", a divider) is not
// on the list and never will be.
const MARKETING_CLAIMS = [
  ['prime location', /\bprime\s+(?:location|area|spot)\b|\blokasi\s+(?:utama|strategik)\b|黄金地段|优越地段/i, /\bprime\b|strategic|strategik|utama|黄金地段|优越/i],
  ['strategic location', /\bstrategic(?:ally)?\s+(?:located|location)\b/i, /strategic|strategik|prime|黄金地段/i],
  ['luxury', /\bluxur(?:y|ious)\b|\bmewah\b|豪华/i, /luxur|mewah|豪华|premium/i],
  ['stunning', /\bstunning\b|\bbreathtaking\b|\bmenakjubkan\b|令人惊叹/i, /stunning|breathtaking|menakjubkan|惊叹/i],
  ['spacious', /\bspacious\b|\bluas\b|宽敞/i, /spacious|luas|宽敞|大空间/i],
  ['modern', /\bmodern\b|\bmoden\b|现代/i, /modern|moden|现代|contemporary/i],
  ['cosy', /\bco[sz]y\b|\bselesa\b|温馨/i, /co[sz]y|selesa|温馨|comfortable/i],
  ['exclusive', /\bexclusive\b|\beksklusif\b|独家/i, /exclusive|eksklusif|独家/i],
  ['hidden gem', /\bhidden gem\b|\brare find\b|\bpermata tersembunyi\b/i, /hidden gem|rare|permata/i],
  ['must see', /\bmust[- ]see\b|\bdon'?t miss\b|\bjangan lepaskan\b|不容错过/i, /must[- ]see|jangan lepaskan|错过/i],
  ['ideal for', /\b(?:ideal|perfect)\s+for\b|\bsesuai untuk\b|适合/i, /\bideal\b|\bperfect\b|sesuai untuk|适合/i],
  ['sought after', /\bsought[- ]after\b|\bhighly desirable\b|\bpopular choice\b/i, /sought|desirable|popular/i],
  ['dream home', /\bdream home\b|\brumah idaman\b|梦想家园/i, /dream|idaman|梦想/i],
  ['unbeatable', /\bunbeatable\b|\bunmatched\b|\btiada tandingan\b/i, /unbeatable|unmatched|tandingan/i],
]

/**
 * Marketing phrases the caption uses that the listing never did. Same contract
 * as the facilities walk: a CLOSED list, wide grounds, silent when the source
 * text is empty.
 */
export function inventedMarketing(caption, listing) {
  const cap = String(caption || '')
  const src = `${listing?.rawText || ''} ${listing?.title || ''}`
  if (!src.trim() || !cap.trim()) return []
  const out = []
  for (const [label, claim, grounds] of MARKETING_CLAIMS) {
    if (claim.test(cap) && !grounds.test(src)) out.push(label)
  }
  return [...new Set(out)]
}
