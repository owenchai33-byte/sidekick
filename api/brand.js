// The agent's branding control — accent colour + name on the price card.
//   GET  /api/brand?profile=<id>                  → { color, name }
//   POST /api/brand { profile, color, name }      → saves, returns the saved value
import { getBrand, saveBrand } from './_lib/brand.js'

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
  const url = new URL(req.url, 'http://localhost')
  if (req.method === 'GET') {
    const profile = url.searchParams.get('profile') || ''
    if (!profile) return send(res, 400, { error: 'profile required' })
    return send(res, 200, await getBrand(profile))
  }
  if (req.method === 'POST') {
    let body
    try { body = await readJson(req) } catch { return send(res, 400, { error: 'Invalid JSON' }) }
    const profile = (body?.profile || '').trim()
    if (!profile) return send(res, 400, { error: 'profile required' })
    try {
      return send(res, 200, await saveBrand(profile, { color: body?.color, name: body?.name }))
    } catch (e) {
      return send(res, 400, { error: e?.message || String(e) })
    }
  }
  return send(res, 405, { error: 'GET or POST only' })
}
