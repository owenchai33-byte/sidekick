// Approve (or skip) a held post. OpenClaw calls this when the human replies ✅
// or ❌ in the WhatsApp control chat. Secret-gated (same INGEST_SECRET), since
// approving publishes to real socials.
//
//   POST /api/approve   { id, decision:'approve'|'skip' }   header x-ingest-secret
//   GET  /api/approve?id=<id>&decision=approve&secret=<secret>   (convenience)
//
// approve → publishes the held post to the connected accounts, logs it to the
//           feed, removes it from pending.
// skip    → just removes it from pending.

import { getPending, delPending, claimPending, releasePending } from './_lib/pending.js'
import { appendFeed } from './_lib/feed.js'
import { postToConnected } from './_lib/social.js'
import { captionViolations } from './_lib/postguard.js'
import { ownershipVerdict } from './_lib/tenant.js'

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
// THE LAST CHECK: the caption against the listing it claims to describe.
//
// captionDegraded, below, is a flag SOMEBODY ELSE set. This is a measurement
// taken here, at the publish moment, from the source hold.js stored — so a
// caption that reached the pending store from a path that never validated (the
// Mac reel script writes and holds its own) is still compared to the agent's
// real listing text before it goes out under their name. A dropped flag stops
// being the only thing between invented content and a client's public page.
//
// ONLY `invented` blocks, and that narrowness IS the design:
//   - `missing` is decided on the write path, which has the languages, the
//     trained style and two repair rounds of context this handler does not.
//     Re-deciding it here would refuse posts ingest.js deliberately allowed —
//     it lets a single non-money omission through on purpose.
//   - `marketing` and the agent's own style rules are cosmetic. postguard.js
//     already separates them from `invented` for exactly this reason: a stray
//     "spacious" that survived two repair rounds is not worth losing the
//     listing over, and on 2026-09-04 an emoji rule read as a blanket ban
//     flattened a real client's whole caption format on his live page.
//   - `warnings` carry the heuristic property-name guess, which refused three
//     good captions in two days. They may never refuse anything.
// A refusal is silent and total, so it is spent only on a stated FACT the
// listing does not support: a price, a room count, a yield, a lease term, a
// facility, a distance.
//
// MONEY NEVER BLOCKS HERE, whatever the source carries. This is the hardest-won
// line in the file, so the reasoning is written down.
//
// knownAmounts() can ground only three figures: the price, the price x 12, and
// the price / sqft. Malaysian property captions state a great deal more
// arithmetic than that, all of it computed off figures the listing really gives:
//     "Save RM42,000 below bank value"      (valuation - asking)
//     "Deposit: 2 months (RM2,600)"         (rent x 2)
//     "Downpayment only RM45,000"           (asking x 10%)
//     "Estimated instalment from RM1,750"   (a loan table)
//     "RM3,500 + RM300 service charge (RM3,800 all in)"
//     "7% bumi discount, nett RM558,000"
// Every one reads as an invented figure. Six of twenty real captions were refused
// on this, including one live on a client's page right now.
//
// The earlier version of this guard exempted money only when the source carried
// NO price — which made it stricter the more it knew, so the well-behaved caller
// that sent `price` was the one punished. That inversion is what gave it away.
//
// The width of the allowance is not the point; the place is. A refusal at the ✅
// is terminal and silent — there is no repair round here, no model, nobody to
// tell. Money invention IS still caught on the write path (ingest.js), where the
// model is handed the invention by name and gets two rounds to rewrite it. That
// is where a check that cannot tell arithmetic from invention belongs.
//
// What still blocks is everything read straight off the source text with no sum
// in between: a room count, a yield, a lease term, a facility, a furnishing, a
// tenure, a distance. Those are the inventions that put a false fact about a real
// property on a paying client's page, and none of them require doing maths first.
const MONEY_INVENTION = /^rm\s*[\d.,]/i
function inventedFacts(item) {
  const src = item?.source
  const text = typeof src?.text === 'string' ? src.text.trim() : ''
  // NO SOURCE, NO CHECK. The ~14 pendings already held predate this field, and
  // everything ingest.js writes still lacks it. An absent source is UNKNOWN,
  // not guilty — treating it as a failure would make every one of those records
  // unpublishable the moment this ships, which is the same silent, total
  // refusal this guard exists to prevent, wearing a different costume.
  if (!text) return []
  try {
    const invented = captionViolations(item.caption, { ...src, rawText: text }).invented
    return invented.filter((v) => !MONEY_INVENTION.test(String(v).trim()))
  } catch {
    // A guard that throws must not refuse the post. Failing closed here would
    // take out every publish at once with no error anyone ever sees, which is
    // strictly worse than publishing the caption a human is looking at.
    return []
  }
}

// ✅/👍/yes → approve, ❌/👎/no → skip; anything else falls through to the arg.
function normalizeDecision(d) {
  const s = String(d || '').trim().toLowerCase()
  if (/(approve|post|yes|ya|ok|👍|✅|✔)/.test(s)) return 'approve'
  if (/(skip|no|cancel|reject|👎|❌|✖)/.test(s)) return 'skip'
  return s
}

export default async function handler(req, res) {
  const secret = process.env.INGEST_SECRET
  const url = new URL(req.url, 'http://x')
  const provided = req.headers['x-ingest-secret'] || url.searchParams.get('secret') || ''
  if (!secret) return send(res, 501, { error: 'INGEST_SECRET not set' })
  if (provided !== secret) return send(res, 401, { error: 'Bad or missing x-ingest-secret' })

  let body = {}
  if (req.method === 'POST') { try { body = req.body ?? (await readJson(req)) } catch { return send(res, 400, { error: 'Invalid JSON' }) } }
  else if (req.method !== 'GET') return send(res, 405, { error: 'POST or GET only' })

  const id = body.id || url.searchParams.get('id')
  const decision = normalizeDecision(body.decision || url.searchParams.get('decision') || 'approve')
  // Both refusals below tell the human "or pass force:true to publish it anyway",
  // and the header comment offers the GET link as the convenience path — but the
  // body is only parsed for POST, so on that link there was no way to say it.
  // An override the error message names and the documented path cannot reach is
  // not an override.
  const forced = body?.force === true || /^(1|true|yes)$/i.test(url.searchParams.get('force') || '')
  if (!id) return send(res, 400, { error: 'id is required' })

  const item = await getPending(id)
  if (!item) return send(res, 404, { ok: false, error: 'Not found — already handled or expired' })

  // WHOSE POST IS THIS? The shared INGEST_SECRET says the caller is one of our
  // own Macs; it does not say WHICH agent it is acting for. At one tenant that
  // was the same thing. At fifty it is not: `status` lists every tenant's
  // pendings to any secret-holder, so the likeliest cross-tenant publish needs
  // no attacker at all — the agent model reads a stranger's id out of that list
  // and approves it, and one agent's listing goes out on another's Facebook.
  //
  // The caller may now SAY who it is acting for, as `profile` (the tenant's
  // profileId) or `sender` (their phone), by body field or query param. When the
  // claim and the record can be compared, a disagreement refuses.
  //
  // WHEN THEY CANNOT BE COMPARED, NOTHING CHANGES. That is not timidity, it is
  // the requirement:
  //   * No caller sends a claim today. sidekick.mjs approve() posts { id,
  //     decision } and nothing else (its arg parser already lifts --sender, but
  //     approve is dispatched without it), and that file is not in this repo.
  //     Refusing an unclaimed approve would refuse EVERY approve, everywhere,
  //     the moment this deployed.
  //   * The ~11 pendings already held predate the fields entirely.
  //   * The reel path stores no `sender` at all (api/hold.js), so a check keyed
  //     on sender alone would silently refuse 100% of TikTok approvals.
  // An unprovable record is UNKNOWN, and unknown keeps working exactly as it
  // does today. The answer says which of the two it was, so nobody has to guess
  // whether the check ran.
  const claimProfile = body.profile || body.profileId || url.searchParams.get('profile') || ''
  const claimSender = body.sender || url.searchParams.get('sender') || ''
  const owner = ownershipVerdict({ claimProfile, claimSender, item })
  if (owner.verdict === 'mismatch') {
    // Deliberately does NOT echo the record's real owner. The most likely caller
    // here is a model that got confused about which id belongs to whom, and
    // handing it the right profileId would be handing it the missing half of a
    // cross-tenant publish.
    return send(res, 403, {
      ok: false, id, blocked: 'notYours', field: owner.field,
      error: `this held post belongs to a different agent — refusing to ${decision === 'skip' ? 'discard' : 'publish'} it. Check the pendingId: it came from another tenant's list, not this sender's.`,
    })
  }

  if (decision === 'skip') {
    await delPending(id)
    return send(res, 200, { ok: true, decision: 'skip', skipped: true, id, ownership: owner.verdict })
  }
  if (decision !== 'approve') return send(res, 400, { error: `Unclear decision "${decision}" — use approve or skip` })

  // The tenant's own profile, captured at ingest. NO fallback: publishing to a
  // default profile means publishing to somebody else's accounts.
  const profileId = item.profileId
  if (!profileId) return send(res, 400, { ok: false, id, error: 'this held post has no profile — cannot publish safely' })

  // HARD GATE: never publish a caption the engine failed to write. AGENTS.md
  // tells the assistant not to, but that is an instruction to a model, not an
  // enforced rule — and AUTO mode has no assistant at all. A human who really
  // wants the boilerplate can pass force:true.
  if (item.captionDegraded && !forced) {
    return send(res, 409, {
      ok: false, id, blocked: 'captionDegraded',
      error: 'this caption is generic demo text (the AI writer failed), not this agent\'s style. Refusing to publish. Re-send the listing once the caption engine is back, or pass force:true to publish it anyway.',
    })
  }

  // Same refusal, one step further out: not "the writer told us it failed" but
  // "the caption says something the listing does not". Runs BEFORE the claim, so
  // a refused post is left pending exactly as it was and the same id retries.
  const invented = inventedFacts(item)
  if (invented.length && !forced) {
    return send(res, 409, {
      ok: false, id, blocked: 'captionInvented', invented,
      error: `this caption states things the agent's listing never did: ${invented.join('; ').slice(0, 300)}. Refusing to publish — that is invented information on a client's public page. Fix the caption and re-send the listing, or pass force:true to publish it anyway.`,
    })
  }

  // Take an ATOMIC claim before publishing. Read-then-delete is two operations, so
  // two ✅ arriving together both saw the item and both published — measured. The
  // claim is a single test-and-set, so exactly one caller ever gets through.
  if (!(await claimPending(id))) {
    return send(res, 200, { ok: false, id, alreadyHandled: true, error: 'already being published — ignoring the duplicate ✅' })
  }
  const r = await postToConnected({ caption: item.caption, captionShort: item.captionShort, mediaItems: item.mediaItems, profileId, platforms: item.platforms })
  if (!r.ok) {
    // Nothing was published: drop the claim and leave it pending so they can retry.
    await releasePending(id)
    // Carry `blocked` through. postToConnected refuses for reasons the agent
    // layer has to phrase differently (out of credits vs a bad caption), and
    // dropping the flag left it with nothing to branch on but prose.
    return send(res, r.error ? 502 : 200, { ok: false, id, reason: r.reason, error: r.error, retryable: true, ...(r.blocked ? { blocked: r.blocked } : {}) })
  }

  await appendFeed({
    at: new Date().toISOString(),
    // WHOSE post this was. Every feed record written before today has no owner,
    // which is why /api/feed can only scope the ones written from here on: an
    // untagged record cannot be shown to a tenant without guessing, and guessing
    // is how one agent sees another's prices and addresses.
    profileId,
    location: item.location ?? null,
    price: item.price ?? null,
    listingType: item.listingType,
    platforms: r.platforms,
    card: item.card ?? null,
    cover: item.cover ?? null,
    mediaCount: item.mediaCount ?? (item.mediaItems?.length || 0),
    caption: item.caption ? item.caption.slice(0, 180) : '',
    group: item.group ?? null,
  })
  await delPending(id)
  await releasePending(id)
  return send(res, 200, { ok: true, decision: 'approve', posted: r.platforms, id, ownership: owner.verdict, ...(r.partialErrors ? { partialErrors: r.partialErrors } : {}) })
}
