// The provider chain, tested by breaking providers rather than by hoping.
//
// Groq is the free stopgap the whole product currently runs its captions on,
// with Gemini behind it. The question that matters is not "does Groq work" but
// "what happens the morning Groq doesn't" - and that had never been exercised.
// Real keys cannot be used here (Vercel masks secrets on `env pull`), so these
// break the HTTP layer instead, which is where the failures actually arrive.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const GOOD = JSON.stringify({ facebook_page: 'Tropics City RM338,000' })

// Replace fetch through vi.stubGlobal rather than by assigning to globalThis:
// vitest then guarantees it is put back, even if a test throws before its
// afterEach. Assigning directly leaves a live stub behind on a failure path,
// and the next file to run gets a fetch that answers every URL with a caption.
const install = (behaviour) => {
  const tried = []
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url)
    const who = /groq/.test(u) ? 'groq'
      : /generativelanguage|googleapis/.test(u) ? 'gemini'
      : /anthropic/.test(u) ? 'claude' : 'unknown'
    tried.push(who)
    const b = behaviour[who]
    if (b === '500') return new Response('upstream boom', { status: 500 })
    if (b === '429') return new Response(JSON.stringify({ error: { message: 'rate limit reached' } }),
      { status: 429, headers: { 'retry-after': '1' } })
    if (b === '401') return new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: 401 })
    const body = who === 'gemini' ? { candidates: [{ content: { parts: [{ text: GOOD }] } }] }
      : who === 'claude' ? { content: [{ text: GOOD }] }
      : { choices: [{ message: { content: GOOD } }] }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  return tried
}

// A fresh module each time: providerChain() reads env at call time, but the
// adapters close over module state, so a cached copy would leak between cases.
// (A `?v=` cache-buster works under plain node but Vite refuses a variable
// dynamic import, so reset the registry instead.)
const load = async () => { vi.resetModules(); return import('./providers.js') }

const ENV = ['AI_PROVIDER', 'AI_FALLBACK_PROVIDER', 'GROQ_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_RETRY_BUDGET_MS']
beforeEach(() => { for (const k of ENV) delete process.env[k] })
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

const KEYED = { GROQ_API_KEY: 'gsk_test', GEMINI_API_KEY: 'AIza_test', AI_RETRY_BUDGET_MS: '3000' }
const ask = async () => (await (await load()).runModel('give me the json'))

describe('the caption engine survives its provider', () => {
  it('uses the primary when it is healthy', async () => {
    Object.assign(process.env, { AI_PROVIDER: 'groq', ...KEYED })
    const tried = install({ groq: 'ok' })
    expect(await ask()).toContain('338,000')
    expect([...new Set(tried)]).toEqual(['groq'])
  })

  for (const [label, code] of [['is down', '500'], ['has a dead key', '401'], ['is rate limited', '429']]) {
    it(`falls over to Gemini when Groq ${label}`, async () => {
      Object.assign(process.env, { AI_PROVIDER: 'groq', AI_FALLBACK_PROVIDER: 'gemini', ...KEYED })
      const tried = install({ groq: code, gemini: 'ok' })
      expect(await ask()).toContain('338,000')
      expect([...new Set(tried)]).toEqual(['groq', 'gemini'])
    })
  }

  it('fails loudly when every provider is down, rather than inventing a caption', async () => {
    Object.assign(process.env, { AI_PROVIDER: 'groq', AI_FALLBACK_PROVIDER: 'gemini', ...KEYED })
    install({ groq: '500', gemini: '500' })
    // The publish gate turns a thrown error into a held post. A returned string
    // here would become a real caption on a real page.
    await expect(ask()).rejects.toThrow()
  })

  it('does not try a fallback whose key is missing', async () => {
    Object.assign(process.env, { AI_PROVIDER: 'groq', AI_FALLBACK_PROVIDER: 'claude', ...KEYED })
    const tried = install({ groq: '500', claude: 'ok' })
    await expect(ask()).rejects.toThrow()
    expect(tried).not.toContain('claude')
  })

  it('works the other way round too, so the pair can be swapped', async () => {
    Object.assign(process.env, { AI_PROVIDER: 'gemini', AI_FALLBACK_PROVIDER: 'groq', ...KEYED })
    const tried = install({ gemini: '500', groq: 'ok' })
    expect(await ask()).toContain('338,000')
    expect([...new Set(tried)]).toEqual(['gemini', 'groq'])
  })
})

// Per-minute and per-day limits need opposite handling.
//
// Groq words both as "Rate limit reached" and only the bracketed code separates
// them. A per-minute limit clears in seconds and is worth waiting out. A daily
// budget clears at midnight, which no retry budget reaches - so treating it as
// transient made every request burn the full 75s before handing over to the
// next provider. On the day Groq's allowance runs out, that is the difference
// between a quiet handover and the whole product crawling.
describe('a daily budget hands over, a per-minute limit waits', () => {
  const load = async () => { vi.resetModules(); return import('./providers.js') }
  const KEYED = { GROQ_API_KEY: 'gsk_test', GEMINI_API_KEY: 'AIza_test' }

  const groqSaying = (message, geminiOk = true) => {
    const tried = []
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url)
      if (/groq/.test(u)) {
        tried.push('groq')
        return new Response(JSON.stringify({ error: { message } }), { status: 429 })
      }
      tried.push('gemini')
      return new Response(JSON.stringify(geminiOk
        ? { candidates: [{ content: { parts: [{ text: GOOD }] } }] }
        : { error: { message: 'nope' } }), { status: geminiOk ? 200 : 500 })
    }))
    return tried
  }

  it('hands a spent DAILY budget straight to the fallback', async () => {
    Object.assign(process.env, { AI_PROVIDER: 'groq', AI_FALLBACK_PROVIDER: 'gemini', ...KEYED, AI_RETRY_BUDGET_MS: '5000' })
    const tried = groqSaying('Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 198534. Please try again in 10m34.6s')
    const { runModel } = await load()
    const started = Date.now()
    expect(await runModel('x')).toContain('338,000')
    // Two Groq calls - the main model, then the backup model, which has its own
    // daily budget - and then out to Gemini. NOT seven blind retries against a
    // budget that only returns at midnight.
    expect(tried.filter((t) => t === 'groq')).toHaveLength(2)
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it('still waits out a PER-MINUTE limit before giving up on the primary', async () => {
    Object.assign(process.env, { AI_PROVIDER: 'groq', AI_FALLBACK_PROVIDER: 'gemini', ...KEYED, AI_RETRY_BUDGET_MS: '2500' })
    // "try again in 0.4s" fits inside the budget below; a 12s wait would
    // correctly be abandoned on the first attempt, which would prove nothing.
    const tried = groqSaying('Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Used 7900. Please try again in 0.4s')
    const { runModel } = await load()
    await runModel('x')
    expect(tried.filter((t) => t === 'groq').length).toBeGreaterThan(1)
  })
})

// A second model is a second daily budget.
//
// The free tier meters tokens per day PER MODEL. When the main model's 200,000
// are gone, waiting achieves nothing (they return at midnight) and falling
// through to a paid provider spends money while a perfectly good free allowance
// sits unused. Verified live on a day the main model was genuinely spent: the
// backup answered in 1.2s with a contract-clean caption.
describe('a spent daily budget moves to the other free model', () => {
  const load = async () => { vi.resetModules(); return import('./providers.js') }
  const TPD = 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 198997'

  it('retries on the backup model rather than giving up on Groq', async () => {
    Object.assign(process.env, { AI_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_test', AI_RETRY_BUDGET_MS: '3000' })
    const models = []
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      const model = JSON.parse(opts.body).model
      models.push(model)
      if (model === 'openai/gpt-oss-120b') return new Response(JSON.stringify({ error: { message: TPD } }), { status: 429 })
      return new Response(JSON.stringify({ choices: [{ message: { content: GOOD } }] }), { status: 200 })
    }))
    const { runModel } = await load()
    expect(await runModel('x')).toContain('338,000')
    expect(models).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b'])
  })

  it('does not loop when the backup is spent too — it hands to the next provider', async () => {
    Object.assign(process.env, {
      AI_PROVIDER: 'groq', AI_FALLBACK_PROVIDER: 'gemini',
      GROQ_API_KEY: 'gsk_test', GEMINI_API_KEY: 'AIza_test', AI_RETRY_BUDGET_MS: '3000',
    })
    const seen = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (/groq/.test(String(url))) {
        seen.push(JSON.parse(opts.body).model)
        return new Response(JSON.stringify({ error: { message: TPD } }), { status: 429 })
      }
      seen.push('gemini')
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: GOOD }] } }] }), { status: 200 })
    }))
    const { runModel } = await load()
    expect(await runModel('x')).toContain('338,000')
    // Each Groq model tried exactly once, then out to Gemini. No recursion.
    expect(seen).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'gemini'])
  })

  // REVERSED, on production evidence. This used to assert that a per-MINUTE
  // limit waits on the better model instead of switching. Waiting is only right
  // if the wait ends in a caption: measured 2026-09-11 12:54 and 2026-09-12
  // 10:51 (Edward's shoplot), it ended at "gemini 429: Your prepayment credits
  // are depleted" and the client got demo boilerplate, while gpt-oss-20b's
  // separate per-minute allowance went unused. One listing is ~13,000 tokens
  // against 8,000/minute, so that minute is genuinely spent.
  it('a LONG per-minute wait moves to the backup model, which has its own minute', async () => {
    Object.assign(process.env, { AI_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_test', AI_RETRY_BUDGET_MS: '2000' })
    const models = []
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      const model = JSON.parse(opts.body).model
      models.push(model)
      if (model === 'openai/gpt-oss-120b') {
        return new Response(JSON.stringify({ error: { message: 'Rate limit reached on tokens per minute (TPM): Limit 8000. Please try again in 21.6s' } }), { status: 429 })
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: GOOD } }] }), { status: 200 })
    }))
    const { runModel } = await load()
    expect(await runModel('x')).toContain('338,000')
    // The better model is still asked first.
    expect(models).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b'])
  })

  it('a SHORT per-minute wait keeps the better model and waits it out', async () => {
    Object.assign(process.env, { AI_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_test', AI_RETRY_BUDGET_MS: '5000' })
    const models = []
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      const model = JSON.parse(opts.body).model
      models.push(model)
      if (models.length === 1) {
        return new Response(JSON.stringify({ error: { message: 'Rate limit reached on tokens per minute (TPM): Limit 8000. Please try again in 0.4s' } }), { status: 429 })
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: GOOD } }] }), { status: 200 })
    }))
    const { runModel } = await load()
    expect(await runModel('x')).toContain('338,000')
    expect(models).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-120b'])
  })

  // Edward's shoplot, 2026-09-12 10:51, replayed end to end.
  it("Edward's caption: Groq out of minute, Gemini out of credit — a real caption still comes back", async () => {
    Object.assign(process.env, {
      AI_PROVIDER: 'groq', AI_FALLBACK_PROVIDER: 'gemini',
      GROQ_API_KEY: 'gsk_test', GEMINI_API_KEY: 'AIza_test', AI_RETRY_BUDGET_MS: '2000',
    })
    const seen = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (/generativelanguage/.test(String(url))) {
        seen.push('gemini')
        return new Response(JSON.stringify({ error: { message: 'Your prepayment credits are depleted.' } }), { status: 429 })
      }
      const model = JSON.parse(opts.body).model
      seen.push(model)
      if (model === 'openai/gpt-oss-120b') {
        return new Response(JSON.stringify({ error: { message: 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 7913. Please try again in 21.6s' } }), { status: 429 })
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: GOOD } }] }), { status: 200 })
    }))
    const { runModel } = await load()
    expect(await runModel('caption this listing')).toContain('338,000')
    // Never reaches the dead key, so nothing degrades to demo text.
    expect(seen).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b'])
  })

  it('records which model answered, and that it was a fallback', async () => {
    Object.assign(process.env, { AI_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_test', AI_RETRY_BUDGET_MS: '2000' })
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      const model = JSON.parse(opts.body).model
      if (model === 'openai/gpt-oss-120b') {
        return new Response(JSON.stringify({ error: { message: 'Rate limit reached on tokens per minute (TPM): Limit 8000' } }), { status: 429 })
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: GOOD } }] }), { status: 200 })
    }))
    const { runModel } = await load()
    const trace = []
    await runModel('x', trace)
    expect(trace).toEqual([{ provider: 'groq', model: 'openai/gpt-oss-20b', fellBackFrom: 'openai/gpt-oss-120b 429 (minute spent)' }])
  })
})
