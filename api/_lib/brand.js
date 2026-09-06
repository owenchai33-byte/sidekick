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

const PREFIX = 'brand/'

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
  return blobs.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
}

export async function getBrand(profileId) {
  const t = tok()
  if (!t || !profileId) return { ...EMPTY }
  try {
    const v = await versions(profileId, t)
    if (!v.length) return { ...EMPTY }
    const r = await fetch(v[0].url, { cache: 'no-store' })
    if (!r.ok) return { ...EMPTY }
    const j = await r.json()
    return { color: j.color || '', name: j.name || '', region: j.region || '', logo: j.logo || '', cardEnabled: j.cardEnabled !== false }
  } catch { return { ...EMPTY } }
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
  const blob = await put(`${PREFIX}${profileId}.json`, JSON.stringify(data), {
    access: 'public', token: t, contentType: 'application/json', addRandomSuffix: true,
  })
  try {
    const stale = (await versions(profileId, t)).filter((b) => b.url !== blob.url)
    if (stale.length) await del(stale.map((b) => b.url), { token: t })
  } catch { /* ignore prune failures */ }
  return data
}
