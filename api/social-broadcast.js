// Portal: publish to ALL of an agent's connected accounts (their Zernio
// profile) in one call. Used by the Connect screen's test post and, later,
// per-agent listing posting.  POST { caption, mediaUrl?, mediaType? }
import { postFingerprint, claimPostOnce, releasePostOnce, looksLikeDemoCaption } from './_lib/postguard.js'
import { connectedAccounts, defaultProfile, providerConfigured, provider } from './_lib/social.js'
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

// True when this POST looks like it came from the app's own pages.
//
// BE CLEAR ABOUT WHAT THIS IS NOT. It is not authentication. A browser cannot
// forge these headers, so it stops a cross-site page attacking a logged-in user
// - but curl, a cron or the agent's exec tool sets any of them with one -H, and
// the exec tool IS what caused the 2026-09-01 incident. Verified 2026-09-04: a
// bare `-H "sec-fetch-site: same-origin"` walks straight through, and so does a
// forged Origin, because the host it is compared against is client-supplied too.
//
// It exists only so the web UI keeps working, since those pages cannot hold
// INGEST_SECRET. The real protection on this route is the demo-caption check and
// the dedupe claim below, which are what actually stopped the incident. Treat
// this as a speed bump; the proper fix is a session the UI can present.
function fromOwnUi(req) {
  const h = req.headers || {}
  const site = String(h['sec-fetch-site'] || '')
  if (site === 'same-origin' || site === 'same-site') return true
  const host = String(h['x-forwarded-host'] || h.host || '')
  if (!host) return false
  const hostOf = (v) => { try { return new URL(String(v)).host } catch { return '' } }
  return hostOf(h.origin) === host || hostOf(h.referer) === host
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })

  // AUTH. This route was wide open: anyone with the deployed URL could publish
  // to a client's Facebook, and on 2026-09-01 the agent's exec tool called it
  // directly to skip the approve pipeline. The shared secret is what /api/ingest
  // and /api/approve use, so OpenClaw and any server-side caller present that.
  //
  // The four in-app callers (ConnectPage, CreatePostPage, ListingDetailPage,
  // ContentPostCard) are browser fetches with no credential to send, and the
  // portal has no login to hang a session on - so they are admitted by the
  // same-origin check instead. That stops scripted access, not a human who can
  // already load the portal; a per-agent login is the follow-up.
  const secret = process.env.INGEST_SECRET
  const provided = req.headers['x-ingest-secret'] || (new URL(req.url, 'http://x').searchParams.get('secret')) || ''
  if (!(secret && provided === secret) && !fromOwnUi(req)) {
    return send(res, 401, { error: 'Bad or missing x-ingest-secret' })
  }

  const { configured } = providerConfigured()
  if (!configured) return send(res, 501, { error: 'Posting provider not connected — set its API key in Vercel' })

  let body
  try { body = await readJson(req) } catch { return send(res, 400, { error: 'Invalid JSON' }) }
  const caption = (body?.caption || '').trim()
  if (!caption) return send(res, 400, { error: 'caption is required' })
  const mediaUrl = body?.mediaUrl || SAMPLE_VIDEO
  const mediaType = body?.mediaType === 'image' ? 'image' : 'video'
  const scheduledFor = body?.scheduledFor || '' // ISO string → schedule instead of post now
  const profileId = body?.profile || defaultProfile()

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
