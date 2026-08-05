// Per-agent caption style ("trained" voice). One small JSON blob per Zernio
// profile: the agent's plain-English rules + a few example captions to mimic.
// Read at caption time; edited from the agent's app link. Best-effort — a
// missing/unreadable style just means the default house voice.

import { put, list } from '@vercel/blob'

const PREFIX = 'style/'
const tok = () => process.env.BLOB_READ_WRITE_TOKEN

export async function getStyle(profileId) {
  const t = tok()
  if (!t || !profileId) return { style: '', examples: [] }
  try {
    const { blobs } = await list({ prefix: `${PREFIX}${profileId}.json`, token: t, limit: 1 })
    if (!blobs[0]) return { style: '', examples: [] }
    const r = await fetch(blobs[0].url, { cache: 'no-store' })
    if (!r.ok) return { style: '', examples: [] }
    const j = await r.json()
    return { style: j.style || '', examples: Array.isArray(j.examples) ? j.examples : [] }
  } catch { return { style: '', examples: [] } }
}

export async function saveStyle(profileId, { style, examples }) {
  const t = tok()
  if (!t) throw new Error('no BLOB token')
  if (!profileId) throw new Error('profile required')
  const data = {
    style: String(style || '').slice(0, 4000),
    examples: (Array.isArray(examples) ? examples : []).map((e) => String(e || '').trim()).filter(Boolean).slice(0, 5).map((e) => e.slice(0, 1500)),
    updatedAt: new Date().toISOString(),
  }
  await put(`${PREFIX}${profileId}.json`, JSON.stringify(data), {
    access: 'public', token: t, contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true,
  })
  return data
}
