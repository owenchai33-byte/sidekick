// THE REPAIR ROUND MUST NOT THROW AWAY THE AGENT'S FORMAT.
//
// 2026-09-11, live, Owen's RENNA rental: the caption came back with a single
// "━" where the examples have a full ━━━━ rule, every property detail on one
// line, and the DEPOSIT & TERMS and COMMISSION sections gone. The same listing
// and style, captioned 2026-09-08, had all of them. The repair round re-sent the
// caption prompt WITHOUT the style examples and WITHOUT the caption it was meant
// to fix, then accepted whatever came back if it had fewer findings.
//
// The captions below are the real ones from that chat (the phone number is a
// dummy): FORMATTED is the 2026-09-08 caption, FLATTENED is 2026-09-11's.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { captionShape, formatLost } from './format.js'
import { buildRepairPrompt } from './prompts.js'

const pending = { putPending: vi.fn(), getPending: vi.fn(), delPending: vi.fn(), claimPending: vi.fn(), releasePending: vi.fn() }
const social = { postToConnected: vi.fn(), connectedAccounts: vi.fn(), defaultProfile: vi.fn() }
const style = { getStyle: vi.fn(), getRules: vi.fn() }
const runModel = vi.fn()

vi.mock('./pending.js', () => pending)
vi.mock('./social.js', () => social)
vi.mock('./feed.js', () => ({ appendFeed: vi.fn() }))
vi.mock('./providers.js', async (orig) => ({ ...(await orig()), runModel, providerStatus: () => ({ configured: true, provider: 'groq' }) }))
vi.mock('./style.js', () => style)
vi.mock('./brand.js', () => ({ getBrand: vi.fn(async () => ({})) }))
vi.mock('./brandcard.js', () => ({ renderBrandCard: vi.fn(async () => Buffer.from('png')) }))
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async () => ({ url: 'https://blob.test/card.png' })),
  list: vi.fn(async () => ({ blobs: [] })), del: vi.fn(async () => {}),
}))

const { default: ingest } = await import('../ingest.js')

const LISTING = `Brand New RENNA RESIDENCE for Rent

📍The Northbank, Kuching

• 2 Bedrooms | 2 Bathrooms
- Size: 787 Sqft | Fully Furnished
- Level: 12th Floor
- Rental price: RM2.5k (nego)

Deposit & Terms:
• Security Deposit: 2 months
• Advance Rental: 1 month
• Utilities Deposit: 1 month
• Tenancy stamping fee: shared equally

Comm: 1 month + 8% SST
Amy 0123456789`

const PARSED = {
  listingType: 'rental', price: 2500, location: 'The Northbank, Kuching', bedrooms: 2, bathrooms: 2,
  propertyType: null, sqft: 787, landSqft: null, tenure: null, furnishing: 'Fully Furnished',
  title: '2-bed @ The Northbank', propertyName: 'RENNA RESIDENCE',
}

// 2026-09-08 — the agent's format. Carries one style finding: the fire emoji
// their rule bans. That single finding was enough to send it to the repair round.
const FORMATTED = `🔥 FOR RENT | RENNA RESIDENCE

✨ Fully Furnished | 12th Floor | 2 Bed 2 Bath

📍 THE NORTHBANK, KUCHING

━━━━━━━━━━━━━━━

💰 Monthly Rent

RM2,500/month (nego)

━━━━━━━━━━━━━━━

Property Details

🛏️ 2 Bedrooms

🛁 2 Bathrooms

📐 Built-up Area: 787 sqft

🛋️ Fully Furnished

🏢 Level: 12th Floor

━━━━━━━━━━━━━━━

DEPOSIT & TERMS

• Security Deposit: 2 months

• Advance Rental: 1 month

• Utilities Deposit: 1 month

• Tenancy stamping fee: shared equally

━━━━━━━━━━━━━━━

COMMISSION

Comm: 1 month + 8% SST

━━━━━━━━━━━━━━━

📲 PM For More Information Or Viewing Arrangement

Amy 0123456789

#PCMY_Rent`

// The same caption with the one finding fixed IN PLACE — what a repair is for.
const EDITED = FORMATTED.replace('🔥 FOR RENT', '🏡 FOR RENT')

// 2026-09-11 — what the repair round produced instead.
const FLATTENED = `🏡 RENNA RESIDENCE FOR RENT

✨ Brand New

📍 THE NORTHBANK, KUCHING

━

💰 Monthly Rent: RM2,500 /month (nego)

Property Details: 🛏️ 2 Beds | 🛁 2 Baths | 📐 787 sq ft | 📜 Fully Furnished | 🏢 Level: 12th Floor

✅ Highlights

• Security Deposit: 2 months

• Advance Rental: 1 month

• Utilities Deposit: 1 month

• Tenancy stamping fee: shared equally

📲 PM For More Information Or Viewing Arrangement

Amy 0123456789

#PCMY_Rent`

const STYLE = {
  style: 'Copy the EXACT layout, emojis, voice AND SPACING of the example captions below on EVERY listing.',
  examples: ['🏡 RARE CORNER TERRACE HOUSE FOR SALE\n\n📍 Jalan Stampin, Kuching\n\n━━━━━━━━━━━━━━━\n\n💰 Selling Price\n\nMatch Bank Value\n\n━━━━━━━━━━━━━━━\n\n📲 PM For More Information Or Viewing Arrangement\n\n#PCMY_Sale'],
}
const RULES = ['from now on always put the area name in CAPS and never use the fire emoji']

describe('the shape of a caption', () => {
  it('measures the real formatted caption', () => {
    const s = captionShape(FORMATTED)
    expect(s.rules).toBe(5)
    expect(s.longestRule).toBe(15)
    expect(s.spacing).toBeGreaterThan(0.9)
  })

  it('calls the 2026-09-11 caption a lost format', () => {
    expect(formatLost(FORMATTED, FLATTENED)).toMatch(/dividers 5 → 1/)
  })

  it('does not call a word fixed in place a lost format', () => {
    expect(formatLost(FORMATTED, EDITED)).toBeNull()
  })

  it('holds no agent to a feature their format does not have', () => {
    // A plain, single-spaced style with no dividers: nothing to lose.
    const plain = 'RENNA RESIDENCE for rent\nRM2,500/month, 787 sqft\n2 bed 2 bath, fully furnished\nCall Amy 0123456789'
    expect(formatLost(plain, plain.replace('for rent', 'FOR RENT'))).toBeNull()
  })
})

describe('the repair prompt', () => {
  const previous = { facebook_page: { en: FORMATTED } }
  const p = buildRepairPrompt({ listingType: 'rental', rawText: LISTING }, previous, ['THEIR OWN RULE, broken: no fire emoji'], RULES)

  it('carries the caption it is fixing, verbatim', () => {
    expect(p).toContain(JSON.stringify(previous, null, 2))
  })
  it('carries the listing, the findings and their rules', () => {
    expect(p).toContain('Comm: 1 month + 8% SST')
    expect(p).toContain('no fire emoji')
    expect(p).toContain(RULES[0])
  })
  it('carries the same transaction rule as the caption prompt', () => {
    expect(p).toMatch(/Listing type: RENTAL/)
    expect(p).toMatch(/NEVER write "Selling Price"/)
  })
  it('is an edit, not a rewrite from a style description', () => {
    expect(p).toMatch(/Change only the words the list above names/)
    expect(p).not.toContain('Example 1')
  })
})

const mkRes = () => {
  const r = { statusCode: 0, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.end = (b) => { r.body = typeof b === 'string' ? JSON.parse(b) : b; return r }
  return r
}
const dry = async () => {
  const res = mkRes()
  await ingest({ method: 'POST', url: '/api/ingest', headers: { 'x-ingest-secret': 's3cret' },
    body: { dry: true, profileId: 'p1', sender: '+60100000000', text: LISTING } }, res)
  return res.body
}

// Route each call by its prompt, and record which model "answered", the way the
// real adapters do.
const answers = (repairs) => {
  const prompts = []
  runModel.mockImplementation(async (prompt, trace) => {
    prompts.push(prompt)
    trace?.push({ provider: 'groq', model: 'openai/gpt-oss-120b' })
    if (prompt.startsWith('You are editing a property caption')) return JSON.stringify({ facebook_page: { en: repairs.shift() } })
    if (prompt.includes('You are an expert property EDITOR')) return JSON.stringify({ facebook_page: { en: FORMATTED } })
    return JSON.stringify(PARSED)
  })
  return prompts
}

describe('writeCaption, end to end through /api/ingest', () => {
  beforeEach(() => {
    process.env.INGEST_SECRET = 's3cret'
    vi.clearAllMocks()
    social.defaultProfile.mockReturnValue('')
    social.connectedAccounts.mockResolvedValue(0)
    style.getStyle.mockResolvedValue({ ...STYLE, source: 'primary' })
    style.getRules.mockResolvedValue({ rules: RULES, source: 'primary' })
  })

  it('sends the repair the caption it wrote, not the style description', async () => {
    const prompts = answers([EDITED])
    await dry()
    const repair = prompts.find((p) => p.startsWith('You are editing a property caption'))
    expect(repair, 'a repair round ran').toBeTruthy()
    expect(repair).toContain('━━━━━━━━━━━━━━━\\n\\nDEPOSIT & TERMS')
    expect(repair).not.toContain(STYLE.examples[0].slice(0, 30))
  })

  it('keeps the format when the repair fixes the word in place', async () => {
    answers([EDITED])
    const r = await dry()
    expect(r.caption).toBe(EDITED)
    expect(r.captionTrace.map((s) => s.step)).toEqual(['write', 'repair 1'])
    expect(r.captionTrace[1]).toMatchObject({ accepted: true, by: 'groq/openai/gpt-oss-120b' })
  })

  it('refuses a repair that flattens the format over a style finding', async () => {
    // Both rounds come back flat. A flat caption with no findings used to win;
    // the agent's own formatted caption is kept instead.
    answers([FLATTENED, FLATTENED])
    const r = await dry()
    expect(r.caption).toBe(FORMATTED)
    expect(r.captionDegraded).toBe(false)
    const rounds = r.captionTrace.filter((s) => s.step.startsWith('repair'))
    expect(rounds).toHaveLength(2)
    for (const s of rounds) expect(s).toMatchObject({ accepted: false, formatLost: expect.stringMatching(/dividers/) })
    expect(r.captionTrace.at(-1)).toMatchObject({ step: 'left in' })
  })

  it('takes a flat repair when the formatted caption would be refused', async () => {
    // "Selling Price" on a rental is refused outright. A plainer caption that
    // says the right thing beats a refused post.
    const wrongWords = FORMATTED.replace('💰 Monthly Rent', '💰 Selling Price').replace('🔥', '🏡')
    const prompts = []
    runModel.mockImplementation(async (prompt, trace) => {
      prompts.push(prompt)
      trace?.push({ provider: 'groq', model: 'openai/gpt-oss-120b' })
      if (prompt.startsWith('You are editing a property caption')) return JSON.stringify({ facebook_page: { en: FLATTENED } })
      if (prompt.includes('You are an expert property EDITOR')) return JSON.stringify({ facebook_page: { en: wrongWords } })
      return JSON.stringify(PARSED)
    })
    const r = await dry()
    expect(r.caption).toBe(FLATTENED)
    expect(r.captionDegraded).toBe(false)
    expect(r.captionTrace[1]).toMatchObject({ accepted: true, formatLost: expect.any(String) })
  })

  it('says which model wrote it, including the backup', async () => {
    runModel.mockImplementation(async (prompt, trace) => {
      trace?.push({ provider: 'groq', model: 'openai/gpt-oss-20b', fellBackFrom: 'openai/gpt-oss-120b 413' })
      if (prompt.includes('You are an expert property EDITOR')) return JSON.stringify({ facebook_page: { en: EDITED } })
      return JSON.stringify(PARSED)
    })
    const r = await dry()
    expect(r.captionTrace[0]).toEqual({ step: 'write', by: 'groq/openai/gpt-oss-20b (backup — openai/gpt-oss-120b 413)' })
  })
})
