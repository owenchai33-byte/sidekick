// THE FREE TIER IS THE CEILING, AND HALF OF IT WAS UNREACHABLE.
//
// Production runs Groq primary with Gemini behind it, and Gemini's prepaid
// balance is zero — so Groq alone carries every listing. Groq rejects a request
// that does not fit the per-MINUTE token allowance with 413 request_too_large,
// NOT 429. 413 was not in TRANSIENT and not in the daily-limit branch, so it
// neither waited nor switched model: it fell straight through to the dead Gemini
// key and then to demo text, while gpt-oss-20b's separate per-minute and per-day
// budgets sat untouched.
//
// Measured on production 2026-09-09: an oversized request failed in 1.08s — a
// retried 429 cannot be that fast — while a small request sent immediately after
// succeeded. A size rejection, not an outage. The readable body names the real
// limit: "tokens per minute (TPM): Limit 8000".
//
// 413 is deliberately NOT added to TRANSIENT: re-sending the identical oversized
// request to the same model would fail again on the same budget. It switches
// model, which is where the unused budget is.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('./providers.js', import.meta.url), 'utf8')

describe('a 413 reaches the backup model instead of the dead fallback', () => {
  it('the daily-limit branch also fires on 413', () => {
    const line = SRC.split('\n').find((l) => l.includes('GROQ_BACKUP_MODEL') && l.trim().startsWith('if ('))
    expect(line, 'the model-switch condition').toBeTruthy()
    expect(line).toMatch(/413/)
  })

  it('413 is NOT retried against the same model', () => {
    // Re-sending an identical oversized request to the same model fails on the
    // same budget. It must switch, not wait.
    const transient = SRC.match(/const TRANSIENT[^\n]*/)?.[0] || ''
    expect(transient).not.toMatch(/413/)
  })

  it('the switch still cannot recurse or fire on an explicit model override', () => {
    const line = SRC.split('\n').find((l) => l.includes('GROQ_BACKUP_MODEL') && l.trim().startsWith('if ('))
    expect(line).toMatch(/!modelOverride/)
    expect(line).toMatch(/model !== GROQ_BACKUP_MODEL/)
  })
})

describe('the operator is told which provider actually failed', () => {
  // The chain kept only the LAST error, so with [groq, gemini] every Groq
  // failure was reported as "Gemini prepayment credits are depleted" — a
  // permanent misdirection, since Gemini is last and fails every time.
  it('every attempt is accumulated and all of them are thrown', () => {
    // `lastErr` legitimately survives — withRetry uses it to retry ONE provider,
    // and the chain passes it through as the thrown error's `cause`. What
    // changed is that the chain no longer THROWS it: it collects one
    // {provider, status, message} per attempt and throws the aggregate, so a
    // Groq failure can no longer surface as a Gemini billing error.
    const loop = SRC.match(/export async function runModel\(prompt(?:, trace)?\)[\s\S]*?\n\}/)[0]
    expect(loop).toMatch(/attempts\.push\(\{\s*provider: p, status:/)
    expect(loop).toMatch(/throw chainError\(attempts, lastErr\)/)
    expect(loop).not.toMatch(/throw lastErr/)
  })

  it('the aggregate names every provider that was tried', () => {
    const fn = SRC.match(/function chainError\(attempts, lastErr\) \{[\s\S]*?\n\}/)[0]
    expect(fn).toMatch(/attempts/)
    expect(fn).toMatch(/err\.attempts = attempts/)
  })

  it('briefly() survives a TRUNCATED envelope', async () => {
    // Every adapter slices the upstream body to 200-300 chars, so a real Groq
    // 413 arrives as unparseable JSON. Falling back to the raw body printed the
    // envelope this function exists to strip.
    const m = SRC.match(/function briefly\(message\) \{[\s\S]*?\n\}/)[0]
    // eslint-disable-next-line no-eval
    const briefly = eval('(' + m.replace('function briefly', 'function') + ')')
    const truncated = 'groq 413: {"error":{"message":"Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Used 6100, Requested 3400, pl'
    const out = briefly(truncated)
    expect(out).toMatch(/Request too large/)
    expect(out).toMatch(/tokens per minute/)
    expect(out.startsWith('{')).toBe(false)
  })

  it('a well-formed envelope still parses, and plain text passes through', () => {
    const m = SRC.match(/function briefly\(message\) \{[\s\S]*?\n\}/)[0]
    // eslint-disable-next-line no-eval
    const briefly = eval('(' + m.replace('function briefly', 'function') + ')')
    expect(briefly('gemini 429: {"error": {"code": 429, "message": "Your prepayment credits are depleted."}}'))
      .toBe('Your prepayment credits are depleted.')
    expect(briefly('groq 500: upstream is on fire')).toBe('upstream is on fire')
    expect(briefly('')).toBe('')
  })
})

describe('the remedy offered matches the cause', () => {
  it('never promises a re-send when no provider key is set', () => {
    // "Re-send this listing in about a minute; the free per-minute budget
    // refills" is true for a spent budget and false for a missing key — no
    // re-send ever fixes that. Telling someone to retry forever is the same
    // unkeepable promise this pass removed from AGENTS.md.
    const ingest = readFileSync(new URL('../ingest.js', import.meta.url), 'utf8')
    const idx = ingest.indexOf('the free per-minute budget refills')
    expect(idx, 'the remedy sentence exists').toBeGreaterThan(-1)
    const around = ingest.slice(Math.max(0, idx - 400), idx + 200)
    expect(around).toMatch(/status\.configured/)
    expect(around).toMatch(/No re-send will help until a provider key is set/)
  })
})
