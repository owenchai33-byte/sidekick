// Per-agent training, tested THROUGH THE HTTP HANDLER.
//
// saveRule() had unit tests and they passed. The route to it did not exist: the
// rules branch sat inside the `kind === 'brand'` block, after that block's
// return, so it was both unreachable and gated on a kind it could never see.
// Every `remember` fell through to saveStyle, which ignores `rule` and answers
// with the style object, and the CLI read `.rules` off that as an empty list -
// so every agent who taught the system anything was told "got it" while nothing
// was written. Nine months of unit tests could not have caught it.
//
// So these tests call the ENDPOINT, and assert on what comes back out.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const store = new Map()
vi.mock('./style.js', () => ({
  getStyle: vi.fn(async (p) => store.get(`s:${p}`) || { style: '', examples: [] }),
  saveStyle: vi.fn(async (p, v) => { store.set(`s:${p}`, { style: v.style || '', examples: v.examples || [] }); return store.get(`s:${p}`) }),
  getBrand: vi.fn(async (p) => store.get(`b:${p}`) || { color: null, name: null }),
  saveBrand: vi.fn(async (p, v) => { store.set(`b:${p}`, { color: v.color, name: v.name }); return store.get(`b:${p}`) }),
  getRules: vi.fn(async (p) => ({ rules: store.get(`r:${p}`) || [] })),
  saveRule: vi.fn(async (p, { rule, replace }) => {
    if (!p) throw new Error('profile required')
    const cur = store.get(`r:${p}`) || []
    const next = Array.isArray(replace) ? replace : (cur.includes(rule) ? cur : [...cur, rule])
    store.set(`r:${p}`, next)
    return { rules: next }
  }),
}))

const { default: handler } = await import('../style.js')

const mkRes = () => {
  const r = { statusCode: 200, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.end = (b) => { r.body = typeof b === 'string' ? JSON.parse(b) : b; return r }
  r.status = (c) => { r.statusCode = c; return r }
  r.writeHead = (c) => { r.statusCode = c; return r }
  return r
}
// style.js reads the raw request stream rather than a pre-parsed req.body, so
// the fake request has to emit 'data'/'end' like a real one.
const mkReq = (method, url, body) => ({
  method, url, headers: { 'content-type': 'application/json' },
  on(ev, cb) {
    if (ev === 'data' && body !== undefined) cb(JSON.stringify(body))
    if (ev === 'end') cb()
    return this
  },
})
const post = async (body) => { const res = mkRes(); await handler(mkReq('POST', '/api/style', body), res); return res }
const get = async (qs) => { const res = mkRes(); await handler(mkReq('GET', `/api/style?${qs}`), res); return res }

beforeEach(() => { store.clear(); vi.clearAllMocks() })

describe('POST kind=rules actually reaches saveRule', () => {
  it('returns the saved rule, not the style object', async () => {
    const res = await post({ profile: 'a1', kind: 'rules', rule: 'Never use emoji in captions' })
    // The exact shape the CLI checks before it tells an agent "got it".
    expect(Array.isArray(res.body?.rules)).toBe(true)
    expect(res.body.rules).toContain('Never use emoji in captions')
    expect(res.body).not.toHaveProperty('style')
  })

  it('accumulates rules instead of replacing them', async () => {
    await post({ profile: 'a1', kind: 'rules', rule: 'No hashtags on Facebook' })
    const res = await post({ profile: 'a1', kind: 'rules', rule: 'Put the price in the first two lines' })
    expect(res.body.rules).toEqual(['No hashtags on Facebook', 'Put the price in the first two lines'])
  })

  it('reads back what was taught', async () => {
    await post({ profile: 'a1', kind: 'rules', rule: 'Always use the first photo as the cover' })
    const res = await get('profile=a1&kind=rules')
    expect(res.body.rules).toEqual(['Always use the first photo as the cover'])
  })

  it('keeps one agent’s rules away from another’s', async () => {
    await post({ profile: 'a1', kind: 'rules', rule: 'No emoji' })
    await post({ profile: 'a2', kind: 'rules', rule: 'Chinese captions only' })
    expect((await get('profile=a1&kind=rules')).body.rules).toEqual(['No emoji'])
    expect((await get('profile=a2&kind=rules')).body.rules).toEqual(['Chinese captions only'])
  })
})

describe('the sibling branches still work', () => {
  it('brand still saves', async () => {
    const res = await post({ profile: 'a1', kind: 'brand', color: '#123456', name: 'TRR' })
    expect(res.body).toMatchObject({ color: '#123456', name: 'TRR' })
  })

  it('a plain style write does not wipe the rules', async () => {
    await post({ profile: 'a1', kind: 'rules', rule: 'No emoji' })
    await post({ profile: 'a1', style: 'House format: price first.' })
    expect((await get('profile=a1&kind=rules')).body.rules).toEqual(['No emoji'])
  })

  it('a rules write does not wipe the style', async () => {
    await post({ profile: 'a1', style: 'House format: price first.' })
    await post({ profile: 'a1', kind: 'rules', rule: 'No emoji' })
    expect((await get('profile=a1')).body.style).toBe('House format: price first.')
  })
})
