// The agent's caption-style control.
//   GET  /api/style?profile=<id>            → { style, examples }
//   POST /api/style { profile, style, examples } → saves, returns the saved value
// Scoped by Zernio profile (each agent edits their own via their link).

import { getStyle, saveStyle } from './_lib/style.js'

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
    return send(res, 200, await getStyle(profile))
  }

  if (req.method === 'POST') {
    let body
    try { body = req.body ?? (await readJson(req)) } catch { return send(res, 400, { error: 'Invalid JSON' }) }
    const profile = (body?.profile || '').trim()
    if (!profile) return send(res, 400, { error: 'profile required' })
    try {
      const saved = await saveStyle(profile, { style: body?.style, examples: body?.examples })
      return send(res, 200, { ok: true, ...saved })
    } catch (e) { return send(res, 502, { error: e?.message || String(e) }) }
  }

  return send(res, 405, { error: 'GET or POST only' })
}
