// Provider abstraction for the content engine. One `runModel(prompt)` entry
// point; adapters for Gemini (free tier, default) and Claude (ready to flip on
// via AI_PROVIDER=claude once revenue covers the pennies-per-listing).
//
// Reads config from process.env at call time so dev middleware and Vercel
// functions behave identically.

const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash'
const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5'

export function providerStatus() {
  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase()
  const hasGemini = !!process.env.GEMINI_API_KEY
  const hasClaude = !!process.env.ANTHROPIC_API_KEY
  const active = provider === 'claude' ? hasClaude : hasGemini
  return { provider, hasGemini, hasClaude, configured: active }
}

/**
 * Run the active provider with a prompt, returning raw model text.
 * Throws on transport/API errors so the caller can fall back to demo mode.
 */
export async function runModel(prompt) {
  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase()
  if (provider === 'claude') return runClaude(prompt)
  return runGemini(prompt)
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
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`)
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
    throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 300)}`)
  }
  const data = await res.json()
  const text = (data?.content || []).map((b) => b.text || '').join('')
  if (!text) throw new Error('Anthropic returned no text')
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
