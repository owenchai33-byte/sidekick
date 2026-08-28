// Portal: disconnect (unlink) one connected social account from the agent's
// Zernio profile — used to reset the demo profile between testers.
//   POST /api/social-disconnect  { accountId }
import { disconnect, providerConfigured } from './_lib/social.js'

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
  const accountId = (body?.accountId || '').trim()
  if (!accountId) return send(res, 400, { error: 'accountId is required' })

  try {
    await disconnect(accountId)
    return send(res, 200, { ok: true })
  } catch (e) {
    return send(res, 502, { error: e?.message || String(e) })
  }
}
