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
 * TikTok photo posts cap the caption at 90 chars (it's the slideshow title), so
 * TikTok gets `captionShort` and everyone else the full caption — one Zernio
 * call per caption variant. Returns { ok, platforms } on success (with
 * partialErrors if some platform failed), or { ok:false, reason|error }. Never throws.
 */
export async function postToConnected({ caption, captionShort, mediaItems, key, profileId, platforms }) {
  if (!key) return { ok: false, reason: 'ZERNIO_API_KEY not set' }
  try {
    let accounts = await connectedAccounts(key, profileId)
    if (platforms && platforms.length) accounts = accounts.filter((a) => platforms.includes(a.platform))
    if (!accounts.length) return { ok: false, reason: platforms ? `No ${platforms.join('/')} account connected yet` : 'No connected accounts on the central profile yet' }

    const short = (captionShort || caption || '').slice(0, 90)
    const groups = [
      { accts: accounts.filter((a) => a.platform === 'tiktok'), content: short },
      { accts: accounts.filter((a) => a.platform !== 'tiktok'), content: caption },
    ].filter((g) => g.accts.length)

    const posted = []
    const errors = []
    for (const g of groups) {
      const platforms = g.accts.map((a) => ({ platform: a.platform, accountId: a._id }))
      const pr = await fetch(`${ZERNIO}/posts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ content: g.content, mediaItems, platforms, publishNow: true }),
      })
      const ptext = await pr.text().catch(() => '')
      if (pr.ok) posted.push(...platforms.map((p) => p.platform))
      else errors.push(`${platforms.map((p) => p.platform).join('/')}: ${pr.status} ${ptext.slice(0, 120)}`)
    }
    if (!posted.length) return { ok: false, error: errors.join(' | ') }
    return { ok: true, platforms: posted, ...(errors.length ? { partialErrors: errors } : {}) }
  } catch (e) {
    return { ok: false, error: 'Zernio unreachable: ' + (e?.message || String(e)) }
  }
}
