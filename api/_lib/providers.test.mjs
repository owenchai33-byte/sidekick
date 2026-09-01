// Proves the caption engine survives the failure that actually bit us on
// 2026-09-01: Gemini answering 429 in bursts and recovering seconds later.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { runModel, providerStatus } from './providers.js'

const realFetch = globalThis.fetch
const geminiOk = (text) => ({
  ok: true, status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
})
const fail = (status) => ({ ok: false, status, text: async () => `{"error":{"code":${status}}}` })

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key'
  process.env.AI_RETRY_BUDGET_MS = '3000'
  delete process.env.AI_PROVIDER
  delete process.env.AI_FALLBACK_PROVIDER
  delete process.env.GROQ_API_KEY
  delete process.env.ANTHROPIC_API_KEY
})
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks() })

describe('runModel resilience', () => {
  it('retries a 429 and returns the real caption', async () => {
    const calls = []
    globalThis.fetch = vi.fn(async () => {
      calls.push(1)
      return calls.length === 1 ? fail(429) : geminiOk('{"caption":"real"}')
    })
    expect(await runModel('x')).toBe('{"caption":"real"}')
    expect(calls.length).toBe(2) // it did not give up on the first 429
  })

  it('does NOT retry a permanent error (bad key)', async () => {
    const calls = []
    globalThis.fetch = vi.fn(async () => { calls.push(1); return fail(401) })
    await expect(runModel('x')).rejects.toThrow(/401/)
    expect(calls.length).toBe(1) // retrying a bad key just burns the budget
  })

  it('falls back to a second provider when the first stays down', async () => {
    process.env.GROQ_API_KEY = 'groq-key'
    process.env.AI_FALLBACK_PROVIDER = 'groq'
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('generativelanguage')) return fail(429)
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"from":"groq"}' } }] }) }
    })
    expect(await runModel('x')).toBe('{"from":"groq"}')
  })

  it('gives up inside the time budget instead of hanging the request', async () => {
    process.env.AI_RETRY_BUDGET_MS = '1200'
    globalThis.fetch = vi.fn(async () => fail(429))
    const t0 = Date.now()
    await expect(runModel('x')).rejects.toThrow(/429/)
    expect(Date.now() - t0).toBeLessThan(3000) // never runs past the function timeout
  })

  it('reports configured=false when no provider has a key', () => {
    delete process.env.GEMINI_API_KEY
    expect(providerStatus().configured).toBe(false)
  })
})
