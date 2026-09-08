#!/usr/bin/env node
// Move (or, better, RE-POINT) one agent's trained settings between profile ids.
//
// WHY THIS EXISTS. style/<id>, rules/<id> and brand/<id> are keyed by the
// posting provider's profile id. Change provider and every one of them is
// orphaned at once, silently — the reads degrade to empty and the next caption
// comes out in the default format on a client's public page. Before this file
// the only automation that carried anything across a re-key was
// onboard-agent.sh, which carries the STYLE and drops the RULES and the BRAND.
//
// TWO MODES, and the first is the one to reach for:
//
//   --link    Record the old id as a PREVIOUS id of the agent. Nothing is
//             copied and nothing moves; the read-through fallback in
//             _lib/identity.js serves the old blobs under the new name. This is
//             instant, has nothing to verify, and is undone by deleting one
//             field. It needs INGEST_SECRET.
//
//   --copy    Actually duplicate style, rules and brand onto the new id. Use it
//             when you want the data to physically live under the new key.
//             THE SOURCE IS NEVER TOUCHED, NEVER DELETED — a copy, not a move,
//             so "undo" is always available by simply reading the old key again.
//
// SAFETY RULES THIS TOOL WILL NOT BREAK:
//   * A source that reads DEGRADED aborts everything. An unreadable source is
//     not an empty one, and copying "" over a trained destination is the
//     accident this whole exercise exists to prevent.
//   * A NON-EMPTY destination is refused unless --force. Overwriting somebody's
//     trained voice is not a thing that should happen by typo.
//   * Every write is journalled with the destination's PRIOR contents first, so
//     --undo <journal> puts it back exactly.
//   * Every write is READ BACK and compared field by field. The tool reports
//     VERIFIED or FAILED per kind and exits non-zero on any failure — it never
//     says "migrated" on the strength of an HTTP 200.
//   * Idempotent: a kind already identical at the destination is reported
//     "already there" and skipped, so re-running is free and safe.
//
// USAGE
//   node tools/migrate-agent.mjs --from <oldId> --to <newId> --link
//   node tools/migrate-agent.mjs --from <oldId> --to <newId> --copy [--force]
//   node tools/migrate-agent.mjs --from <oldId> --to <newId> --copy --dry-run
//   node tools/migrate-agent.mjs --undo tools/migrations/<file>.json
//   node tools/migrate-agent.mjs --show <agentId>
//
//   --base <url>   defaults to $SIDEKICK_BASE or the live app
//   --kinds        comma list of style,rules,brand (default: all three)

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_BASE = 'https://sidekick-demopromax.vercel.app'
const ALL_KINDS = ['style', 'rules', 'brand']

// --- args --------------------------------------------------------------------
function parseArgs(argv) {
  const a = { kinds: ALL_KINDS }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    const next = () => argv[++i]
    if (k === '--from') a.from = next()
    else if (k === '--to') a.to = next()
    else if (k === '--base') a.base = next()
    else if (k === '--kinds') a.kinds = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (k === '--undo') a.undo = next()
    else if (k === '--show') a.show = next()
    else if (k === '--link') a.link = true
    else if (k === '--copy') a.copy = true
    else if (k === '--force') a.force = true
    else if (k === '--dry-run' || k === '--dry') a.dry = true
    else if (k === '--secret') a.secret = next()
    else if (k === '-h' || k === '--help') a.help = true
  }
  return a
}

// INGEST_SECRET is only needed for --link (the agent registry is the one write
// on /api/style that is gated). Read it the same way the other tools do.
function ingestSecret(explicit) {
  if (explicit) return explicit
  if (process.env.INGEST_SECRET) return process.env.INGEST_SECRET
  for (const p of [join(HERE, '.env'), join(process.env.HOME || '', '.openclaw/workspace-sidekick/tools/.env')]) {
    try {
      const m = /^\s*INGEST_SECRET\s*=\s*(.+?)\s*$/m.exec(readFileSync(p, 'utf8'))
      if (m) return m[1].replace(/^["']|["']$/g, '')
    } catch { /* not there */ }
  }
  return ''
}

// --- the shapes, normalised so a comparison means something ------------------
//
// getStyle/getRules/getBrand now also return found/degraded/source. Those are
// metadata ABOUT the read, not part of the setting, so they are stripped before
// anything is compared or written.
// Character counts are reported in CODE POINTS, not JS string length.
//
// Measured against the live app 2026-09-08: Owen's trained style is 970 by
// `curl | python3 len()` and 983 by JavaScript's `.length`. Both are correct —
// the style is full of emoji, and `.length` counts each non-BMP emoji as two
// UTF-16 code units. Reporting 983 next to a runbook that says 970 is how
// somebody concludes the style has been corrupted and goes looking for a
// problem that is not there. So this counts the way curl does.
const charCount = (s) => [...String(s || '')].length

const shape = {
  style: {
    get: (d) => ({ style: d.style || '', examples: Array.isArray(d.examples) ? d.examples : [] }),
    empty: (v) => !v.style && !v.examples.length,
    body: (v) => ({ style: v.style, examples: v.examples }),
    describe: (v) => `${charCount(v.style)} chars, ${v.examples.length} example(s)`,
  },
  rules: {
    get: (d) => ({ rules: Array.isArray(d.rules) ? d.rules : [] }),
    empty: (v) => !v.rules.length,
    body: (v) => ({ kind: 'rules', rules: v.rules }),
    describe: (v) => `${v.rules.length} rule(s)`,
  },
  brand: {
    get: (d) => ({
      color: d.color || '', name: d.name || '', region: d.region || '',
      logo: d.logo || '', cardEnabled: d.cardEnabled !== false,
    }),
    empty: (v) => !v.color && !v.name && !v.region && !v.logo && v.cardEnabled === true,
    body: (v) => ({ kind: 'brand', color: v.color, name: v.name, region: v.region, logo: v.logo, cardEnabled: v.cardEnabled }),
    describe: (v) => [v.color && `colour ${v.color}`, v.name && `name "${v.name}"`, v.region && `region "${v.region}"`,
      v.logo && 'a logo', v.cardEnabled ? 'card on' : 'card OFF'].filter(Boolean).join(', ') || 'nothing',
  },
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// --- api ---------------------------------------------------------------------
async function readKind(base, id, kind) {
  const q = kind === 'style' ? '' : `&kind=${kind}`
  const r = await fetch(`${base}/api/style?profile=${encodeURIComponent(id)}${q}`)
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`GET ${kind} for ${id}: ${r.status} ${JSON.stringify(d).slice(0, 200)}`)
  // `degraded` means the STORE failed. Never treat it as empty.
  return { value: shape[kind].get(d), degraded: !!d.degraded, source: d.source || 'unknown' }
}

async function writeKind(base, id, kind, value, secret) {
  const r = await fetch(`${base}/api/style`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-ingest-secret': secret } : {}) },
    body: JSON.stringify({ profile: id, ...shape[kind].body(value) }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`POST ${kind} to ${id}: ${r.status} ${JSON.stringify(d).slice(0, 200)}`)
  return d
}

async function readAgent(base, id) {
  const r = await fetch(`${base}/api/style?profile=${encodeURIComponent(id)}&kind=agent`)
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`GET agent ${id}: ${r.status}`)
  return d
}

// --- modes -------------------------------------------------------------------

async function doShow(base, id) {
  console.log(`\nAGENT ${id}   (${base})\n`)
  const rec = await readAgent(base, id)
  // A record is only a record if it LOOKS like one.
  //
  // On a build that predates the kind=agent branch, ?kind=agent falls through to
  // getStyle and answers with a style object — and a check of `rec.exists ===
  // false` read that as "yes, there is a record". Measured against production on
  // 2026-09-08, before this was deployed: all three agents were reported as
  // having a registry entry when the endpoint did not exist yet. A migration
  // tool that misreports the state of the thing being migrated is worse than no
  // tool, so it now identifies a record positively rather than by absence.
  const hasRecord = !!rec && typeof rec.agentId === 'string' && rec.exists !== false
  if (!hasRecord && rec && rec.agentId === undefined && (rec.style !== undefined || rec.rules !== undefined)) {
    console.log('  record          NOT SUPPORTED by this deployment — /api/style?kind=agent')
    console.log('                  answered with a style object, so the identity layer is not live yet.')
  } else {
    console.log(`  record          ${hasRecord ? 'yes' : 'none — this agent resolves to itself'}`)
  }
  if (hasRecord) {
    console.log(`  previousIds     ${(rec.previousIds || []).join(', ') || '(none)'}`)
    console.log(`  postingProfile  ${JSON.stringify(rec.postingProfile || {})}`)
  }
  for (const kind of ALL_KINDS) {
    const { value, degraded, source } = await readKind(base, id, kind)
    const state = degraded ? 'UNREADABLE (store failed)' : shape[kind].empty(value) ? 'empty' : shape[kind].describe(value)
    console.log(`  ${kind.padEnd(15)} ${state}${source && source !== 'primary' ? `   [source: ${source}]` : ''}`)
  }
  console.log('')
}

async function doLink({ base, from, to, secret, dry }) {
  if (!secret) {
    console.error('--link writes the agent registry, which needs INGEST_SECRET.')
    console.error('Set INGEST_SECRET, or pass --secret <value>.')
    process.exit(2)
  }
  console.log(`\nLINK  ${to}  ->  remembers  ${from}\n`)
  console.log('Nothing is copied. The read-through fallback serves the old blobs')
  console.log('under the new name, and the old blobs are never touched.\n')

  // Say what is actually at stake before writing anything.
  for (const kind of ALL_KINDS) {
    const src = await readKind(base, from, kind)
    console.log(`  ${kind.padEnd(8)} at ${from}: ${src.degraded ? 'UNREADABLE' : shape[kind].empty(src.value) ? 'empty' : shape[kind].describe(src.value)}`)
  }
  if (dry) { console.log('\n--dry-run: nothing written.\n'); return 0 }

  const r = await fetch(`${base}/api/style`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ingest-secret': secret },
    body: JSON.stringify({ profile: to, kind: 'agent', previousIds: [from] }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) { console.error(`\nFAILED: ${r.status} ${JSON.stringify(d)}`); return 1 }

  // VERIFY by reading back, through the same path a caption will use.
  const rec = await readAgent(base, to)
  const linked = (rec.previousIds || []).includes(from)
  console.log(`\n  registry write  ${linked ? 'VERIFIED' : 'FAILED — previousIds does not contain the old id'}`)
  if (!linked) return 1

  let bad = 0
  for (const kind of ALL_KINDS) {
    const dst = await readKind(base, to, kind)
    const src = await readKind(base, from, kind)
    if (src.degraded) { console.log(`  ${kind.padEnd(8)} source unreadable — cannot verify`); bad++; continue }
    if (shape[kind].empty(src.value)) { console.log(`  ${kind.padEnd(8)} nothing to serve (source empty)`); continue }
    const ok = same(dst.value, src.value)
    console.log(`  ${kind.padEnd(8)} ${ok ? 'VERIFIED' : 'FAILED'} — reads back as ${shape[kind].describe(dst.value)} [${dst.source}]`)
    if (!ok) bad++
  }
  console.log(bad ? '\nSOMETHING IS WRONG — do not proceed.\n' : '\nDone. To undo: rewrite the record with previousIds omitted.\n')
  return bad ? 1 : 0
}

async function doCopy({ base, from, to, kinds, force, dry, secret }) {
  console.log(`\nCOPY  ${from}  ->  ${to}     (${base})`)
  console.log('The source is only ever READ. Nothing is deleted.\n')

  // 1. Read the source, and refuse outright if it cannot be read.
  const src = {}
  for (const kind of kinds) {
    const r = await readKind(base, from, kind)
    if (r.degraded) {
      console.error(`ABORT: ${kind} at ${from} could not be READ (the store failed).`)
      console.error('An unreadable source is not an empty one. Copying "" over the')
      console.error('destination is exactly the loss this tool exists to prevent.')
      return 2
    }
    src[kind] = r.value
  }

  // 2. Read the destination and decide, per kind, what happens.
  const plan = []
  for (const kind of kinds) {
    const d = await readKind(base, to, kind)
    if (d.degraded) {
      console.error(`ABORT: ${kind} at ${to} could not be READ. Refusing to write blind.`)
      return 2
    }
    if (shape[kind].empty(src[kind])) plan.push({ kind, action: 'skip', why: 'source is empty — nothing to copy', prior: d.value })
    else if (same(d.value, src[kind])) plan.push({ kind, action: 'already', why: 'destination is already identical', prior: d.value })
    else if (!shape[kind].empty(d.value) && !force) plan.push({ kind, action: 'refuse', why: `destination already has ${shape[kind].describe(d.value)} — pass --force to overwrite`, prior: d.value })
    else plan.push({ kind, action: 'write', why: shape[kind].empty(d.value) ? 'destination is empty' : 'OVERWRITING (--force)', prior: d.value })
  }

  console.log('PLAN')
  for (const p of plan) console.log(`  ${p.kind.padEnd(8)} ${p.action.toUpperCase().padEnd(8)} ${p.why}`)
  for (const p of plan) if (p.action === 'write') console.log(`\n  ${p.kind}: will write ${shape[p.kind].describe(src[p.kind])}`)

  const refused = plan.filter((p) => p.action === 'refuse')
  if (refused.length) {
    console.error(`\nREFUSED: ${refused.map((p) => p.kind).join(', ')} would overwrite real settings.`)
    console.error('Nothing was written. Re-run with --force only if that is what you mean.\n')
    return 1
  }
  const writes = plan.filter((p) => p.action === 'write')
  if (!writes.length) { console.log('\nNothing to do — already migrated.\n'); return 0 }
  if (dry) { console.log('\n--dry-run: nothing written.\n'); return 0 }

  // 3. Journal the destination's PRIOR state BEFORE touching it. This is undo.
  const dir = join(HERE, 'migrations')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const journalPath = join(dir, `${from}__to__${to}__${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(journalPath, JSON.stringify({
    base, from, to, at: new Date().toISOString(),
    kinds: writes.map((w) => w.kind),
    priorAtDestination: Object.fromEntries(writes.map((w) => [w.kind, w.prior])),
    copiedFromSource: Object.fromEntries(writes.map((w) => [w.kind, src[w.kind]])),
  }, null, 2))
  console.log(`\njournal  ${journalPath}`)

  // 4. Write, then READ BACK and compare. A 200 is not proof.
  let failed = 0
  const moved = []
  for (const w of writes) {
    await writeKind(base, to, w.kind, src[w.kind], secret)
    const back = await readKind(base, to, w.kind)
    const ok = !back.degraded && same(back.value, src[w.kind])
    console.log(`  ${w.kind.padEnd(8)} ${ok ? 'VERIFIED' : 'FAILED'}  ${shape[w.kind].describe(back.value)}`)
    if (ok) moved.push(`${w.kind}: ${shape[w.kind].describe(src[w.kind])}`)
    else failed++
  }

  console.log('\nMOVED')
  for (const m of moved) console.log(`  ${m}`)
  console.log(`\nThe source ${from} is UNCHANGED and still readable.`)
  console.log(`To undo the destination: node tools/migrate-agent.mjs --undo ${journalPath}\n`)
  if (failed) console.error(`${failed} kind(s) did not verify. DO NOT treat this migration as done.\n`)
  return failed ? 1 : 0
}

async function doUndo(path, secret) {
  const j = JSON.parse(readFileSync(path, 'utf8'))
  console.log(`\nUNDO  ${path}`)
  console.log(`Restoring ${j.to} to what it held before ${j.at}.`)
  console.log(`(${j.from} was never modified and is not touched here.)\n`)
  let failed = 0
  for (const kind of j.kinds) {
    const prior = j.priorAtDestination[kind]
    await writeKind(j.base, j.to, kind, prior, secret)
    const back = await readKind(j.base, j.to, kind)
    const ok = !back.degraded && same(back.value, prior)
    console.log(`  ${kind.padEnd(8)} ${ok ? 'RESTORED' : 'FAILED'}  ${shape[kind].describe(back.value)}`)
    if (!ok) failed++
  }
  console.log('')
  return failed ? 1 : 0
}

// --- main --------------------------------------------------------------------
const a = parseArgs(process.argv.slice(2))
const base = (a.base || process.env.SIDEKICK_BASE || DEFAULT_BASE).replace(/\/+$/, '')
const secret = ingestSecret(a.secret)

if (a.help || (!a.undo && !a.show && !(a.from && a.to))) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')
    .filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(a.help ? 0 : 2)
}

let code = 0
try {
  if (a.show) code = (await doShow(base, a.show)) || 0
  else if (a.undo) code = await doUndo(a.undo, secret)
  else if (a.link) code = await doLink({ base, from: a.from, to: a.to, secret, dry: a.dry })
  else if (a.copy) code = await doCopy({ base, from: a.from, to: a.to, kinds: a.kinds, force: a.force, dry: a.dry, secret })
  else {
    console.error('Say which: --link (re-point, nothing copied) or --copy (duplicate the blobs).')
    console.error('--link is the safer one and is what the runbook uses.')
    code = 2
  }
} catch (e) {
  console.error(`\nFAILED: ${e?.message || e}\n`)
  code = 1
}
process.exit(code)
