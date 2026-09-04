// The home screen must not report zero connected accounts when it simply cannot tell.
//
// api/feed.js asked for the DEFAULT profile's accounts and swallowed the error.
// POSTPEER_PROFILE_ID is deliberately unset - _lib/social.js documents that a
// multi-tenant account has no safe default - so the call always threw, accounts
// stayed empty, and the first screen anyone opens showed a red
// "No accounts — connect" over an account with Facebook, Instagram and TikTok
// all live. Absent evidence reported as a fact, owner-facing.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const social = { connectedAccounts: vi.fn(), defaultProfile: vi.fn(), providerConfigured: vi.fn() }
vi.mock('./social.js', () => social)
vi.mock('./providers.js', () => ({ providerStatus: () => ({ configured: true, provider: 'groq' }) }))
vi.mock('./feed.js', () => ({ readFeed: vi.fn(async () => []) }))
vi.mock('./pending.js', () => ({ listPending: vi.fn(async () => []) }))

const { default: handler } = await import('../feed.js')

const call = async () => {
  const res = { statusCode: 200, body: null, setHeader() {}, status(c) { this.statusCode = c; return this },
    end(b) { this.body = typeof b === 'string' ? JSON.parse(b) : b; return this } }
  await handler({ method: 'GET', url: '/api/feed', headers: {} }, res)
  return res.body
}

beforeEach(() => {
  vi.clearAllMocks()
  social.providerConfigured.mockReturnValue({ configured: true, provider: 'postpeer' })
  social.defaultProfile.mockReturnValue('')
})

describe('the connected-accounts badge', () => {
  it('reports null — not zero — when the profile cannot be resolved', async () => {
    social.connectedAccounts.mockRejectedValue(new Error('no profile for this sender'))
    const body = await call()
    expect(body.status.connectedAccounts).toBeNull()
  })

  it('reports a real zero when the profile resolves and has nothing linked', async () => {
    social.connectedAccounts.mockResolvedValue([])
    const body = await call()
    expect(body.status.connectedAccounts).toBe(0)
  })

  it('reports the real count when accounts are linked', async () => {
    social.connectedAccounts.mockResolvedValue([{ platform: 'facebook' }, { platform: 'tiktok' }])
    const body = await call()
    expect(body.status.connectedAccounts).toBe(2)
    expect(body.status.platforms).toEqual(['facebook', 'tiktok'])
  })
})
