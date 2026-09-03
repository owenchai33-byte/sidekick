// Vision, tested by taking the keys away.
//
// Vision was Gemini-only and threw without GEMINI_API_KEY. When that account's
// billing ran dry (429 "prepayment credits are depleted") nothing broke loudly:
// every cover choice quietly became "photo 0" and the OCR path did not exist.
// So the cases here are the ones that actually happen — the primary vision
// provider refusing, and nobody holding a vision key at all — plus the one that
// would cost real money if it ever passed: OCR inventing a price.
//
// Same shape as failover.test.mjs: stub fetch through vi.stubGlobal (vitest puts
// it back even when a test throws) and reset the module registry between cases,
// because the chain reads env at call time but the adapters close over module
// state.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const COVER = JSON.stringify({ index: 2 })
// A real transcription of a listing whose price was smudged: the price is
// absent from the text and named in "unreadable". The stray top-level "price"
// is the model doing exactly what it must not do — offering a number it worked
// out rather than read.
const OCR_NO_PRICE = JSON.stringify({
  text: 'TROPICS CITY, Kuching\n3 bilik tidur, 2 bilik air\nCall 012-345 6789',
  confidence: 'medium',
  unreadable: ['price'],
  price: 450000,
})

const install = (behaviour) => {
  const tried = []
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const u = String(url)
    const who = /generativelanguage|googleapis/.test(u) ? 'gemini'
      : /anthropic/.test(u) ? 'claude'
      : /groq/.test(u) ? 'groq' : 'unknown'
    tried.push({ who, body: JSON.parse(String(init?.body || '{}')) })
    const b = behaviour[who]
    if (b === undefined) return new Response('no such provider here', { status: 404 })
    if (b === '500') return new Response('upstream boom', { status: 500 })
    if (b === '401') return new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: 401 })
    if (b === '429') return new Response(JSON.stringify({ error: { message: 'prepayment credits are depleted' } }), { status: 429 })
    const payload = who === 'gemini' ? { candidates: [{ content: { parts: [{ text: b }] } }] }
      : { content: [{ text: b }] }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  return tried
}

const loadProviders = async () => { vi.resetModules(); return import('./providers.js') }
const loadHandler = async () => { vi.resetModules(); return (await import('../generate.js')).default }

const ENV = ['AI_PROVIDER', 'AI_FALLBACK_PROVIDER', 'VISION_PROVIDER', 'VISION_FALLBACK_PROVIDER',
  'GROQ_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_RETRY_BUDGET_MS', 'AI_VISION_RETRY_BUDGET_MS']
beforeEach(() => { for (const k of ENV) delete process.env[k] })
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

const IMAGES = [
  { mimeType: 'image/jpeg', data: 'aaaa' },
  { mimeType: 'image/jpg', data: 'bbbb' },
  { mimeType: 'image/png', data: 'cccc' },
]

// The handler answers through a node response object, so collect what it wrote.
const post = async (body) => {
  const handler = await loadHandler()
  const out = { statusCode: 0, headers: {} }
  const res = {
    set statusCode(v) { out.statusCode = v },
    get statusCode() { return out.statusCode },
    setHeader(k, v) { out.headers[k] = v },
    end(payload) { out.body = JSON.parse(payload) },
  }
  await handler({ method: 'POST', body }, res)
  return out
}

describe('vision runs on whichever provider has a key', () => {
  it('picks a cover through the configured vision provider', async () => {
    Object.assign(process.env, { VISION_PROVIDER: 'gemini', GEMINI_API_KEY: 'AIza_test' })
    const tried = install({ gemini: COVER })
    const res = await post({ action: 'cover', images: IMAGES })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ index: 2, provider: 'gemini' })
    expect(res.body.degraded).toBeFalsy()
    expect(tried.map((t) => t.who)).toEqual(['gemini'])
  })

  it('sends the photos to Claude as base64 image blocks when Claude is the vision provider', async () => {
    Object.assign(process.env, { VISION_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'sk-ant-test' })
    const tried = install({ claude: COVER })
    expect((await post({ action: 'cover', images: IMAGES })).body.index).toBe(2)
    const sent = tried[0].body.messages[0].content
    expect(sent.filter((c) => c.type === 'image')).toHaveLength(3)
    // Anthropic rejects "image/jpg"; WhatsApp photos arrive labelled that way.
    expect(sent[1].source.media_type).toBe('image/jpeg')
    expect(sent.at(-1)).toMatchObject({ type: 'text' })
  })

  it('skips a text-only primary and uses the vision key that is present', async () => {
    // Production runs AI_PROVIDER=groq, whose free models take no images. Before
    // this, vision inherited that name and never ran at all.
    Object.assign(process.env, { AI_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_test', ANTHROPIC_API_KEY: 'sk-ant-test' })
    const { visionChain } = await loadProviders()
    expect(visionChain()).toEqual(['claude'])
    const tried = install({ claude: COVER })
    expect((await post({ action: 'cover', images: IMAGES })).body.index).toBe(2)
    expect(tried.map((t) => t.who)).not.toContain('groq')
  })

  for (const [label, code] of [['is down', '500'], ['has a dead key', '401'], ['is out of credit', '429']]) {
    it(`falls over to Claude when Gemini ${label}`, async () => {
      Object.assign(process.env, {
        VISION_PROVIDER: 'gemini', VISION_FALLBACK_PROVIDER: 'claude',
        GEMINI_API_KEY: 'AIza_test', ANTHROPIC_API_KEY: 'sk-ant-test',
        AI_VISION_RETRY_BUDGET_MS: '2000',
      })
      const tried = install({ gemini: code, claude: COVER })
      const res = await post({ action: 'cover', images: IMAGES })
      // The reply names the model that ANSWERED, not the one configured.
      expect(res.body).toMatchObject({ index: 2, provider: 'claude' })
      expect([...new Set(tried.map((t) => t.who))]).toEqual(['gemini', 'claude'])
    })
  }

  it('does not try a vision provider whose key is missing', async () => {
    Object.assign(process.env, { VISION_PROVIDER: 'gemini', VISION_FALLBACK_PROVIDER: 'claude', GEMINI_API_KEY: 'AIza_test', AI_VISION_RETRY_BUDGET_MS: '2000' })
    const tried = install({ gemini: '401', claude: COVER })
    const res = await post({ action: 'cover', images: IMAGES })
    expect(res.body.degraded).toBe(true)
    expect(tried.map((t) => t.who)).not.toContain('claude')
  })
})

describe('no vision key at all degrades, it does not break', () => {
  it('keeps the first photo as cover and says why in words', async () => {
    Object.assign(process.env, { AI_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_test' })
    const tried = install({})
    const res = await post({ action: 'cover', images: IMAGES })
    expect(res.statusCode).toBe(200)
    expect(res.body.index).toBe(0)
    expect(res.body.degraded).toBe(true)
    // A plain reason, not a raw upstream error string: an agent reads this.
    expect(res.body.reason).toMatch(/GEMINI_API_KEY or ANTHROPIC_API_KEY/)
    expect(tried).toHaveLength(0) // nothing was even attempted
  })

  it('returns an empty transcription rather than a guessed one', async () => {
    const tried = install({})
    const res = await post({ action: 'readlisting', images: IMAGES })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ degraded: true, text: '', confidence: 'none', unreadable: [] })
    expect(res.body.reason).toMatch(/type the listing instead/)
    expect(tried).toHaveLength(0)
  })

  it('degrades the same way when the vision call itself fails', async () => {
    Object.assign(process.env, { VISION_PROVIDER: 'gemini', GEMINI_API_KEY: 'AIza_test', AI_VISION_RETRY_BUDGET_MS: '1000' })
    install({ gemini: '401' })
    const res = await post({ action: 'readlisting', images: IMAGES })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ degraded: true, text: '', confidence: 'none' })
  })
})

describe('listing OCR reads, it does not fill in', () => {
  it('returns the transcription with its confidence and the fields it could not read', async () => {
    Object.assign(process.env, { VISION_PROVIDER: 'gemini', GEMINI_API_KEY: 'AIza_test' })
    install({ gemini: OCR_NO_PRICE })
    const res = await post({ action: 'readlisting', images: [IMAGES[0]] })
    expect(res.body.text).toContain('TROPICS CITY')
    expect(res.body.confidence).toBe('medium')
    expect(res.body.unreadable).toEqual(['price'])
    expect(res.body.degraded).toBe(false)
  })

  it('never carries a price the model was not able to read off the image', async () => {
    Object.assign(process.env, { VISION_PROVIDER: 'gemini', GEMINI_API_KEY: 'AIza_test' })
    install({ gemini: OCR_NO_PRICE })
    const res = await post({ action: 'readlisting', images: [IMAGES[0]] })
    // The model offered price: 450000 alongside a transcription that contains no
    // price. Forwarding it would put a made-up asking price on a public listing.
    expect(res.body.price).toBeUndefined()
    expect(JSON.stringify(res.body)).not.toContain('450000')
    expect(res.body.text).not.toMatch(/RM\s*[\d,]+/)
  })

  it('reports "none" when the images held no readable listing text', async () => {
    Object.assign(process.env, { VISION_PROVIDER: 'gemini', GEMINI_API_KEY: 'AIza_test' })
    install({ gemini: JSON.stringify({ text: '', confidence: 'low', unreadable: ['price', 'phone'] }) })
    const res = await post({ action: 'readlisting', images: [IMAGES[0]] })
    expect(res.body).toMatchObject({ text: '', confidence: 'none' })
    expect(res.body.unreadable).toEqual(['price', 'phone'])
  })

  it('rejects a call with no images instead of answering about nothing', async () => {
    Object.assign(process.env, { VISION_PROVIDER: 'gemini', GEMINI_API_KEY: 'AIza_test' })
    install({ gemini: OCR_NO_PRICE })
    expect((await post({ action: 'readlisting', images: [] })).statusCode).toBe(400)
  })
})

// A spent balance is not a rate limit.
//
// The depleted Gemini key answers 429, which the retry logic read as "wait and
// try again". Measured against the real key on 2026-09-03: seven image uploads
// over 11.8 seconds before it gave up - on a Vercel function killed at about
// ten, so the caller never received the degraded answer it was owed. A balance
// clears when somebody pays, which no retry budget can outlast.
describe('a spent balance fails over immediately, a rate limit does not', () => {
  const load = async () => { vi.resetModules(); return import('./providers.js') }
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  const answer429 = (message) => {
    let uploads = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      uploads++
      return new Response(JSON.stringify({ error: { code: 429, message } }), { status: 429 })
    }))
    return () => uploads
  }
  const IMG = [{ mimeType: 'image/jpeg', data: 'AAAA' }]

  it('gives up on a depleted balance after a single attempt', async () => {
    process.env.VISION_PROVIDER = 'gemini'
    process.env.GEMINI_API_KEY = 'AIza_depleted'
    process.env.AI_VISION_RETRY_BUDGET_MS = '4000'
    const uploads = answer429('Your prepayment credits are depleted. Please go to AI Studio to top up.')
    const { runModelVision } = await load()
    const started = Date.now()
    await expect(runModelVision('x', IMG)).rejects.toThrow()
    expect(uploads()).toBe(1)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('still retries a genuine rate limit', async () => {
    process.env.VISION_PROVIDER = 'gemini'
    process.env.GEMINI_API_KEY = 'AIza_busy'
    process.env.AI_VISION_RETRY_BUDGET_MS = '2000'
    const uploads = answer429('Rate limit reached for model, please try again shortly')
    const { runModelVision } = await load()
    await expect(runModelVision('x', IMG)).rejects.toThrow()
    expect(uploads()).toBeGreaterThan(1)
  })

  it('reaches the fallback provider instead of timing out on the spent one', async () => {
    process.env.VISION_PROVIDER = 'gemini'
    process.env.VISION_FALLBACK_PROVIDER = 'claude'
    process.env.GEMINI_API_KEY = 'AIza_depleted'
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    process.env.AI_VISION_RETRY_BUDGET_MS = '4000'
    const tried = []
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url)
      if (/generativelanguage/.test(u)) {
        tried.push('gemini')
        return new Response(JSON.stringify({ error: { message: 'Your prepayment credits are depleted.' } }), { status: 429 })
      }
      tried.push('claude')
      return new Response(JSON.stringify({ content: [{ text: '{"index":1}' }] }), { status: 200 })
    }))
    const { runModelVision } = await load()
    const started = Date.now()
    const out = await runModelVision('x', IMG)
    expect(String(out.text ?? out)).toContain('"index":1')
    expect(tried).toEqual(['gemini', 'claude'])
    expect(Date.now() - started).toBeLessThan(1500)
  })
})
