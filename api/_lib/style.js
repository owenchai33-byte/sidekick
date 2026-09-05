// Per-agent caption style ("trained" voice). One small JSON blob per Zernio
// profile: the agent's plain-English rules + a few example captions to mimic.
// Read at caption time; edited from the agent's app link or via WhatsApp.
//
// Writes use addRandomSuffix so every save is a NEW object (never a stale-cached
// overwrite of a fixed URL); reads take the newest and prune the rest.

import { put, list, del } from '@vercel/blob'

const PREFIX = 'style/'
const tok = () => process.env.BLOB_READ_WRITE_TOKEN
// How many versions of a style/rule set survive a write. Reads always take the
// newest; the rest exist so an unauthenticated overwrite is recoverable.
const KEEP_VERSIONS = 3

async function versions(profileId, t) {
  const { blobs } = await list({ prefix: `${PREFIX}${profileId}`, token: t, limit: 25 })
  return blobs.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
}

export async function getStyle(profileId) {
  const t = tok()
  if (!t || !profileId) return { style: '', examples: [] }
  try {
    const v = await versions(profileId, t)
    if (!v.length) return { style: '', examples: [] }
    const r = await fetch(v[0].url, { cache: 'no-store' })
    if (!r.ok) return { style: '', examples: [] }
    const j = await r.json()
    return { style: j.style || '', examples: Array.isArray(j.examples) ? j.examples : [] }
  } catch { return { style: '', examples: [] } }
}

export async function saveStyle(profileId, { style, examples }) {
  const t = tok()
  if (!t) throw new Error('no BLOB token')
  if (!profileId) throw new Error('profile required')
  // Merge: only overwrite fields provided (a WhatsApp rule tweak keeps app examples, & vice-versa).
  const cur = await getStyle(profileId)
  const data = {
    style: style !== undefined ? String(style || '').slice(0, 4000) : cur.style,
    examples: examples !== undefined
      ? (Array.isArray(examples) ? examples : []).map((e) => String(e || '').trim()).filter(Boolean).slice(0, 5).map((e) => e.slice(0, 4000))
      : cur.examples,
    updatedAt: new Date().toISOString(),
  }
  const blob = await put(`${PREFIX}${profileId}.json`, JSON.stringify(data), {
    access: 'public', token: t, contentType: 'application/json', addRandomSuffix: true,
  })
  // Prune, but KEEP THE LAST FEW.
  //
  // This used to delete everything but the newest, which made a write final.
  // /api/style has no authentication and cannot be given any today (the reasons
  // are written out in api/style.js), so the realistic failure — a wipe of an
  // agent's trained voice, whether by a stranger with their profileId or by a
  // caller sending `style` when it meant to send only `examples` — was
  // irreversible. Reads take versions[0], so the older blobs cost a few KB and
  // change nothing about behaviour; they are there so the answer to "their style
  // is gone" is a restore instead of retraining from memory.
  try {
    const stale = (await versions(profileId, t)).filter((b) => b.url !== blob.url).slice(KEEP_VERSIONS - 1)
    if (stale.length) await del(stale.map((b) => b.url), { token: t })
  } catch { /* ignore prune failures */ }
  return data
}


// --- per-agent RULES ---------------------------------------------------------
//
// Everything an agent has taught this system beyond their caption format: which
// photo to use as cover, colours, what never to say, how they want the reel
// voiced, anything they corrected once and should never have to correct again.
//
// This exists because there was nowhere to put it. An agent could say "always
// use the first photo I send" or "stop calling it an apartment" and it was gone
// the moment the chat moved on - so they had to say it again, and again. At 100
// agents, each with their own way of working, that is the difference between a
// system that learns and one that annoys.
//
// Kept as short plain-English lines, newest last, capped so the caption prompt
// cannot bloat. Rules are per profileId, so one agent's preferences can never
// reach another's captions.
const RULES_PREFIX = 'rules/'
const MAX_RULES = 40

async function ruleVersions(profileId, t) {
  const { blobs } = await list({ prefix: `${RULES_PREFIX}${profileId}`, token: t, limit: 25 })
  return blobs.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
}

export async function getRules(profileId) {
  const t = tok()
  if (!t || !profileId) return { rules: [] }
  try {
    const v = await ruleVersions(profileId, t)
    if (!v.length) return { rules: [] }
    const r = await fetch(v[0].url, { cache: 'no-store' })
    if (!r.ok) return { rules: [] }
    const j = await r.json()
    return { rules: Array.isArray(j.rules) ? j.rules : [] }
  } catch { return { rules: [] } }
}

/** Add one rule (deduped), or replace the whole set when `replace` is given. */
export async function saveRule(profileId, { rule, replace }) {
  const t = tok()
  if (!t) throw new Error('no BLOB token')
  if (!profileId) throw new Error('profile required')
  let rules
  if (Array.isArray(replace)) {
    rules = replace.map((r) => String(r || '').trim()).filter(Boolean)
  } else {
    const cur = (await getRules(profileId)).rules
    const clean = String(rule || '').trim().slice(0, 300)
    if (!clean) return { rules: cur }
    // Near-duplicate check: the same correction phrased twice should not stack up.
    const norm = (x) => x.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
    rules = cur.filter((r) => norm(r) !== norm(clean))
    rules.push(clean)
  }
  rules = rules.slice(-MAX_RULES)
  const data = { rules, updatedAt: new Date().toISOString() }
  const blob = await put(`${RULES_PREFIX}${profileId}.json`, JSON.stringify(data), {
    access: 'public', token: t, contentType: 'application/json', addRandomSuffix: true,
  })
  // Same as saveStyle: keep the previous few, so `replace: []` from a stranger
  // (or from a caller that meant to append) is not the end of everything an
  // agent has taught this system.
  try {
    const stale = (await ruleVersions(profileId, t)).filter((b) => b.url !== blob.url).slice(KEEP_VERSIONS - 1)
    if (stale.length) await del(stale.map((b) => b.url), { token: t })
  } catch { /* ignore prune failures */ }
  return data
}
