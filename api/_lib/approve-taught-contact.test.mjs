// Edward's Stapok reel, held 2026-09-15 12:25 — three minutes before the write-side
// fix for rule-taught WhatsApp links shipped — carried his own link from a rule.
// Its record has no contactLinks, so the tick refused it as "invented". The tick
// now reads the profile's rules as they are, so that already-held post publishes,
// and a link to any other number is still refused.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const pending = { putPending: vi.fn(), getPending: vi.fn(), delPending: vi.fn(), claimPending: vi.fn(), releasePending: vi.fn() }
const social = { postToConnected: vi.fn(), connectedAccounts: vi.fn(), defaultProfile: vi.fn() }
const style = { getRules: vi.fn(), getStyle: vi.fn(async () => ({})) }
vi.mock('./pending.js', () => pending)
vi.mock('./social.js', () => social)
vi.mock('./feed.js', () => ({ appendFeed: vi.fn() }))
vi.mock('./style.js', () => style)
const { default: approveHandler } = await import('../approve.js')

const EDWARD = '6a9ceb0f8737dad86c409a7e'
const LISTING = '2 Adjoining Town land FOR SALE\n📍 Location/Locality: Stapok\n\n✅ Land Size :\n* Lot 1: 20.51 points\n* Lot 2: 17.46 points\nTOTAL：37.97 Points\n✅ Land Type: Mixed Zone Land\n✅ Leasehold: 2069\n\n💰Price: Rm37k/points\nLumpsum： Rm 1,404,890\n\nMy WhatsApp link'
const REEL = '🔥 STAPOK LAND FOR SALE\n\n📍 STAPOK\n\n💰 RM1,404,890\n\n✅ Land Size: 37.97 Points (Lot 1: 20.51, Lot 2: 17.46)\n\n✅ Leasehold: 2069\n\n📲 https://wa.me/60183929100\n\n#STAPOK'
const RULE = "Always include my WhatsApp link https://wa.me/60183929100 as the contact line in captions (instead of just 'PM For More Information')"
const record = (caption) => ({ id: 'bc5044df', profileId: EDWARD, kind: 'reel', caption, platforms: ['tiktok'], mediaItems: [{ url: 'https://blob.test/r.mp4', type: 'video' }], captionDegraded: false, source: { text: LISTING, price: 1404890 }, at: new Date().toISOString() })
const approve = async () => {
  const r = { statusCode: 0, body: null, headers: {}, setHeader() {}, end(b) { this.body = typeof b === 'string' ? JSON.parse(b) : b; return this } }
  await approveHandler({ method: 'POST', url: '/api/approve', headers: { 'x-ingest-secret': 's3cret' }, body: { id: 'bc5044df', decision: 'approve', profile: EDWARD } }, r)
  return r
}

beforeEach(() => {
  process.env.INGEST_SECRET = 's3cret'
  vi.clearAllMocks()
  pending.claimPending.mockResolvedValue(true)
  social.postToConnected.mockResolvedValue({ ok: true, platforms: ['tiktok'] })
})

describe('the tick grounds a WhatsApp link the agent taught as a rule', () => {
  it("publishes Edward's held Stapok reel", async () => {
    pending.getPending.mockResolvedValue(record(REEL))
    style.getRules.mockResolvedValue({ rules: [RULE] })
    const r = await approve()
    expect(r.body.blocked).toBeUndefined()
    expect(r.body.ok).toBe(true)
  })

  it('without the rule it is refused, exactly as before', async () => {
    pending.getPending.mockResolvedValue(record(REEL))
    style.getRules.mockResolvedValue({ rules: [] })
    const r = await approve()
    expect(r.statusCode).toBe(409)
    expect(r.body.blocked).toBe('captionInvented')
  })

  it('a link to a different number is still refused', async () => {
    pending.getPending.mockResolvedValue(record(REEL.replace('60183929100', '60123456789')))
    style.getRules.mockResolvedValue({ rules: [RULE] })
    const r = await approve()
    expect(r.body.blocked).toBe('captionInvented')
  })

  it('a rules read that fails grounds nothing and does not break the tick', async () => {
    pending.getPending.mockResolvedValue(record(REEL))
    style.getRules.mockRejectedValue(new Error('blob down'))
    const r = await approve()
    expect(r.body.blocked).toBe('captionInvented')
  })
})
