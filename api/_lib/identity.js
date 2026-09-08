// WHO an agent is, kept separate from WHERE their posts go.
//
// THE BUG THIS FILE EXISTS TO KILL
// --------------------------------
// Every per-agent setting is stored under the POSTING PROVIDER'S profile id:
//     style/<id>   rules/<id>   brand/<id>
// Zernio and PostPeer mint DIFFERENT ids for the same human. So changing
// POSTING_PROVIDER used to re-key every one of those blobs at once — silently.
// Nothing errors: getStyle returns { style:'', examples:[] } for "no blob" and
// for "never trained" alike, so the only symptom is the next caption coming out
// in the default format, on a paying client's public page, with nobody told.
// It has already happened once in this product's history.
//
// THE FIX, in two halves
// ----------------------
// 1. The id in tools/tenants.json is now an AGENT ID: a stable name for a human
//    that never changes again, whatever provider is live. It is what style,
//    rules and brand are keyed by, and what a Connect link carries.
// 2. The posting profile — the provider's own id — is looked up from the agent
//    record here, per provider. Changing provider changes only that lookup.
//
// The agent ids for the three live agents are SEEDED TO THEIR CURRENT PROFILE
// IDS on purpose. That makes the switch a change of MEANING, not of data:
// nothing is copied, no blob moves, every Connect link and every `t=` token
// already in an agent's WhatsApp stays valid, and rollback has nothing to undo.
//
// WHAT MAKES THIS SAFE TO DEPLOY BEFORE THE FLIP
// ----------------------------------------------
// An agent with no record resolves to ITSELF — byte-identical to today's
// behaviour. Every failure in here (no token, blob down, unparseable record)
// degrades to that same answer. This layer can therefore only ever add
// information; it can never take away a lookup that works today.

import { put, list } from '@vercel/blob'

const PREFIX = 'agents/'
const tok = () => process.env.BLOB_READ_WRITE_TOKEN

// Per-lambda memo, so threading identity through getStyle + getRules + getBrand
// costs ONE blob list per agent per minute rather than three per request.
//
// A miss is cached too, and deliberately: almost every agent has no record for
// most of this migration's life, and an uncached miss would put a blob list in
// front of every caption. The cost of the memo is that a record written on one
// lambda takes up to TTL to be seen by another — which shows up as an agent
// still resolving to their old posting profile for a minute after Owen writes
// their record. That is visible and self-correcting; a blob list per caption is
// neither.
const CACHE_MS = 30_000
const cache = new Map()

/** Test hook, and the thing to call after writing a record on this instance. */
export function resetIdentityCache(agentId) {
  if (agentId) cache.delete(String(agentId))
  else cache.clear()
}

const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())

function normaliseRecord(j, agentId) {
  if (!j || typeof j !== 'object') return null
  const posting = {}
  const p = j.postingProfile && typeof j.postingProfile === 'object' ? j.postingProfile : {}
  for (const k of Object.keys(p)) {
    const v = str(p[k])
    if (v) posting[String(k).toLowerCase()] = v
  }
  return {
    agentId: str(j.agentId) || str(agentId),
    label: str(j.label),
    previousIds: (Array.isArray(j.previousIds) ? j.previousIds : []).map(str).filter(Boolean),
    postingProfile: posting,
    updatedAt: str(j.updatedAt),
  }
}

/**
 * The agent's record, or null when there isn't one / it could not be read.
 *
 * NEVER THROWS. Null is the "carry on exactly as before" answer, and every
 * caller below is written so that null reproduces today's behaviour precisely.
 */
export async function getAgentRecord(agentId) {
  const id = str(agentId)
  const t = tok()
  if (!t || !id) return null

  const hit = cache.get(id)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rec

  let rec = null
  try {
    const { blobs } = await list({ prefix: `${PREFIX}${id}`, token: t, limit: 25 })
    if (blobs.length) {
      const newest = newestFirst(blobs)[0]
      const r = await fetch(newest.url, { cache: 'no-store' })
      if (r.ok) rec = normaliseRecord(await r.json(), id)
    }
  } catch {
    // A registry that cannot be read must not take down a caption. Fall through
    // to null, which means "this agent is their own posting profile" — today's
    // behaviour — and do NOT cache the failure as a durable miss.
    return null
  }
  cache.set(id, { at: Date.now(), rec })
  return rec
}

/**
 * Every key this agent's settings might be stored under, newest first:
 * the agent id itself, then any id they used to be known by.
 *
 * This is the read-through fallback list. It exists so that a settings read can
 * never come back empty merely because it looked in ONE place — which is the
 * silent loss this whole file is about.
 */
export async function identityKeys(agentId) {
  const id = str(agentId)
  if (!id) return []
  const rec = await getAgentRecord(id)
  const keys = [id]
  for (const prev of rec?.previousIds || []) {
    if (!prev || keys.includes(prev)) continue
    // Vercel Blob reads are PREFIX matches (list({ prefix: 'style/' + key })),
    // and that relation runs ONE WAY ONLY.
    //
    // prev LONGER than id  — list('style/'+id) already matches prev's blobs, so
    //                        including prev adds nothing. Skip is correct.
    // prev SHORTER than id — list('style/'+id) does NOT match 'style/<prev>-N',
    //                        so skipping prev makes that data permanently
    //                        unreachable. Measured: settings written under
    //                        '6a90f9f6' with a primary of the full 24-hex id
    //                        read back empty, found:false.
    //
    // The old condition skipped both directions and silently orphaned the second.
    if (prev.startsWith(id)) continue
    keys.push(prev)
  }
  return keys
}

// --- the read-through itself -------------------------------------------------
//
// Shared by style, rules and brand so all three fall back the same way. Living
// here rather than in style.js keeps brand.js from having to import from style.js
// just to borrow it.

/** Newest blob under one exact key. { data } | { data:null } | { error:true } */
/**
 * Blobs newest-first, safely.
 *
 * Every reader did `new Date(b.uploadedAt).getTime()` inline. Date.parse gives
 * NaN for a missing or oddly-shaped uploadedAt, a comparator returning NaN is
 * treated as 0, and so the sort silently became a NO-OP — the caller then read
 * blobs[0], meaning whatever order the store happened to return. That was
 * invisible only because every writer pruned down to exactly one version. Keep
 * more than one and it becomes an agent's colour or trained style quietly
 * reverting on a live post.
 *
 * An undated blob sorts LAST: one we can date is more trustworthy than one we
 * cannot. Array#sort is stable, so undated blobs keep the order the store gave.
 */
export function newestFirst(blobs) {
  const ts = (b) => {
    const n = Date.parse(b?.uploadedAt)
    return Number.isFinite(n) ? n : -Infinity
  }
  return [...(blobs || [])].sort((a, b) => {
    const ta = ts(a), tb = ts(b)
    return ta === tb ? 0 : tb - ta
  })
}

async function readNewest(prefix, key, t) {
  try {
    const { blobs } = await list({ prefix: `${prefix}${key}`, token: t, limit: 25 })
    if (!blobs.length) return { data: null }
    const newest = newestFirst(blobs)[0]
    const r = await fetch(newest.url, { cache: 'no-store' })
    if (!r.ok) return { error: true }
    return { data: await r.json() }
  } catch { return { error: true } }
}

/**
 * Walk the agent's keys — their own id first, then any id they used to be known
 * by — and take the first that actually holds something.
 *
 * "EXISTS BUT EMPTY" KEEPS FALLING BACK. Otherwise a single stray empty write at
 * the new key would permanently shadow a trained style at the old one, which is
 * precisely the shape of loss being prevented here. Within one key the newest
 * version still wins, so a deliberate clear is never resurrected.
 *
 * Returns { value, found, degraded, source }. `degraded` means the STORE failed
 * somewhere in the walk — an empty answer that must NOT be read as "untrained".
 */
export async function readThrough(prefix, agentId, t, { parse, isEmpty }) {
  const keys = await identityKeys(agentId)
  let degraded = false
  for (const key of keys) {
    const res = await readNewest(prefix, key, t)
    // A key that could not be read is UNKNOWN, not empty. Keep looking — a later
    // key may answer — but remember that the silence was not proof.
    if (res.error) { degraded = true; continue }
    if (!res.data) continue
    const value = parse(res.data)
    // A DELIBERATE CLEAR IS AN ANSWER, NOT A GAP.
    //
    // "Exists but empty keeps falling back" protects a trained style from one
    // stray empty write at a new key. Applied to a clear the agent MEANT, it
    // becomes silent refusal number seven: they say "forget the rule about the
    // fire emoji", the write succeeds, the tool reports success, and the rule
    // keeps applying to every caption forever because an older key still has it.
    //
    // The two are indistinguishable by content — both are empty — so the writer
    // says which it was. saveStyle/saveRule/saveBrand stamp `cleared: true` when
    // the agent emptied something on purpose. That stops the walk; an accidental
    // empty, which carries no stamp, still falls through.
    if (res.data.cleared === true) {
      return { value, found: true, degraded: false, source: key === agentId ? 'primary' : `legacy:${key}` }
    }
    if (isEmpty(value, res.data)) continue
    return { value, found: true, degraded: false, source: key === agentId ? 'primary' : `legacy:${key}` }
  }
  return { value: null, found: false, degraded, source: degraded ? 'degraded' : 'none' }
}

/**
 * The provider profile to publish this agent's post to.
 *
 * Falls back to the agent id itself, which is exactly what every caller passed
 * straight to the provider before this file existed. An agent with no record,
 * or a registry that is down, therefore behaves as it does today.
 *
 * `providerName` is passed in rather than imported so that social.js can depend
 * on this module without this module depending back on it.
 */
export async function resolvePostingProfile(agentId, providerName) {
  const id = str(agentId)
  if (!id) return ''
  const rec = await getAgentRecord(id)
  const mapped = rec?.postingProfile?.[String(providerName || '').toLowerCase()]
  return str(mapped) || id
}

/**
 * Create or update an agent record. Merges: a call that names only
 * `postingProfile.zernio` leaves previousIds and the postpeer mapping alone.
 *
 * Writes are additive by design — `previousIds` is a UNION, never a
 * replacement. An old key is how a trained style is still reachable, so this
 * module is not given a way to forget one by accident.
 */
export async function saveAgentRecord(agentId, { label, previousIds, postingProfile } = {}) {
  const t = tok()
  if (!t) throw new Error('no BLOB token')
  const id = str(agentId)
  if (!id) throw new Error('agent id required')

  const cur = (await getAgentRecord(id)) || { agentId: id, label: '', previousIds: [], postingProfile: {} }

  const mergedPrev = [...cur.previousIds]
  for (const p of Array.isArray(previousIds) ? previousIds : []) {
    const v = str(p)
    // An agent is never their own previous id: that would make the fallback list
    // read the same key twice and hide a genuine miss behind a duplicate hit.
    if (!v || v === id || mergedPrev.includes(v)) continue
    mergedPrev.push(v)
  }

  const mergedPosting = { ...cur.postingProfile }
  const incoming = postingProfile && typeof postingProfile === 'object' ? postingProfile : {}
  for (const k of Object.keys(incoming)) {
    const key = String(k).toLowerCase()
    const v = str(incoming[k])
    // '' deletes a mapping (back to "this agent is their own profile"); a value sets it.
    if (v) mergedPosting[key] = v
    else delete mergedPosting[key]
  }

  const data = {
    agentId: id,
    label: label !== undefined ? str(label).slice(0, 60) : cur.label,
    previousIds: mergedPrev.slice(-10),
    postingProfile: mergedPosting,
    updatedAt: new Date().toISOString(),
  }

  // addRandomSuffix, like every other blob this codebase writes: a fixed URL can
  // be served stale from cache after an overwrite. Old versions are NOT pruned
  // here — a record is a few hundred bytes, and the previous one is the way back
  // from a mistyped Zernio profile id.
  await put(`${PREFIX}${id}.json`, JSON.stringify(data), {
    access: 'public', token: t, contentType: 'application/json', addRandomSuffix: true,
  })
  resetIdentityCache(id)
  return data
}
