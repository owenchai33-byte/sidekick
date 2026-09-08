// Per-agent branding (accent colour + name shown on the price card). Stored the
// same way as the caption style: one small JSON blob per profile.
//
// Before this, brand colour and name were GLOBAL env vars, so every agent on the
// system shared one look — fine for a pilot, wrong the moment a second agency uses
// it. Env vars remain the fallback for anyone who has not set their own.
//
// Writes use addRandomSuffix so every save is a NEW object (never a stale-cached
// overwrite of a fixed URL); reads take the newest and prune the rest.

import { put, list, del } from '@vercel/blob'
import { readThrough, newestFirst } from './identity.js'

const PREFIX = 'brand/'
// How many versions of a brand survive a write. Reads always take the newest;
// the rest exist so an unauthenticated overwrite is recoverable. Matches
// _lib/style.js — /api/style is the same endpoint with the same lack of auth,
// and brand writes reach it through the same door.
const KEEP_VERSIONS = 3

// cardEnabled defaults TRUE: an agent who has never set a brand keeps the card
// they have always had. Only an explicit false turns it off.
const EMPTY = { color: '', name: '', region: '', logo: '', cardEnabled: true }

// A logo is drawn onto a public image, so it has to BE a public image. Anything
// else is stored as empty rather than rejected — a bad logo must never stop a
// post going out.
function normaliseLogo(v) {
  const u = String(v ?? '').trim()
  if (!u) return ''
  return /^https:\/\/[^\s]+$/i.test(u) ? u.slice(0, 500) : null
}
const tok = () => process.env.BLOB_READ_WRITE_TOKEN

/** #RGB or #RRGGBB only — anything else is rejected rather than silently ignored,
 *  because a bad colour renders an invisible or garish card on a real listing. */
export function normaliseColor(c) {
  const s = String(c || '').trim()
  if (!s) return ''
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(s)
  if (!m) return null
  const hex = m[1]
  return '#' + (hex.length === 3 ? hex.split('').map((x) => x + x).join('') : hex).toLowerCase()
}

async function versions(profileId, t) {
  const { blobs } = await list({ prefix: `${PREFIX}${profileId}`, token: t, limit: 25 })
  return newestFirst(blobs)
}

// Brand reads fall back through the agent's old keys for the same reason style
// and rules do — a re-keyed agent whose colour and logo silently vanish posts a
// card that is not theirs onto a client's public page. See the long note in
// _lib/style.js for the three states a read can be in.
//
// EMPTINESS IS NOT JUST "no colour". An agent who has only ever turned the price
// card OFF has set something real, so `cardEnabled:false` counts as content and
// stops the fallback — otherwise their one deliberate choice would be skipped
// over in favour of an older key that still had the card on.
export async function getBrand(profileId) {
  const t = tok()
  if (!t || !profileId) return { ...EMPTY, found: false, degraded: false, source: 'none' }
  const r = await readThrough(PREFIX, profileId, t, {
    parse: (j) => ({
      color: j.color || '', name: j.name || '', region: j.region || '',
      logo: j.logo || '', cardEnabled: j.cardEnabled !== false,
    }),
    isEmpty: (v) => !v.color && !v.name && !v.region && !v.logo && v.cardEnabled === true,
  })
  return { ...(r.value || { ...EMPTY }), found: r.found, degraded: r.degraded, source: r.source }
}

export async function saveBrand(profileId, { color, name, region, logo, cardEnabled }) {
  const t = tok()
  if (!t) throw new Error('no BLOB token')
  if (!profileId) throw new Error('profile required')
  const cur = await getBrand(profileId)
  let logoUrl = cur.logo || ''
  if (logo !== undefined) {
    const l = normaliseLogo(logo)
    if (l === null) throw new Error(`"${logo}" is not an image link — send me the logo as a photo and I'll upload it`)
    logoUrl = l
  }
  let nextColor = cur.color
  if (color !== undefined) {
    const c = normaliseColor(color)
    if (c === null) throw new Error(`"${color}" is not a colour — use a hex code like #C8102E`)
    nextColor = c
  }
  const data = {
    color: nextColor,
    name: name !== undefined ? String(name || '').trim().slice(0, 60) : cur.name,
    // Where this agent actually works, in their own words ("Kuching, Sarawak",
    // "Johor Bahru", "Klang Valley"). Only the content-plan prompt reads it, and
    // only to talk about THEIR market instead of the pilot agent's. It is never
    // attached to a listing: a listing's location comes from the listing.
    region: region !== undefined ? String(region || '').trim().slice(0, 60) : cur.region,
    // Their own mark, drawn top-right on the price card.
    logo: logoUrl,
    // Some agencies do not want a price panel on their photos at all. This is a
    // standing choice, unlike the per-listing `card:false` an ingest call can pass.
    cardEnabled: cardEnabled !== undefined ? cardEnabled !== false : cur.cardEnabled !== false,
    updatedAt: new Date().toISOString(),
  }
  // Same stamp as style and rules: a brand emptied on purpose is an answer, not
  // a gap, and must not be refilled from an older key.
  data.cleared = !data.color && !data.name && !data.region && !data.logo && data.cardEnabled === true
  const blob = await put(`${PREFIX}${profileId}.json`, JSON.stringify(data), {
    access: 'public', token: t, contentType: 'application/json', addRandomSuffix: true,
  })
  // STILL DELETES EVERY OTHER VERSION, unlike saveStyle and saveRule which keep
  // KEEP_VERSIONS=3. So a brand write is final while a style write is
  // recoverable — the same unauthenticated endpoint, two different answers to
  // "can this be undone". Worth fixing, but NOT here and not as a side effect of
  // the identity migration: this prune is the only reason getBrand never had to
  // depend on `uploadedAt` ordering, and keeping older versions makes every
  // brand read depend on that sort being right. brand-logo.test.mjs proves the
  // point — its list() mock returns no uploadedAt, so with three versions kept,
  // getBrand reads the OLDEST and the agent's colour, logo and card toggle all
  // silently revert. That is a stale read on a live price card, which is exactly
  // the failure this file's own header warns about. It needs its own change,
  // with a mock that models uploadedAt and a test for the ordering.
  try {
    // PRUNE, BUT KEEP THE LAST FEW — the same rule style and rules already use.
    //
    // This deleted every other version, so a brand write was FINAL. /api/style
    // has no authentication and cannot be given any today (the reasons are
    // written out in api/style.js), and brand saves go through that same
    // unauthenticated door: a mistyped colour, a cleared logo or a wrongly
    // flipped cardEnabled had no way back. Style was made recoverable and brand
    // was left behind — same exposure, same blast radius, and the result is
    // burned onto a price card on a client's public page.
    //
    // Reads take versions[0], so the older blobs cost a few KB and change
    // nothing about behaviour; they are there so the answer to "my logo is
    // gone" is a restore rather than asking the agent to send it again.
    const stale = (await versions(profileId, t)).filter((b) => b.url !== blob.url).slice(KEEP_VERSIONS - 1)
    if (stale.length) await del(stale.map((b) => b.url), { token: t })
  } catch { /* ignore prune failures */ }
  return data
}
