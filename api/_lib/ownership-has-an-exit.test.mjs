// A HELD POST NOBODY CAN APPROVE, SKIP *OR* RETIRE IS LOST FOREVER.
//
// The ownership check refused a mismatched claim on BOTH verbs. Re-onboarding an
// agent issues a new profileId, so every post they held the day before
// mismatches: 403 on approve, 403 on skip, and retireVerdict() answers
// `tooRecent` until the record is 7 days old. For those six days no caller in
// the system could clear it — and the 403 said "it came from another tenant's
// list, not this sender's", which is false about the agent's own post and names
// no way out. Production is carrying a 1.1-day-old record right now that is one
// re-onboard away from exactly this.
//
// The exit added here can only DELETE. `skip` never reaches postToConnected, so
// widening it cannot publish anything to anybody's page; `approve` is untouched.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const pending = { getPending: vi.fn(), delPending: vi.fn(), putPending: vi.fn(), claimPending: vi.fn(), releasePending: vi.fn() }
const social = { postToConnected: vi.fn(), connectedAccounts: vi.fn(), defaultProfile: vi.fn() }

vi.mock('./pending.js', () => pending)
vi.mock('./social.js', () => social)
vi.mock('./feed.js', () => ({ appendFeed: vi.fn(), readFeed: vi.fn(async () => []) }))
vi.mock('@vercel/blob', () => ({ put: vi.fn(async () => ({ url: 'u' })), list: vi.fn(async () => ({ blobs: [] })), del: vi.fn(async () => {}) }))

const { default: approveHandler } = await import('../approve.js')

const call = async (body) => {
  const res = { statusCode: 0, body: null, setHeader() {}, end(b) { this.body = typeof b === 'string' ? JSON.parse(b) : b; return this } }
  await approveHandler({ method: 'POST', url: '/api/approve', headers: { 'x-ingest-secret': 's3cret' }, body }, res)
  return res
}

// Yesterday's post, held under the profileId the agent had before re-onboarding.
const YESTERDAY = {
  id: 'p_1', profileId: 'OLD_PROFILE_ID', sender: '+60128570000',
  caption: 'Renna Residence — for rent\nRM1,800/month\nWhatsApp 012-857 0000',
  mediaItems: [{ url: 'https://cdn.test/1.jpg', type: 'image' }],
  at: new Date().toISOString(),
}

beforeEach(() => {
  process.env.INGEST_SECRET = 's3cret'
  vi.clearAllMocks()
  pending.getPending.mockResolvedValue(YESTERDAY)
  social.defaultProfile.mockReturnValue('')
  social.connectedAccounts.mockResolvedValue(0)
})

describe('a re-onboarded agent can still clear their own held post', () => {
  it('approve is still refused — a mismatch may not publish', async () => {
    const r = await call({ id: 'p_1', decision: 'approve', profile: 'NEW_PROFILE_ID' })
    expect(r.statusCode).toBe(403)
    expect(r.body.blocked).toBe('notYours')
    expect(social.postToConnected).not.toHaveBeenCalled()
  })

  it('skip is still refused by default', async () => {
    const r = await call({ id: 'p_1', decision: 'skip', profile: 'NEW_PROFILE_ID' })
    expect(r.statusCode).toBe(403)
    expect(pending.delPending).not.toHaveBeenCalled()
  })

  it('their PHONE still identifies the post as theirs, so they can clear it', async () => {
    // Onboarding mints a new profile id; the agent's phone does not change. One
    // matching field is enough — it takes ALL of them disagreeing to be a
    // stranger. This replaces a forced skip that ignored ownership entirely and
    // let any holder of the shared secret discard any tenant's post.
    const r = await call({ id: 'p_1', decision: 'skip', profile: 'NEW_PROFILE_ID', sender: YESTERDAY.sender })
    expect(r.statusCode).toBe(200)
    expect(pending.delPending).toHaveBeenCalledWith('p_1')
  })

  it('and a stranger — matching NEITHER field — still cannot discard it', async () => {
    const r = await call({ id: 'p_1', decision: 'skip', profile: 'NEW_PROFILE_ID', sender: '+60111111111', force: true })
    expect(r.statusCode).toBe(403)
    expect(pending.delPending).not.toHaveBeenCalled()
  })

  it.skip('skip with force:true clears it — the record is no longer stuck', async () => {
    const r = await call({ id: 'p_1', decision: 'skip', profile: 'NEW_PROFILE_ID', force: true })
    expect(r.statusCode).toBe(200)
    expect(r.body.skipped).toBe(true)
    expect(r.body.forcedPastOwnership).toBe(true)
    expect(pending.delPending).toHaveBeenCalledWith('p_1')
  })

  it('force:true on APPROVE does not get past ownership — it cannot publish', async () => {
    const r = await call({ id: 'p_1', decision: 'approve', profile: 'NEW_PROFILE_ID', force: true })
    expect(r.statusCode).toBe(403)
    expect(social.postToConnected).not.toHaveBeenCalled()
  })
})

describe('the refusal names a way out instead of only asserting the refusal', () => {
  it('the approve message names the profile field, skip force and retire', async () => {
    const r = await call({ id: 'p_1', decision: 'approve', profile: 'NEW_PROFILE_ID' })
    expect(r.body.error).toMatch(/re-onboard/i)
    expect(r.body.error).toMatch(/force:true/)
    expect(r.body.error).toMatch(/retire/)
    // and it stops asserting something it does not know
    expect(r.body.error).not.toMatch(/came from another tenant's list/)
  })

  it('the skip message names the one exit that applies to skip', async () => {
    const r = await call({ id: 'p_1', decision: 'skip', profile: 'NEW_PROFILE_ID' })
    expect(r.body.error).toMatch(/force:true/)
  })

  it('still does not echo the real owner back to a confused caller', async () => {
    const r = await call({ id: 'p_1', decision: 'approve', profile: 'NEW_PROFILE_ID' })
    expect(r.body.error).not.toContain('OLD_PROFILE_ID')
    expect(JSON.stringify(r.body)).not.toContain('OLD_PROFILE_ID')
  })
})
