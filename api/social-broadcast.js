// Portal: publish to ALL of an agent's connected accounts (their Zernio
// profile) in one call. Used by the Connect screen's test post and, later,
// per-agent listing posting.  POST { caption, mediaUrl?, mediaType? }
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
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
    const post = { content: caption, mediaItems: [{ url: mediaUrl, type: mediaType }], platforms }
    if (scheduledFor) { post.publishNow = false; post.scheduledFor = scheduledFor }
    else { post.publishNow = true }
    const pr = await fetch(base, { method: 'POST', headers, body: JSON.stringify(post) })
    const pt = await pr.text().catch(() => '')
    if (!pr.ok) return send(res, 502, { error: `${provider()} post ${pr.status}: ${pt.slice(0, 200)}` })
    return send(res, 200, { ok: true, posted: platforms.map((p) => p.platform), scheduled: !!scheduledFor })
  } catch (e) {
    return send(res, 502, { error: `${provider()} unreachable: ` + (e?.message || String(e)) })
  }
}
