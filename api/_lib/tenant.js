// Tenant identity — the shared vocabulary for "who is asking?" and "whose record
// is this?".
//
// It lives in _lib because api/ is AT Vercel's 12-function cap: a 13th file
// under api/ fails the deploy at "Deploying outputs", after a green build. Every
// gate in this codebase therefore has to go inside a handler that already exists,
// or in here.
//
// NOTHING IN HERE INVENTS IDENTITY. Every question below is answered one of three
// ways — yes, no, or UNKNOWN — and each caller is written so UNKNOWN behaves
// exactly as the code behaved before any of this existed. That asymmetry is the
// whole design. This project has shipped five silent-refusal bugs, and a guard
// that wrongly refuses is worse than one that misses: the refusal reaches nobody.
// A paying agent presses ✅ and their listing simply never appears.

import { createHmac, timingSafeEqual } from 'node:crypto'

const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())

/**
 * Phone numbers reach us as "+60169219859" (tools/tenants.json), "60169219859"
 * or "0169219859", and OpenClaw has been seen to add a suffix. Compare on the
 * last 9 digits — the subscriber part every Malaysian form shares.
 *
 * Deliberately LENIENT. A normaliser that is too strict turns two spellings of
 * the same agent into a mismatch, and a mismatch here refuses a real ✅.
 */
export function normalizeSender(v) {
  const digits = str(v).replace(/\D+/g, '')
  if (!digits) return ''
  return digits.length > 9 ? digits.slice(-9) : digits
}

/**
 * Does the caller's claimed identity match the record's?
 *
 *   { verdict: 'match' | 'mismatch' | 'unknown', field, reason }
 *
 * 'unknown' is returned whenever the comparison CANNOT be made — no claim was
 * sent, or the record predates the field. It is not a soft "no": callers must
 * treat it as "carry on exactly as before".
 *
 * Both identities are checked when both are available. One decisive mismatch is
 * enough to refuse, even if the other field agrees: a request whose two claims
 * disagree about who it is has no business publishing to anyone.
 */
export function ownershipVerdict({ claimProfile, claimSender, item }) {
  const comparisons = [
    { field: 'profileId', claim: str(claimProfile), record: str(item?.profileId) },
    { field: 'sender', claim: normalizeSender(claimSender), record: normalizeSender(item?.sender) },
  ].filter((c) => c.claim && c.record)

  const bad = comparisons.find((c) => c.claim !== c.record)
  if (bad) {
    return { verdict: 'mismatch', field: bad.field, reason: `the ${bad.field} on this record is not the one the caller claims` }
  }
  const good = comparisons[0]
  if (good) return { verdict: 'match', field: good.field, reason: null }

  // Why the comparison could not be made, in words, so the caller can say it.
  const claimed = str(claimProfile) || normalizeSender(claimSender)
  return {
    verdict: 'unknown',
    field: null,
    reason: claimed
      ? 'this record carries no owner to check the claim against (it predates tenant tagging)'
      : 'the caller did not say who it is acting for',
  }
}

// --- per-profile link tokens -------------------------------------------------
//
// A `?profile=` is NOT a credential. It is in every Connect link WhatsApped to a
// client, in their browser's address bar, and in /api/ingest's response body.
// Scoping by it stops one tenant ACCIDENTALLY seeing another's data — which is
// the realistic failure at 50 agents, including the agent model reading a
// stranger's id out of `status` output and approving it. It stops nothing
// deliberate.
//
// This is the deliberate half: a stateless per-profile token, so the same profile
// always mints the same token and a link can be re-minted at any time from
// anywhere with no store to keep in sync.
//
// It is NOT yet enforced anywhere, because the two places that compose Connect
// links (~/.openclaw/tools/onboard-agent.sh and connection-watch.mjs) are outside
// this repo and cannot be changed here — so every link in an agent's WhatsApp
// today carries no `t`, and requiring one would lock those agents out of their
// own portal. verifyProfileToken() is wired in as an ACCEPT path only: presenting
// a valid token is proof, presenting none is the status quo.
function linkSecret() {
  return process.env.LINK_SECRET || process.env.INGEST_SECRET || ''
}

/** The token for a profile, or '' when no secret is configured to mint from. */
export function mintProfileToken(profileId) {
  const s = linkSecret()
  const p = str(profileId)
  if (!s || !p) return ''
  return createHmac('sha256', s).update(`profile:${p}`).digest('base64url').slice(0, 16)
}

/** true only when `token` is the real token for `profileId`. */
export function verifyProfileToken(profileId, token) {
  const expected = mintProfileToken(profileId)
  const got = str(token)
  if (!expected || !got || expected.length !== got.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(got))
  } catch { return false }
}

/** The shared server-side secret, presented by header or ?secret=. */
export function hasIngestSecret(req) {
  const secret = process.env.INGEST_SECRET
  if (!secret) return false
  let q = ''
  try { q = new URL(req?.url || '/', 'http://x').searchParams.get('secret') || '' } catch { q = '' }
  const provided = req?.headers?.['x-ingest-secret'] || q || ''
  return provided === secret
}

/** A `t=` link token, from the query string, a header, or a POST body. */
export function tokenFrom(req, body) {
  let q = ''
  try { q = new URL(req?.url || '/', 'http://x').searchParams.get('t') || '' } catch { q = '' }
  return str(req?.headers?.['x-sidekick-token'] || q || body?.t || '')
}

// --- did this really come from our own pages? --------------------------------
//
// BE CLEAR ABOUT WHAT THIS IS NOT: it is not authentication. A browser cannot
// forge these headers, so it stops a cross-site page acting for a logged-in
// user — but curl, a cron or the agent's exec tool sets any of them with one -H,
// and the exec tool IS what caused the 2026-09-01 incident.
//
// What changed here: the old version compared `origin`/`referer` against the
// request's OWN `host` header, which the caller also supplies. Verified
// 2026-09-04: `{ host:'evil.test', origin:'https://evil.test' }` walked straight
// through. The comparison is now against a host the SERVER knows — APP_HOST or
// Vercel's own env — and falls back to the old self-comparison only when neither
// is configured, which is local dev.
//
// `sec-fetch-site` is kept as the primary signal: every current browser sends it
// and none lets a page set it. Safari below 16.4 (March 2023) does not send it
// at all, which is why the origin path survives — an agent on an old iPhone must
// still be able to press "send test post".
export function fromOwnUi(req) {
  const h = req?.headers || {}
  const site = String(h['sec-fetch-site'] || '')
  if (site === 'same-origin' || site === 'same-site') return true

  const hostOf = (v) => { try { return new URL(String(v)).host } catch { return '' } }
  const known = [
    process.env.APP_HOST,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  ].map((v) => (v ? String(v).replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '')).filter(Boolean)

  const candidates = known.length ? known : [String(h['x-forwarded-host'] || h.host || '')].filter(Boolean)
  if (!candidates.length) return false
  const from = [hostOf(h.origin), hostOf(h.referer)].filter(Boolean)
  return from.some((f) => candidates.includes(f))
}

/**
 * Best-effort client IP, for rate limiting only. Never used as identity.
 *
 * THE FIRST ENTRY OF x-forwarded-for IS THE CALLER'S TO WRITE. Vercel appends
 * the real client address to whatever the client already sent, so reading
 * `[0]` reads a value the attacker chose — and rotating it defeats every limit
 * keyed on this. Measured 2026-09-05: 300 /api/generate calls with a fresh
 * `x-forwarded-for` each, 0 blocked, against a 40/minute limit. The budget the
 * limiter exists to protect is the product's entire daily ceiling.
 *
 * `x-real-ip` is set by the platform and not forwarded from the client, so it
 * is preferred. Falling back to the LAST entry of x-forwarded-for rather than
 * the first picks the hop nearest us, which is the one the client cannot forge.
 */
export function clientIp(req) {
  const h = req?.headers || {}
  const real = String(h['x-real-ip'] || '').trim()
  if (real) return real
  const chain = String(h['x-forwarded-for'] || '').split(',').map((v) => v.trim()).filter(Boolean)
  return chain.length ? chain[chain.length - 1] : 'unknown'
}

// --- rate limiting -----------------------------------------------------------
//
// In-memory and therefore PER LAMBDA INSTANCE: a caller spread across instances
// gets a multiple of the limit, and a cold start forgets everything. Say that
// out loud rather than letting the next reader take it for a quota.
//
// It is still worth having. The thing being defended is a 200,000-token/day
// budget that one loop can drain in an afternoon, and this turns "unlimited" into
// "expensive and slow". Limits are set FAR above what a working agent does, for
// the usual reason: the failure mode of a limit that is too tight is a real agent
// locked out of their own product mid-listing.
const buckets = new Map()
const LAST_SWEEP = { at: 0 }

export function rateLimit(key, { limit, windowMs }) {
  const now = Date.now()
  // Opportunistic sweep so a long-lived instance cannot grow without bound.
  if (now - LAST_SWEEP.at > 60_000) {
    LAST_SWEEP.at = now
    for (const [k, hits] of buckets) {
      if (!hits.length || now - hits[hits.length - 1] > 3_600_000) buckets.delete(k)
    }
  }
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs)
  if (hits.length >= limit) {
    buckets.set(key, hits)
    return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000)) }
  }
  hits.push(now)
  buckets.set(key, hits)
  return { ok: true, remaining: limit - hits.length }
}

/** Test-only: forget every bucket. */
export function resetRateLimits() { buckets.clear(); LAST_SWEEP.at = 0 }
