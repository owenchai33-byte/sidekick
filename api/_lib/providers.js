// Provider abstraction for the content engine. One `runModel(prompt)` entry
// point; adapters for Gemini (free tier, default) and Claude (ready to flip on
// via AI_PROVIDER=claude once revenue covers the pennies-per-listing).
//
// Reads config from process.env at call time so dev middleware and Vercel
// functions behave identically.

const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash'
const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5'
// gpt-oss-20b, not llama-3.3-70b-versatile: the llama model carries an
// Enterprise designation and is absent from Groq's free-tier table, so a free
// key would fail with model-not-found. gpt-oss-20b is on the free tier, is the
// fastest production model they list (~1000 T/s) and has a 131K context, which
// is ample for a caption prompt. Override with GROQ_MODEL.
const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-20b'

// A single 429 used to drop us straight to demo boilerplate. Gemini's free tier
// refuses in bursts and recovers within seconds, so one immediate retry converts
// most of those failures into a real caption. Measured 2026-09-01: the parser and
// the caption writer, called seconds apart, disagreed constantly.
//
// Everything here runs inside a Vercel function with no maxDuration set (~10s on
// Hobby), so retries are bounded by a WALL-CLOCK BUDGET, not just an attempt
// count. Blowing the budget would turn a slow caption into a dead request, which
// is worse than a degraded one.
const TRANSIENT = new Set([408, 409, 425, 429, 500, 502, 503, 504])
const retryBudgetMs = () => Number(process.env.AI_RETRY_BUDGET_MS || 6000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Providers to try, in order: the configured one, then any listed in
// AI_FALLBACK_PROVIDER (comma-separated). Only providers whose key is actually
// present are attempted, so an unset fallback silently costs nothing.
function providerChain() {
  const primary = (process.env.AI_PROVIDER || 'gemini').toLowerCase()
  const extra = (process.env.AI_FALLBACK_PROVIDER || '')
    .toLowerCase().split(',').map((x) => x.trim()).filter(Boolean)
  const keyed = { gemini: 'GEMINI_API_KEY', claude: 'ANTHROPIC_API_KEY', groq: 'GROQ_API_KEY' }
  const seen = new Set()
  return [primary, ...extra].filter((p) => {
    if (seen.has(p) || !keyed[p] || !process.env[keyed[p]]) return false
    seen.add(p)
    return true
  })
}

function adapterFor(p) {
  if (p === 'claude') return runClaude
  if (p === 'groq') return runGroq
  return runGemini
}

// Retry one provider while its errors look transient and the budget allows.
async function withRetry(fn, deadline) {
  let attempt = 0, lastErr
  for (;;) {
    try { return await fn() } catch (e) {
      lastErr = e
      const waited = Math.min(500 * 2 ** attempt, 2500) + Math.floor(Math.random() * 200)
      attempt += 1
      // Give up if the error is permanent (bad key, bad request) or if sleeping
      // then retrying would run past the deadline.
      if (!e?.transient || Date.now() + waited >= deadline) throw lastErr
      await sleep(waited)
    }
  }
}

export function providerStatus() {
  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase()
  const hasGemini = !!process.env.GEMINI_API_KEY
  const hasClaude = !!process.env.ANTHROPIC_API_KEY
  const hasGroq = !!process.env.GROQ_API_KEY
  // Configured means SOMETHING in the chain can run, not just the primary.
  const chain = providerChain()
  return { provider, hasGemini, hasClaude, hasGroq, chain, configured: chain.length > 0 }
}

/**
 * Run the active provider with a prompt, returning raw model text.
 * Throws on transport/API errors so the caller can fall back to demo mode.
 */
export async function runModel(prompt) {
  const chain = providerChain()
  if (!chain.length) throw new Error('no AI provider configured (set GEMINI_API_KEY)')
  const deadline = Date.now() + retryBudgetMs()
  let lastErr
  for (const p of chain) {
    try { return await withRetry(() => adapterFor(p)(prompt), deadline) } catch (e) {
      lastErr = e
      // Move to the next provider only if there is time left to try it.
      if (Date.now() >= deadline) break
    }
  }
  throw lastErr || new Error('all AI providers failed')
}

async function runGemini(prompt) {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not set')
  const model = process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, responseMimeType: 'application/json' },
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const err = new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`)
    err.status = res.status
    err.transient = TRANSIENT.has(res.status)
    throw err
  }
  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || ''
  if (!text) throw new Error('Gemini returned no text')
  return text
}

async function runClaude(prompt) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY not set')
  const model = process.env.ANTHROPIC_MODEL || ANTHROPIC_DEFAULT_MODEL

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0.8,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const err = new Error(`Anthropic ${res.status}: ${detail.slice(0, 300)}`)
    err.status = res.status
    err.transient = TRANSIENT.has(res.status)
    throw err
  }
  const data = await res.json()
  const text = (data?.content || []).map((b) => b.text || '').join('')
  if (!text) throw new Error('Anthropic returned no text')
  return text
}

// Groq's free tier, OpenAI-compatible. Exists so the caption engine survives a
// Gemini outage without a paid second vendor: set GROQ_API_KEY and
// AI_FALLBACK_PROVIDER=groq. Never used unless the key is present.
async function runGroq(prompt) {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY not set')
  const model = process.env.GROQ_MODEL || GROQ_DEFAULT_MODEL

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      // gpt-oss models burn REASONING tokens against the same rate limit as
      // output: one caption call measured 4,146 tokens, 1,685 of them reasoning,
      // against an 8,000/min free-tier budget - barely one listing a minute.
      // reasoning_effort low cut it to 2,945 total (445 reasoning) with the
      // format intact. A caption does not need chain-of-thought.
      ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const err = new Error(`Groq ${res.status}: ${detail.slice(0, 300)}`)
    err.status = res.status
    err.transient = TRANSIENT.has(res.status)
    throw err
  }
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content || ''
  if (!text) throw new Error('Groq returned no text')
  return text
}

/**
 * Parse model output that is supposed to be JSON. Tolerates stray markdown
 * fences or leading prose by extracting the outermost {...} block.
 */
export function extractJson(text) {
  if (!text) throw new Error('Empty model output')
  let t = text.trim()
  // Strip ```json ... ``` fences if present
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    return JSON.parse(t)
  } catch {
    const start = t.indexOf('{')
    const end = t.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(t.slice(start, end + 1))
    }
    throw new Error('Model did not return valid JSON')
  }
}

// Vision: prompt + inline images → text (used to pick the best cover photo).
// Gemini-only for now (the free default); other providers throw.
export async function runModelVision(prompt, images) {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not set (vision needs Gemini)')
  const model = process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const parts = [{ text: prompt }, ...images.map((img) => ({ inline_data: { mime_type: img.mimeType || 'image/jpeg', data: img.data } }))]
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Gemini vision ${res.status}: ${detail.slice(0, 200)}`)
  }
  const data = await res.json()
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || ''
}
