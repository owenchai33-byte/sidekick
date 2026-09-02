// Reproduces the 2026-09-01 incident: one listing published to Facebook and
// Instagram three times (06:33:13 / 06:34:16 / 06:35:23), carrying demo
// boilerplate, because the operator asked "fb and ig posted?".
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { postFingerprint, looksLikeDemoCaption, inventsPriceHistory, captionViolations } from './postguard.js'

// The exact text PostPeer received three times that day.
const DEMO = `✨ Property in The Northbank — now available

Looking for a place that just feels right? This home with 2 bedrooms in The Northbank is ready for its next owner. RM2,500/month — great value for the area.

2 bedrooms · 2 bathrooms · 787 sq ft

Drop me a DM and I'll send over the full details and viewing times. 🏡`

// The caption the operator actually approved and believed had gone out.
const REAL = `✨ Brand New RENNA RESIDENCE — Now Available for Rent

Looking for a premium rental at The Northbank? This stunning RENNA RESIDENCE is move-in ready!

📍 The Northbank, Kuching
💰 RM2,500/month (negotiable)
🛏️ 2 Bedrooms | 2 Bathrooms | 787 Sqft
🏢 Level 12 | Fully Furnished

Ready to view? DM or call Lydia 0143998011 🏡`

describe('demo-caption detection', () => {
  it('catches the boilerplate that actually got published', () => {
    expect(looksLikeDemoCaption(DEMO)).toBe(true)
  })

  it('does NOT flag the real branded caption', () => {
    expect(looksLikeDemoCaption(REAL)).toBe(false)
  })

  it('does not flag a normal caption that merely mentions a DM', () => {
    expect(looksLikeDemoCaption('Lovely 3 bed in Batu Kawa, RM480k. DM me for a viewing.')).toBe(false)
  })

  it('is safe on empty/undefined input', () => {
    expect(looksLikeDemoCaption('')).toBe(false)
    expect(looksLikeDemoCaption(undefined)).toBe(false)
  })
})

describe('post fingerprint', () => {
  const base = {
    profileId: 'p1', caption: REAL,
    platforms: ['facebook', 'instagram'],
    mediaItems: [{ url: 'https://blob/a.png' }],
  }

  it('is identical for a repeat of the same post', () => {
    expect(postFingerprint(base)).toBe(postFingerprint({ ...base }))
  })

  it('ignores platform ORDER, so fb+ig equals ig+fb', () => {
    expect(postFingerprint(base)).toBe(postFingerprint({ ...base, platforms: ['instagram', 'facebook'] }))
  })

  it('differs for a different agent, so one agent cannot block another', () => {
    expect(postFingerprint(base)).not.toBe(postFingerprint({ ...base, profileId: 'p2' }))
  })

  it('differs for a genuinely different listing', () => {
    expect(postFingerprint(base)).not.toBe(postFingerprint({ ...base, caption: 'Totally different listing' }))
  })

  it('differs when the media changes', () => {
    expect(postFingerprint(base)).not.toBe(postFingerprint({ ...base, mediaItems: [{ url: 'https://blob/b.png' }] }))
  })
})

describe('claimPostOnce', () => {
  let store
  beforeEach(async () => {
    vi.resetModules()
    store = new Map()
    process.env.BLOB_READ_WRITE_TOKEN = 'tok'
    process.env.POST_DEDUPE_WINDOW_MS = '600000'
    vi.doMock('@vercel/blob', () => ({
      put: async (key) => {
        if (store.has(key)) throw new Error('exists')   // allowOverwrite:false
        store.set(key, { url: `u/${key}`, uploadedAt: new Date().toISOString() })
        return store.get(key)
      },
      list: async ({ prefix }) => ({ blobs: store.has(prefix) ? [store.get(prefix)] : [] }),
      del: async (url) => { for (const [k, v] of store) if (v.url === url) store.delete(k) },
    }))
  })

  it('lets the first post through and blocks the immediate repeats', async () => {
    const { claimPostOnce } = await import('./postguard.js')
    const fp = 'abc123'
    expect(await claimPostOnce(fp)).toBe(true)   // 06:33:13 - the real post
    expect(await claimPostOnce(fp)).toBe(false)  // 06:34:16 - blocked
    expect(await claimPostOnce(fp)).toBe(false)  // 06:35:23 - blocked
  })

  it('does not block a DIFFERENT listing posted at the same moment', async () => {
    const { claimPostOnce } = await import('./postguard.js')
    expect(await claimPostOnce('listing-a')).toBe(true)
    expect(await claimPostOnce('listing-b')).toBe(true)
  })

  it('releases the claim so a failed publish can genuinely retry', async () => {
    const { claimPostOnce, releasePostOnce } = await import('./postguard.js')
    expect(await claimPostOnce('x')).toBe(true)
    expect(await claimPostOnce('x')).toBe(false)
    await releasePostOnce('x')
    expect(await claimPostOnce('x')).toBe(true)
  })

  it('fails OPEN when Blob has no token, rather than blocking all posting', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    const { claimPostOnce } = await import('./postguard.js')
    expect(await claimPostOnce('anything')).toBe(true)
  })
})

describe('invented price history', () => {
  const listing = { rawText: 'RARE 1-BEDROOM FOR SALE. Tropics City. RM338,000 (RM100k below value).' }

  it('catches the exact fabrication seen in 8 of 8 generations', () => {
    expect(inventsPriceHistory('💰 Selling Price\nRM438,000\nNOW ONLY RM338,000', listing)).toBe(true)
  })

  it('catches "PRICE REDUCED" when the listing never said so', () => {
    expect(inventsPriceHistory('🔥 PRICE REDUCED | FOR SALE', listing)).toBe(true)
  })

  it('allows an honest below-bank-value caption', () => {
    expect(inventsPriceHistory('💰 RM338,000\n🏦 Bank Value RM438,000\n💥 Save RM100,000', listing)).toBe(false)
  })

  it('does NOT block a listing the agent really did reduce', () => {
    const reduced = { rawText: 'PRICE REDUCED! Was RM400,000, now RM338,000.' }
    expect(inventsPriceHistory('🔥 PRICE REDUCED\nNOW ONLY RM338,000', reduced)).toBe(false)
  })

  it('is safe on empty input', () => {
    expect(inventsPriceHistory('', listing)).toBe(false)
    expect(inventsPriceHistory('Lovely 2 bed in Kuching, RM2,500/month.', listing)).toBe(false)
  })
})

describe('caption contract (the Tropics City incident)', () => {
  const listing = { rawText: `RARE 1-BEDROOM UNIT FOR SALE. SAVED RM100k
Tropics City - 1 Bedroom Unit For Sale
Location : Tabuan Dayak
Selling Price : RM338,000 (RM100K Below Value)
800 sqft, 1 Bedroom, 1 Bathroom, 1 Carpark
Current Rental : RM1,300/month. Annual Rental: RM15,600
5 mins to Jalan Song. Gross ROI 4.62% p.a.
Lister: Edward 0183929100` }

  it('flags the published caption: invented furnishing + dropped hook and name', () => {
    const v = captionViolations('RM338,000. 800 sq ft. Fully Furnished. RM1,300/month. RM15,600 annual. Edward 0183929100', listing)
    expect(v.invented).toContain('Fully Furnished')
    expect(v.missing).toContain('the below-value hook')
    expect(v.missing.some((m) => m.includes('Tropics City'))).toBe(true)
  })

  it('passes a caption that honours the listing', () => {
    const good = `Tropics City, Tabuan Dayak. RM338,000 - RM100K Below Value (save RM100k).
800 sqft, 1 bed 1 bath 1 carpark. Rental RM1,300/month, RM15,600/year, ROI 4.62%.
5 mins to Jalan Song. Edward 0183929100`
    const v = captionViolations(good, listing)
    expect(v.invented).toEqual([])
    expect(v.missing).toEqual([])
  })

  it('allows furnishing when the listing states it', () => {
    const furnished = { rawText: 'RENNA RESIDENCE for rent, RM2,500/month, fully furnished, Lydia 0143998011' }
    const v = captionViolations('RENNA RESIDENCE - RM2,500/month, Fully Furnished. Lydia 0143998011', furnished)
    expect(v.invented).toEqual([])
  })

  it('flags an invented distance claim', () => {
    const v = captionViolations('Tropics City RM338,000, 800 sqft, RM1,300/month, RM15,600, RM100k below value, 5 mins to Jalan Song, 3 mins to the airport! Edward 0183929100', listing)
    expect(v.invented.some((x) => /airport/i.test(x))).toBe(true)
  })
})
