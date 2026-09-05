// Portal: disconnect (unlink) one connected social account.
//   POST /api/social-disconnect  { profile, accountId }
//
// THIS WAS AN ANONYMOUS KILL SWITCH. It took an accountId, called the provider's
// DELETE, and asked nothing else — no secret, no profile, no ownership. Paired
// with /api/social-accounts (which listed the ids for any ?profile=), a stranger
// holding a profileId could unlink a paying client's Facebook, Instagram and
// TikTok in three requests. A profileId is not secret: it is in the Connect link
// WhatsApped to every client and in /api/ingest's response body.
//
// Three things now stand in the way, and it is worth being precise about what
// each one is worth, because none of them is a login:
//
//   1. `profile` is REQUIRED and the account must actually be ON that profile.
//      This kills the blind unlink — an id scraped from a log, a screenshot or
//      another tenant's page is no longer enough — and it makes a cross-tenant
//      unlink impossible even by accident.
//   2. The caller must hold INGEST_SECRET, or a valid link token, or look like
//      our own pages (see _lib/tenant.js fromOwnUi — a speed bump, honestly
//      labelled as one; it now compares Origin against a host the SERVER knows
//      rather than against the caller's own Host header).
//   3. A rate limit, so nobody sweeps profileIds.
//
// The only caller is src/pages/ConnectPage.jsx's disconnect button, which sends
// both fields. It is the one screen in the app that needs an account id at all.
import { connectedAccounts, disconnect, providerConfigured } from './_lib/social.js'
import { clientIp, fromOwnUi, hasIngestSecret, rateLimit, tokenFrom, verifyProfileToken } from './_lib/tenant.js'

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
  try { body = req.body ?? (await readJson(req)) } catch { return send(res, 400, { error: 'Invalid JSON' }) }
  const accountId = (body?.accountId || '').trim()
  const profileId = (body?.profile || body?.profileId || '').trim()
  if (!accountId) return send(res, 400, { error: 'accountId is required' })
  if (!profileId) {
    return send(res, 400, { error: 'profile is required — open your own SideKick link (it carries ?profile=) and disconnect from there' })
  }

  const credentialled = hasIngestSecret(req) || verifyProfileToken(profileId, tokenFrom(req, body))
  if (!credentialled && !fromOwnUi(req)) {
    return send(res, 401, { error: 'Disconnect from your own SideKick Connect screen' })
  }

  const rl = rateLimit(`disconnect:${clientIp(req)}`, { limit: 10, windowMs: 60_000 })
  if (!rl.ok) return send(res, 429, { error: `Too many disconnect attempts — try again in ${rl.retryAfter}s`, retryAfter: rl.retryAfter })

  try {
    // OWNERSHIP, from the provider itself rather than from anything the caller
    // said. An id that is not on this profile is either a mistake or somebody
    // else's account, and both answers are "no".
    const accounts = await connectedAccounts(profileId)
    if (!accounts.some((a) => String(a.id) === accountId)) {
      return send(res, 403, {
        ok: false, blocked: 'notYours',
        error: 'that account is not connected to this profile — refusing to disconnect it',
      })
    }
    await disconnect(accountId)
    return send(res, 200, { ok: true })
  } catch (e) {
    return send(res, 502, { error: e?.message || String(e) })
  }
}
