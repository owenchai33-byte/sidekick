// The ONE place that talks to a social-posting provider.
//
// `POSTING_PROVIDER=zernio|postpeer` picks the backend at runtime, so a bad
// provider is a config flip away from being undone — no redeploy, no code change.
// Everything else in the app imports from here and never sees a provider URL.
//
// Why two providers: Zernio bills per CONNECTED ACCOUNT (each agent = 3 accounts,
// so the bill grows with every agent Edward signs). PostPeer bills per POST with
// unlimited accounts, which is the right shape for "many agents, few posts each"
// — roughly 85% cheaper at 30+ agents.
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

const ZERNIO = 'https://zernio.com/api/v1'
const POSTPEER = 'https://api.postpeer.dev/v1'

// Zernio's original pilot profile. Kept as the fallback so nothing changes for
// existing Zernio traffic; PostPeer gets its own via POSTPEER_PROFILE_ID.
export const DEFAULT_PROFILE = '6a6c498971a67c109cfcae06'

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
/** The profile to use when the caller didn't name one. */
export function defaultProfile() {
  return provider() === 'postpeer'
    ? process.env.POSTPEER_PROFILE_ID || ''
    : process.env.ZERNIO_PROFILE_ID || DEFAULT_PROFILE
}
/** For /api/feed's status panel — is the current provider usable? */
export function providerConfigured() {
  return { provider: provider(), configured: !!apiKey() }
}
const missingKey = () =>
  provider() === 'postpeer'
    ? 'PostPeer not connected — set POSTPEER_API_KEY in Vercel'
    : 'Zernio not connected — set ZERNIO_API_KEY in Vercel'

/** Accounts connected to a profile, normalised to { id, platform, username }. */
export async function connectedAccounts(profileId) {
  if (!apiKey()) throw new Error(missingKey())
  const pid = profileId || defaultProfile()
  if (provider() === 'postpeer') {
    const qs = new URLSearchParams({ limit: '100' })
    if (pid) qs.set('profileId', pid)
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
export async function postToConnected({ caption, captionShort, mediaItems, profileId, platforms }) {
  if (!apiKey()) return { ok: false, reason: missingKey() }
  try {
    let accounts = await connectedAccounts(profileId)
    if (platforms && platforms.length) accounts = accounts.filter((a) => platforms.includes(a.platform))
    if (!accounts.length)
      return { ok: false, reason: platforms ? `No ${platforms.join('/')} account connected yet` : 'No connected accounts on this profile yet' }

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
      if (!r.ok) return { ok: false, error: `PostPeer ${r.status} ${t.slice(0, 200)}` }
      return { ok: true, platforms: targets.map((p) => p.platform) }
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
    if (!posted.length) return { ok: false, error: errors.join(' | ') }
    return { ok: true, platforms: posted, ...(errors.length ? { partialErrors: errors } : {}) }
  } catch (e) {
    return { ok: false, error: `${provider()} unreachable: ` + (e?.message || String(e)) }
  }
}
