// Portal: publish to ALL of an agent's connected accounts (their Zernio
// profile) in one call. Used by the Connect screen's test post and, later,
// per-agent listing posting.  POST { caption, mediaUrl?, mediaType? }
import { postFingerprint, claimPostOnce, releasePostOnce, looksLikeDemoCaption } from './_lib/postguard.js'
import { connectedAccounts, providerConfigured, provider } from './_lib/social.js'
import { fromOwnUi, hasIngestSecret, rateLimit, tokenFrom, verifyProfileToken } from './_lib/tenant.js'
// Demo fallback so the Connect screen's "test post" needs no media of its own.
const SAMPLE_VIDEO = 'https://r4c9otkizegwkpzf.public.blob.vercel-storage.com/sidekick-video-test-4je6E4khevkGtS8bOMOI1dVo8cZ7aW.mp4'

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

// `fromOwnUi` now lives in _lib/tenant.js, and half of it has been taken away.
//
// It used to compare the request's Origin against the request's own Host header
// — both supplied by the caller — so `-H "host: evil.test" -H "origin:
// https://evil.test"` matched itself and walked through. Verified 2026-09-04.
// The comparison is now against a host the SERVER knows (APP_HOST, or Vercel's
// own env), and falls back to the old self-comparison only when neither is
// configured, which is local dev.
//
// It is still not authentication, and this route no longer leans on it alone:
// see the profile requirement and the per-profile throttle below.

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })

  // AUTH. This route was wide open: anyone with the deployed URL could publish
  // to a client's Facebook, and on 2026-09-01 the agent's exec tool called it
  // directly to skip the approve pipeline. The shared secret is what /api/ingest
  // and /api/approve use, so OpenClaw and any server-side caller present that.
  //
  // The four in-app callers (ConnectPage, CreatePostPage, ListingDetailPage,
  // ContentPostCard) are browser fetches, and the portal has no login to hang a
  // session on - so they are admitted by the same-origin check, or by the `t=`
  // link token when their link carries one. That stops scripted access, not a
  // human who can already load the portal; a per-agent login is the follow-up.
  //
  // Whichever way a caller gets in, it must still name WHOSE accounts it means.
  let body
  try { body = await readJson(req) } catch { return send(res, 400, { error: 'Invalid JSON' }) }
  const profileId = (body?.profile || body?.profileId || '').trim()

  const credentialled = hasIngestSecret(req) || verifyProfileToken(profileId, tokenFrom(req, body))
  if (!credentialled && !fromOwnUi(req)) {
    return send(res, 401, { error: 'Bad or missing x-ingest-secret' })
  }

  // WHOSE ACCOUNTS. This used to fall back to defaultProfile(), so a caller that
  // named no profile published to whatever the deployment's default happened to
  // be — nobody's, in production today, and one specific agent's the moment
  // anyone sets POSTPEER_PROFILE_ID to fix the home screen's badge.
  //
  // Three of the four in-app callers sent no profile and have therefore been
  // answering 502 in production since the switch to PostPeer; they now send the
  // profile from the agent's own link, so this refusal replaces a broken button
  // rather than breaking a working one — and it says what to do about it.
  if (!profileId) {
    return send(res, 400, {
      error: 'no profile on this post — open your own SideKick link (it carries ?profile=). Refusing to guess whose accounts to publish to.',
    })
  }

  // A throttle for anyone who is not holding a real credential. fromOwnUi is a
  // header check and a determined caller forges it; what they cannot do is turn
  // that into a flood on a client's page.
  if (!credentialled) {
    const rl = rateLimit(`broadcast:${profileId}`, { limit: 10, windowMs: 5 * 60_000 })
    if (!rl.ok) {
      return send(res, 429, { error: `That's a lot of posts at once — wait ${rl.retryAfter}s and try again`, retryAfter: rl.retryAfter })
    }
  }

  const { configured } = providerConfigured()
  if (!configured) return send(res, 501, { error: 'Posting provider not connected — set its API key in Vercel' })

  const caption = (body?.caption || '').trim()
  if (!caption) return send(res, 400, { error: 'caption is required' })
  const mediaUrl = body?.mediaUrl || SAMPLE_VIDEO
  const mediaType = body?.mediaType === 'image' ? 'image' : 'video'
  const scheduledFor = body?.scheduledFor || '' // ISO string → schedule instead of post now

  try {
    // Target exactly the accounts this agent has connected. This endpoint keeps
    // its own fetch (rather than postToConnected) because it supports scheduling.
    const accounts = await connectedAccounts(profileId)
    if (!accounts.length) return send(res, 400, { error: 'No connected accounts yet — connect one on the Connect screen first' })

    const isPP = provider() === 'postpeer'
    const base = isPP ? 'https://api.postpeer.dev/v1/posts/' : 'https://zernio.com/api/v1/posts'
    const headers = isPP
      ? { 'content-type': 'application/json', 'x-access-key': process.env.POSTPEER_API_KEY }
      : { 'content-type': 'application/json', authorization: `Bearer ${process.env.ZERNIO_API_KEY}` }

    const platforms = accounts.map((a) => ({ platform: a.platform, accountId: a.id }))

    // This endpoint publishes a RAW caption with no pendingId, so the approve
    // pipeline's guards never see it. On 2026-09-01 that let one listing go to
    // Facebook and Instagram three times, with demo boilerplate, triggered by
    // nothing more than the operator asking whether it had posted. Apply the
    // same two guards here.
    if (looksLikeDemoCaption(caption)) {
      return send(res, 409, { ok: false, blocked: 'captionDegraded',
        error: 'this is the demo fallback caption, not a real one - refusing to publish it' })
    }
    const mediaItems = [{ url: mediaUrl, type: mediaType }]
    const fp = postFingerprint({ profileId, caption, platforms: accounts.map((a) => a.platform), mediaItems })
    // A scheduled post is a deliberate future action, not a retry, so it is exempt.
    if (!scheduledFor && !(await claimPostOnce(fp))) {
      return send(res, 409, { ok: false, duplicate: true,
        error: 'an identical post just went out - ignoring this repeat' })
    }

    const post = { content: caption, mediaItems, platforms }
    if (scheduledFor) { post.publishNow = false; post.scheduledFor = scheduledFor }
    else { post.publishNow = true }
    const pr = await fetch(base, { method: 'POST', headers, body: JSON.stringify(post) })
    const pt = await pr.text().catch(() => '')
    if (!pr.ok) {
      // Nothing published: drop the claim so a genuine retry is not blocked.
      if (!scheduledFor) await releasePostOnce(fp)
      return send(res, 502, { error: `${provider()} post ${pr.status}: ${pt.slice(0, 200)}` })
    }
    return send(res, 200, { ok: true, posted: platforms.map((p) => p.platform), scheduled: !!scheduledFor })
  } catch (e) {
    return send(res, 502, { error: `${provider()} unreachable: ` + (e?.message || String(e)) })
  }
}
