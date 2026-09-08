// A REFUSAL THAT NAMES THE WRONG CAUSE SENDS SOMEBODY TO DEBUG THE WRONG SYSTEM.
//
// `captionDegraded` is set by TWO different things:
//   (a) the model call actually failed, and the caption is demo boilerplate;
//   (b) the caption broke the listing contract — in which case it is the agent's
//       real styled copy and the caption engine worked perfectly.
//
// All three refusal messages asserted (a). In case (b) they were false, and
// "Re-send the listing once the caption engine is back" is worse than false: it
// is unactionable, because re-sending the same listing reproduces the same
// refusal every time. This is the live repeat of the incident where an agent was
// told "the caption engine failed, retry later" about a correct Chinese rental
// caption.
//
// The true reason was already being computed AND persisted, as
// `captionDegradedReason` on the pending record, and grep showed nothing ever
// read it: not approve.js, not the review-mode reply.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const pending = { putPending: vi.fn(), getPending: vi.fn(), delPending: vi.fn(), claimPending: vi.fn(), releasePending: vi.fn() }
const social = { postToConnected: vi.fn(), connectedAccounts: vi.fn(), defaultProfile: vi.fn() }
const blob = { put: vi.fn(async () => ({ url: 'https://blob.test/c.png' })), list: vi.fn(async () => ({ blobs: [] })), del: vi.fn(async () => {}) }

vi.mock('./pending.js', () => pending)
vi.mock('./social.js', () => social)
vi.mock('./feed.js', () => ({ appendFeed: vi.fn(), readFeed: vi.fn(async () => []) }))
vi.mock('@vercel/blob', () => blob)

const { default: approveHandler } = await import('../approve.js')

const mkRes = () => {
  const r = { statusCode: 0, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.end = (b) => { r.body = typeof b === 'string' ? JSON.parse(b) : b; return r }
  return r
}
const approve = async (body) => {
  const res = mkRes()
  await approveHandler({ method: 'POST', url: '/api/approve', headers: { 'x-ingest-secret': 's3cret' }, body }, res)
  return res
}

beforeEach(() => {
  process.env.INGEST_SECRET = 's3cret'
  vi.clearAllMocks()
  social.defaultProfile.mockReturnValue('')
  social.connectedAccounts.mockResolvedValue(0)
})

describe('the ✅ says which of the two causes it actually was', () => {
  it('a contract breach is NOT reported as the engine having failed', async () => {
    pending.getPending.mockResolvedValue({
      id: 'p_1', profileId: 'p1', caption: 'FOR RENT — Tabuan Jaya\nRM1,800/month\nDeposit 2 months (RM3,600)',
      captionDegraded: true,
      captionDegradedReason: 'caption breaks the listing contract - invented "RM3,600"',
      mediaItems: [{ url: 'https://cdn.test/1.jpg', type: 'image' }],
    })
    const r = await approve({ id: 'p_1', decision: 'approve' })
    expect(r.statusCode).toBe(409)
    expect(r.body.blocked).toBe('captionDegraded')
    // the true cause reaches the human
    expect(r.body.captionDegradedReason).toContain('invented "RM3,600"')
    expect(r.body.error).toContain('invented "RM3,600"')
    // and the two false claims are gone
    expect(r.body.error).not.toMatch(/the AI writer failed/i)
    expect(r.body.error).not.toMatch(/once the caption engine is back/i)
    // it says what WOULD change things
    expect(r.body.error).toMatch(/force:true/)
  })

  it('an actual engine failure still says the engine failed', async () => {
    pending.getPending.mockResolvedValue({
      id: 'p_2', profileId: 'p1', caption: '✨ Property — now available',
      captionDegraded: true, captionDegradedReason: null,
      mediaItems: [{ url: 'https://cdn.test/1.jpg', type: 'image' }],
    })
    const r = await approve({ id: 'p_2', decision: 'approve' })
    expect(r.statusCode).toBe(409)
    expect(r.body.error).toMatch(/the AI writer failed/i)
  })
})
