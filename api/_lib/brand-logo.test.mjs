// PER-AGENT CARD BRANDING: a logo, and the choice not to have a card at all.
//
// Until now only the accent colour and a name string were per-agent, so every
// client's price card looked like every other client's. These two are the
// difference between "a tool posted this" and "my agency posted this".
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = new Map()
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (key, body, opts) => {
    const k = opts?.addRandomSuffix ? `${key}-${store.size}` : key
    store.set(k, JSON.parse(body))
    return { url: `https://blob.test/${k}`, pathname: k }
  }),
  // list() matches by PREFIX, the way Blob does — saveBrand writes with
  // addRandomSuffix, so the stored key is never exactly the prefix.
  list: vi.fn(async ({ prefix }) => ({
    blobs: [...store.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ url: `https://blob.test/${k}`, pathname: k })),
  })),
  // saveBrand prunes the previous version after writing the new one. A no-op
  // del left both in place, and getBrand then read whichever came first — which
  // is not a test artefact but exactly how a stale read would look in production.
  del: vi.fn(async (urls) => {
    for (const u of [].concat(urls)) store.delete(String(u).replace('https://blob.test/', ''))
  }),
}))
vi.stubGlobal('fetch', vi.fn(async (url) => {
  const key = String(url).replace('https://blob.test/', '')
  return store.has(key)
    ? { ok: true, json: async () => store.get(key) }
    : { ok: false, json: async () => ({}) }
}))

const { getBrand, saveBrand } = await import('./brand.js')

beforeEach(() => { process.env.BLOB_READ_WRITE_TOKEN = 'tok'; store.clear() })

describe('the agency logo', () => {
  it('is stored per profile and read back', async () => {
    await saveBrand('P1', { logo: 'https://blob.test/logos/trr.png' })
    expect((await getBrand('P1')).logo).toBe('https://blob.test/logos/trr.png')
  })

  it('does not leak to another agent', async () => {
    await saveBrand('P1', { logo: 'https://blob.test/logos/trr.png' })
    expect((await getBrand('P2')).logo).toBe('')
  })

  it('survives a later colour change — one field at a time', async () => {
    await saveBrand('P1', { logo: 'https://blob.test/logos/trr.png' })
    await saveBrand('P1', { color: '#C8102E' })
    const b = await getBrand('P1')
    expect(b.logo).toBe('https://blob.test/logos/trr.png')
    expect(b.color.toLowerCase()).toBe('#c8102e')   // normaliseColor lowercases
  })

  it.each([['a bare word', 'my-logo.png'], ['an http link', 'http://x.test/l.png'], ['a data URI', 'data:image/png;base64,AAA']])(
    'refuses %s with something an agent can act on', async (_n, bad) => {
      // A logo is drawn onto a public image, so it has to BE a public image.
      await expect(saveBrand('P1', { logo: bad })).rejects.toThrow(/send me the logo as a photo/i)
    })

  it('can be cleared', async () => {
    await saveBrand('P1', { logo: 'https://blob.test/logos/trr.png' })
    await saveBrand('P1', { logo: '' })
    expect((await getBrand('P1')).logo).toBe('')
  })
})

describe('turning the price card off', () => {
  it('defaults ON for an agent who never set a brand', async () => {
    // Every existing agent keeps the card they have always had.
    expect((await getBrand('NEVER_SET')).cardEnabled).toBe(true)
  })

  it('stays on until explicitly turned off', async () => {
    await saveBrand('P1', { name: 'TRR' })
    expect((await getBrand('P1')).cardEnabled).toBe(true)
  })

  it('turns off, and back on', async () => {
    await saveBrand('P1', { cardEnabled: false })
    expect((await getBrand('P1')).cardEnabled).toBe(false)
    await saveBrand('P1', { cardEnabled: true })
    expect((await getBrand('P1')).cardEnabled).toBe(true)
  })

  it('a name change does not silently switch it back on', async () => {
    await saveBrand('P1', { cardEnabled: false })
    await saveBrand('P1', { name: 'TRR' })
    expect((await getBrand('P1')).cardEnabled).toBe(false)
  })
})

describe('the card renderer and the ingest path honour both', () => {
  it('the card draws the logo when one is set', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./brandcard.js', import.meta.url), 'utf8'))
    expect(src).toMatch(/const logo = String\(brand\.logo/)
    expect(src).toMatch(/logo \? h\('div'/)          // conditional: no logo, no gap
  })

  it('ingest skips the card entirely when the agent turned it off', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../ingest.js', import.meta.url), 'utf8'))
    expect(src).toMatch(/brand\?\.cardEnabled !== false && body\?\.card !== false/)
  })
})
