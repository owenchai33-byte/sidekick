// `limit` WAS ACCEPTED AND IGNORED, WHICH IS HOW A PENDING BECOMES UNREACHABLE.
//
// /api/feed called listPending(20) and never read the query parameter. Four
// callers in ~/.openclaw/workspace-sidekick/tools/sidekick.mjs pass one —
// `retire` asks for 100, `cover` and `caption` for 30, `status` for 10 — and
// every one of them silently got 20.
//
// listPending() sorts NEWEST FIRST and `retire` selects the OLDEST, so the one
// command that can clear a stuck pending could only ever see the 20 newest
// records. Production carries 12 today, 11 of them owned by profiles nobody is
// mapped to, so no caller can approve or skip them; past 20 they also become
// invisible to the only tool that clears them. The tool then reports "no pending
// with that id — it may already have been posted or skipped", which is false.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const listPending = vi.fn(async () => [])
vi.mock('./pending.js', () => ({ listPending }))
vi.mock('./feed.js', () => ({ readFeed: vi.fn(async () => []) }))
vi.mock('./social.js', () => ({
  connectedAccounts: vi.fn(async () => []),
  providerConfigured: () => ({ configured: false, provider: 'none' }),
}))
vi.mock('./providers.js', () => ({ providerStatus: () => ({ configured: false, provider: 'none' }) }))

const { default: feedHandler } = await import('../feed.js')

const get = async (url) => {
  const res = { statusCode: 0, body: null, setHeader() {}, end(b) { this.body = typeof b === 'string' ? JSON.parse(b) : b; return this } }
  await feedHandler({ method: 'GET', url, headers: { 'x-ingest-secret': 's3cret' } }, res)
  return res
}

beforeEach(() => { process.env.INGEST_SECRET = 's3cret'; vi.clearAllMocks(); listPending.mockResolvedValue([]) })

describe('/api/feed honours the limit its callers pass', () => {
  it('retire asking for 100 is given 100, not 20', async () => {
    await get('/api/feed?limit=100')
    expect(listPending).toHaveBeenCalledWith(100)
  })

  it('cover and caption asking for 30 are given 30', async () => {
    await get('/api/feed?limit=30')
    expect(listPending).toHaveBeenCalledWith(30)
  })

  it('no limit still means 20', async () => {
    await get('/api/feed')
    expect(listPending).toHaveBeenCalledWith(20)
  })

  it('a nonsense limit cannot ask the blob store for more than it pages', async () => {
    await get('/api/feed?limit=9999')
    expect(listPending).toHaveBeenCalledWith(100)
    vi.clearAllMocks()
    await get('/api/feed?limit=-4')
    expect(listPending).toHaveBeenCalledWith(20)
  })
})
