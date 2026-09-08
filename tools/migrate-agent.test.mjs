// The migration tool, exercised as a REAL SUBPROCESS against a stub of
// /api/style. Not a unit test of its internals — the thing that matters about a
// migration tool is what it does when it is run, so it gets run.
//
// The four properties being proved are the four that make a migration safe to
// point at a paying client's trained settings:
//   1. it VERIFIES by reading back, and reports what it moved
//   2. it is IDEMPOTENT — a second run writes nothing
//   3. it REFUSES a non-empty destination unless told otherwise
//   4. it is REVERSIBLE — --undo restores exactly what was there
// Plus the one that is easy to forget: a source that cannot be READ aborts,
// because an unreadable source is not an empty one.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { rmSync, existsSync, readdirSync } from 'node:fs'

const run = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const TOOL = join(HERE, 'migrate-agent.mjs')
const MIGRATIONS = join(HERE, 'migrations')

const STYLE_970 = 'x'.repeat(970)
const EXAMPLES_2 = ['KOTA SAMARAHAN\nTropics City\nRM1,300 / month\n\nDM me', 'BATU KAWA\nRiveria\nRM498,000\n\nDM me']
const RULES_3 = [
  'Never call a condo an apartment',
  'always use the first photo i send as the cover',
  'from now on always put the area name in CAPS and never use the fire emoji',
]

const OLD = 'oldprofile111'
const NEW = 'newprofile222'
const SECRET = 'test-secret'

// --- a stand-in for /api/style, with the same shapes -------------------------
let db, server, base, breakReadsFor

function emptyDb() {
  return { style: new Map(), rules: new Map(), brand: new Map(), agent: new Map() }
}

const EMPTY_BRAND = { color: '', name: '', region: '', logo: '', cardEnabled: true }

function start() {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      const url = new URL(req.url, 'http://x')
      const send = (code, obj) => {
        res.statusCode = code
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(obj))
      }
      if (!url.pathname.startsWith('/api/style')) return send(404, { error: 'nope' })

      if (req.method === 'GET') {
        const p = url.searchParams.get('profile') || ''
        const kind = url.searchParams.get('kind') || 'style'
        // The degraded case: the store answered, but it could not read. This is
        // the state the tool must refuse to act on.
        if (breakReadsFor && breakReadsFor.profile === p && breakReadsFor.kind === kind) {
          const shell = kind === 'rules' ? { rules: [] } : kind === 'brand' ? { ...EMPTY_BRAND } : { style: '', examples: [] }
          return send(200, { ...shell, found: false, degraded: true, source: 'degraded' })
        }
        if (kind === 'agent') {
          const r = db.agent.get(p)
          return send(200, r || { agentId: p, previousIds: [], postingProfile: {}, exists: false })
        }
        const v = db[kind].get(p)
        const shell = kind === 'rules' ? { rules: [] } : kind === 'brand' ? { ...EMPTY_BRAND } : { style: '', examples: [] }
        return send(200, { ...shell, ...(v || {}), found: !!v, degraded: false, source: v ? 'primary' : 'none' })
      }

      if (req.method === 'POST') {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
          const b = JSON.parse(raw || '{}')
          const p = b.profile
          if (!p) return send(400, { error: 'profile required' })
          if (b.kind === 'agent') {
            if (req.headers['x-ingest-secret'] !== SECRET) return send(401, { error: 'needs secret' })
            const cur = db.agent.get(p) || { agentId: p, previousIds: [], postingProfile: {} }
            const prev = [...cur.previousIds]
            for (const x of b.previousIds || []) if (x && x !== p && !prev.includes(x)) prev.push(x)
            const rec = { agentId: p, previousIds: prev, postingProfile: { ...cur.postingProfile, ...(b.postingProfile || {}) } }
            db.agent.set(p, rec)
            return send(200, rec)
          }
          if (b.kind === 'rules') { db.rules.set(p, { rules: b.rules || [] }); return send(200, db.rules.get(p)) }
          if (b.kind === 'brand') {
            db.brand.set(p, { color: b.color || '', name: b.name || '', region: b.region || '', logo: b.logo || '', cardEnabled: b.cardEnabled !== false })
            return send(200, db.brand.get(p))
          }
          db.style.set(p, { style: b.style ?? '', examples: b.examples ?? [] })
          return send(200, db.style.get(p))
        })
        return
      }
      return send(405, { error: 'no' })
    })
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
  })
}

const tool = (...args) =>
  run('node', [TOOL, '--base', base, ...args], { env: { ...process.env, INGEST_SECRET: SECRET } })
    .then((r) => ({ code: 0, ...r }))
    .catch((e) => ({ code: e.code ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' }))

function seedSource() {
  db.style.set(OLD, { style: STYLE_970, examples: EXAMPLES_2 })
  db.rules.set(OLD, { rules: RULES_3 })
  db.brand.set(OLD, { color: '#c8102e', name: 'TRR', region: 'Kuching, Sarawak', logo: 'https://blob.test/l.png', cardEnabled: true })
}

function journals() {
  return existsSync(MIGRATIONS) ? readdirSync(MIGRATIONS).filter((f) => f.endsWith('.json')) : []
}

beforeEach(async () => {
  db = emptyDb()
  breakReadsFor = null
  rmSync(MIGRATIONS, { recursive: true, force: true })
  base = await start()
})
afterEach(async () => {
  await new Promise((r) => server.close(r))
  rmSync(MIGRATIONS, { recursive: true, force: true })
})

// -----------------------------------------------------------------------------

describe('--copy moves everything, and proves it', () => {
  it('copies style, rules AND brand — not just the style', async () => {
    // onboard-agent.sh carries the style and silently drops the rules and the
    // brand. That is the gap this tool closes, so it is the first thing checked.
    seedSource()
    const r = await tool('--from', OLD, '--to', NEW, '--copy')
    expect(r.code).toBe(0)

    expect(db.style.get(NEW)).toEqual({ style: STYLE_970, examples: EXAMPLES_2 })
    expect(db.rules.get(NEW).rules).toEqual(RULES_3)
    expect(db.brand.get(NEW).color).toBe('#c8102e')
    expect(db.brand.get(NEW).name).toBe('TRR')
  })

  it('prints exactly what it moved, and says the source is untouched', async () => {
    seedSource()
    const r = await tool('--from', OLD, '--to', NEW, '--copy')
    expect(r.stdout).toMatch(/MOVED/)
    expect(r.stdout).toMatch(/970 chars, 2 example\(s\)/)
    expect(r.stdout).toMatch(/3 rule\(s\)/)
    expect(r.stdout).toMatch(/colour #c8102e/)
    expect(r.stdout).toMatch(/VERIFIED/)
    expect(r.stdout).toMatch(new RegExp(`source ${OLD} is UNCHANGED`))
  })

  it('never touches the source', async () => {
    seedSource()
    await tool('--from', OLD, '--to', NEW, '--copy')
    expect(db.style.get(OLD)).toEqual({ style: STYLE_970, examples: EXAMPLES_2 })
    expect(db.rules.get(OLD).rules).toEqual(RULES_3)
  })

  it('VERIFIES by reading back — a write that does not stick is reported FAILED', async () => {
    // The stub drops style writes on the floor while still answering 200. A tool
    // that trusts the status code would call this a successful migration.
    seedSource()
    const realSet = db.style.set.bind(db.style)
    db.style.set = (k, v) => (k === NEW ? db.style : realSet(k, v))
    const r = await tool('--from', OLD, '--to', NEW, '--copy')
    expect(r.code).toBe(1)
    expect(r.stdout).toMatch(/style\s+FAILED/)
    expect(r.stderr).toMatch(/DO NOT treat this migration as done/)
  })

  it('is idempotent — a second run writes nothing', async () => {
    seedSource()
    await tool('--from', OLD, '--to', NEW, '--copy')
    const before = journals().length
    const r = await tool('--from', OLD, '--to', NEW, '--copy')
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/already migrated|ALREADY/i)
    // No second journal, because nothing was written.
    expect(journals().length).toBe(before)
  })

  it('--dry-run writes nothing at all', async () => {
    seedSource()
    const r = await tool('--from', OLD, '--to', NEW, '--copy', '--dry-run')
    expect(r.code).toBe(0)
    expect(db.style.has(NEW)).toBe(false)
    expect(journals()).toHaveLength(0)
  })
})

describe('it refuses to destroy something', () => {
  it('will not overwrite a non-empty destination without --force', async () => {
    seedSource()
    db.style.set(NEW, { style: 'a DIFFERENT agent already trained this', examples: [] })
    const r = await tool('--from', OLD, '--to', NEW, '--copy')
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/REFUSED/)
    expect(r.stderr).toMatch(/Nothing was written/)
    // and it really did not write — including the kinds that WOULD have been fine.
    expect(db.style.get(NEW).style).toBe('a DIFFERENT agent already trained this')
    expect(db.rules.has(NEW)).toBe(false)
  })

  it('--force overwrites, but only when asked in those words', async () => {
    seedSource()
    db.style.set(NEW, { style: 'stale', examples: [] })
    const r = await tool('--from', OLD, '--to', NEW, '--copy', '--force')
    expect(r.code).toBe(0)
    expect(db.style.get(NEW).style).toBe(STYLE_970)
  })

  it('ABORTS when the SOURCE cannot be read — degraded is not empty', async () => {
    // The catastrophic accident: the store hiccups, the source reads as '', and
    // the tool faithfully copies nothing over a trained destination.
    seedSource()
    breakReadsFor = { profile: OLD, kind: 'style' }
    const r = await tool('--from', OLD, '--to', NEW, '--copy')
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/could not be READ/)
    expect(db.style.has(NEW)).toBe(false)
    expect(db.rules.has(NEW)).toBe(false)
  })

  it('ABORTS rather than writing blind when the DESTINATION cannot be read', async () => {
    seedSource()
    breakReadsFor = { profile: NEW, kind: 'brand' }
    const r = await tool('--from', OLD, '--to', NEW, '--copy')
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/Refusing to write blind/)
  })
})

describe('it is reversible', () => {
  it('--undo restores the destination exactly, and leaves the source alone', async () => {
    seedSource()
    db.style.set(NEW, { style: 'what was there before', examples: ['prior'] })
    await tool('--from', OLD, '--to', NEW, '--copy', '--force')
    expect(db.style.get(NEW).style).toBe(STYLE_970)

    const j = journals()
    expect(j).toHaveLength(1)
    const r = await tool('--undo', join(MIGRATIONS, j[0]))
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/RESTORED/)
    expect(db.style.get(NEW)).toEqual({ style: 'what was there before', examples: ['prior'] })
    // The source was never part of the migration and is not part of the undo.
    expect(db.style.get(OLD).style).toBe(STYLE_970)
  })

  it('journals the destination\'s prior state BEFORE writing', async () => {
    seedSource()
    db.rules.set(NEW, { rules: ['an older rule'] })
    await tool('--from', OLD, '--to', NEW, '--copy', '--force')
    const j = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(join(MIGRATIONS, journals()[0]), 'utf8')))
    expect(j.priorAtDestination.rules).toEqual({ rules: ['an older rule'] })
    expect(j.copiedFromSource.rules).toEqual({ rules: RULES_3 })
    expect(j.from).toBe(OLD)
    expect(j.to).toBe(NEW)
  })
})

describe('--link, the mode that moves nothing', () => {
  it('records the old id and verifies the settings read through', async () => {
    seedSource()
    // The stub serves the fallback the way the real app does: once NEW knows
    // about OLD, reads for NEW return OLD's data.
    const realGet = db.style.get.bind(db.style)
    db.style.get = (k) => realGet(k) ?? (db.agent.get(k)?.previousIds?.includes(OLD) ? realGet(OLD) : undefined)
    const realRules = db.rules.get.bind(db.rules)
    db.rules.get = (k) => realRules(k) ?? (db.agent.get(k)?.previousIds?.includes(OLD) ? realRules(OLD) : undefined)
    const realBrand = db.brand.get.bind(db.brand)
    db.brand.get = (k) => realBrand(k) ?? (db.agent.get(k)?.previousIds?.includes(OLD) ? realBrand(OLD) : undefined)

    const r = await tool('--from', OLD, '--to', NEW, '--link')
    expect(r.code).toBe(0)
    expect(db.agent.get(NEW).previousIds).toEqual([OLD])
    expect(r.stdout).toMatch(/registry write\s+VERIFIED/)
    expect(r.stdout).toMatch(/style\s+VERIFIED/)
    expect(r.stdout).toMatch(/rules\s+VERIFIED/)
    // Nothing was copied.
    expect(db.style.has(NEW)).toBe(false)
  })

  it('refuses without a secret rather than writing an unauthenticated registry', async () => {
    seedSource()
    const r = await run('node', [TOOL, '--base', base, '--from', OLD, '--to', NEW, '--link'],
      { env: { ...process.env, INGEST_SECRET: '', HOME: '/nonexistent' } }).catch((e) => ({ code: e.code, stderr: e.stderr }))
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/INGEST_SECRET/)
  })
})

describe('--show tells you the truth about an agent', () => {
  it('reports what is stored and where it came from', async () => {
    seedSource()
    const r = await tool('--show', OLD)
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/970 chars, 2 example\(s\)/)
    expect(r.stdout).toMatch(/3 rule\(s\)/)
    expect(r.stdout).toMatch(/resolves to itself/)
  })

  it('calls an unreadable setting UNREADABLE, never "empty"', async () => {
    seedSource()
    breakReadsFor = { profile: OLD, kind: 'style' }
    const r = await tool('--show', OLD)
    expect(r.stdout).toMatch(/UNREADABLE/)
    expect(r.stdout).not.toMatch(/style\s+empty/)
  })

  it('counts characters the way curl does, so it cannot contradict the runbook', async () => {
    // Measured against the live app 2026-09-08: the trained style is 970 by
    // `curl | python3 len()` and 983 by JavaScript's `.length`, because it is
    // full of emoji and .length counts each non-BMP emoji as two UTF-16 units.
    // Reporting 983 beside a runbook that says 970 is how somebody concludes
    // the style has been corrupted and goes hunting a problem that is not there.
    db.style.set(OLD, { style: 'a'.repeat(960) + '🏡'.repeat(10), examples: [] })
    const r = await tool('--show', OLD)
    expect(r.stdout).toMatch(/970 chars/)
    expect(r.stdout).not.toMatch(/980 chars/)
  })

  it('does not claim a registry entry exists on a deployment that has no such endpoint', async () => {
    // Caught against production before this shipped: ?kind=agent fell through to
    // getStyle on the old build and answered with a style object, and a check of
    // `exists === false` read that as "yes, there is a record". A migration tool
    // that misreports the state of the thing being migrated is worse than none.
    seedSource()
    const realGet = db.agent.get.bind(db.agent)
    db.agent.get = (k) => realGet(k) ?? undefined
    // Make the stub behave like the OLD deployment: kind=agent returns a style.
    const prevHandler = server.listeners('request')[0]
    server.removeAllListeners('request')
    server.on('request', (req, res) => {
      const u = new URL(req.url, 'http://x')
      if (req.method === 'GET' && u.searchParams.get('kind') === 'agent') {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        return res.end(JSON.stringify({ style: 'a style, not a record', examples: [] }))
      }
      return prevHandler(req, res)
    })

    const r = await tool('--show', OLD)
    expect(r.stdout).toMatch(/NOT SUPPORTED by this deployment/)
    expect(r.stdout).not.toMatch(/record\s+yes/)
  })
})
