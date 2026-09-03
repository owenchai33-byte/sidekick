// Per-agent settings the agent controls: their caption STYLE and their BRAND
// (accent colour + name on the price card).
//
// Both live behind ONE function on purpose: Vercel's Hobby plan allows 12
// serverless functions per deployment and a separate /api/brand took the project
// to 13, which fails at "Deploying outputs" AFTER a successful build — an easy
// failure to misread as a code error. Keep new per-profile settings here.
//
//   GET  /api/style?profile=<id>              → { style, examples }
//   GET  /api/style?profile=<id>&kind=brand   → { color, name }
//   POST /api/style { profile, style, examples }        → saves the style
//   POST /api/style { profile, kind:"brand", color, name } → saves the brand
import { getStyle, saveStyle, getRules, saveRule } from './_lib/style.js'
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
    if ((url.searchParams.get('kind') || '') === 'brand') return send(res, 200, await getBrand(profile))
    if ((url.searchParams.get('kind') || '') === 'rules') return send(res, 200, await getRules(profile))
    return send(res, 200, await getStyle(profile))
  }

  if (req.method === 'POST') {
    let body
    try { body = await readJson(req) } catch { return send(res, 400, { error: 'Invalid JSON' }) }
    const profile = (body?.profile || '').trim()
    if (!profile) return send(res, 400, { error: 'profile required' })
    try {
      if (body?.kind === 'brand') {
        return send(res, 200, await saveBrand(profile, { color: body?.color, name: body?.name }))
      }
      // This branch sat INSIDE the brand block, after its return: unreachable,
      // and gated on a kind it could never have. Every `remember` therefore fell
      // through to saveStyle, which ignores `rule`, answered with the style
      // object, and the CLI read `.rules` off it as an empty list - so the agent
      // was told "ok, remembered" while nothing was written, for every rule any
      // agent ever taught. Caught 2026-09-03 by asking the API instead of
      // calling saveRule() directly, which is what the unit tests had been doing.
      if ((body?.kind || '') === 'rules') {
        return send(res, 200, await saveRule(profile, { rule: body?.rule, replace: body?.rules }))
      }
      return send(res, 200, await saveStyle(profile, { style: body?.style, examples: body?.examples }))
    } catch (e) {
      return send(res, 400, { error: e?.message || String(e) })
    }
  }

  return send(res, 405, { error: 'GET or POST only' })
}
