// Shared Zernio posting — used by the immediate-post path and the approve path
// so there is exactly one place that publishes to connected accounts.

const ZERNIO = 'https://zernio.com/api/v1'
export const DEFAULT_PROFILE = '6a6c498971a67c109cfcae06' // central brand profile

/** The accounts connected to a profile. Throws on a Zernio API error. */
export async function connectedAccounts(key, profileId) {
  const r = await fetch(`${ZERNIO}/accounts?profileId=${encodeURIComponent(profileId)}`, {
    headers: { authorization: `Bearer ${key}` },
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Zernio accounts ${r.status}`)
  return d.accounts || []
}

/**
 * Publish caption + media to every connected account on a profile.
 * Returns { ok, platforms } on success, or { ok:false, reason|error } — never throws.
 */
export async function postToConnected({ caption, mediaItems, key, profileId }) {
  if (!key) return { ok: false, reason: 'ZERNIO_API_KEY not set' }
  try {
    const accounts = await connectedAccounts(key, profileId)
    if (!accounts.length) return { ok: false, reason: 'No connected accounts on the central profile yet' }
    const platforms = accounts.map((a) => ({ platform: a.platform, accountId: a._id }))
    const post = { content: caption, mediaItems, platforms, publishNow: true }
    const pr = await fetch(`${ZERNIO}/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(post),
    })
    const ptext = await pr.text().catch(() => '')
    if (!pr.ok) return { ok: false, error: `Zernio post ${pr.status}: ${ptext.slice(0, 200)}` }
    return { ok: true, platforms: platforms.map((p) => p.platform) }
  } catch (e) {
    return { ok: false, error: 'Zernio unreachable: ' + (e?.message || String(e)) }
  }
}
