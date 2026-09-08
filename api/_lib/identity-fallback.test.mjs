// THE TEST THIS WHOLE MIGRATION EXISTS FOR.
//
// Owen has spent weeks training a 970-character caption format, 2 worked
// examples and 3 rules, and every one of them is stored under the POSTING
// PROVIDER'S profile id: style/<id>, rules/<id>, brand/<id>. Zernio mints
// different ids from PostPeer, so flipping POSTING_PROVIDER re-keys all of it at
// once. Nothing errors. getStyle returns the same { style:'', examples:[] } for
// "no blob" and "never trained", so the only symptom is the next caption coming
// out in the default format on a paying client's public page, with nobody told.
// It has already happened once in this product's history.
//
// So these run against the REAL getStyle / getRules / getBrand, through a blob
// mock shaped like Vercel Blob actually behaves — PREFIX matching (which is what
// _lib/style.js:versions does), addRandomSuffix on every write, and uploadedAt
// ordering — with a fixture the size and shape of the real thing. Nothing here
// re-implements the fallback rule; if the rule were deleted these would fail.
import { describe, it, expect, beforeEach, vi } from 'vitest'

// --- the fixture, shaped like the live blobs ---------------------------------

// 970 characters, because that is what /api/style reports for Owen and Edward.
// Built rather than pasted so the length is a fact the test asserts, not a
// number in a comment that drifts.
const STYLE_970 = (() => {
  const head =
    'Write like a Kuching property agent talking to a neighbour, not like a brochure. ' +
    'Open with the area name in CAPS, then the property name, then the price on its own line. ' +
    'Never use the fire emoji. Never call a condo an apartment. ' +
    'Keep it to four short paragraphs, no bullet points, no hashtag walls. ' +
    'End with "DM me" and nothing else. '
  const filler =
    'State only what the listing says: if furnishing is not mentioned, do not mention furnishing. '
  let s = head
  while (s.length < 970) s += filler
  return s.slice(0, 970)
})()

const EXAMPLES_2 = [
  'KOTA SAMARAHAN\nTropics City\nRM1,300 / month\n\n3 rooms, 2 baths, mid floor with a car park. Walking distance to UNIMAS.\n\nDM me',
  'BATU KAWA\nRiveria Residence\nRM498,000\n\nCorner unit, 1,150 sqft, pool view. Ready to move in.\n\nDM me',
]

// The three rules verbatim from /api/style?kind=rules on the live app.
const RULES_3 = [
  'Never call a condo an apartment',
  'always use the first photo i send as the cover',
  'from now on always put the area name in CAPS and never use the fire emoji',
]

const BRAND = { color: '#c8102e', name: 'TRR', region: 'Kuching, Sarawak', logo: 'https://blob.test/logos/trr.png', cardEnabled: true }

// The two ids that matter: what Owen is keyed under today, and what Zernio would
// mint for the same human.
const OLD_ID = '6a90f9f6f59d1531f8d04018'
const NEW_ID = 'ag_7c31d90ab4415e02fd6631aa'

// --- a blob store that behaves like Vercel Blob -------------------------------

let store = []          // [{ pathname, url, uploadedAt, body }]
let clock = 0
const failing = new Set()   // prefixes whose list() throws, for the degraded case

vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (key, body, opts) => {
    // addRandomSuffix: every write is a NEW object, never an overwrite.
    const pathname = opts?.addRandomSuffix ? key.replace(/\.json$/, `-${store.length}.json`) : key
    const url = `https://blob.test/${pathname}`
    store.push({ pathname, url, uploadedAt: new Date(++clock * 1000).toISOString(), body })
    return { url, pathname }
  }),
  // PREFIX matching, which is the behaviour _lib/style.js depends on.
  list: vi.fn(async ({ prefix }) => {
    for (const f of failing) if (String(prefix).startsWith(f)) throw new Error('blob store unreachable')
    return { blobs: store.filter((b) => b.pathname.startsWith(prefix)).map((b) => ({ ...b })) }
  }),
  del: vi.fn(async (urls) => {
    const gone = new Set([].concat(urls))
    store = store.filter((b) => !gone.has(b.url))
  }),
}))

vi.stubGlobal('fetch', vi.fn(async (url) => {
  const b = store.find((x) => x.url === String(url))
  return b ? { ok: true, json: async () => JSON.parse(b.body) } : { ok: false, json: async () => ({}) }
}))

// Writes a blob directly, bypassing saveStyle — the only way to produce an
// empty object with no `cleared` stamp, which is what a foreign or older writer
// leaves behind.
async function writeRawBlob(pathname, body) {
  const { put } = await import('@vercel/blob')
  await put(pathname, JSON.stringify(body), { access: 'public', addRandomSuffix: true, contentType: 'application/json' })
}

const { getStyle, saveStyle, getRules, saveRule } = await import('./style.js')
const { getBrand, saveBrand } = await import('./brand.js')
const { resolvePostingProfile, saveAgentRecord, resetIdentityCache, identityKeys } = await import('./identity.js')

/** Write the settings the way they exist today: under one profile id. */
async function seedSettingsUnder(id) {
  await saveStyle(id, { style: STYLE_970, examples: EXAMPLES_2 })
  await saveRule(id, { replace: RULES_3 })
  await saveBrand(id, BRAND)
}

beforeEach(async () => {
  store = []
  clock = 0
  failing.clear()
  resetIdentityCache()
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token'
  delete process.env.POSTING_PROVIDER
})

// -----------------------------------------------------------------------------

describe('the switch does not lose a single trained setting', () => {
  it('an agent re-keyed to a NEW id still gets their 970-char style, 2 examples and 3 rules', async () => {
    // Everything Owen has trained lives under the PostPeer id.
    await seedSettingsUnder(OLD_ID)
    // Zernio mints him a different id, and the registry records where he came from.
    await saveAgentRecord(NEW_ID, { label: 'Owen', previousIds: [OLD_ID] })

    // Read as the NEW agent. Nothing has been copied, moved or re-written.
    const style = await getStyle(NEW_ID)
    expect(style.style).toBe(STYLE_970)
    expect(style.style).toHaveLength(970)
    expect(style.examples).toEqual(EXAMPLES_2)
    expect(style.examples).toHaveLength(2)

    const rules = await getRules(NEW_ID)
    expect(rules.rules).toEqual(RULES_3)
    expect(rules.rules).toHaveLength(3)
    // The one an agent notices first if it goes missing.
    expect(rules.rules).toContain('Never call a condo an apartment')

    const brand = await getBrand(NEW_ID)
    expect(brand.color).toBe('#c8102e')
    expect(brand.name).toBe('TRR')
    expect(brand.logo).toBe('https://blob.test/logos/trr.png')
  })

  it('says WHERE each answer came from, so a fallback firing is never silent', async () => {
    await seedSettingsUnder(OLD_ID)
    await saveAgentRecord(NEW_ID, { previousIds: [OLD_ID] })

    expect((await getStyle(NEW_ID)).source).toBe(`legacy:${OLD_ID}`)
    expect((await getRules(NEW_ID)).source).toBe(`legacy:${OLD_ID}`)
    expect((await getBrand(NEW_ID)).source).toBe(`legacy:${OLD_ID}`)
    // ...and found:true, so nobody mistakes a served-from-legacy read for an
    // untrained agent and goes off to retrain a style that was never lost.
    expect((await getStyle(NEW_ID)).found).toBe(true)
  })

  it('prefers the agent\'s OWN key once they have one, and does not merge the two', async () => {
    await seedSettingsUnder(OLD_ID)
    await saveAgentRecord(NEW_ID, { previousIds: [OLD_ID] })
    await saveStyle(NEW_ID, { style: 'a newer, retrained voice', examples: ['fresh'] })

    const s = await getStyle(NEW_ID)
    expect(s.style).toBe('a newer, retrained voice')
    expect(s.source).toBe('primary')
    // Merging two trained styles would produce a format that is neither.
    expect(s.style).not.toContain('Kuching property agent')
    expect(s.examples).toEqual(['fresh'])
  })

  it('an UNSTAMPED empty blob at the new key does not shadow the trained one', async () => {
    // The realistic accident: something that is not saveStyle leaves an empty
    // object at the new id — an older build, an onboarding script, a hand-written
    // blob. It carries no `cleared` stamp, so it is not an answer, and taking
    // "exists" for "has content" would bury the 970 characters permanently.
    await seedSettingsUnder(OLD_ID)
    await saveAgentRecord(NEW_ID, { previousIds: [OLD_ID] })
    await writeRawBlob(`style/${NEW_ID}.json`, { style: '', examples: [] })
    await writeRawBlob(`rules/${NEW_ID}.json`, { rules: [] })

    expect((await getStyle(NEW_ID)).style).toBe(STYLE_970)
    expect((await getRules(NEW_ID)).rules).toEqual(RULES_3)
  })

  it('but a DELIBERATE clear is honoured, not refilled from the old key', async () => {
    // The mirror failure, and it is silent refusal number seven. The agent says
    // "forget the rule about the fire emoji". saveRule succeeds, the tool reports
    // success — and the rule keeps applying to every caption forever because an
    // older key still holds it. `replace: []` is reachable from the
    // unauthenticated /api/style, so this is the ordinary way rules are cleared.
    //
    // Content cannot tell the two apart; both are empty. So the WRITER says
    // which it was, and only a write that meant it carries the stamp.
    await seedSettingsUnder(OLD_ID)
    await saveAgentRecord(NEW_ID, { previousIds: [OLD_ID] })
    await saveRule(NEW_ID, { replace: [] })
    await saveStyle(NEW_ID, { style: '', examples: [] })

    expect((await getRules(NEW_ID)).rules).toEqual([])
    expect((await getStyle(NEW_ID)).style).toBe('')
  })

  it('and clearing one kind does not clear the other', async () => {
    await seedSettingsUnder(OLD_ID)
    await saveAgentRecord(NEW_ID, { previousIds: [OLD_ID] })
    await saveRule(NEW_ID, { replace: [] })

    expect((await getRules(NEW_ID)).rules).toEqual([])
    expect((await getStyle(NEW_ID)).style).toBe(STYLE_970)   // untouched
  })
})

describe('an empty answer says WHY it is empty', () => {
  it('a genuinely untrained agent reads empty, found:false, degraded:false', async () => {
    // Wilson: a real agent with nothing trained yet. Empty is the correct answer
    // and it must stay silent — inventing a warning here would be noise on every
    // post a new agent makes.
    const s = await getStyle('6a9ceacd8737dad86c4099cc')
    expect(s.style).toBe('')
    expect(s.examples).toEqual([])
    expect(s.found).toBe(false)
    expect(s.degraded).toBe(false)
    expect(s.source).toBe('none')
    expect((await getRules('6a9ceacd8737dad86c4099cc')).found).toBe(false)
  })

  it('a blob store that FAILED reads degraded:true — not "untrained"', async () => {
    // This is the distinction that stops someone retraining a style that was
    // never lost. Empty-because-broken and empty-because-absent are different
    // facts and the reader has to be able to tell them apart.
    await saveAgentRecord(NEW_ID, { previousIds: [OLD_ID] })
    resetIdentityCache()
    failing.add('style/')

    const s = await getStyle(NEW_ID)
    expect(s.style).toBe('')
    expect(s.found).toBe(false)
    expect(s.degraded).toBe(true)
    expect(s.source).toBe('degraded')
  })

  it('a store failure on the PRIMARY key still falls through to the legacy key', async () => {
    // A read must never come back empty because it only looked in one place —
    // including when the one place it looked threw.
    await seedSettingsUnder(OLD_ID)
    await saveAgentRecord(NEW_ID, { previousIds: [OLD_ID] })
    resetIdentityCache()
    failing.add(`style/${NEW_ID}`)

    const s = await getStyle(NEW_ID)
    expect(s.style).toBe(STYLE_970)
    expect(s.found).toBe(true)
    expect(s.source).toBe(`legacy:${OLD_ID}`)
  })
})

describe('the fallback cannot become a leak', () => {
  it('an agent with no record reads ONLY their own key — exactly today\'s behaviour', async () => {
    await seedSettingsUnder(OLD_ID)
    // No registry entry at all, which is every agent on day one.
    const s = await getStyle(NEW_ID)
    expect(s.style).toBe('')
    expect(s.found).toBe(false)
    expect(await identityKeys(NEW_ID)).toEqual([NEW_ID])
  })

  it('one agent\'s previousIds cannot reach another agent\'s settings', async () => {
    await seedSettingsUnder(OLD_ID)
    // A DIFFERENT agent, whose own history has nothing to do with Owen's id.
    await saveAgentRecord('ag_someone_else', { previousIds: ['ag_their_own_old_id'] })
    const s = await getStyle('ag_someone_else')
    expect(s.style).toBe('')
    expect(s.found).toBe(false)
    expect(s.style).not.toContain('Kuching property agent')
  })

  it('refuses to record an agent as their own previous id', async () => {
    // It would make the walk read the same key twice and hide a genuine miss
    // behind a duplicate hit.
    const rec = await saveAgentRecord(NEW_ID, { previousIds: [NEW_ID, OLD_ID] })
    expect(rec.previousIds).toEqual([OLD_ID])
  })

  it('skips a LONGER previous id — the primary already lists its blobs', async () => {
    // Blob reads are prefix matches, so list('style/<short>') does also return
    // 'style/<short><more>'. Including the longer key adds no data and could only
    // make `source` lie about where the answer came from.
    await saveAgentRecord('6a90f9f6', { previousIds: [OLD_ID] })
    expect(await identityKeys('6a90f9f6')).toEqual(['6a90f9f6'])
  })

  it('but KEEPS a shorter one — that relation does not run the other way', async () => {
    // list('style/<long>') does NOT match 'style/<short>-N.json'. Skipping the
    // shorter key made its data permanently unreachable: settings written under
    // '6a90f9f6' read back empty, found:false, from the full 24-hex primary.
    await saveAgentRecord(OLD_ID, { previousIds: ['6a90f9f6'] })
    expect(await identityKeys(OLD_ID)).toEqual([OLD_ID, '6a90f9f6'])
  })

  it('and the shorter key is actually read, not merely listed', async () => {
    await seedSettingsUnder('6a90f9f6')
    await saveAgentRecord(OLD_ID, { previousIds: ['6a90f9f6'] })
    expect((await getStyle(OLD_ID)).style).toBe(STYLE_970)
  })
})

describe('writing never destroys the way back', () => {
  it('a save after a re-key writes to the NEW key and leaves the OLD one intact', async () => {
    await seedSettingsUnder(OLD_ID)
    await saveAgentRecord(NEW_ID, { previousIds: [OLD_ID] })

    // A rule taught after the switch. saveRule merges with what it can READ,
    // which now includes the legacy set — so the three trained rules are carried
    // forward rather than replaced by a set of one.
    await saveRule(NEW_ID, { rule: 'never mention the developer by name' })

    const after = await getRules(NEW_ID)
    expect(after.rules).toHaveLength(4)
    expect(after.rules.slice(0, 3)).toEqual(RULES_3)
    expect(after.source).toBe('primary')

    // And the original is untouched, so rolling back is reading the old key again.
    expect((await getRules(OLD_ID)).rules).toEqual(RULES_3)
    expect((await getStyle(OLD_ID)).style).toBe(STYLE_970)
  })
})

describe('the posting target, which is the half that DOES change', () => {
  it('resolves to the provider profile on the record', async () => {
    await saveAgentRecord(NEW_ID, { postingProfile: { postpeer: 'pp_111', zernio: 'zz_222' } })
    expect(await resolvePostingProfile(NEW_ID, 'zernio')).toBe('zz_222')
    expect(await resolvePostingProfile(NEW_ID, 'postpeer')).toBe('pp_111')
  })

  it('an agent with no record is their own posting profile — today\'s behaviour exactly', async () => {
    // This is what makes the whole thing safe to deploy BEFORE the provider flip.
    expect(await resolvePostingProfile(OLD_ID, 'postpeer')).toBe(OLD_ID)
    expect(await resolvePostingProfile(OLD_ID, 'zernio')).toBe(OLD_ID)
  })

  it('a provider with no mapping falls back to the agent id, not to nothing', async () => {
    // Half-configured must not mean "publish nowhere" OR "publish anywhere".
    await saveAgentRecord(NEW_ID, { postingProfile: { postpeer: 'pp_111' } })
    expect(await resolvePostingProfile(NEW_ID, 'zernio')).toBe(NEW_ID)
  })

  it('names nobody when asked about nobody', async () => {
    expect(await resolvePostingProfile('', 'zernio')).toBe('')
  })

  it('identity is NOT re-keyed by a posting-profile change', async () => {
    // The whole point: changing where posts go must not move where settings live.
    await seedSettingsUnder(OLD_ID)
    await saveAgentRecord(OLD_ID, { postingProfile: { zernio: 'zz_222' } })
    expect(await resolvePostingProfile(OLD_ID, 'zernio')).toBe('zz_222')
    expect((await getStyle(OLD_ID)).style).toBe(STYLE_970)
    expect((await getStyle(OLD_ID)).source).toBe('primary')
    expect((await getRules(OLD_ID)).rules).toEqual(RULES_3)
  })
})
