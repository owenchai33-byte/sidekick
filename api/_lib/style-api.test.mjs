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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

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
const { resetRateLimits } = await import('./tenant.js')
const get = async (qs) => { const res = mkRes(); await handler(mkReq('GET', `/api/style?${qs}`), res); return res }

// If ./style.js is ever NOT mocked, the real one runs and talks to Vercel Blob,
// which shows up as an unexplained 5-second timeout rather than as a failure
// anyone can read. Make that impossible to mistake: no test here should touch
// the network at all, so any attempt is an immediate, named failure.
beforeEach(() => {
  store.clear()
  vi.clearAllMocks()
  resetRateLimits()
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    throw new Error(`style-api test tried to reach the network (${String(url).slice(0, 60)}) — ./style.js is not mocked`)
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

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

// ─────────────────────────────────────────────────────────────────────────────
// WHO MAY WRITE HERE: still everybody, and that is a decision, not an oversight.
//
// Four of this route's seven writers are not browsers and send no credential,
// and all four live outside this repo (sidekick.mjs setstyle/setbrand,
// rule-sweeper.mjs's 10-minute cron, onboard-agent.sh's style migration). Any
// gate takes one of them away silently — the agent's `setstyle` answers "saved"
// and nothing is written, which is the exact failure this file was created for.
// So the tests below pin the callers open, and the mitigations are the ones that
// cannot refuse anyone: a rate limit far above real volume, and a style history
// deep enough that a wipe is recoverable (see style-recovery.test.mjs).
describe('/api/style: every real writer still gets through', () => {
  it('sidekick.mjs setstyle — plain node fetch, no credential', async () => {
    const res = await post({ profile: 'p1', style: 'short and punchy' })
    expect(res.statusCode).toBe(200)
  })

  it('sidekick.mjs setbrand — plain node fetch, no credential', async () => {
    const res = await post({ profile: 'p1', kind: 'brand', color: '#123456', name: 'TRR' })
    expect(res.statusCode).toBe(200)
  })

  it('sidekick.mjs remember — the one caller that does send the secret', async () => {
    const res = await post({ profile: 'p1', kind: 'rules', rule: 'always use the first photo' })
    expect(res.statusCode).toBe(200)
    expect(res.body.rules).toContain('always use the first photo')
  })

  it('rule-sweeper.mjs — the 10-minute rule-recovery cron, no credential', async () => {
    const res = await post({ profile: 'p1', kind: 'rules', rules: ['a', 'b'] })
    expect(res.statusCode).toBe(200)
  })

  it('onboard-agent.sh — migrating a real trained style, no credential', async () => {
    const res = await post({ profile: 'p2', style: 'migrated', examples: ['one'] })
    expect(res.statusCode).toBe(200)
  })

  it('StylePage.jsx — the browser, which also has no credential', async () => {
    const res = await post({ profile: 'p3', style: 'from the app', examples: ['x'] })
    expect(res.statusCode).toBe(200)
  })

  it('and every reader: getstyle, getbrand, rules, selftest, rule-sweeper', async () => {
    expect((await get('profile=p1')).statusCode).toBe(200)
    expect((await get('profile=p1&kind=brand')).statusCode).toBe(200)
    expect((await get('profile=p1&kind=rules')).statusCode).toBe(200)
  })
})

describe('/api/style: the rate limit is above every real writer', () => {
  it('lets an agent save their style over and over', async () => {
    for (let i = 0; i < 15; i++) {
      expect((await post({ profile: 'p1', style: `v${i}` })).statusCode).toBe(200)
    }
  })

  it('but stops a script walking profileIds', async () => {
    let last
    for (let i = 0; i < 25; i++) last = await post({ profile: `victim-${i}`, style: 'wiped' })
    expect(last.statusCode).toBe(429)
  })

  it('reads are limited far more loosely — the crons poll them', async () => {
    for (let i = 0; i < 100; i++) {
      expect((await get('profile=p1&kind=rules')).statusCode).toBe(200)
    }
  })
})
