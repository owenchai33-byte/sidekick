// ZERNIO REQUIRES page AND limit TOGETHER; POSTPEER DOES NOT.
//
// Measured on the live API the moment POSTING_PROVIDER became zernio — every
// agent's account list failed at once with:
//   {"error":"page and limit must be provided together",
//    "type":"invalid_request_error","code":"invalid_field_value"}
//
// It reads exactly like a wrong profile id or a dead API key, and it is neither.
// The `limit` was added to match the PostPeer branch, where it is valid on its
// own — a real asymmetry between the two providers, in a branch that had not run
// in production for months.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let seen = []

async function load(provider) {
  vi.resetModules()
  seen = []
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    seen.push(String(url))
    return new Response(JSON.stringify({ accounts: [], integrations: [] }), { status: 200 })
  }))
  process.env.POSTING_PROVIDER = provider
  process.env.ZERNIO_API_KEY = 'zk'
  process.env.POSTPEER_API_KEY = 'pk'
  return import('./social.js')
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('listing an agent\'s accounts', () => {
  it('sends page alongside limit on Zernio', async () => {
    const { connectedAccounts } = await load('zernio')
    await connectedAccounts('6a9fa82b6b0000c3ff27e395').catch(() => {})
    const call = seen.find((u) => u.includes('/accounts'))
    expect(call, 'no accounts call was made').toBeTruthy()
    const q = new URL(call).searchParams
    expect(q.get('limit')).toBe('100')
    expect(q.get('page'), 'Zernio 400s when limit arrives without page').toBeTruthy()
    expect(q.get('profileId')).toBe('6a9fa82b6b0000c3ff27e395')
  })

  it('still asks for the agent\'s OWN profile, not a default', async () => {
    const { connectedAccounts } = await load('zernio')
    process.env.ZERNIO_PROFILE_ID = 'SOME_SHARED_PILOT_PROFILE'
    await connectedAccounts('6a9fa7533bfef68b44ea6375').catch(() => {})
    const call = seen.find((u) => u.includes('/accounts'))
    expect(new URL(call).searchParams.get('profileId')).toBe('6a9fa7533bfef68b44ea6375')
    expect(call).not.toContain('SOME_SHARED_PILOT_PROFILE')
    delete process.env.ZERNIO_PROFILE_ID
  })

  it('and an empty agent id never lists anything at all', async () => {
    // '' would become /accounts?profileId= — every account on the key.
    const { connectedAccounts } = await load('zernio')
    await connectedAccounts('').catch(() => {})
    expect(seen.filter((u) => u.includes('/accounts'))).toHaveLength(0)
  })
})
