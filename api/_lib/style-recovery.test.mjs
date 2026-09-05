// A WRITE HERE USED TO BE FINAL.
//
// /api/style has no authentication and cannot be given any today: four of its
// writers are scripts outside this repo that send no credential (the reasoning
// is written out in api/style.js). So the realistic failure is an agent's
// trained voice being replaced — by a stranger who knows their profileId, which
// is not a secret, or by a caller that sent `style` when it meant `examples` —
// and the old prune deleted every earlier version on the way out.
//
// Keeping the previous few versions does not stop the write. It makes the answer
// to "their style is gone" a restore instead of "retrain it from memory".
import { describe, it, expect, beforeEach, vi } from 'vitest'

const blobs = []
const del = vi.fn(async () => {})
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (key, body) => {
    const url = `https://blob.test/${key}-${blobs.length}`
    blobs.unshift({ url, uploadedAt: new Date(Date.now() + blobs.length * 1000).toISOString(), body })
    return { url }
  }),
  list: vi.fn(async () => ({ blobs: [...blobs] })),
  del,
}))

const { saveStyle, saveRule } = await import('./style.js')

beforeEach(() => {
  blobs.length = 0
  del.mockClear()
  process.env.BLOB_READ_WRITE_TOKEN = 'blob-token'
  global.fetch = vi.fn(async (url) => {
    const b = blobs.find((x) => x.url === url)
    return { ok: !!b, json: async () => JSON.parse(b.body) }
  })
})

describe('a style write leaves a way back', () => {
  it('keeps the previous versions instead of deleting them', async () => {
    await saveStyle('p1', { style: 'the real trained voice', examples: ['a'] })
    await saveStyle('p1', { style: 'WIPED' })
    // Two writes, and nothing was deleted — the earlier one is still there.
    expect(del).not.toHaveBeenCalled()
    expect(blobs).toHaveLength(2)
    expect(blobs.some((b) => b.body.includes('the real trained voice'))).toBe(true)
  })

  it('still prunes once the history is deep enough to stop growing', async () => {
    for (let i = 0; i < 5; i++) await saveStyle('p1', { style: `v${i}` })
    expect(del).toHaveBeenCalled()
  })

  it('reads still take the NEWEST version — behaviour is unchanged', async () => {
    const first = await saveStyle('p1', { style: 'first', examples: ['a'] })
    expect(first.style).toBe('first')
    const second = await saveStyle('p1', { style: 'second' })
    expect(second.style).toBe('second')
    // The merge still reads the newest for the fields it was not given.
    expect(second.examples).toEqual(['a'])
  })

  it('does the same for taught rules, including a whole-set replace', async () => {
    await saveRule('p1', { rule: 'always use the first photo' })
    await saveRule('p1', { replace: [] }) // the shape that wipes everything
    expect(del).not.toHaveBeenCalled()
    expect(blobs.some((b) => b.body.includes('always use the first photo'))).toBe(true)
  })
})
