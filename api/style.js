// Per-agent settings the agent controls: their caption STYLE and their BRAND
// (accent colour + name on the price card).
//
// Both live behind ONE function on purpose: Vercel's Hobby plan allows 12
// serverless functions per deployment and a separate /api/brand took the project
// to 13, which fails at "Deploying outputs" AFTER a successful build — an easy
// failure to misread as a code error. Keep new per-profile settings here.
//
//   GET  /api/style?profile=<id>              → { style, examples }
//   GET  /api/style?profile=<id>&kind=brand   → { color, name, region }
//   POST /api/style { profile, style, examples }        → saves the style
//   POST /api/style { profile, kind:"brand", color, name, region } → saves the brand
import { getStyle, saveStyle, getRules, saveRule } from './_lib/style.js'
import { getBrand, saveBrand } from './_lib/brand.js'
import { clientIp, hasIngestSecret, rateLimit } from './_lib/tenant.js'

// THIS ROUTE IS NOT AUTHENTICATED, AND IT COULD NOT BE MADE SO TODAY. Written
// down because the next person to read it will otherwise assume somebody forgot.
//
// A write here replaces an agent's trained caption format or their taught rules,
// and the only thing between a stranger and that is knowing a profileId — which
// is in the Connect link WhatsApped to every client, in their address bar, and
// in /api/ingest's response body.
//
// Every writer was enumerated before deciding. Four of them are NOT browsers and
// send no credential, and all four live outside this repo, so they cannot be
// given one here:
//     sidekick.mjs:370   setbrand     (holds INGEST_SECRET; does not send it)
//     sidekick.mjs:414   setstyle     (holds INGEST_SECRET; does not send it)
//     rule-sweeper.mjs:95             (cron, every 10 min — the rule-recovery
//                                      backstop; a gate here silently stops it)
//     onboard-agent.sh:177            (migrates a REAL trained style on setup)
// Only sidekick.mjs:536 `remember` sends the secret, and only StylePage is a
// browser. Gating on the secret would take away setstyle and setbrand — the two
// commands an agent uses to teach the system — and gating on a link token would
// take away every link already sitting in an agent's WhatsApp. Both are the
// silent-refusal failure this codebase keeps shipping, so neither was done.
//
// What IS here is what cannot refuse a legitimate caller: a rate limit far above
// any real writer's volume, so one profileId cannot be turned into a sweep of
// fifty; and _lib/style.js now keeps the previous version of a style instead of
// pruning it, so a wipe is recoverable rather than final.
//
// To finish it: have sidekick.mjs's setstyle/setbrand send x-ingest-secret (one
// line each, copied from `remember`), have onboard-agent.sh and rule-sweeper.mjs
// send it too, and emit `&t=` on the Connect/Style links from onboard-agent.sh
// and connection-watch.mjs:148. Then the accept-list here becomes
// secret-or-token and this comment can be deleted.

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

  // Generous by design: rule-sweeper writes once per 10-minute cron, onboarding
  // once per agent, and a person editing their style saves a handful of times.
  // Nobody real meets this; a script walking profileIds does.
  // A CALLER HOLDING THE SECRET IS NOT THE THREAT, so it is not throttled.
  //
  // The four non-browser writers — sidekick.mjs setstyle/setbrand/remember, the
  // rule-sweeper cron, onboard-agent.sh and the selftest — all run on an agent's
  // own Mac and all share ONE outbound IP per agent. Throttling them by IP means
  // an agent teaching the bot several preferences in a row, or a sweeper firing
  // beside a person editing their style, starts getting 429s on their own
  // training. That is a lockout: the agent is told "too many requests" for using
  // the product normally, and the preference they just taught is silently lost.
  //
  // What the limit is actually for is a stranger walking profileIds, and a
  // stranger does not hold INGEST_SECRET.
  const ip = clientIp(req)
  const rl = hasIngestSecret(req)
    ? { ok: true }
    : req.method === 'POST'
      ? rateLimit(`style-write:${ip}`, { limit: 20, windowMs: 60_000 })
      : rateLimit(`style-read:${ip}`, { limit: 120, windowMs: 60_000 })
  if (!rl.ok) {
    res.setHeader?.('retry-after', String(rl.retryAfter))
    return send(res, 429, { error: `Too many style requests — try again in ${rl.retryAfter}s`, retryAfter: rl.retryAfter })
  }

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
        return send(res, 200, await saveBrand(profile, { color: body?.color, name: body?.name, region: body?.region }))
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
