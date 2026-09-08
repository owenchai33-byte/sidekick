// AN UNMAPPED SENDER IS REFUSED. IT IS NEVER ROUTED TO A FALLBACK PROFILE.
//
// The hazard, end to end. api/ingest.js used to resolve the publish target as
// `body.profileId || defaultProfile()`, and defaultProfile() is
// <PROVIDER>_PROFILE_ID. Production was safe only by accident: it runs PostPeer
// and POSTPEER_PROFILE_ID is blank. The moment POSTING_PROVIDER flips to zernio
// with ZERNIO_PROFILE_ID set to anything, every sender who is not in
// tools/tenants.json publishes to that ONE profile's real Facebook, Instagram
// and TikTok — with the wrong caption style, the wrong brand and the wrong
// rules, reported to the sending agent as a success.
//
// It needs no attacker and no mistake by Owen. sidekick.mjs looks tenants.json
// up by EXACT phone string against '+60...' keys, so a sender arriving as
// '60169219859', or with a WhatsApp JID suffix, simply misses and the field is
// omitted from the ingest body.
//
// And three things push a person to set that variable on switch day:
// .env.example calls it "REQUIRED", vite.config.js forwards it to the dev
// server, and the home screen's red "No accounts — connect" badge looks like it
// is asking for one.
//
// These tests exist so that setting it can never again publish to somebody.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const social = {
  postToConnected: vi.fn(),
  connectedAccounts: vi.fn(),
  // The real one, so the test is about ingest's use of it rather than a stub's.
  defaultProfile: vi.fn(),
}
vi.mock('./social.js', () => social)
vi.mock('./pending.js', () => ({ putPending: vi.fn(async () => 'held-1'), getPending: vi.fn(), delPending: vi.fn(), claimPending: vi.fn(async () => true), releasePending: vi.fn() }))
vi.mock('./feed.js', () => ({ appendFeed: vi.fn() }))
vi.mock('./style.js', () => ({ getStyle: vi.fn(async () => ({ style: '', examples: [] })), getRules: vi.fn(async () => ({ rules: [] })) }))
vi.mock('./brand.js', () => ({ getBrand: vi.fn(async () => ({})) }))
vi.mock('./providers.js', () => ({
  providerStatus: () => ({ configured: false, provider: null }),
  runModel: vi.fn(async () => { throw new Error('no test may call a provider') }),
  extractJson: vi.fn(() => { throw new Error('no test may call a provider') }),
}))

const { getStyle, getRules } = await import('./style.js')
const { getBrand } = await import('./brand.js')
const { default: ingest } = await import('../ingest.js')

const mkRes = () => {
  const r = { statusCode: 0, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.end = (b) => { r.body = typeof b === 'string' ? JSON.parse(b) : b; return r }
  return r
}
const post = async (body) => {
  const res = mkRes()
  await ingest({ method: 'POST', url: '/api/ingest', headers: { 'x-ingest-secret': 's3cret' }, body }, res)
  return res
}

const LISTING = {
  text: 'Tropics City Kota Samarahan for rent. RM1,300/month. 3 rooms.',
  images: ['https://cdn.test/photo1.jpg'],
  sender: '60169219859',   // the un-normalised spelling that misses tenants.json
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INGEST_SECRET = 's3cret'
  delete process.env.ZERNIO_PROFILE_ID
  delete process.env.POSTPEER_PROFILE_ID
  delete process.env.POSTING_PROVIDER
  social.defaultProfile.mockReturnValue('')
})

describe('an unmapped sender', () => {
  it('is refused, and told which file fixes it', async () => {
    const res = await post(LISTING)
    expect(res.statusCode).toBe(400)
    expect(res.body.ok).toBe(false)
    expect(res.body.error).toMatch(/no profile for this sender/)
    expect(res.body.error).toMatch(/tools\/tenants\.json/)
  })

  it('publishes NOTHING and reads NOBODY\'S settings', async () => {
    await post({ ...LISTING, auto: true })
    expect(social.postToConnected).not.toHaveBeenCalled()
    expect(social.connectedAccounts).not.toHaveBeenCalled()
    // Not even a read: a caption written in another agent's trained voice is
    // most of the damage even when the post is later refused.
    expect(getStyle).not.toHaveBeenCalled()
    expect(getRules).not.toHaveBeenCalled()
    expect(getBrand).not.toHaveBeenCalled()
  })

  it('is STILL refused when ZERNIO_PROFILE_ID is set — the switch-day scenario', async () => {
    // This is the exact configuration the runbook tells Owen to avoid, proven
    // harmless rather than merely discouraged. A comment in .env.example is not
    // a control; this is.
    process.env.POSTING_PROVIDER = 'zernio'
    process.env.ZERNIO_PROFILE_ID = '6a6c498971a67c109cfcae06'
    social.defaultProfile.mockReturnValue('6a6c498971a67c109cfcae06')

    const res = await post({ ...LISTING, auto: true })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/no profile for this sender/)
    expect(social.postToConnected).not.toHaveBeenCalled()
  })

  it('is STILL refused when POSTPEER_PROFILE_ID is set', async () => {
    process.env.POSTING_PROVIDER = 'postpeer'
    process.env.POSTPEER_PROFILE_ID = 'pp_shared_pilot'
    social.defaultProfile.mockReturnValue('pp_shared_pilot')

    const res = await post({ ...LISTING, auto: true })
    expect(res.statusCode).toBe(400)
    expect(social.postToConnected).not.toHaveBeenCalled()
  })

  it('never asks what the default profile is on a publish path at all', async () => {
    // The strongest form: the publish path does not merely ignore the answer,
    // it does not ask the question. A future edit cannot reintroduce the
    // fallback by "just using the value that is already in scope".
    process.env.ZERNIO_PROFILE_ID = 'anything'
    await post({ ...LISTING, auto: true })
    await post({ ...LISTING, dry: true })
    await post(LISTING)
    expect(social.defaultProfile).not.toHaveBeenCalled()
  })
})

describe('a MAPPED sender is unaffected', () => {
  it('reads THEIR settings and reports THEIR profile, ignoring the default entirely', async () => {
    // Dry mode: this file is about which identity ingest resolves, and dry is the
    // path that answers that without dragging in the card renderer or a live
    // provider. Where the POST goes is proved in _lib/social.js's own tests.
    process.env.ZERNIO_PROFILE_ID = 'a-default-that-must-not-be-used'
    const OWEN = '6a90f9f6f59d1531f8d04018'

    const res = await post({ ...LISTING, profileId: OWEN, dry: true })
    expect(res.statusCode).toBe(200)
    expect(res.body.profileId).toBe(OWEN)
    expect(getStyle).toHaveBeenCalledWith(OWEN)
    expect(getRules).toHaveBeenCalledWith(OWEN)
    expect(getBrand).toHaveBeenCalledWith(OWEN)
    expect(social.defaultProfile).not.toHaveBeenCalled()
  })

  it('reports WHERE the style came from, so a fallback is never silent', async () => {
    getStyle.mockResolvedValueOnce({ style: 'trained', examples: ['a'], found: true, degraded: false, source: 'legacy:oldid' })
    const res = await post({ ...LISTING, profileId: 'p1', dry: true })
    expect(res.body.styleSource).toBe('legacy:oldid')
    expect(res.body.settingsNote).toMatch(/previous profile id/)
  })

  it('a DEGRADED settings read is not reported as "no trained style"', async () => {
    // The sentence that sends somebody off to retrain a style that was never
    // lost. Empty-because-broken and empty-because-absent are different facts.
    getStyle.mockResolvedValueOnce({ style: '', examples: [], found: false, degraded: true, source: 'degraded' })
    const res = await post({ ...LISTING, profileId: 'p1', dry: true })
    expect(res.body.settingsDegraded).toBe(true)
    expect(res.body.styleWarning).toMatch(/could not read/i)
    expect(res.body.styleWarning).toMatch(/Do NOT retrain/)
    expect(res.body.styleWarning).not.toMatch(/no trained caption style found/)
  })
})
