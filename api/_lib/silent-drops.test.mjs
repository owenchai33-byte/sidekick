// THINGS THAT WENT MISSING WITHOUT ANYONE BEING TOLD.
//
// Four defects, all reproduced against the real functions on 2026-09-08, all
// sharing one shape: the system did something reasonable and said nothing, so
// the only person who could have noticed was the client, later, by absence.
//
//   1. A platform the client asked for was DROPPED from a multi-platform post
//      and the answer was `{ok:true}`.
//   2. A platform nobody has connected was refused as `retryable` with no flag
//      to branch on, so the agent retried forever.
//   3. Every provider 4xx — including the 404 a mistyped agent id produces —
//      was reported to a human as "unreachable", i.e. an outage.
//   4. A word the agent BANNED reached the model as a stated listing fact,
//      unless they had phrased the ban exactly the way AGENTS.md teaches.
//
// (4) is the one with a published consequence and is tested first.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { bannedWord, ruleViolations } from './postguard.js'
import { buildContentPrompt } from './prompts.js'

// -----------------------------------------------------------------------------
// 4. A BANNED WORD MUST NOT REACH THE MODEL AS A FACT.
//
// Edward's rule is "never call a condo an apartment". His listing said neither
// word; the parser inferred propertyType "Apartment"; the facts block asserted
// "Property type: Apartment"; the model wrote the word he had forbidden and two
// repair rounds could not argue it back out — the prompt was stating as fact the
// thing the rule asked it to avoid.
//
// That was fixed for ONE phrasing. The parse was two regexes anchored to
// end-of-string, so it read the four shapes AGENTS.md teaches and nothing else.
// Every rule below says the same thing in ordinary English and every one of them
// LEAKED, while the rule saved, listed and displayed completely normally.

describe('a banned word never reaches the model as a fact, however the agent phrased it', () => {
  const listing = {
    listingType: 'sale', price: 338000, location: 'Tabuan Dayak', propertyName: 'Tropics City',
    propertyType: 'Apartment', bedrooms: 1, bathrooms: 1, sqft: 800,
    rawText: 'Tropics City 1 Bedroom Unit RM338,000 800 sqft Edward 0183929100',
  }
  const build = (rules) => buildContentPrompt(listing, ['facebook_page'], ['en'], { style: 's', examples: [] }, null, rules)

  // The phrasing AGENTS.md dictates, plus four ordinary rewordings of it. Only
  // the first was enforced before; the other four leaked.
  it.each([
    'never call a condo an apartment',
    "Don't call it an apartment, it's a condo",
    'Never use the word apartment — it is a condo',
    'Always say condo, never apartment',
    'Never describe a property as an apartment',
  ])('the facts block does not assert the forbidden word: %s', (rule) => {
    expect(build([rule])).not.toContain('Property type: Apartment')
  })

  it('still keeps the property type when no rule forbids it', () => {
    expect(build([])).toContain('Property type: Apartment')
    expect(build(['Never use emoji in captions'])).toContain('Property type: Apartment')
    expect(build(['Never say luxury'])).toContain('Property type: Apartment')
    expect(build(['Keep captions under 5 lines'])).toContain('Property type: Apartment')
  })
})

describe('the ban the repair round enforces is the same ban the prompt reads', () => {
  const CAP = 'LUXURY CONDO\nRM1,500/month\nFully furnished'

  // These fired before and MUST still fire — widening a guard must never cost a
  // catch it already had.
  it.each([
    'Never say luxury',
    "Don't say luxury",
    'Never call a condo an apartment',
  ])('kept: %s', (rule) => {
    expect(bannedWord(rule)).not.toBeNull()
  })

  it.each([
    ['Never use the word "luxury" in captions', 'luxury'],
    ['Never describe a property as luxury', 'luxury'],
    ['Avoid the word luxury', 'luxury'],
    ['Never mention luxury', 'luxury'],
    ['Stop saying luxury', 'luxury'],
    ['jangan guna perkataan mewah', 'mewah'],
  ])('now also reads: %s', (rule, word) => {
    expect(bannedWord(rule)).toBe(word)
  })

  it('the repair round quotes the banned word back', () => {
    expect(ruleViolations(CAP, ['Never use the word "luxury" in captions']))
      .toEqual(['they asked you never to say "luxury" — take it out'])
  })

  // THE SAFETY PROPERTY. A rule it cannot read mechanically must answer null: a
  // wrong ban strips a true field out of the facts block AND sends every caption
  // into a repair round it cannot win.
  it.each([
    'Make it punchier',
    'Sound more premium',
    'Always mention the carpark',
    'Keep captions under 5 lines',
    'Put the price in the first two lines',
    'Write captions in Chinese',
  ])('says "I cannot tell" rather than guessing: %s', (rule) => {
    expect(bannedWord(rule)).toBeNull()
  })

  it('a rule about ONE emoji is not turned into a word ban', () => {
    // The blanket-vs-named emoji distinction is handled by its own arm, and a
    // nonsense ban on "the fire emoji" would only add noise to the repair round.
    expect(bannedWord('never use the fire emoji')).toBeNull()
    expect(ruleViolations('🔥 HOT UNIT\nRM1,500', ['never use the fire emoji']))
      .toEqual(['they asked you not to use the fire emoji — remove it (keep their other emoji)'])
  })
})

// -----------------------------------------------------------------------------
// 1-3. THE PUBLISH PATH.

const ACCOUNTS = [
  { _id: 'z1', platform: 'facebook', username: 'page' },
  { _id: 'z2', platform: 'instagram', username: 'ig' },
]

function fakeBlob() {
  const store = new Map()
  return {
    put: vi.fn(async (key, _b, opts) => {
      if (store.has(key) && opts?.allowOverwrite === false) throw new Error('blob already exists')
      const b = { url: `https://blob/${key}`, uploadedAt: new Date().toISOString() }
      store.set(key, b)
      return b
    }),
    list: vi.fn(async ({ prefix }) => ({ blobs: [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v) })),
    del: vi.fn(async () => {}),
  }
}

async function setup({ accounts = ACCOUNTS, publish, accountsStatus = 200, accountsBody, accountsThrows } = {}) {
  vi.resetModules()
  const blob = fakeBlob()
  vi.doMock('@vercel/blob', () => ({ put: blob.put, list: blob.list, del: blob.del }))
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url)
    if (/\/accounts\?/.test(u)) {
      if (accountsThrows) throw accountsThrows
      return new Response(accountsBody ?? JSON.stringify({ accounts }), { status: accountsStatus })
    }
    if (/\/posts$/.test(u)) return publish ? publish() : new Response('{}', { status: 200 })
    return new Response('{}', { status: 200 })
  }))
  return await import('./social.js')
}

const LISTING = {
  caption: 'KOTA SAMARAHAN Tropics City RM1,300 a month — 017-1234567',
  mediaItems: [{ url: 'https://img/1.jpg' }],
  profileId: 'AGENT1',
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.POSTING_PROVIDER = 'zernio'
  process.env.ZERNIO_API_KEY = 'zk_test'
  process.env.BLOB_READ_WRITE_TOKEN = 'blob-token'
  delete process.env.ZERNIO_PROFILE_ID
})
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

// 1. A REQUESTED PLATFORM THAT IS NOT CONNECTED USED TO VANISH.
//
// Ask for Facebook and Instagram with only Facebook connected and the answer was
// `{ok:true, platforms:['facebook']}` — no partialErrors, no warning. AGENTS.md
// rule 8 makes the agent report `posted` faithfully, so it said "Facebook ✅",
// which is true, and the client was never told Instagram had been skipped. That
// is the state a staged reconnect leaves every agent in.
describe('a platform the client asked for is never dropped in silence', () => {
  it('names the skipped platform, and still publishes the one that can publish', async () => {
    const { postToConnected } = await setup({
      accounts: [{ _id: 'z1', platform: 'facebook', username: 'page' }],
      publish: () => new Response(JSON.stringify({
        postId: 'zp1', platforms: [{ platform: 'facebook', success: true }],
      }), { status: 200 }),
    })
    const r = await postToConnected({ ...LISTING, platforms: ['facebook', 'instagram'] })

    expect(r.ok).toBe(true)                       // the post still went out
    expect(r.platforms).toEqual(['facebook'])     // and reports only what went live
    expect(r.skipped).toEqual(['instagram'])
    // partialErrors is the field AGENTS.md rule 8 already tells the agent to
    // read out, so the omission reaches the human with no new agent contract.
    expect(r.partialErrors.join(' ')).toMatch(/instagram: no instagram account is connected/)
  })

  it('says nothing extra when every requested platform is connected', async () => {
    const { postToConnected } = await setup({
      publish: () => new Response(JSON.stringify({
        postId: 'zp1',
        platforms: [{ platform: 'facebook', success: true }, { platform: 'instagram', success: true }],
      }), { status: 200 }),
    })
    const r = await postToConnected({ ...LISTING, platforms: ['facebook', 'instagram'] })
    expect(r.ok).toBe(true)
    expect(r.skipped).toBeUndefined()
    expect(r.partialErrors).toBeUndefined()
  })

  it('a skipped platform does not mask a real per-platform failure', async () => {
    const { postToConnected } = await setup({
      accounts: [{ _id: 'z1', platform: 'facebook', username: 'page' }],
      publish: () => new Response(JSON.stringify({
        postId: 'zp1', status: 'failed',
        platforms: [{ platform: 'facebook', success: false, errorMessage: 'token expired' }],
      }), { status: 202 }),
    })
    const r = await postToConnected({ ...LISTING, platforms: ['facebook', 'instagram'] })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/token expired/)
  })
})

// 2. "RETRY IT" FOR SOMETHING NO RETRY CAN FIX.
//
// `postAll` always forks a reel child whose pending carries platforms:['tiktok'],
// so an agent with no TikTok gets this on every default post — after a model call
// for the script, an ffmpeg render and a Blob upload. approve.js stamps
// retryable:true on any !r.ok and AGENTS.md rule 7 tells the agent it can safely
// retry that id. Retrying IS safe; it simply cannot ever work. This refusal was
// the one shape carrying no `blocked` flag, so the agent had nothing to branch on
// but prose.
describe('a refusal only a human can clear says so', () => {
  it('flags "not connected" structurally and names what would change it', async () => {
    const { postToConnected } = await setup({ accounts: [{ _id: 'z1', platform: 'facebook', username: 'page' }] })
    const r = await postToConnected({ ...LISTING, platforms: ['tiktok'] })

    expect(r.ok).toBe(false)
    expect(r.blocked).toBe('notConnected')        // the flag approve.js carries through
    expect(r.needsConnect).toEqual(['tiktok'])
    expect(r.reason).toMatch(/cannot succeed on a retry/)
    expect(r.reason).toMatch(/connect/i)
  })

  it('still refuses, and still says why, when the profile has nothing connected at all', async () => {
    const { postToConnected } = await setup({ accounts: [] })
    const r = await postToConnected({ ...LISTING })
    expect(r.ok).toBe(false)
    expect(r.blocked).toBe('notConnected')
    expect(r.reason).toMatch(/connect/i)
  })
})

// 3. EVERY 4xx WAS REPORTED AS AN OUTAGE.
//
// connectedAccounts throws on any non-2xx and postToConnected's catch owned the
// wording, so a mistyped agent id read as "zernio unreachable" and sent whoever
// debugged it at Zernio's status page. Verified against the live API on
// 2026-09-08: an unknown profile really does 404 "Profile not found or access
// denied", and a malformed one 400s — so it is detectable, and nothing detected
// it. Half of this was already fixed (the provider's body is appended); the
// lying prefix survived, and the regression test only asserted the body.
describe('a provider that answered is not called unreachable', () => {
  it.each([
    [404, '{"error":"Profile not found or access denied"}'],
    [401, '{"error":"invalid api key"}'],
    [402, '{"error":"subscription inactive"}'],
  ])('a %i is reported as a refusal, with the provider\'s own words', async (status, body) => {
    const { postToConnected } = await setup({ accountsStatus: status, accountsBody: body })
    const r = await postToConnected({ ...LISTING, caption: `${LISTING.caption} ${status}` })
    expect(r.ok).toBe(false)
    expect(r.error).not.toMatch(/unreachable/)
    expect(r.error).toMatch(/refused/)
    expect(r.error).toMatch(String(status))
  })

  it('a genuine network failure IS still called unreachable', async () => {
    const { postToConnected } = await setup({ accountsThrows: new TypeError('fetch failed') })
    const r = await postToConnected({ ...LISTING, caption: `${LISTING.caption} net` })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/unreachable/)
    expect(r.error).toMatch(/fetch failed/)
  })
})

// -----------------------------------------------------------------------------
// AND THE SAME TWO FACTS, THROUGH THE ROUTE THE AGENT ACTUALLY CALLS.
//
// approve.js is where the ✅ lands, and it is where the agent reads its answer.
// Both of these were invisible there: `skipped` had nowhere to go, and the
// "not connected" refusal arrived as `retryable:true` with prose and no flag —
// AGENTS.md rule 7 then told the agent it could safely retry that id, which is
// true and useless: the reel child always carries platforms:['tiktok'], so an
// agent with no TikTok hit this on every default post, forever, after a model
// call, an ffmpeg render and a Blob upload.
describe('the ✅ route passes both facts on to the agent', () => {
  const pending = { getPending: vi.fn(), delPending: vi.fn(), claimPending: vi.fn(), releasePending: vi.fn() }
  const social = { postToConnected: vi.fn() }

  const approveOnce = async (postResult, item) => {
    vi.resetModules()
    vi.doMock('./pending.js', () => pending)
    vi.doMock('./social.js', () => social)
    vi.doMock('./feed.js', () => ({ appendFeed: vi.fn() }))
    vi.clearAllMocks()
    process.env.INGEST_SECRET = 's3cret'
    pending.claimPending.mockResolvedValue(true)
    pending.getPending.mockResolvedValue(item)
    social.postToConnected.mockResolvedValue(postResult)
    const { default: handler } = await import('../approve.js')
    const res = { statusCode: 0, body: null, headers: {} }
    res.setHeader = (k, v) => { res.headers[k] = v }
    res.end = (b) => { res.body = typeof b === 'string' ? JSON.parse(b) : b; return res }
    res.status = (c) => { res.statusCode = c; return res }
    res.writeHead = (c) => { res.statusCode = c; return res }
    await handler({ method: 'POST', url: '/api/approve', headers: { 'x-ingest-secret': 's3cret' }, body: { id: 'PEND1', decision: 'approve' } }, res)
    return res
  }

  it('a platform that was skipped is named in the answer, not swallowed', async () => {
    const res = await approveOnce(
      { ok: true, platforms: ['facebook'], skipped: ['instagram'], partialErrors: ['instagram: no instagram account is connected on this profile — not posted'] },
      { caption: 'a real caption', profileId: 'p1', mediaItems: [], platforms: ['facebook', 'instagram'] },
    )
    expect(res.statusCode).toBe(200)
    expect(res.body.posted).toEqual(['facebook'])
    expect(res.body.skipped).toEqual(['instagram'])
    expect(res.body.partialErrors.join(' ')).toMatch(/instagram/)
  })

  it('a refusal only a human can clear reaches the agent with its flag and its reason', async () => {
    const res = await approveOnce(
      { ok: false, blocked: 'notConnected', needsConnect: ['tiktok'], reason: 'No tiktok account connected yet — this cannot succeed on a retry; the agent has to connect tiktok on the Connect page first, then ✅ again' },
      { caption: 'a real caption', profileId: 'p1', mediaItems: [], platforms: ['tiktok'] },
    )
    expect(res.body.ok).toBe(false)
    expect(res.body.blocked).toBe('notConnected')
    expect(res.body.reason).toMatch(/cannot succeed on a retry/)
    // retryable stays TRUE and that is correct — AGENTS.md defines it as
    // "nothing was published and you CAN safely retry", and nothing was
    // published: the claim was released. What was missing is the flag telling
    // the agent a retry cannot change the answer, and that is now present.
    expect(res.body.retryable).toBe(true)
    expect(pending.releasePending).toHaveBeenCalledWith('PEND1')
  })
})

// ---------------------------------------------------------------------------
// THE REVIEWER'S COUNTEREXAMPLES.
//
// The rewrite claimed "0 previously-firing phrasings lost". It lost two: a ban
// written as a PHRASE rather than a word. The lead consumed an article but not a
// bare "the", so "Never say the price is negotiable" left four words for a
// matcher that takes three, and the rule silently stopped applying — which an
// agent never notices, because nothing reports a style rule that quietly
// stopped firing.
describe('a ban written as a phrase still fires', () => {
  it.each([
    ['Never say the price is negotiable', 'price is negotiable'],
    ['Never mention the price is negotiable', 'price is negotiable'],
    ['Never say negotiable', 'negotiable'],
  ])('%s', (rule, want) => {
    expect(bannedWord(rule)).toBe(want)
  })

  it('and the phrasings that already worked still do', () => {
    for (const [rule, want] of [
      ['never call a condo an apartment', 'apartment'],
      ["Don't call it an apartment, it's a condo", 'apartment'],
      ['Never use the word apartment — it is a condo', 'apartment'],
      ['Always say condo, never apartment', 'apartment'],
      ['Never say luxury', 'luxury'],
      ["Don't say luxury", 'luxury'],
      ['jangan guna perkataan apartment', 'apartment'],
    ]) {
      expect(bannedWord(rule), rule).toBe(want)
    }
  })

  it('a NAMED EMOJI is still not a word ban', () => {
    // Reachable only once a bare "the" counted as scaffolding. Treated as a word
    // ban it would hunt the letters "fire emoji" in the caption and never find
    // them, while the real rule went unenforced — and this is the rule that has
    // already cost a client their whole caption format once.
    expect(bannedWord('never use the fire emoji')).toBeNull()
    expect(bannedWord('never use any emoji')).toBeNull()
    expect(ruleViolations('Hot unit 🔥 RM450,000', ['never use the fire emoji']).length).toBeGreaterThan(0)
  })
})

// The auto path publishes with NO HUMAN IN THE LOOP, so its response is the only
// place a skipped platform can ever be noticed. postToConnected has two callers
// and only approve.js was wired.
describe('the auto path reports a platform it could not post to', () => {
  it('carries skipped and partialErrors through', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../ingest.js', import.meta.url), 'utf8'))
    const auto = src.slice(src.indexOf("mode: 'auto'") - 400, src.indexOf("mode: 'auto'") + 400)
    expect(auto).toMatch(/r\.skipped\?\.length \? \{ skipped: r\.skipped \}/)
    expect(auto).toMatch(/r\.partialErrors\?\.length \? \{ partialErrors: r\.partialErrors \}/)
  })
})
