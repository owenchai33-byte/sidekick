// Provider abstraction for the content engine. Two entry points -
// `runModel(prompt)` for text and `runModelVision(prompt, images)` for photos -
// each walking its own chain; adapters for Gemini (free tier, default) and
// Claude (ready to flip on via AI_PROVIDER=claude once revenue covers the
// pennies-per-listing). The two chains are separate because the text primary
// (Groq) cannot see images.
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
// gpt-oss-120b, not 20b. Two reasons, both found on 2026-09-03:
//
// 1. Every caption-quality measurement this project has - 9/9 facts kept across
//    three agent styles and three listing shapes, zero invented claims - was
//    taken on 120b. Production was quietly running the smaller 20b, so the
//    numbers being relied on were never the numbers being shipped.
// 2. The free tier meters tokens per day PER MODEL (200,000), and it is only
//    the 429 body that says so - the response headers advertise the 8,000/min
//    limit and nothing else, so a day's budget disappears with no warning. A
//    day of load testing exhausted 20b's allowance and every caption fell back
//    to demo text for hours, while 120b answered normally the whole time.
const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b'

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

// Not every 429 is worth waiting for. A rate limit clears in seconds; a depleted
// prepaid balance or an exhausted daily quota clears when somebody pays, which
// no retry budget can outlast. Measured 2026-09-03 against the real (depleted)
// Gemini key: retrying its 429 spent 11.8 seconds and seven image uploads before
// giving up, on a Vercel function that is killed at about ten - so the caller
// never even received the degraded answer. Treated as permanent, the same call
// fails over in well under a second.
// A PER-MINUTE limit is worth waiting out - it clears in seconds. A per-DAY
// limit is not: it clears at midnight, which no retry budget reaches. Groq
// words both as "Rate limit reached", and only the bracketed code tells them
// apart (TPM/RPM vs TPD/RPD). Left as transient, a spent daily budget made
// every single request burn the full 75s retry budget before falling through
// to the next provider - so the day Groq's allowance runs out, the whole
// product would crawl instead of quietly handing over.
const SPENT = /prepayment credits are depleted|quota|billing|exceeded your current quota|insufficient|payment|per day|\b(TPD|RPD)\b/i
function isTransient(status, body) {
  if (!TRANSIENT.has(status)) return false
  if (status === 429 && SPENT.test(String(body || ''))) return false
  return true
}
// 6s could not outlast a per-MINUTE rate limit, so a morning burst degraded
// captions that would have succeeded seconds later. 75s covers Groq's window
// with room to spare. Callers are background jobs holding a WhatsApp "building
// your post..." message, not a user staring at a spinner.
// MEASURED CEILING, 2026-09-03 - read this before promising anyone volume.
//
// Groq's free tier allows 8,000 tokens PER MINUTE (and 1,000 requests/day).
// One styled caption prompt is ~2,790 tokens before the reply, and a single
// listing makes several calls (parse, write, up to two contract repairs, then
// the reel script) - roughly 13,000 tokens. So ONE listing already exceeds the
// per-minute budget on its own.
//
// In practice: listings arriving one after another are fine, because the budget
// refills between them. THREE ARRIVING AT ONCE IS NOT - tested against the
// deployed app, three concurrent listings each spent 75-150s retrying and then
// fell back to demo text, which the publish gate correctly refused. The agents
// got nothing. Ten concurrent behaved the same way.
//
// No retry budget fixes this; the limit is per-minute and the work does not fit.
// Serving 30+ agents whose mornings overlap needs a paid tier with a materially
// higher token-per-minute allowance, not a code change.
const retryBudgetMs = () => Number(process.env.AI_RETRY_BUDGET_MS || 75000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// "1m26.4s" / "577ms" / "12.3" -> milliseconds. Groq reports the reset window
// on every response; on a 429 it is the difference between waiting the right
// two seconds and giving up on a caption that would have succeeded.
function durationToMs(v) {
  if (!v) return 0
  const t = String(v).trim()
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(parseFloat(t) * 1000)   // bare seconds
  let ms = 0
  for (const [, n, u] of t.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h)/g)) {
    const f = u === 'ms' ? 1 : u === 's' ? 1000 : u === 'm' ? 60000 : 3600000
    ms += parseFloat(n) * f
  }
  return Math.round(ms)
}

function parseRetryAfter(headers, body) {
  const h = (k) => { try { return headers?.get?.(k) } catch { return null } }
  const direct = durationToMs(h('retry-after'))
  if (direct) return direct
  // token limits reset far sooner than request limits; take the smaller usable one
  const cands = [durationToMs(h('x-ratelimit-reset-tokens')), durationToMs(h('x-ratelimit-reset-requests'))].filter((x) => x > 0)
  if (cands.length) return Math.min(...cands)
  const m = String(body || '').match(/try again in ([\d.]+\s*\w+)/i)
  return m ? durationToMs(m[1]) : 0
}

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
      // A rate limit tells us exactly how long to wait; anything else backs off.
      const waited = e?.retryAfterMs
        ? Math.min(e.retryAfterMs + 500, 45000)
        : Math.min(500 * 2 ** attempt, 2500) + Math.floor(Math.random() * 200)
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

// The human sentence out of a provider's JSON envelope. This message ends up in
// a WhatsApp reply to an agent and in an operator alert, so `{"error":{"message":
// "..."}}` is 40 wasted characters of the ~140 each attempt gets.
function briefly(message) {
  const body = String(message || '').replace(/^\S+ (?:vision )?\d+:\s*/, '')
  try {
    const t = JSON.parse(body)?.error?.message
    if (t) return String(t).replace(/\s+/g, ' ').trim().slice(0, 140)
  } catch { /* Every adapter slices the upstream body to 200-300 chars, so a REAL
    Groq 413 envelope arrives as TRUNCATED JSON and never parses. Falling back to
    the raw body prints the envelope this function exists to strip — the operator
    alert is then mostly punctuation. Pull the sentence out by hand instead. */ }
  const m = body.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)/)
  const text = m ? m[1].replace(/\\(["\\/])/g, '$1').replace(/\\[nrt]/g, ' ') : body
  return text.replace(/\s+/g, ' ').trim().slice(0, 140)
}

// EVERY provider's failure, not just the last one.
//
// This loop used to keep `lastErr` and throw it, so with the production chain
// [groq, gemini] the operator was told "Gemini 429: your prepayment credits are
// depleted" whatever Groq had actually done — and Groq is the primary and the
// only funded provider, so the message named the wrong system 100% of the time.
// Measured live 2026-09-09 against /api/generate on production: a 500-token
// request and a 26,000-token one failed for obviously different reasons and both
// surfaced the identical Gemini billing string.
//
// The throw happens on exactly the same condition as before and the same callers
// still catch it; only the message changes, plus `attempts` for anything that
// wants the parts rather than the sentence.
function chainError(attempts, lastErr) {
  if (!attempts.length) return lastErr || new Error('all AI providers failed')
  const err = new Error(attempts
    .map((a) => `${a.provider}${a.status ? ` ${a.status}` : ''}: ${briefly(a.message)}`)
    .join(' | '))
  err.attempts = attempts
  // The PRIMARY's status, not the last provider's: the primary is what the
  // product runs on, so that is the number worth acting on.
  err.status = attempts[0].status ?? null
  err.cause = lastErr
  return err
}

/**
 * Run the active provider with a prompt, returning raw model text.
 * Throws on transport/API errors so the caller can fall back to demo mode.
 *
 * `trace`, when given, is an array the adapter that ANSWERED appends one entry
 * to: { provider, model, fellBackFrom? }. Nothing recorded which model wrote a
 * caption, and the Groq adapter silently swaps to its smaller backup on a 413
 * or a spent day — so on 2026-09-11 a caption came back in a flattened format
 * and there was no way to say whether the backup model or the repair round had
 * written it. The answer is now carried out with the caption instead of guessed.
 */
export async function runModel(prompt, trace) {
  const chain = providerChain()
  if (!chain.length) throw new Error('no AI provider configured (set GEMINI_API_KEY)')
  const deadline = Date.now() + retryBudgetMs()
  let lastErr
  const attempts = []
  for (const p of chain) {
    try { return await withRetry(() => adapterFor(p)(prompt, Array.isArray(trace) ? trace : null), deadline) } catch (e) {
      lastErr = e
      attempts.push({ provider: p, status: e?.status ?? null, message: String(e?.message || e) })
      // Move to the next provider only if there is time left to try it.
      if (Date.now() >= deadline) break
    }
  }
  throw chainError(attempts, lastErr)
}

async function runGemini(prompt, trace) {
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
    err.transient = isTransient(res.status, detail)
    throw err
  }
  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || ''
  if (!text) throw new Error('Gemini returned no text')
  trace?.push({ provider: 'gemini', model })
  return text
}

async function runClaude(prompt, trace) {
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
    err.transient = isTransient(res.status, detail)
    throw err
  }
  const data = await res.json()
  const text = (data?.content || []).map((b) => b.text || '').join('')
  if (!text) throw new Error('Anthropic returned no text')
  trace?.push({ provider: 'claude', model })
  return text
}

// Groq's free tier, OpenAI-compatible. Exists so the caption engine survives a
// Gemini outage without a paid second vendor: set GROQ_API_KEY and
// AI_FALLBACK_PROVIDER=groq. Never used unless the key is present.
// The free tier meters tokens per day PER MODEL, so a second model is a second
// 200,000-token budget - roughly doubling the day's capacity for nothing. The
// backup is smaller and writes a slightly plainer caption, which is why it is
// only ever reached once the main model's day is genuinely spent: every caption
// still has to pass the same contract before it can be published, so the
// trade is a plainer caption instead of no caption at all, and an agent at 9am
// gets a post rather than a refusal.
const GROQ_BACKUP_MODEL = process.env.GROQ_BACKUP_MODEL || 'openai/gpt-oss-20b'
// A rate-limit window this short is worth waiting out on the better model.
// Anything longer and the caption is better served by the backup model's own
// minute — see the reasoning at the 429 branch in runGroq.
const QUICK_RETRY_MS = Number(process.env.GROQ_QUICK_RETRY_MS || 3000)

async function runGroq(prompt, trace, modelOverride, fellBackFrom) {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY not set')
  const model = modelOverride || process.env.GROQ_MODEL || GROQ_DEFAULT_MODEL

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
    err.transient = isTransient(res.status, detail)
    // A rate limit is not a failure, it is a queue. Groq says exactly how long
    // to wait; honour it instead of burning the budget on blind backoff.
    if (res.status === 429) err.retryAfterMs = parseRetryAfter(res.headers, detail)
    // Out of tokens for the DAY on this model, and a backup model with its own
    // budget exists? Use it. Waiting is pointless - the budget returns at
    // midnight - and the alternative is falling through to a paid provider, or
    // to nothing, while a perfectly good free allowance sits unused.
    // 413 IS THE SAME ANSWER IN A DIFFERENT STATUS. Groq rejects a request that
    // does not fit the per-MINUTE token allowance with 413 request_too_large, not
    // 429 — and 413 is not in TRANSIENT either, so today it neither waits nor
    // switches model: it falls straight through to the dead Gemini key and then
    // to demo text, with gpt-oss-20b's separate per-minute and per-day budgets
    // untouched. Measured on production 2026-09-09: an oversized request failed
    // in 1.08s (a retried 429 cannot be that fast) while a small request sent
    // immediately after succeeded — a size rejection, not an outage.
    // Deliberately NOT added to TRANSIENT: re-sending the identical oversized
    // request to the same model would just fail again on the same budget.
    //
    // A PER-MINUTE LIMIT NOW SWITCHES MODEL TOO, and this reverses an earlier
    // decision ("wait, keeping the better one"). Waiting is only right if the
    // wait ends in a caption. Measured on production twice: 2026-09-11 12:54
    // and 2026-09-12 10:51, Edward's shoplot — "groq 429 … on tokens per
    // minute" then "gemini 429: Your prepayment credits are depleted", so the
    // wait ended at a dead fallback and the client was handed demo boilerplate
    // that the publish gate refused. One listing is ~13,000 tokens against an
    // 8,000/minute allowance, so the minute is genuinely gone; the budget is
    // metered PER MODEL, and gpt-oss-20b's separate allowance was sitting
    // untouched the whole time. A plainer caption beats no caption.
    //
    // NOT EVERY PER-MINUTE LIMIT. Groq says how long the window has left, and a
    // short one is worth waiting out on the better model — a caption from
    // gpt-oss-120b one second later beats a plainer one now. It is the LONG
    // waits that stranded Edward ("Please try again in 21.6s", twice), because
    // the wait has to fit inside the retry budget AND the function's own life,
    // and what it falls through to is a dead key. So: under QUICK_RETRY_MS,
    // wait (the retry below); over it, take the other model's fresh minute.
    //
    // The better model is still tried first, every time, and if the backup is
    // rate-limited as well the error stays transient — so the wait-and-retry
    // below still happens, now as the second answer instead of the only one.
    const spentDay = /per day|\b(TPD|RPD)\b/i.test(detail)
    const quick = err.retryAfterMs > 0 && err.retryAfterMs <= QUICK_RETRY_MS
    const switchModel = res.status === 413 || (res.status === 429 && (spentDay || !quick))
    if (switchModel && !modelOverride && model !== GROQ_BACKUP_MODEL) {
      const why = res.status === 413 ? 'request too large' : spentDay ? 'day spent' : 'minute spent'
      return runGroq(prompt, trace, GROQ_BACKUP_MODEL, `${model} ${res.status} (${why})`)
    }
    throw err
  }
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content || ''
  if (!text) throw new Error('Groq returned no text')
  trace?.push({ provider: 'groq', model, ...(fellBackFrom ? { fellBackFrom } : {}) })
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

// Vision: prompt + inline images -> text (cover-photo choice, listing OCR).
//
// This used to be Gemini-only and threw without GEMINI_API_KEY, so the day
// Gemini's billing ran dry (HTTP 429 "prepayment credits are depleted") every
// cover choice silently became "photo 0" and OCR was impossible. It now walks a
// chain the same way the text path does.
//
// Only providers that can actually see images belong here: production runs
// AI_PROVIDER=groq, and Groq's free gpt-oss models take text only, so a vision
// call that inherited the text primary would 400 on every photo.
const VISION_KEYED = { gemini: 'GEMINI_API_KEY', claude: 'ANTHROPIC_API_KEY' }

// Gemini answers a depleted billing account with 429 - the same status a burst
// rate limit uses, but this one never recovers. Retrying it to the full text
// budget (75s) would hold a cover request open until the function itself times
// out, so vision gets a shorter one and moves to the next provider instead.
const visionBudgetMs = () => Number(process.env.AI_VISION_RETRY_BUDGET_MS || 12000)

// Anthropic rejects anything outside this set, and a WhatsApp photo arrives
// labelled "image/jpg" or with a charset suffix often enough to matter.
const ANTHROPIC_MEDIA = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
function anthropicMediaType(mime) {
  const m = String(mime || '').split(';')[0].trim().toLowerCase()
  if (m === 'image/jpg') return 'image/jpeg'
  return ANTHROPIC_MEDIA.has(m) ? m : 'image/jpeg'
}

/**
 * Vision providers to try, in order: VISION_PROVIDER (falling back to the text
 * AI_PROVIDER), then VISION_FALLBACK_PROVIDER (falling back to
 * AI_FALLBACK_PROVIDER), then any remaining keyed vision provider.
 *
 * That last step is the point of the whole thing: with AI_PROVIDER=groq the
 * first two steps yield nothing, and a configured ANTHROPIC_API_KEY sitting
 * unused is exactly how cover selection went dark. A provider is only tried
 * when its key is present, so an absent key still costs nothing.
 */
export function visionChain() {
  const first = (process.env.VISION_PROVIDER || process.env.AI_PROVIDER || 'gemini').toLowerCase()
  const listed = (process.env.VISION_FALLBACK_PROVIDER || process.env.AI_FALLBACK_PROVIDER || '')
    .toLowerCase().split(',').map((x) => x.trim()).filter(Boolean)
  const seen = new Set()
  return [first, ...listed, ...Object.keys(VISION_KEYED)].filter((p) => {
    if (seen.has(p) || !VISION_KEYED[p] || !process.env[VISION_KEYED[p]]) return false
    seen.add(p)
    return true
  })
}

// Why a caller may not get vision, in words a WhatsApp reply can carry. Callers
// degrade on this instead of on a raw upstream error string.
export const VISION_UNCONFIGURED =
  'no vision provider key is configured — set GEMINI_API_KEY or ANTHROPIC_API_KEY (and VISION_PROVIDER if you want a specific one)'

export function visionStatus() {
  const chain = visionChain()
  return {
    chain,
    provider: chain[0] || null,
    configured: chain.length > 0,
    reason: chain.length ? null : VISION_UNCONFIGURED,
  }
}

function visionAdapterFor(p) {
  return p === 'claude' ? runClaudeVision : runGeminiVision
}

/**
 * Run the first vision provider that has a key, falling through on failure.
 * images = [{ mimeType, data }] where data is raw base64 (no data: prefix).
 * Returns { text, provider } — the provider that ANSWERED, not the one
 * configured, so a degraded reply cannot name a model that never ran.
 * Throws when nothing can run; callers must degrade, never invent.
 */
export async function runModelVision(prompt, images) {
  const chain = visionChain()
  if (!chain.length) {
    const err = new Error(VISION_UNCONFIGURED)
    err.visionUnconfigured = true
    throw err
  }
  const deadline = Date.now() + visionBudgetMs()
  let lastErr
  const attempts = []
  for (const p of chain) {
    try {
      const text = await withRetry(() => visionAdapterFor(p)(prompt, images), deadline)
      return { text, provider: p }
    } catch (e) {
      lastErr = e
      attempts.push({ provider: p, status: e?.status ?? null, message: String(e?.message || e) })
      if (Date.now() >= deadline) break
    }
  }
  throw chainError(attempts, lastErr)
}

async function runGeminiVision(prompt, images) {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not set')
  const model = process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const parts = [
    { text: prompt },
    ...images.map((img) => ({ inline_data: { mime_type: img.mimeType || 'image/jpeg', data: img.data } })),
  ]
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const err = new Error(`Gemini vision ${res.status}: ${detail.slice(0, 200)}`)
    err.status = res.status
    err.transient = isTransient(res.status, detail)
    throw err
  }
  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || ''
  if (!text) throw new Error('Gemini vision returned no text')
  return text
}

async function runClaudeVision(prompt, images) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY not set')
  const model = process.env.ANTHROPIC_VISION_MODEL || process.env.ANTHROPIC_MODEL || ANTHROPIC_DEFAULT_MODEL
  // No JSON response mode on this API - the prompts ask for raw JSON and
  // extractJson() strips a fence if one comes back anyway.
  const content = [
    ...images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: anthropicMediaType(img.mimeType), data: img.data },
    })),
    { type: 'text', text: prompt },
  ]
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
      temperature: 0.2,
      messages: [{ role: 'user', content }],
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const err = new Error(`Anthropic vision ${res.status}: ${detail.slice(0, 200)}`)
    err.status = res.status
    err.transient = isTransient(res.status, detail)
    throw err
  }
  const data = await res.json()
  const text = (data?.content || []).map((b) => b.text || '').join('')
  if (!text) throw new Error('Anthropic vision returned no text')
  return text
}
