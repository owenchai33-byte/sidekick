// Per-agent caption style ("trained" voice). One small JSON blob per Zernio
// profile: the agent's plain-English rules + a few example captions to mimic.
// Read at caption time; edited from the agent's app link or via WhatsApp.
//
// Writes use addRandomSuffix so every save is a NEW object (never a stale-cached
// overwrite of a fixed URL); reads take the newest and prune the rest.

import { put, list, del } from '@vercel/blob'

const PREFIX = 'style/'
const tok = () => process.env.BLOB_READ_WRITE_TOKEN

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
  // Prune older versions so only the newest remains.
  try {
    const stale = (await versions(profileId, t)).filter((b) => b.url !== blob.url)
    if (stale.length) await del(stale.map((b) => b.url), { token: t })
  } catch { /* ignore prune failures */ }
  return data
}
