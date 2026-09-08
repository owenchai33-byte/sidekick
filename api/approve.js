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
import { captionViolations, nonMoneyInventions } from './_lib/postguard.js'
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
// The exemption itself now lives in postguard.js as nonMoneyInventions(), so
// the write path (ingest.js) and the publish path cannot drift apart again —
// they had, and the same caption approve.js would happily publish was marked
// degraded by ingest.js first.
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
    return nonMoneyInventions(captionViolations(item.caption, { ...src, rawText: text }).invented)
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
  if (s === 'retire') return 'retire'
  return s
}

// RETIRE — the only way to clear a pending nobody can reach.
//
// Ownership refuses BOTH verbs, publish and discard, and that is right for
// publish: acting on another tenant's post is the thing it exists to stop.
// Applied to discard it created a trap. Measured 2026-09-06 on production: 11
// held records carried profile ids of agents no longer mapped —
// 6a6d5fa0444fb0860526cde7, 6a71927695385c01ffbd2655 — so NO caller could
// approve them and no caller could skip them either. They sit in the feed
// forever, and `status` reads that feed, so every "did it post?" rummages
// through them. The day an agent is offboarded, their held posts become
// permanent litter.
//
// Retire is narrow enough not to need an owner:
//   * it can only DELETE. There is no path from here to postToConnected, so the
//     worst it can do is discard something, never publish it to a real page.
//   * it refuses anything younger than the floor. Nobody is waiting on a ✅ from
//     three weeks ago, so age alone proves no live work is at stake — no claim
//     of identity required, and none accepted.
// A structurally empty record is retirable at any age: no caption and no media
// is not a post anybody is waiting for. That is what the two `caption:"race"`
// rows on production were — residue from a dedupe test that reached the live
// store.
const RETIRE_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function retireVerdict(item, now = Date.now(), minAgeMs = RETIRE_MIN_AGE_MS) {
  // NO MEDIA MEANS IT CAN NEVER PUBLISH. Both writers require photos — ingest
  // refuses without images, hold refuses without mediaItems — so a held record
  // with none is not a post waiting for a decision, it is litter, whatever its
  // caption says and whatever its date says. The two `caption:"race"` rows on
  // production are exactly this: residue from a dedupe test that reached the
  // live store, with a caption, no photos, and no readable date, so every
  // age-based rule refused them and they were unreachable forever.
  const media = Array.isArray(item?.mediaItems) ? item.mediaItems.length : 0
  if (!media) return { ok: true, reason: 'no media — this record could never have published' }

  const at = Date.parse(item?.at)
  // UNDATED IS NOT OLD. A record whose age cannot be read might have been held a
  // minute ago, and refusing is the direction that cannot destroy live work.
  if (!Number.isFinite(at)) return { ok: false, reason: 'this post carries no readable date, so its age cannot be checked' }
  const ageMs = now - at
  if (ageMs < minAgeMs) {
    const days = Math.floor(ageMs / (24 * 60 * 60 * 1000))
    return { ok: false, reason: `this post is ${days} day(s) old — retire only clears posts older than ${Math.round(minAgeMs / 86400000)} days. Use skip if you mean to discard it.` }
  }
  return { ok: true, reason: `held ${Math.floor(ageMs / 86400000)} days with no decision` }
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

  // Runs BEFORE the ownership gate: an unreachable record is exactly the one
  // that needs clearing, and retire cannot publish.
  if (decision === 'retire') {
    const v = retireVerdict(item)
    if (!v.ok) return send(res, 409, { ok: false, id, blocked: 'tooRecent', error: v.reason })
    await delPending(id)
    return send(res, 200, { ok: true, decision: 'retire', retired: true, id, reason: v.reason })
  }

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
  // NO FORCED CROSS-TENANT DISCARD. `!(decision === 'skip' && forced)` let any
  // secret-holder — and install.sh writes the SAME secret onto every client Mac
  // — discard another tenant's held post at any age. It cannot publish, but the
  // client silently never gets their post and no error reaches them: this
  // product's own class-B signature, reintroduced as a convenience.
  //
  // `retire` already covers the case this was reaching for, and covers it
  // safely: delete-only, and only past an age floor that proves nobody is
  // waiting. A stuck post has an exit; a stranger does not get a delete button.
  // PUBLISHING NEEDS EVERY CLAIM TO AGREE; DISCARDING NEEDS ONE.
  // A re-onboarded agent keeps their phone and gets a new profile id, so one
  // field disagrees and one matches — they are not a stranger to their own post
  // and must be able to clear it. Sending that post to the wrong accounts is
  // unrecoverable, so approve still requires the strict verdict.
  const strictEnough = decision === 'approve' ? owner.strict !== false : true
  if (owner.verdict === 'mismatch' || !strictEnough) {
    // Deliberately does NOT echo the record's real owner. The most likely caller
    // here is a model that got confused about which id belongs to whom, and
    // handing it the right profileId would be handing it the missing half of a
    // cross-tenant publish.
    //
    // A MISMATCH IS NOT ALWAYS SOMEBODY ELSE'S POST, AND IT USED TO BE A DEAD
    // END. Re-onboarding an agent gives them a new profileId, so every post they
    // held yesterday mismatches: 403 on approve AND 403 on skip, while
    // retireVerdict() returns `tooRecent` for six more days. Nobody — not the
    // agent, not the operator — could clear it, and the message named no way
    // out, so it read as "this is not yours" about a post that was.
    //
    // Two things change, both of them additive:
    //   * `skip` accepts force:true. Skip cannot publish; the worst it can do is
    //     discard, which is what the caller is asking for, and it is the same
    //     escape hatch the degraded-caption gate already uses.
    //   * the message names the exits instead of only stating the refusal.
    const exits = decision === 'skip'
      ? 'If it IS this agent\'s post and the profileId changed (a re-onboard does that), re-send with force:true to discard it.'
      : 'If it IS this agent\'s post and the profileId changed (a re-onboard does that), send the CURRENT profile as `profile`. To get rid of it instead: skip it with force:true, or retire it once it is 7 days old.'
    return send(res, 403, {
      ok: false, id, blocked: 'notYours', field: owner.field,
      error: `this held post is recorded against a different agent — refusing to ${decision === 'skip' ? 'discard' : 'publish'} it. ${exits}`,
    })
  }

  if (decision === 'skip') {
    await delPending(id)
    return send(res, 200, { ok: true, decision: 'skip', skipped: true, id, ownership: owner.verdict,
      ...(owner.verdict === 'mismatch' ? { forcedPastOwnership: true } : {}) })
  }
  if (decision !== 'approve') return send(res, 400, { error: `Unclear decision "${decision}" — use approve, skip or retire` })

  // The tenant's own profile, captured at ingest. NO fallback: publishing to a
  // default profile means publishing to somebody else's accounts.
  const profileId = item.profileId
  if (!profileId) return send(res, 400, { ok: false, id, error: 'this held post has no profile — cannot publish safely' })

  // HARD GATE: never publish a caption the engine failed to write. AGENTS.md
  // tells the assistant not to, but that is an instruction to a model, not an
  // enforced rule — and AUTO mode has no assistant at all. A human who really
  // wants the boilerplate can pass force:true.
  if (item.captionDegraded && !forced) {
    // WHY it is degraded is stored on the record (captionDegradedReason, written
    // by ingest.js and /api/hold) and was never read by anything. So the ✅ said
    // "the AI writer failed ... re-send the listing once the caption engine is
    // back" even when the writer had succeeded and the caption had simply broken
    // the listing contract — false, and unactionable, because re-sending the
    // same listing reproduces the same refusal every time.
    const why = String(item.captionDegradedReason || '').trim()
    return send(res, 409, {
      ok: false, id, blocked: 'captionDegraded',
      ...(why ? { captionDegradedReason: why } : {}),
      error: why
        ? `refusing to publish: ${why}. This is the agent's own caption, not demo text — the engine is fine, so re-sending the listing will not change it. Fix the caption, or pass force:true to publish it as it stands.`
        : 'this caption is generic demo text (the AI writer failed), not this agent\'s style. Refusing to publish. Re-send the listing once the caption engine is back, or pass force:true to publish it anyway.',
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
  // `skipped` rides alongside partialErrors, which already carries the sentence
  // AGENTS.md rule 8 makes the agent read out. A platform the client asked for
  // and did not get is part of reporting `posted` honestly, not a separate story.
  return send(res, 200, {
    ok: true, decision: 'approve', posted: r.platforms, id, ownership: owner.verdict,
    ...(r.skipped ? { skipped: r.skipped } : {}),
    ...(r.partialErrors ? { partialErrors: r.partialErrors } : {}),
  })
}
