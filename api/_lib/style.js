// Per-agent caption style ("trained" voice). One small JSON blob per Zernio
// profile: the agent's plain-English rules + a few example captions to mimic.
// Read at caption time; edited from the agent's app link or via WhatsApp.
//
// Writes use addRandomSuffix so every save is a NEW object (never a stale-cached
// overwrite of a fixed URL); reads take the newest and prune the rest.

import { put, list, del } from '@vercel/blob'
import { readThrough, newestFirst } from './identity.js'

const PREFIX = 'style/'
const tok = () => process.env.BLOB_READ_WRITE_TOKEN
// How many versions of a style/rule set survive a write. Reads always take the
// newest; the rest exist so an unauthenticated overwrite is recoverable.
const KEEP_VERSIONS = 3

async function versions(profileId, t) {
  const { blobs } = await list({ prefix: `${PREFIX}${profileId}`, token: t, limit: 25 })
  return newestFirst(blobs)
}

// --- read-through, and the three states a read can be in ---------------------
//
// getStyle used to return the SAME { style:'', examples:[] } for five different
// things: no blob token, no blob, a fetch that failed, unparseable JSON, and an
// agent who genuinely has not trained anything. That single conflation IS the
// silent loss. After a provider change the trained style is still sitting under
// the OLD profile id, the read looks only under the new one, gets empty, and
// the next caption comes out in the default format on a paying client's public
// page with nobody told.
//
// Two things change. A read now walks EVERY key this agent has ever been known
// by instead of one. And it says which of three things happened:
//
//   found:true                    a blob was read and had content — use it
//   found:false, degraded:false   looked everywhere, nothing is there
//                                 (the correct answer for an untrained agent)
//   found:false, degraded:true    the STORE failed. NOT the same as empty, and
//                                 callers must not read it as "untrained".
//
// `source` names the key that answered — 'primary', 'legacy:<oldId>', 'none' or
// 'degraded' — and is reported out through /api/ingest, so "did the fallback
// fire?" is answered by the response instead of by guesswork.

// The walk itself lives in _lib/identity.js so style, rules and brand all fall
// back identically.

const EMPTY_STYLE = () => ({ style: '', examples: [] })

export async function getStyle(profileId) {
  const t = tok()
  if (!t || !profileId) return { ...EMPTY_STYLE(), found: false, degraded: false, source: 'none' }
  const r = await readThrough(PREFIX, profileId, t, {
    parse: (j) => ({ style: j.style || '', examples: Array.isArray(j.examples) ? j.examples : [] }),
    isEmpty: (v) => !v.style && !v.examples.length,
  })
  return { ...(r.value || EMPTY_STYLE()), found: r.found, degraded: r.degraded, source: r.source }
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
  // Said out loud so a read can tell a deliberate clear from a stray empty write
  // — see the note in _lib/identity.js readThrough().
  data.cleared = !data.style && !data.examples.length
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
  return newestFirst(blobs)
}

// Rules fall back exactly as the style does, and for the same money. The three
// Owen has trained — never call a condo an apartment, use the first photo as the
// cover, area name in CAPS and no fire emoji — are stored under rules/<id> and
// had no migration path in any tooling in this repo before this.
export async function getRules(profileId) {
  const t = tok()
  if (!t || !profileId) return { rules: [], found: false, degraded: false, source: 'none' }
  const r = await readThrough(RULES_PREFIX, profileId, t, {
    parse: (j) => ({ rules: Array.isArray(j.rules) ? j.rules : [] }),
    isEmpty: (v) => !v.rules.length,
  })
  return { rules: r.value?.rules || [], found: r.found, degraded: r.degraded, source: r.source }
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
  const data = { rules, updatedAt: new Date().toISOString(), cleared: rules.length === 0 }
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
