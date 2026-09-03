// The provider chain, tested by breaking providers rather than by hoping.
//
// Groq is the free stopgap the whole product currently runs its captions on,
// with Gemini behind it. The question that matters is not "does Groq work" but
// "what happens the morning Groq doesn't" - and that had never been exercised.
// Real keys cannot be used here (Vercel masks secrets on `env pull`), so these
// break the HTTP layer instead, which is where the failures actually arrive.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const GOOD = JSON.stringify({ facebook_page: 'Tropics City RM338,000' })
const realFetch = globalThis.fetch

const install = (behaviour) => {
  const tried = []
  globalThis.fetch = vi.fn(async (url) => {
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
  })
  return tried
}

// A fresh module each time: providerChain() reads env at call time, but the
// adapters close over module state, so a cached copy would leak between cases.
// (A `?v=` cache-buster works under plain node but Vite refuses a variable
// dynamic import, so reset the registry instead.)
const load = async () => { vi.resetModules(); return import('./providers.js') }

const ENV = ['AI_PROVIDER', 'AI_FALLBACK_PROVIDER', 'GROQ_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_RETRY_BUDGET_MS']
beforeEach(() => { for (const k of ENV) delete process.env[k] })
afterEach(() => { globalThis.fetch = realFetch })

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
