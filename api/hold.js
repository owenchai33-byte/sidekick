// Hold a pre-built post (e.g. a TikTok reel the Mac just rendered) as a pending,
// so the normal ✅ approve flow can publish it. Secret-gated (INGEST_SECRET).
//   POST /api/hold  { caption, mediaItems:[{url,type}], platforms?, profileId,
//                     location?, price?, listingType?, cover?, group?,
//                     captionDegraded?, captionDegradedReason?, script?,
//                     sourceText?/rawText?, listing? }
import { putPending } from './_lib/pending.js'

// THE HOLE THIS CLOSES. approve.js refuses to publish when the pending record
// carries captionDegraded — but hold.js never wrote that field, so anything the
// Mac held arrived at the tick looking clean. Confirmed 2026-09-03: pending
// e5f48cc5 was held with "Property in Kuching - RM1,300 a month", the
// deterministic reel fallback from ingest.js word for word, and a ✅ on it would
// have put template text on TikTok while its FB/IG sibling was correctly blocked.
// looksLikeDemoCaption() did not help: it knows the four demoContent() markers,
// and the reel template contains none of them.
//
// So the caller's flag is persisted (below), AND the text is checked here, because
// the caller that produced that pending is the Mac reel script, which lives outside
// this repo and cannot be relied on to start sending the flag.
//
// Deliberately NO text-sniffing here. A first version tried to recognise the
// template by its shape ("<Type> in <Location> — RM<price>") and refused 7 of 8
// realistic short captions - "Studio in Kuching — RM650 a month" is what a real
// TikTok title looks like, not a template. That is the 2026-09-03 failure again:
// silent, total, and on the good path. The caller's flag is the signal; if the
// Mac reel script ever holds an unflagged template, fix it there where the text
// is actually known, not by guessing here.

// -- the SOURCE the caption was written from ---------------------------------
//
// A pending has only ever stored the finished caption, so approve.js cannot
// re-check anything at the ✅ — it can only trust captionDegraded, a boolean
// somebody upstream set. That is enough when the writer is ingest.js, which runs
// captionViolations and repairs the caption before it holds. It is not enough
// here: the Mac reel script composes its own caption and posts it straight to
// /api/hold, so on that path NOTHING ever compares the caption to the listing it
// claims to describe. A dropped flag has the same effect on either path.
//
// Storing the source closes that: approve.js can measure the caption against the
// agent's real listing text at the moment of publishing.
//
// This is NOT the text-sniffing ruled out above. Sniffing guesses from shape
// whether a caption looks like a template. This stores a known source so a later
// check can only ever report a FACT the source does not contain.
//
// Exactly the fields captionViolations() reads off a parsed listing, and no
// others — rawText, propertyName/location/title, price/sqft/landSqft,
// bedrooms/bathrooms, listingType, furnishing, tenure. propertyType is not one
// of them and is not stored twice; neither are the photos, the card or the
// media list, which are already on the record and are not text.
const SOURCE_FIELDS = ['propertyName', 'location', 'title', 'price', 'sqft', 'landSqft',
  'bedrooms', 'bathrooms', 'listingType', 'furnishing', 'tenure']

// Far longer than any WhatsApp listing this has ever been sent. Past the cap the
// source is DROPPED, never truncated: a cut-off source is missing money figures
// and room counts the listing really states, and every one of those would then
// read as invented at the tick. No source means no check, which is the safe
// direction to fail in.
const MAX_SOURCE = 8000

// And a FLOOR, for the same reason as the cap and with the same failure mode.
// A source too short to be a listing still reads as authoritative: measured, an
// 18-character source made a faithful caption refuse with five inventions named,
// because everything the caption legitimately said was absent from those 18
// characters. Short is as dangerous as truncated. Real one-line listings do
// exist ("Studio in Kuching — RM650 a month" is 33 characters), so the floor sits
// below them; anything under it is treated as no source at all, and no source
// means no check, which is the direction that publishes rather than refuses.
const MIN_SOURCE = 25

// Fields the caller has always sent flat, alongside `listing`. Used only when
// the parsed listing does not carry them.
const FLAT_FALLBACK = { price: 'price', location: 'location', listingType: 'listingType' }

/** The listing text + parsed fields to re-check this caption against, or null. */
export function sourceFrom(body) {
  // `sourceText` / `rawText` ONLY, and deliberately not a bare `text`. The field
  // name is the caller's promise that this is the agent's listing; `text` is a
  // generic key that could just as easily arrive holding a reel hook, a voiceover
  // line or a caption fragment, and any of those would switch this check on with
  // an authoritative-looking source that describes nothing. A caller that means
  // the listing can say so.
  const text = String(body?.sourceText ?? body?.rawText ?? body?.listing?.rawText ?? '').trim()
  // NO TEXT, NO SOURCE. captionViolations grounds furnishing/tenure claims and
  // "5 mins to X" against the source string with no empty-source guard of their
  // own, so an empty string would make every one of them read as invented and
  // refuse ordinary captions wholesale. An absent source is UNKNOWN, not guilty.
  if (!text || text.length < MIN_SOURCE || text.length > MAX_SOURCE) return null
  const parsed = body?.listing && typeof body.listing === 'object' ? body.listing : {}
  const source = { text }
  for (const k of SOURCE_FIELDS) {
    // Top level is the FALLBACK, not an afterthought. price, location and
    // listingType are already sent flat by every caller (this handler reads them
    // for the feed record below), and `price` in particular is what grounds the
    // figures a caption computes rather than copies: knownAmounts() derives the
    // annual rental as price x 12 and the psf from it. Measured on this corpus —
    // a source sent as text alone made "RM1,300/month (RM15,600 a year)" read as
    // an invented RM15,600, which is a faithful caption refused at the tick.
    const v = parsed[k] ?? (k in FLAT_FALLBACK ? body?.[FLAT_FALLBACK[k]] : undefined)
    // null/'' is the parser saying "absent", and captionViolations is already
    // silent on an absent field, so storing it would only make the record bigger.
    if (v !== undefined && v !== null && v !== '') source[k] = v
  }
  return source
}

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

export default async function handler(req, res) {
  const secret = process.env.INGEST_SECRET
  const provided = req.headers['x-ingest-secret'] || (new URL(req.url, 'http://x').searchParams.get('secret')) || ''
  if (!secret) return send(res, 501, { error: 'INGEST_SECRET not set' })
  if (provided !== secret) return send(res, 401, { error: 'Bad or missing x-ingest-secret' })
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })

  let body
  try { body = req.body ?? (await readJson(req)) } catch { return send(res, 400, { error: 'Invalid JSON' }) }
  const mediaItems = Array.isArray(body?.mediaItems) ? body.mediaItems.filter((m) => m && m.url) : []
  if (!mediaItems.length) return send(res, 400, { error: 'mediaItems required' })
  const caption = (body?.caption || '').toString()
  const captionShort = (body?.captionShort || caption).toString().slice(0, 90)
  const script = (body?.script || '').toString()

  // Default FALSE when the caller says nothing. The flag only ever blocks, and
  // flipping the default would make every one of the already-held pendings —
  // none of which carry the field — unpublishable the moment this ships, which
  // is the same silent-refusal failure in a different costume. A caller that
  // knows the caption is degraded says so; a caller that doesn't, doesn't.
  const captionDegraded = body?.captionDegraded === true || body?.captionDegraded === 'true'
  const captionDegradedReason = captionDegraded
    ? (String(body?.captionDegradedReason || '').trim() || 'the caller held this post as degraded')
    : null

  const source = sourceFrom(body)

  try {
    const id = await putPending({
      at: new Date().toISOString(),
      caption,
      captionShort,
      mediaItems,
      platforms: Array.isArray(body?.platforms) && body.platforms.length ? body.platforms : null,
      profileId: body?.profileId || null,
      // The reel path stored no sender, so a pending held here could only ever
      // be owned by its profileId — and /api/approve's ownership check has one
      // fewer way to recognise a real approval because of it. Additive: absent
      // stays null, exactly as before, and nothing refuses on its absence.
      sender: body?.sender || null,
      location: body?.location ?? null,
      price: body?.price ?? null,
      listingType: body?.listingType || 'sale',
      cover: body?.cover || mediaItems[0]?.url || null,
      mediaCount: mediaItems.length,
      group: body?.group || null,
      kind: body?.kind || 'reel',
      // Persisted so approve.js can refuse for itself on the ✅.
      captionDegraded,
      captionDegradedReason,
      // Persisted so approve.js can CHECK for itself on the ✅, instead of only
      // trusting the flag above. null when the caller sent no listing text.
      source,
    })
    return send(res, 200, {
      ok: true, pendingId: id, captionDegraded, sourceStored: !!source,
      ...(captionDegraded ? { captionWarning: `held, but ✅ will refuse to publish it: ${captionDegradedReason}` } : {}),
      // Said out loud so a caller that meant to send the listing text can see it
      // did not arrive. Not an error: holding without a source is still allowed,
      // it just publishes unchecked, exactly as it does today.
      ...(source ? {} : { sourceWarning: 'no listing text sent — the ✅ cannot re-check this caption against the listing' }),
    })
  } catch (e) {
    return send(res, 502, { ok: false, error: 'Could not hold: ' + (e?.message || String(e)) })
  }
}
