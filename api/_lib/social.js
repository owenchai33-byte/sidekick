// The ONE place that talks to a social-posting provider.
//
// `POSTING_PROVIDER=zernio|postpeer` picks the backend at runtime, so a bad
// provider is a config flip away from being undone — no redeploy, no code change.
// Everything else in the app imports from here and never sees a provider URL.
//
// Why two providers: Zernio bills per CONNECTED ACCOUNT and charges whether or
// not anyone posts, so the bill grows with every agent Edward signs. PostPeer
// charges only for what is published and lets an agent connect as many accounts
// as they like — the right shape for "many agents, few posts each", roughly 85%
// cheaper at 30+ agents.
//
// PostPeer's unit is the PLATFORM, not the post: one listing to Facebook,
// Instagram and TikTok spends three. Confirmed against /v1/usage/ on 2026-09-03,
// where a count of 7 broke down as facebook 3, instagram 3, tiktok 1. This file
// used to say "per POST with unlimited accounts", which made the monthly figure
// look three times better than it is.
//
// The two APIs are near-identical (`content` / `mediaItems` / `platforms` /
// `publishNow`), so the differences handled below are small but WILL break things
// silently if missed:
//   * auth header      Zernio `Authorization: Bearer`   PostPeer `x-access-key`
//   * accounts list    /accounts?profileId=  -> .accounts[]._id
//                      /connect/integrations?profileId= -> .integrations[].id
//   * connect URL      returns .authUrl                 returns .url
//   * connect param    redirect_url                     redirectUri
//   * disconnect       DELETE /accounts/{id}            DELETE /connect/integrations/{id}

import { postFingerprint, claimPostOnce, releasePostOnce, looksLikeDemoCaption } from './postguard.js'

const ZERNIO = 'https://zernio.com/api/v1'
const POSTPEER = 'https://api.postpeer.dev/v1'

// THERE IS NO DEFAULT PROFILE, and this comment is where the old one was.
//
// A real Zernio profile id used to sit here as the fallback for
// `ZERNIO_PROFILE_ID || DEFAULT_PROFILE`. Production was safe only by accident:
// it runs PostPeer, whose branch returns '' instead. So the obvious fix for the
// home screen's red "No accounts — connect" badge — set POSTPEER_PROFILE_ID —
// silently re-armed cross-tenant publishing, because every unmapped sender then
// resolves to one shared profile and posts to whoever owns it.
//
// The badge is fixed where it broke instead (api/feed.js asks about the profile
// the caller named). An unmapped sender now resolves to nothing, and every
// caller below refuses rather than guessing.

export function provider() {
  return (process.env.POSTING_PROVIDER || 'zernio').toLowerCase() === 'postpeer' ? 'postpeer' : 'zernio'
}
function apiKey() {
  return provider() === 'postpeer' ? process.env.POSTPEER_API_KEY : process.env.ZERNIO_API_KEY
}
function authHeaders() {
  const key = apiKey()
  return provider() === 'postpeer'
    ? { 'x-access-key': key }
    : { authorization: `Bearer ${key}` }
}
/**
 * The profile to use when the caller didn't name one — '' when there isn't one.
 *
 * '' is the honest answer, not a bug to be patched with a constant. Callers must
 * treat it as "I do not know whose accounts these would be" and refuse.
 */
export function defaultProfile() {
  return provider() === 'postpeer'
    ? process.env.POSTPEER_PROFILE_ID || ''
    : process.env.ZERNIO_PROFILE_ID || ''
}
/** For /api/feed's status panel — is the current provider usable? */
export function providerConfigured() {
  return { provider: provider(), configured: !!apiKey() }
}
const missingKey = () =>
  provider() === 'postpeer'
    ? 'PostPeer not connected — set POSTPEER_API_KEY in Vercel'
    : 'Zernio not connected — set ZERNIO_API_KEY in Vercel'

// Running out of posting credits used to reach the agent as a raw provider
// error mid-publish. The agent is a property agent, not the account holder —
// they cannot top anything up, and the failure read as if they had done
// something wrong. PostPeer bills one credit per platform and publishes the
// balance, so the answer is knowable BEFORE anything is sent.
// Deliberately says nothing about the post being kept: it is kept when the
// approve route refuses (that path holds the pending record), and NOT kept when
// ingest.js publishes in auto mode, which has no pending record at all. One
// constant reaches both, so it can only state what is true of both.
const OUT_OF_CREDITS =
  'Posting is paused — this account has run out of posting credits, so nothing was sent. ' +
  'The account owner needs to top up before anything can go out.'

/**
 * Credits available to spend right now, or null when the balance is UNKNOWN.
 * Null never means zero — it means the check itself could not answer.
 */
export async function postingCredits() {
  try {
    const r = await fetch(`${POSTPEER}/usage/`, { headers: authHeaders() })
    if (!r.ok) return null
    const d = await r.json()
    const b = d?.balance || {}
    const parts = [b.monthly?.remaining, b.purchased?.remaining].filter((n) => Number.isFinite(n))
    if (!parts.length) return null        // a shape we don't recognise is unknown, not empty
    return parts.reduce((a, n) => a + n, 0)
  } catch {
    return null
  }
}

/** Accounts connected to a profile, normalised to { id, platform, username }. */
export async function connectedAccounts(profileId) {
  if (!apiKey()) throw new Error(missingKey())
  const pid = profileId || defaultProfile()
  // NEVER fall through to "every account in the project". PostPeer lists all
  // integrations when no profileId is sent, so an unresolved profile used to
  // silently return ANOTHER TENANT'S accounts — which meant postToConnected
  // would have published one agent's listing to every agent's socials. There is
  // no safe default here: each agent's profile comes from tools/tenants.json.
  // Both providers, not just PostPeer. Zernio used to be exempt because a
  // hardcoded pilot profile stood behind it, so an unresolved profile listed
  // somebody's real accounts instead of refusing. With the constant gone, an
  // empty pid would have gone to `/accounts?profileId=` — which is the same
  // "every account in the project" answer, one provider along.
  if (!pid) {
    throw new Error('no profile for this sender — add their phone → profileId in tools/tenants.json')
  }
  if (provider() === 'postpeer') {
    const qs = new URLSearchParams({ limit: '100', profileId: pid })
    const r = await fetch(`${POSTPEER}/connect/integrations?${qs}`, { headers: authHeaders() })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`PostPeer integrations ${r.status}`)
    return (d.integrations || []).map((a) => ({
      id: a.id,
      platform: a.platform,
      username: a.username || a.displayName,
      // PostPeer tells us when a token has gone stale — surface it so the Connect
      // screen can say "reconnect" instead of silently failing at post time.
      broken: a.authStatus && a.authStatus !== 'active' ? a.authStatus : null,
    }))
  }
  const r = await fetch(`${ZERNIO}/accounts?profileId=${encodeURIComponent(pid)}`, { headers: authHeaders() })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Zernio accounts ${r.status}`)
  return (d.accounts || []).map((a) => ({ id: a._id, platform: a.platform, username: a.username, broken: null }))
}

/** Hosted OAuth URL for an agent to link their OWN account to `profileId`. */
export async function connectUrl({ platform, profileId, redirectUrl }) {
  if (!apiKey()) throw new Error(missingKey())
  const pid = profileId || defaultProfile()
  // An OAuth started with no profile attaches the agent's own Facebook Page to
  // whatever the provider considers "no profile" — shared with every other
  // tenant. ~/.openclaw/tools/connection-watch.mjs documents this as the reason
  // its recovery link must always carry ?profile=; the refusal belongs here too,
  // where it cannot be forgotten by a caller.
  if (!pid) throw new Error('no profile for this connect — open your own SideKick link (it carries ?profile=)')
  if (provider() === 'postpeer') {
    const qs = new URLSearchParams()
    if (pid) qs.set('profileId', pid)
    if (redirectUrl) qs.set('redirectUri', redirectUrl)
    const r = await fetch(`${POSTPEER}/connect/${platform}?${qs}`, { headers: authHeaders() })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || !d.url) throw new Error(`PostPeer ${r.status}: ${JSON.stringify(d).slice(0, 200)}`)
    return d.url
  }
  const qs = new URLSearchParams({ profileId: pid })
  if (redirectUrl) qs.set('redirect_url', redirectUrl)
  const r = await fetch(`${ZERNIO}/connect/${platform}?${qs}`, { headers: authHeaders() })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.authUrl) throw new Error(`Zernio ${r.status}: ${JSON.stringify(d).slice(0, 200)}`)
  return d.authUrl
}

/** Unlink one connected account. */
export async function disconnect(accountId) {
  if (!apiKey()) throw new Error(missingKey())
  const url =
    provider() === 'postpeer'
      ? `${POSTPEER}/connect/integrations/${encodeURIComponent(accountId)}`
      : `${ZERNIO}/accounts/${encodeURIComponent(accountId)}`
  const r = await fetch(url, { method: 'DELETE', headers: authHeaders() })
  if (!r.ok) throw new Error(`${provider()} ${r.status}: ${(await r.text().catch(() => '')).slice(0, 150)}`)
  return true
}

// Releasing the dedupe claim is only safe when the provider has told us the post
// is TERMINALLY dead, and only the PER-PLATFORM status says that.
//
// Measured 2026-09-04: releasing on our own `!posted.length` published the whole
// set twice, because that branch also catches a post PostPeer accepted and is
// still uploading — the poll loop gives up after 6 x 2s and the entry then reads
// "facebook: pending". So the test is the platform's own word for its state.
// 'failed' is the one this codebase has actually seen (the poll loop and the
// caller both key on it); 'error' and 'rejected' are accepted alongside it
// because no provider uses either for work still in flight. Everything else —
// 'pending', 'publishing', 'processing', no status at all, or a bare
// success:false with no status — is UNKNOWN, and unknown means possibly live.
const TERMINAL_FAIL = /^(failed|error|rejected)$/i
// `success === false` is the field PostPeer actually documents per platform (see
// the response shape this file already parses: success, errorMessage,
// platformPostUrl); `status` is the newer, less certain one. A first version
// keyed ONLY on status, so the very incident this release exists for - the tick
// pressed with an expired Facebook token, which answers success:false with an
// errorMessage and no per-platform status - still came back duplicate on retry.
// An explicit false, or a terminal status word, both mean dead. Anything else -
// including a missing field - is unknown and keeps the claim.
const platformDead = (p) =>
  p?.success === false || TERMINAL_FAIL.test(String(p?.status || '').trim())

/**
 * True only when EVERY platform we asked for came back terminally failed, so
 * nothing is live and a retry cannot duplicate anything. A platform missing from
 * the response is unknown, not failed — one silent platform keeps the claim.
 */
function nothingIsLive(targets, plats) {
  if (!plats.length) return false
  if (!plats.every(platformDead)) return false
  const reported = new Set(plats.map((x) => x.platform))
  return targets.every((t) => reported.has(t.platform))
}

// A 4xx from PostPeer is a refusal: bad body, bad key, no permission,
// unprocessable — the request was never accepted, so the claim must not stand or
// the agent's fixed retry is swallowed as a duplicate. 5xx is NOT on this list:
// a 502/504 from a gateway in front of PostPeer cannot be told apart from
// "processed, response lost". Nor are 408 and 429, which can both arrive after
// the post was already queued.
const REJECTED_OUTRIGHT = new Set([400, 401, 403, 422])

/**
 * Publish caption + media to every connected account on a profile.
 *
 * TikTok caps a PHOTO post's title at 90 chars (it's the slideshow title), so
 * TikTok gets `captionShort`. Zernio has no per-platform text, so it needs two
 * calls; PostPeer takes a per-platform `content` override and does it in one.
 *
 * Returns { ok, platforms } (with partialErrors if some platform failed) or
 * { ok:false, reason|error }. Never throws — callers report, they don't crash.
 */
export async function postToConnected({ caption, captionShort, mediaItems, profileId, platforms, allowDemo }) {
  if (!apiKey()) return { ok: false, reason: missingKey() }
  // Never publish the demo fallback under an agent's name, whatever route got
  // here. On 2026-09-01 boilerplate went live on FB and IG because the caller
  // decided for itself that posting something was better than posting nothing.
  if (!allowDemo && looksLikeDemoCaption(caption)) {
    return { ok: false, blocked: 'captionDegraded', reason: 'this is the demo fallback caption, not a real one - refusing to publish it' }
  }
  const fp = postFingerprint({ profileId, caption, platforms, mediaItems })
  if (!(await claimPostOnce(fp))) {
    return { ok: false, duplicate: true, reason: 'an identical post just went out - ignoring this repeat' }
  }
  try {
    let accounts = await connectedAccounts(profileId)
    if (platforms && platforms.length) accounts = accounts.filter((a) => platforms.includes(a.platform))
    if (!accounts.length) {
      // Nothing was sent, so the claim must not stand. Confirmed 2026-09-03:
      // the agent taps the tick with Instagram not yet linked, approve.js
      // answers retryable:true and AGENTS.md tells the agent to retry that id —
      // and the retry hit a claim nobody released, came back duplicate:true, and
      // the agent told the human it had already posted. The listing was
      // unpublishable for the full 10-minute window behind a false success.
      await releasePostOnce(fp)
      return { ok: false, reason: platforms ? `No ${platforms.join('/')} account connected yet` : 'No connected accounts on this profile yet' }
    }

    // Check the balance BEFORE publishing, so an empty account is refused in
    // words the agent can pass on rather than failing halfway through with a
    // provider error. One credit per platform: FB+IG+TikTok costs 3.
    //
    // Fails OPEN when the usage endpoint is unreachable, for the same reason
    // claimPostOnce does: a check that cannot run must not block a legitimate
    // post. postingCredits() returns null for that case, never 0.
    if (provider() === 'postpeer') {
      const need = new Set(accounts.map((a) => a.platform)).size
      const have = await postingCredits()
      // Only an EMPTY account is refused, not a short one. PostPeer publishes
      // what it can afford and reports `partial` (handled below), so refusing
      // when have < need would turn posts it would have published into none.
      // Nobody has verified what it does with a partly-funded post, and finding
      // out costs credits - so the guard stays where the answer is not in doubt.
      if (have === 0) {
        // Drop the dedupe claim, or the re-approval after the top-up looks like
        // a duplicate and gets swallowed inside the 10-minute window.
        await releasePostOnce(fp)
        return { ok: false, blocked: 'noCredits', reason: OUT_OF_CREDITS, credits: { have, need } }
      }
    }

    const short = (captionShort || caption || '').slice(0, 90)

    if (provider() === 'postpeer') {
      const targets = accounts.map((a) => ({
        platform: a.platform,
        accountId: a.id,
        ...(a.platform === 'tiktok' && short !== caption ? { content: short } : {}),
      }))
      const r = await fetch(`${POSTPEER}/posts/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ content: caption, mediaItems, platforms: targets, publishNow: true }),
      })
      const t = await r.text().catch(() => '')
      // Outright rejection releases the claim; an ambiguous 5xx keeps it. See
      // REJECTED_OUTRIGHT above for which is which and why.
      if (!r.ok) {
        if (REJECTED_OUTRIGHT.has(r.status)) await releasePostOnce(fp)
        return { ok: false, error: `PostPeer ${r.status} ${t.slice(0, 200)}` }
      }

      // The response is 202 Accepted and carries per-platform results. Reporting
      // "posted to all" just because the HTTP call worked is how a listing that
      // failed on Instagram gets announced as published everywhere. Read the body.
      let d = {}
      try { d = JSON.parse(t) } catch { /* fall through to the optimistic path */ }
      let status = d.status
      let plats = Array.isArray(d.platforms) ? d.platforms : []

      // Publishing is asynchronous: a fresh post is usually "publishing". Poll
      // briefly for a terminal state rather than guessing.
      if (d.postId && (status === 'publishing' || status === 'pending' || !status)) {
        for (let i = 0; i < 6; i++) {
          await new Promise((res) => setTimeout(res, 2000))
          try {
            const g = await fetch(`${POSTPEER}/posts/${encodeURIComponent(d.postId)}`, { headers: authHeaders() })
            if (!g.ok) break
            const gj = await g.json()
            const post = gj.post || {}
            status = post.status || status
            if (Array.isArray(post.platforms)) plats = post.platforms
            if (status === 'published' || status === 'failed' || status === 'partial') break
          } catch { break }
        }
      }

      const ok2 = (x) => x.success === true || x.status === 'published'
      const posted = plats.filter(ok2).map((x) => x.platform)
      const failed = plats.filter((x) => !ok2(x))
        .map((x) => `${x.platform}: ${x.errorMessage || x.error || x.status || 'failed'}`)
      const urls = plats.filter(ok2).filter((x) => x.platformPostUrl)
        .map((x) => `${x.platform}: ${x.platformPostUrl}`)

      // No per-platform detail came back — stay optimistic but say which state we saw.
      if (!plats.length) return { ok: true, platforms: targets.map((p) => p.platform), postId: d.postId, status }
      // The branch name is the trap: `!posted.length` is NOT "every platform
      // failed" (see nothingIsLive above), so the claim is released only when
      // every target platform said so itself. Confirmed 2026-09-03, the cost of
      // keeping it wrongly: the human taps the tick, approve.js answers
      // retryable:true, the agent retries, the retry comes back duplicate:true
      // and the agent reports a post that never happened.
      if (!posted.length) {
        if (nothingIsLive(targets, plats)) await releasePostOnce(fp)
        return { ok: false, error: failed.join(' | ') || `PostPeer status ${status}`, postId: d.postId }
      }
      // PARTIAL is the opposite case and the claim STAYS. Some platforms are
      // already live; releasing here would let a retry re-publish the whole set
      // and double-post to the ones that succeeded — a duplicate on the client's
      // public page, which is worse than the failed platform staying unposted.
      // The caller sees the failure in partialErrors and re-sends only that
      // platform (a different fingerprint, so it is not blocked).
      return {
        ok: true, platforms: posted, postId: d.postId, status,
        ...(failed.length ? { partialErrors: failed } : {}),
        ...(urls.length ? { postUrls: urls } : {}),
      }
    }

    // Zernio: one call per caption variant.
    const groups = [
      { accts: accounts.filter((a) => a.platform === 'tiktok'), content: short },
      { accts: accounts.filter((a) => a.platform !== 'tiktok'), content: caption },
    ].filter((g) => g.accts.length)

    const posted = []
    const errors = []
    for (const g of groups) {
      const targets = g.accts.map((a) => ({ platform: a.platform, accountId: a.id }))
      const pr = await fetch(`${ZERNIO}/posts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ content: g.content, mediaItems, platforms: targets, publishNow: true }),
      })
      const ptext = await pr.text().catch(() => '')
      if (pr.ok) posted.push(...targets.map((p) => p.platform))
      else errors.push(`${targets.map((p) => p.platform).join('/')}: ${pr.status} ${ptext.slice(0, 120)}`)
    }
    // Same reasoning as PostPeer above: `posted` only fills on a 2xx, so an
    // all-groups-failed result cannot be told apart from a gateway swallowing
    // the response of a request that WAS processed. The claim stays.
    if (!posted.length) {
      return { ok: false, error: errors.join(' | ') }
    }
    return { ok: true, platforms: posted, ...(errors.length ? { partialErrors: errors } : {}) }
  } catch (e) {
    await releasePostOnce(fp)
    return { ok: false, error: `${provider()} unreachable: ` + (e?.message || String(e)) }
  }
}
