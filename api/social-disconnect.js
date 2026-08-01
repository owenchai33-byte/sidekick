// Portal: disconnect (unlink) one connected social account from the agent's
// Zernio profile — used to reset the demo profile between testers.
//   POST /api/social-disconnect  { accountId }
const ZERNIO = 'https://zernio.com/api/v1'

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
  const key = process.env.ZERNIO_API_KEY
  if (!key) return send(res, 501, { error: 'Zernio not connected — set ZERNIO_API_KEY in Vercel' })

  let body
  try { body = await readJson(req) } catch { return send(res, 400, { error: 'Invalid JSON' }) }
  const accountId = (body?.accountId || '').trim()
  if (!accountId) return send(res, 400, { error: 'accountId is required' })

  try {
    const r = await fetch(`${ZERNIO}/accounts/${encodeURIComponent(accountId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${key}` },
    })
    const t = await r.text().catch(() => '')
    if (!r.ok) return send(res, 502, { error: `Zernio ${r.status}: ${t.slice(0, 150)}` })
    return send(res, 200, { ok: true })
  } catch (e) {
    return send(res, 502, { error: 'Zernio unreachable: ' + (e?.message || String(e)) })
  }
}
