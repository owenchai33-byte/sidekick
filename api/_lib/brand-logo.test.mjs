// PER-AGENT CARD BRANDING: a logo, and the choice not to have a card at all.
//
// Until now only the accent colour and a name string were per-agent, so every
// client's price card looked like every other client's. These two are the
// difference between "a tool posted this" and "my agency posted this".
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The blob mock models the three things _lib/brand.js actually depends on:
// addRandomSuffix (every write is a NEW object), PREFIX matching, and — the one
// that was missing — an INCREASING uploadedAt per write.
//
// Without uploadedAt, Date.parse returns NaN, the newest-first comparator
// returns NaN, and the sort is a silent no-op: getBrand read whichever blob the
// store happened to return first. That was invisible while saveBrand pruned
// down to exactly one version, and it is exactly what would break the moment it
// kept three — an agent's colour or logo reverting on a live price card.
// Shape borrowed from api/_lib/identity-fallback.test.mjs.
let store = []
let clock = 0
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (key, body, opts) => {
    const pathname = opts?.addRandomSuffix ? `${key}-${store.length}` : key
    const url = `https://blob.test/${pathname}`
    store.push({ pathname, url, uploadedAt: new Date(++clock * 1000).toISOString(), body })
    return { url, pathname }
  }),
  list: vi.fn(async ({ prefix }) => ({
    // Returned OLDEST-FIRST on purpose: if the reader's sort ever stops working,
    // these tests must fail rather than pass by accident on insertion order.
    blobs: store.filter((b) => b.pathname.startsWith(prefix)).map((b) => ({ ...b })),
  })),
  del: vi.fn(async (urls) => {
    const gone = new Set([].concat(urls))
    store = store.filter((b) => !gone.has(b.url))
  }),
}))
vi.stubGlobal('fetch', vi.fn(async (url) => {
  const b = store.find((x) => x.url === String(url))
  return b ? { ok: true, json: async () => JSON.parse(b.body) } : { ok: false, json: async () => ({}) }
}))

const { getBrand, saveBrand } = await import('./brand.js')

beforeEach(() => { process.env.BLOB_READ_WRITE_TOKEN = 'tok'; store = []; clock = 0 })

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

// ---------------------------------------------------------------------------
// A BRAND WRITE MUST BE RECOVERABLE, AND A BRAND READ MUST BE THE NEWEST ONE.
//
// saveBrand deleted every version but the one it had just written, so a write
// was FINAL. /api/style has no authentication and cannot be given any today
// (api/style.js writes out why), and brand saves go through that same door — so
// a mistyped colour, a cleared logo or a wrongly flipped cardEnabled had no way
// back, and the result is burned onto a price card on a client's public page.
// style.js and rules already kept three versions for exactly this reason; brand
// was left behind with the same exposure.
//
// Keeping versions is only safe if reads reliably take the NEWEST, which is the
// half that was quietly broken: every reader sorted on `new Date(uploadedAt)`,
// that is NaN when the field is absent, and a NaN comparator is treated as 0 —
// so the sort did nothing and blobs[0] won. One version made it invisible.
describe('brand history is kept, and the newest version is what reads', () => {
  const blobsFor = async (profileId) => {
    const { list } = await import('@vercel/blob')
    const { blobs } = await list({ prefix: `brand/${profileId}` })
    return blobs
  }

  it('keeps history instead of exactly one — and as much of it as style keeps', async () => {
    // Asserted as PARITY WITH STYLE rather than a hardcoded number: the
    // requirement is that brand stops being the odd one out, and a literal here
    // would silently drift the day KEEP_VERSIONS changes in one file only.
    const { saveStyle } = await import('./style.js')
    for (const c of ['#111111', '#222222', '#333333', '#444444', '#555555']) await saveBrand('P1', { color: c })
    for (const t of ['a', 'b', 'c', 'd', 'e']) await saveStyle('P1', { style: t })
    const brands = await blobsFor('P1')
    const { list } = await import('@vercel/blob')
    const styles = (await list({ prefix: 'style/P1' })).blobs
    expect(brands.length).toBeGreaterThan(1)          // the whole point: not final
    expect(brands.length).toBe(styles.length)
  })

  it('and the newest is the one that reads back', async () => {
    for (const c of ['#111111', '#222222', '#333333']) await saveBrand('P1', { color: c })
    expect((await getBrand('P1')).color).toBe('#333333')
  })

  it('the previous versions are still there to restore from', async () => {
    await saveBrand('P1', { color: '#C8102E', name: 'TRR', logo: 'https://blob.test/logos/trr.png' })
    await saveBrand('P1', { logo: '' })                        // the accident
    expect((await getBrand('P1')).logo).toBe('')               // honoured…
    // …and the logo is still recoverable from an earlier version. Every
    // surviving blob is read, because list() order is the store's, not ours.
    const all = await Promise.all((await blobsFor('P1')).map(async (b) => (await fetch(b.url)).json()))
    expect(all.some((v) => v.logo === 'https://blob.test/logos/trr.png')).toBe(true)
  })

  it('a newest-wins read survives the store returning versions oldest-first', async () => {
    // The mock returns insertion order deliberately. If the sort regresses to a
    // no-op, this reads '#111111' and fails — which is the production symptom:
    // an agent's colour silently reverting on a live card.
    for (const c of ['#111111', '#222222', '#333333']) await saveBrand('P1', { color: c })
    const raw = await blobsFor('P1')
    expect(raw[0].uploadedAt < raw[raw.length - 1].uploadedAt).toBe(true)
    expect((await getBrand('P1')).color).toBe('#333333')
  })

  it('each field still merges across writes, with three versions live', async () => {
    await saveBrand('P1', { color: '#C8102E' })
    await saveBrand('P1', { name: 'TRR' })
    await saveBrand('P1', { logo: 'https://blob.test/logos/trr.png' })
    const b = await getBrand('P1')
    expect(b.color.toLowerCase()).toBe('#c8102e')
    expect(b.name).toBe('TRR')
    expect(b.logo).toBe('https://blob.test/logos/trr.png')
  })

  it('and one agent\'s history never becomes another\'s', async () => {
    await saveBrand('P1', { color: '#111111' })
    await saveBrand('P2', { color: '#222222' })
    await saveBrand('P1', { color: '#333333' })
    expect((await getBrand('P1')).color).toBe('#333333')
    expect((await getBrand('P2')).color).toBe('#222222')
  })
})

describe('newestFirst: an undated blob cannot win', () => {
  it('sorts by uploadedAt, newest first', async () => {
    const { newestFirst } = await import('./identity.js')
    const out = newestFirst([
      { url: 'a', uploadedAt: '2026-09-01T00:00:00.000Z' },
      { url: 'c', uploadedAt: '2026-09-03T00:00:00.000Z' },
      { url: 'b', uploadedAt: '2026-09-02T00:00:00.000Z' },
    ])
    expect(out.map((b) => b.url)).toEqual(['c', 'b', 'a'])
  })

  it('a blob with no date sorts LAST — a dated one is more trustworthy', async () => {
    const { newestFirst } = await import('./identity.js')
    for (const bad of [undefined, null, '', 'not-a-date']) {
      const out = newestFirst([
        { url: 'undated', uploadedAt: bad },
        { url: 'dated', uploadedAt: '2026-09-01T00:00:00.000Z' },
      ])
      expect(out[0].url, String(bad)).toBe('dated')
    }
  })

  it('all-undated keeps the order the store gave, rather than scrambling', async () => {
    const { newestFirst } = await import('./identity.js')
    const out = newestFirst([{ url: 'x' }, { url: 'y' }, { url: 'z' }])
    expect(out.map((b) => b.url)).toEqual(['x', 'y', 'z'])
  })

  it('does not mutate the caller\'s array, and survives junk', async () => {
    const { newestFirst } = await import('./identity.js')
    const input = [{ url: 'b', uploadedAt: '2026-09-02T00:00:00.000Z' }, { url: 'a', uploadedAt: '2026-09-03T00:00:00.000Z' }]
    newestFirst(input)
    expect(input.map((b) => b.url)).toEqual(['b', 'a'])
    expect(newestFirst([])).toEqual([])
    expect(newestFirst(null)).toEqual([])
  })
})
