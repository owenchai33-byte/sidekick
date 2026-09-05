// TENANT ISOLATION — the half that refuses, and the half that must not.
//
// Every gate added on 2026-09-04 is tested twice here: once that the caller it
// exists to stop is stopped, and once that each REAL caller found in the code
// still succeeds. Each of those second tests names its caller in the title, and
// they are the more important half.
//
// This project has shipped five silent-refusal bugs. A guard that wrongly
// refuses is worse than one that misses, because the refusal reaches nobody: a
// paying agent presses ✅, nothing happens, and no error is raised anywhere. The
// callers named below were enumerated from the code before anything was gated —
// src/ (the browser app), ~/.openclaw/workspace-sidekick/tools/sidekick.mjs (the
// WhatsApp CLI) and ~/.openclaw/tools/*.mjs (the crons).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Readable } from 'node:stream'

const pending = { getPending: vi.fn(), delPending: vi.fn(), claimPending: vi.fn(), releasePending: vi.fn() }
const social = {
  postToConnected: vi.fn(),
  connectedAccounts: vi.fn(),
  disconnect: vi.fn(),
  connectUrl: vi.fn(),
  defaultProfile: vi.fn(() => ''),
  providerConfigured: vi.fn(() => ({ configured: true, provider: 'postpeer' })),
  provider: vi.fn(() => 'postpeer'),
}
const appendFeed = vi.fn()
vi.mock('./pending.js', () => pending)
vi.mock('./social.js', () => social)
vi.mock('./feed.js', () => ({ appendFeed, readFeed: vi.fn(async () => []) }))
vi.mock('./providers.js', async (importOriginal) => ({
  ...(await importOriginal()),
  providerStatus: () => ({ configured: true, provider: 'groq' }),
  runModel: vi.fn(async () => '{"ok":true}'),
  runModelVision: vi.fn(async () => ({ text: '{"index":0}', provider: 'groq' })),
  extractJson: (t) => JSON.parse(t),
  visionStatus: () => ({ configured: true, chain: ['groq'], reason: '' }),
}))

const { default: approve } = await import('../approve.js')
const { default: accounts } = await import('../social-accounts.js')
const { default: disconnectHandler } = await import('../social-disconnect.js')
const { default: connectHandler } = await import('../social-connect.js')
const { default: generate } = await import('../generate.js')
const { resetRateLimits, mintProfileToken, normalizeSender, ownershipVerdict } = await import('./tenant.js')

const SECRET = 's3cret'
const MINE = '6a90f9f6f59d1531f8d04018'
const THEIRS = 'bb11cc22dd33ee44ff550066'
const MY_PHONE = '+60169219859'
const THEIR_PHONE = '+60123456789'

const mkRes = () => {
  const r = { statusCode: 0, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.end = (b) => { r.body = typeof b === 'string' ? JSON.parse(b) : b; return r }
  r.status = (c) => { r.statusCode = c; return r }
  return r
}
// A request as sidekick.mjs / a cron / curl sends it: no browser metadata.
const post = async (handler, body, headers = {}, url = '/api/x') => {
  const res = mkRes()
  const req = Readable.from([JSON.stringify(body)])
  req.method = 'POST'
  req.url = url
  req.headers = { 'content-type': 'application/json', host: 'sidekick.example', ...headers }
  await handler(req, res)
  return res
}
const get = async (handler, url, headers = {}) => {
  const res = mkRes()
  await handler({ method: 'GET', url, headers: { host: 'sidekick.example', ...headers } }, res)
  return res
}
// The same POST as one of the portal's own pages makes it.
const browser = (extra = {}) => ({ 'sec-fetch-site': 'same-origin', ...extra })

beforeEach(() => {
  vi.clearAllMocks()
  resetRateLimits()
  process.env.INGEST_SECRET = SECRET
  delete process.env.LINK_SECRET
  delete process.env.APP_HOST
  pending.claimPending.mockResolvedValue(true)
  social.postToConnected.mockResolvedValue({ ok: true, platforms: ['facebook'] })
  social.connectedAccounts.mockResolvedValue([{ id: 'fb-1', platform: 'facebook', username: 'edward' }])
  social.connectUrl.mockResolvedValue('https://provider.test/oauth')
  social.providerConfigured.mockReturnValue({ configured: true, provider: 'postpeer' })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('/api/approve: a pending belongs to ONE agent', () => {
  const REAL = { caption: 'Terrace at Riveria Park — RM638,000. 012-345 6789.', mediaItems: [{ url: 'x' }] }

  it('refuses to publish another agent\'s pending when the caller says who it is', async () => {
    pending.getPending.mockResolvedValue({ ...REAL, profileId: THEIRS, sender: THEIR_PHONE })
    const res = await post(approve, { id: 'abc', decision: 'approve', profile: MINE }, { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(403)
    expect(res.body.blocked).toBe('notYours')
    expect(social.postToConnected).not.toHaveBeenCalled()
  })

  it('refuses on a sender mismatch too, when that is the only identity to compare', async () => {
    pending.getPending.mockResolvedValue({ ...REAL, profileId: THEIRS, sender: THEIR_PHONE })
    const res = await post(approve, { id: 'abc', decision: 'approve', sender: MY_PHONE }, { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(403)
    expect(social.postToConnected).not.toHaveBeenCalled()
  })

  it('refuses to SKIP another agent\'s pending — discarding it is harm too', async () => {
    // A cross-tenant skip deletes a real listing that was waiting for its owner's
    // ✅. Nobody is told; it simply never posts.
    pending.getPending.mockResolvedValue({ ...REAL, profileId: THEIRS })
    const res = await post(approve, { id: 'abc', decision: 'skip', profile: MINE }, { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(403)
    expect(pending.delPending).not.toHaveBeenCalled()
  })

  it('does NOT hand the real owner\'s profileId back in the refusal', async () => {
    // The likeliest caller here is the agent model, confused about which id
    // belongs to whom. Answering with the right profileId would hand it the
    // missing half of a cross-tenant publish.
    pending.getPending.mockResolvedValue({ ...REAL, profileId: THEIRS, sender: THEIR_PHONE })
    const res = await post(approve, { id: 'abc', decision: 'approve', profile: MINE }, { 'x-ingest-secret': SECRET })
    expect(JSON.stringify(res.body)).not.toContain(THEIRS)
    expect(JSON.stringify(res.body)).not.toContain(THEIR_PHONE)
  })

  it('refuses when the caller\'s two claims disagree with each other', async () => {
    pending.getPending.mockResolvedValue({ ...REAL, profileId: MINE, sender: THEIR_PHONE })
    const res = await post(approve, { id: 'abc', decision: 'approve', profile: MINE, sender: MY_PHONE }, { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(403)
    expect(social.postToConnected).not.toHaveBeenCalled()
  })

  // ── and the half that must not refuse ──────────────────────────────────────

  it('sidekick.mjs approve(id, decision) — which sends NO claim — still publishes', async () => {
    // ~/.openclaw/workspace-sidekick/tools/sidekick.mjs:428 posts { id, decision }
    // and nothing else, and that file is outside this repo. Refusing an unclaimed
    // approve would refuse EVERY approve on every installed Mac the moment this
    // deployed. Unknown keeps working exactly as it did.
    pending.getPending.mockResolvedValue({ ...REAL, profileId: MINE, sender: MY_PHONE })
    const res = await post(approve, { id: 'abc', decision: 'approve' }, { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(200)
    expect(res.body.ownership).toBe('unknown')
    expect(social.postToConnected).toHaveBeenCalled()
  })

  it('the ~11 pendings already held — no profileId, no sender — still publish', async () => {
    pending.getPending.mockResolvedValue({ ...REAL, profileId: MINE }) // no sender at all
    const res = await post(approve, { id: 'abc', decision: 'approve', sender: MY_PHONE }, { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(200)
    expect(res.body.ownership).toBe('unknown')
  })

  it('a reel pending (api/hold.js writes no sender) still publishes on a sender claim', async () => {
    // A check keyed on `sender` alone would silently refuse 100% of TikTok
    // approvals, because hold.js never stored one. That is why profileId is the
    // primary key and an absent field is UNKNOWN, not guilty.
    pending.getPending.mockResolvedValue({ ...REAL, profileId: MINE, kind: 'reel' })
    const res = await post(approve, { id: 'abc', decision: 'approve', sender: MY_PHONE }, { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(200)
  })

  it('the owner approving their own pending publishes, and says the check ran', async () => {
    pending.getPending.mockResolvedValue({ ...REAL, profileId: MINE, sender: MY_PHONE })
    const res = await post(approve, { id: 'abc', decision: 'approve', profile: MINE }, { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(200)
    expect(res.body.ownership).toBe('match')
  })

  it('matches a phone written in another form (+60… vs 0…)', async () => {
    // A normaliser that is too strict turns one agent's two spellings into a
    // mismatch, and a mismatch here refuses a real ✅.
    pending.getPending.mockResolvedValue({ ...REAL, profileId: MINE, sender: '+60169219859' })
    const res = await post(approve, { id: 'abc', decision: 'approve', sender: '0169219859' }, { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(200)
  })

  it('the GET convenience link can carry the claim too', async () => {
    pending.getPending.mockResolvedValue({ ...REAL, profileId: THEIRS })
    const res = await get(approve, `/api/approve?id=abc&decision=approve&secret=${SECRET}&profile=${MINE}`)
    expect(res.statusCode).toBe(403)
  })

  it('records WHOSE post it was in the feed, so the home screen can scope history', async () => {
    pending.getPending.mockResolvedValue({ ...REAL, profileId: MINE })
    await post(approve, { id: 'abc', decision: 'approve' }, { 'x-ingest-secret': SECRET })
    expect(appendFeed).toHaveBeenCalledWith(expect.objectContaining({ profileId: MINE }))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('/api/social-accounts: no default account list', () => {
  it('refuses to enumerate a default profile when the caller names none', async () => {
    const res = await get(accounts, '/api/social-accounts')
    expect(res.statusCode).toBe(400)
    expect(social.connectedAccounts).not.toHaveBeenCalled()
    expect(social.defaultProfile).not.toHaveBeenCalled()
  })

  it('ConnectPage (?profile= from the agent\'s link) still lists their accounts', async () => {
    const res = await get(accounts, `/api/social-accounts?profile=${MINE}`)
    expect(res.statusCode).toBe(200)
    expect(res.body.accounts).toHaveLength(1)
    expect(social.connectedAccounts).toHaveBeenCalledWith(MINE)
  })

  it('healthcheck.mjs and selftest.mjs still get platform names — both send ?profile=', async () => {
    const res = await get(accounts, `/api/social-accounts?profile=${MINE}`)
    expect(res.body.accounts.map((a) => a.platform)).toEqual(['facebook'])
  })

  it('ConnectPage still gets the account id it needs for its disconnect button', async () => {
    const res = await get(accounts, `/api/social-accounts?profile=${MINE}`)
    expect(res.body.accounts[0].id).toBe('fb-1')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('/api/social-disconnect: not an anonymous kill switch', () => {
  it('refuses an accountId with no profile — the blind unlink is gone', async () => {
    const res = await post(disconnectHandler, { accountId: 'fb-1' }, browser())
    expect(res.statusCode).toBe(400)
    expect(social.disconnect).not.toHaveBeenCalled()
  })

  it('refuses to unlink an account that is not on the named profile', async () => {
    social.connectedAccounts.mockResolvedValue([{ id: 'other-1', platform: 'facebook' }])
    const res = await post(disconnectHandler, { accountId: 'fb-1', profile: MINE }, browser())
    expect(res.statusCode).toBe(403)
    expect(res.body.blocked).toBe('notYours')
    expect(social.disconnect).not.toHaveBeenCalled()
  })

  it('refuses a scripted POST that does not even look like our own pages', async () => {
    const res = await post(disconnectHandler, { accountId: 'fb-1', profile: MINE })
    expect(res.statusCode).toBe(401)
    expect(social.disconnect).not.toHaveBeenCalled()
  })

  it('rate-limits a sweep', async () => {
    let last
    for (let i = 0; i < 12; i++) {
      last = await post(disconnectHandler, { accountId: 'fb-1', profile: MINE }, browser())
    }
    expect(last.statusCode).toBe(429)
  })

  it('ConnectPage\'s disconnect button still works — its own profile, own account', async () => {
    const res = await post(disconnectHandler, { accountId: 'fb-1', profile: MINE }, browser())
    expect(res.statusCode).toBe(200)
    expect(social.disconnect).toHaveBeenCalledWith('fb-1')
  })

  it('a secret-holding caller still works without browser headers', async () => {
    const res = await post(disconnectHandler, { accountId: 'fb-1', profile: MINE }, { 'x-ingest-secret': SECRET })
    expect(res.statusCode).toBe(200)
  })

  it('a valid link token is accepted as proof, for when links start carrying one', async () => {
    process.env.LINK_SECRET = 'link-s3cret'
    const t = mintProfileToken(MINE)
    expect(t).toBeTruthy()
    const res = await post(disconnectHandler, { accountId: 'fb-1', profile: MINE, t })
    expect(res.statusCode).toBe(200)
  })

  it('and a token minted for a DIFFERENT profile is not', async () => {
    process.env.LINK_SECRET = 'link-s3cret'
    const res = await post(disconnectHandler, { accountId: 'fb-1', profile: MINE, t: mintProfileToken(THEIRS) })
    expect(res.statusCode).toBe(401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('/api/social-connect: an OAuth with no profile is not started', () => {
  it('refuses rather than attaching the agent\'s Facebook to a shared default', async () => {
    const res = await get(connectHandler, '/api/social-connect?platform=facebook&origin=https://sidekick.example')
    expect(res.statusCode).toBe(400)
    expect(social.connectUrl).not.toHaveBeenCalled()
    expect(social.defaultProfile).not.toHaveBeenCalled()
  })

  it('ConnectPage still starts the OAuth for the profile in the agent\'s link', async () => {
    const res = await get(connectHandler, `/api/social-connect?platform=facebook&origin=https://sidekick.example&profile=${MINE}`)
    expect(res.statusCode).toBe(200)
    expect(res.body.authUrl).toBe('https://provider.test/oauth')
    expect(social.connectUrl).toHaveBeenCalledWith(expect.objectContaining({ profileId: MINE }))
  })

  it('sends the agent back to THEIR profile\'s connect page', async () => {
    await get(connectHandler, `/api/social-connect?platform=facebook&origin=https://sidekick.example&profile=${MINE}`)
    expect(social.connectUrl.mock.calls[0][0].redirectUrl).toContain(`profile=${MINE}`)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('/api/generate: the daily token budget is the product ceiling', () => {
  const parse = (headers = {}) => post(generate, { action: 'parse', rawText: 'Terrace RM638k Kuching' }, headers, '/api/generate')

  it('lets a working agent through — nowhere near the limit', async () => {
    // Preparing one listing costs a handful of calls. Ten in a row is a busy
    // agent, not an attack, and this is the test that has to stay green.
    for (let i = 0; i < 10; i++) expect((await parse()).statusCode).toBe(200)
  })

  it('stops a loop burning the whole day\'s tokens', async () => {
    let last
    for (let i = 0; i < 45; i++) last = await parse()
    expect(last.statusCode).toBe(429)
    expect(last.body.error).toMatch(/wait/i)
  })

  it('counts per caller, so one abuser cannot lock everybody else out', async () => {
    for (let i = 0; i < 45; i++) await parse({ 'x-forwarded-for': '9.9.9.9' })
    const other = await parse({ 'x-forwarded-for': '1.1.1.1' })
    expect(other.statusCode).toBe(200)
  })

  it('SettingsPage\'s status ping on page load is never rate-limited', async () => {
    // src/pages/SettingsPage.jsx calls getStatus() on mount. It costs no tokens,
    // and throttling it would make the app look broken for free.
    for (let i = 0; i < 60; i++) {
      const res = await post(generate, { action: 'status' }, {}, '/api/generate')
      expect(res.statusCode).toBe(200)
    }
  })

  it('the crons keep working — selftest.mjs holds INGEST_SECRET', async () => {
    for (let i = 0; i < 60; i++) {
      expect((await parse({ 'x-ingest-secret': SECRET })).statusCode).toBe(200)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('_lib/tenant: the primitives underneath', () => {
  it('treats two spellings of the same phone as the same agent', () => {
    expect(normalizeSender('+60169219859')).toBe(normalizeSender('0169219859'))
    expect(normalizeSender('60169219859')).toBe(normalizeSender('016-921 9859'))
  })

  it('does not confuse two different agents', () => {
    expect(normalizeSender(MY_PHONE)).not.toBe(normalizeSender(THEIR_PHONE))
  })

  it('answers UNKNOWN — never "no" — when there is nothing to compare', () => {
    expect(ownershipVerdict({ claimProfile: MINE, claimSender: '', item: {} }).verdict).toBe('unknown')
    expect(ownershipVerdict({ claimProfile: '', claimSender: '', item: { profileId: MINE } }).verdict).toBe('unknown')
    expect(ownershipVerdict({ claimProfile: '', claimSender: '', item: {} }).verdict).toBe('unknown')
  })

  it('says WHY it could not tell, so a caller can pass the reason on', () => {
    expect(ownershipVerdict({ claimProfile: '', claimSender: '', item: { profileId: MINE } }).reason)
      .toMatch(/did not say who/)
    expect(ownershipVerdict({ claimProfile: MINE, claimSender: '', item: {} }).reason)
      .toMatch(/predates tenant tagging/)
  })

  it('mints nothing when there is no secret to mint from, and verifies nothing either', () => {
    delete process.env.LINK_SECRET
    delete process.env.INGEST_SECRET
    expect(mintProfileToken(MINE)).toBe('')
    process.env.INGEST_SECRET = SECRET
  })

  it('a token is per-profile and stable', () => {
    process.env.LINK_SECRET = 'link-s3cret'
    expect(mintProfileToken(MINE)).toBe(mintProfileToken(MINE))
    expect(mintProfileToken(MINE)).not.toBe(mintProfileToken(THEIRS))
  })
})
