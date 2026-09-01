// The degraded-caption gate. AGENTS.md tells the assistant not to publish demo
// boilerplate, but that is an instruction to a model. These tests prove the
// SERVER refuses, so a slip by the assistant cannot reach a client's page.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const pending = { getPending: vi.fn(), delPending: vi.fn(), claimPending: vi.fn(), releasePending: vi.fn() }
const social = { postToConnected: vi.fn() }
vi.mock('./_lib/pending.js', () => pending)
vi.mock('./_lib/social.js', () => social)
vi.mock('./_lib/feed.js', () => ({ appendFeed: vi.fn() }))

const { default: handler } = await import('./approve.js')

const mkRes = () => {
  const r = { statusCode: 0, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.end = (b) => { r.body = typeof b === 'string' ? JSON.parse(b) : b; return r }
  r.status = (c) => { r.statusCode = c; return r }
  r.writeHead = (c) => { r.statusCode = c; return r }
  return r
}
const call = async (body) => {
  const res = mkRes()
  await handler({ method: 'POST', url: '/api/approve', headers: { 'x-ingest-secret': 's3cret' }, body }, res)
  return res
}

beforeEach(() => {
  process.env.INGEST_SECRET = 's3cret'
  vi.clearAllMocks()
  pending.claimPending.mockResolvedValue(true)
  social.postToConnected.mockResolvedValue({ ok: true, platforms: ['facebook'] })
})

describe('approve: degraded caption gate', () => {
  it('REFUSES to publish a caption the AI failed to write', async () => {
    pending.getPending.mockResolvedValue({ caption: 'demo', profileId: 'p1', captionDegraded: true, mediaItems: [] })
    const res = await call({ id: 'abc', decision: 'approve' })
    expect(res.statusCode).toBe(409)
    expect(res.body.blocked).toBe('captionDegraded')
    expect(social.postToConnected).not.toHaveBeenCalled() // nothing reached the socials
  })

  it('publishes normally when the caption is real', async () => {
    pending.getPending.mockResolvedValue({ caption: 'real', profileId: 'p1', captionDegraded: false, mediaItems: [] })
    const res = await call({ id: 'abc', decision: 'approve' })
    expect(res.statusCode).toBe(200)
    expect(social.postToConnected).toHaveBeenCalled()
  })

  it('publishes a degraded caption only when a human passes force:true', async () => {
    pending.getPending.mockResolvedValue({ caption: 'demo', profileId: 'p1', captionDegraded: true, mediaItems: [] })
    const res = await call({ id: 'abc', decision: 'approve', force: true })
    expect(res.statusCode).toBe(200)
    expect(social.postToConnected).toHaveBeenCalled()
  })

  it('still lets a degraded post be SKIPPED', async () => {
    pending.getPending.mockResolvedValue({ caption: 'demo', profileId: 'p1', captionDegraded: true })
    const res = await call({ id: 'abc', decision: 'skip' })
    expect(res.statusCode).toBe(200)
    expect(res.body.skipped).toBe(true)
  })
})
