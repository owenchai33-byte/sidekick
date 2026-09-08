// RETIRING A PENDING NOBODY CAN REACH.
//
// The ownership check refuses both verbs — publish and discard. Right for
// publish; a trap for discard. Measured on production 2026-09-06: 11 held
// records carried profile ids of agents no longer mapped, so no caller could
// approve them and no caller could skip them. They sit in the feed forever, and
// `status` reads that feed, so every "did it post?" rummages through them. The
// day an agent is offboarded, their held posts become permanent litter.
//
// Retire needs no owner because it cannot do the thing an owner protects
// against: there is no path from it to postToConnected. What it needs instead is
// proof no live work is at stake, and age is that proof.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const pending = { getPending: vi.fn(), delPending: vi.fn(), putPending: vi.fn(), claimPending: vi.fn(), releasePending: vi.fn() }
const social = { postToConnected: vi.fn() }
vi.mock('./pending.js', () => pending)
vi.mock('./social.js', () => social)
vi.mock('./feed.js', () => ({ appendFeed: vi.fn() }))
vi.mock('./postguard.js', () => ({ captionViolations: () => ({ invented: [], missing: [], marketing: [], warnings: [] }) }))

const { default: approve, retireVerdict } = await import('../approve.js')

const DAY = 24 * 60 * 60 * 1000
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString()
const REAL = (msAgo) => ({
  id: 'x1', at: iso(msAgo), caption: '🏡 SEMI-D FOR SALE — RM735,000. 4 bed 3 bath.',
  mediaItems: [{ url: 'https://cdn.test/a.jpg', type: 'image' }],
  profileId: 'A_DEAD_PROFILE', mediaCount: 1,
})

const mkRes = () => {
  const r = { statusCode: 0, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.end = (b) => { r.body = typeof b === 'string' ? JSON.parse(b) : b; return r }
  return r
}
const call = async (body) => {
  const res = mkRes()
  await approve({ method: 'POST', url: '/api/approve', headers: { 'x-ingest-secret': 's3cret' }, body }, res)
  return res
}

beforeEach(() => { process.env.INGEST_SECRET = 's3cret'; vi.clearAllMocks() })

describe('it clears what nothing else can', () => {
  it('retires a 30-day-old record belonging to a profile nobody is mapped to', async () => {
    pending.getPending.mockResolvedValue(REAL(30 * DAY))
    const res = await call({ id: 'x1', decision: 'retire' })
    expect(res.statusCode).toBe(200)
    expect(res.body.retired).toBe(true)
    expect(pending.delPending).toHaveBeenCalledWith('x1')
  })

  it('and the SAME record cannot be skipped, which is why retire exists', async () => {
    pending.getPending.mockResolvedValue(REAL(30 * DAY))
    const res = await call({ id: 'x1', decision: 'skip', profile: 'SOMEONE_ELSE' })
    expect(res.statusCode).toBe(403)
    expect(res.body.blocked).toBe('notYours')
    expect(pending.delPending).not.toHaveBeenCalled()
  })

  it('retires even when the caller CLAIMS a different owner', async () => {
    // The ordering is the point. Retire sits above the ownership gate, because
    // the record that most needs clearing is precisely the one whose owner no
    // longer exists — and a sweep run from any Mac will carry that Mac's claim.
    // Put retire below the gate and this 403s, which is the trap it was written
    // to escape.
    pending.getPending.mockResolvedValue(REAL(30 * DAY))
    const res = await call({ id: 'x1', decision: 'retire', profile: 'SOMEONE_ELSE_ENTIRELY' })
    expect(res.statusCode).toBe(200)
    expect(res.body.retired).toBe(true)
  })

  it('the same claim on the same record still blocks a PUBLISH', async () => {
    // Retire skipping the gate must not weaken it for the verb that matters.
    pending.getPending.mockResolvedValue(REAL(30 * DAY))
    const res = await call({ id: 'x1', decision: 'approve', profile: 'SOMEONE_ELSE_ENTIRELY' })
    expect(res.statusCode).toBe(403)
    expect(social.postToConnected).not.toHaveBeenCalled()
  })

  it('a record with NO MEDIA goes at any age — the real "race" rows', async () => {
    // Both writers require photos, so a held record with none could never have
    // published. On production these had a caption ("race"), no photos and no
    // readable date, so every age rule refused them: unreachable forever.
    pending.getPending.mockResolvedValue({ id: 'x1', at: undefined, caption: 'race', profileId: 'p1' })
    const res = await call({ id: 'x1', decision: 'retire' })
    expect(res.statusCode).toBe(200)
    expect(res.body.reason).toMatch(/never have published/)
  })

  it('but a post WITH photos still has to be old', async () => {
    pending.getPending.mockResolvedValue(REAL(1 * DAY))
    expect((await call({ id: 'x1', decision: 'retire' })).statusCode).toBe(409)
  })
})

describe('it cannot touch live work', () => {
  it.each([[0], [1], [3], [6]])('refuses a %i-day-old post', async (days) => {
    pending.getPending.mockResolvedValue(REAL(days * DAY))
    const res = await call({ id: 'x1', decision: 'retire' })
    expect(res.statusCode).toBe(409)
    expect(res.body.blocked).toBe('tooRecent')
    expect(pending.delPending).not.toHaveBeenCalled()
  })

  it('refuses yesterday\'s RENNA, the one post that must survive the sweep', async () => {
    pending.getPending.mockResolvedValue({
      id: '24d4a759', at: iso(1 * DAY), caption: '🏡 RENNA RESIDENCE – FOR RENT\n\nRM2,500/month',
      mediaItems: [{ url: 'https://cdn.test/a.jpg' }], profileId: '6a90f9f6f59d1531f8d04018',
    })
    expect((await call({ id: '24d4a759', decision: 'retire' })).statusCode).toBe(409)
  })

  it('UNDATED IS NOT OLD — a record whose age cannot be read is refused', async () => {
    // It might have been held a minute ago. Refusing is the direction that
    // cannot destroy live work.
    for (const at of [undefined, null, '', 'not-a-date', {}]) {
      pending.getPending.mockResolvedValue({ ...REAL(30 * DAY), at })   // REAL has photos
      const res = await call({ id: 'x1', decision: 'retire' })
      expect(res.statusCode).toBe(409)
    }
    expect(pending.delPending).not.toHaveBeenCalled()
  })

  it('a future date is not old either', async () => {
    pending.getPending.mockResolvedValue({ ...REAL(0), at: iso(-30 * DAY) })
    expect((await call({ id: 'x1', decision: 'retire' })).statusCode).toBe(409)
  })

  it('CANNOT PUBLISH, whatever else is true', async () => {
    // The reason it is allowed to skip the ownership gate at all.
    pending.getPending.mockResolvedValue(REAL(30 * DAY))
    await call({ id: 'x1', decision: 'retire' })
    expect(social.postToConnected).not.toHaveBeenCalled()
    expect(pending.claimPending).not.toHaveBeenCalled()
  })

  it('force does not lower the age floor', async () => {
    pending.getPending.mockResolvedValue(REAL(1 * DAY))
    expect((await call({ id: 'x1', decision: 'retire', force: true })).statusCode).toBe(409)
  })

  it('still needs the secret', async () => {
    pending.getPending.mockResolvedValue(REAL(30 * DAY))
    const res = mkRes()
    await approve({ method: 'POST', url: '/api/approve', headers: {}, body: { id: 'x1', decision: 'retire' } }, res)
    expect(res.statusCode).toBe(401)
    expect(pending.delPending).not.toHaveBeenCalled()
  })
})

describe('the verdict function on its own', () => {
  it('reads in plain words an agent could be told', () => {
    const v = retireVerdict({ at: iso(2 * DAY), caption: 'x', mediaItems: [{}] })
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/2 day\(s\) old/)
    expect(v.reason).toMatch(/Use skip if you mean to discard it/)
  })

  it('the floor is configurable, and honoured', () => {
    const item = { at: iso(3 * DAY), caption: 'x', mediaItems: [{}] }
    expect(retireVerdict(item, Date.now(), 7 * DAY).ok).toBe(false)
    expect(retireVerdict(item, Date.now(), 1 * DAY).ok).toBe(true)
  })
})
