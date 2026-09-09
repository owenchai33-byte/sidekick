// "🏢 Condo" — A FACT NOBODY STATED.
//
// Owen's RENNA listing, sent 2026-09-08 09:09:54:
//   Brand New RENNA RESIDENCE for Rent
//   📍The Northbank, Kuching
//   • 2 Bedrooms | 2 Bathrooms  - Size: 787 Sqft | Fully Furnished
//   - Level: 12th Floor  - Rental price: RM2.5k (nego)
//   Comm: 1 month + 8% SST   Lydia 0143998011
//
// It names the building, the floor, the size and the rent. It never says what
// KIND of property it is. The caption published to Facebook and Instagram read
// "🏢 Condo", and the TikTok cut carried "#CondoForRent".
//
// It is very probably right, and that is exactly what makes it the dangerous
// kind of wrong: nobody checks a detail that looks correct. buildParsePrompt
// asks the model to pick a propertyType from a fixed list, and the model
// obliges whether or not the agent gave it one.
//
// This has already cost something once. Edward's listing said only "1 Bedroom
// Unit"; the parser answered "Apartment"; the facts block asserted it; the model
// wrote the exact word his rule forbade, and two repair rounds could not argue
// it back out — because the prompt was stating as fact the thing the rule was
// asking it to avoid. bannedByRules patched that for one agent and one word.
// This is the general case.
import { describe, it, expect } from 'vitest'
import { propertyTypeStated } from './prompts.js'
import { buildContentPrompt, buildReelPrompt } from './prompts.js'
import { demoContent } from '../../shared/demo.js'

const RENNA = `Brand New RENNA RESIDENCE for Rent

📍The Northbank, Kuching

• 2 Bedrooms | 2 Bathrooms
- Size: 787 Sqft | Fully Furnished
- Level: 12th Floor
- Rental price: RM2.5k (nego)

Comm: 1 month + 8% SST
Lydia 0143998011`

describe('a type the agent never wrote is not quoted back as a fact', () => {
  it("Owen's RENNA listing states no type", () => {
    expect(propertyTypeStated({ rawText: RENNA })).toBe(false)
  })

  it('so the facts block does not assert one', () => {
    const listing = { propertyType: 'Condo', location: 'The Northbank, Kuching', bedrooms: 2, rawText: RENNA }
    const p = buildContentPrompt(listing, ['facebook_page'], ['en'], {}, null, [])
    expect(p).not.toMatch(/Property type: Condo/)
  })

  it('nor does the reel prompt', () => {
    const listing = { propertyType: 'Condo', location: 'The Northbank, Kuching', rawText: RENNA }
    expect(buildReelPrompt(listing, {}, [])).not.toMatch(/Type: Condo/)
  })

  it("Edward's '1 Bedroom Unit' states no type either", () => {
    expect(propertyTypeStated({ rawText: '1 Bedroom Unit, RM1,200/month, Kuching' })).toBe(false)
    const p = buildContentPrompt(
      { propertyType: 'Apartment', bedrooms: 1, rawText: '1 Bedroom Unit, RM1,200/month, Kuching' },
      ['facebook_page'], ['en'], {}, null, [])
    expect(p).not.toMatch(/Property type: Apartment/)
  })

  it("a building's own name cannot vouch for its type", () => {
    // "Residence" is in half the condo names in Malaysia. Counting it would let
    // RENNA RESIDENCE prove RENNA RESIDENCE is a condo.
    expect(propertyTypeStated({ rawText: 'THE NORTHBANK residences, Kuching' })).toBe(false)
    expect(propertyTypeStated({ rawText: 'RENNA RESIDENCE' })).toBe(false)
  })

  it('missing or malformed text is not a statement', () => {
    expect(propertyTypeStated({})).toBe(false)
    expect(propertyTypeStated(null)).toBe(false)
    expect(propertyTypeStated({ rawText: null })).toBe(false)
  })
})

describe('a type the agent DID write is still used', () => {
  // The other half matters as much. This must not become the ninth guard that
  // quietly refuses real information.
  for (const text of [
    'Condo for rent in Kuching RM2,500',
    'Condominium at Vivacity, RM450,000',
    '3 storey terrace house for sale',
    'Semi-D in Kota Samarahan',
    'Double storey bungalow, freehold',
    'Shoplot at Jalan Song, RM1.2m',
    'Serviced apartment, fully furnished',
    'Penthouse unit, 2,400 sqft',
    'Studio unit for rent',
    'Pangsapuri untuk disewa di Kuching',
    'Rumah teres 2 tingkat untuk dijual',
    'Banglo mewah, tanah luas',
    '公寓出租 RM1800 每月',
    '排屋出售，地点方便',
    '半独立洋房，价格面议',
  ]) {
    it(`states a type: ${JSON.stringify(text)}`, () => {
      expect(propertyTypeStated({ rawText: text })).toBe(true)
    })
  }

  it('and the facts block passes it straight through', () => {
    const listing = { propertyType: 'Condo', bedrooms: 2, rawText: 'Condo for rent in Kuching RM2,500' }
    expect(buildContentPrompt(listing, ['facebook_page'], ['en'], {}, null, [])).toMatch(/Property type: Condo/)
  })

  it("an agent's ban still outranks a type they did write", () => {
    // bannedByRules came first and keeps precedence: Edward saying "never call a
    // condo an apartment" wins even over a word in his own message.
    const listing = { propertyType: 'Apartment', rawText: 'Apartment for rent, Kuching' }
    const p = buildContentPrompt(listing, ['facebook_page'], ['en'], {}, null,
      ['never call a condo an apartment'])
    expect(p).not.toMatch(/Property type: Apartment/)
  })
})

// THE FALLBACK NEVER READS THE PROMPT.
//
// Gating buildContentPrompt was not enough, and production said so on
// 2026-09-09. With the model rate-limited — most of the afternoon, on the free
// tier — demoContent runs instead and renders `${l.propertyType || 'Property'}`
// straight into the caption. Two runs in six came back
// "✨ Condo in The Northbank, Kuching — now available" with the prompt fix
// already live, because the fallback path never sees the facts block.
//
// So the guess is dropped once, in ingest.js, where every renderer downstream
// inherits it. These tests hold the END of that chain: the caption a rate-limited
// agent actually receives.

describe('the degraded caption does not carry a guessed type either', () => {
  const rennaListing = (propertyType) => ({
    propertyType, listingType: 'rental', price: 2500, location: 'The Northbank, Kuching',
    bedrooms: 2, bathrooms: 2, sqft: 787, furnishing: 'Fully Furnished', rawText: RENNA,
  })

  it('says "Property", not "Condo", once the type is dropped', () => {
    // ingest.js nulls propertyType when the agent never wrote one; this is what
    // demoContent then produces.
    const out = demoContent(rennaListing(null), ['facebook_page'], ['en'])
    const cap = out.facebook_page.en
    expect(cap).not.toMatch(/condo|apartment/i)
    expect(cap).toMatch(/Property/)
  })

  it('still uses a type the agent did write', () => {
    const cap = demoContent(rennaListing('Condo'), ['facebook_page'], ['en']).facebook_page.en
    expect(cap).toMatch(/Condo/)
  })

  it('every language variant is clean, not just English', () => {
    // The Chinese and Malay templates have their own propertyType slots.
    const out = demoContent(rennaListing(null), ['facebook_page'], ['en', 'zh', 'ms'])
    for (const lang of ['en', 'zh', 'ms']) {
      expect(out.facebook_page[lang] || '', lang).not.toMatch(/condo|apartment/i)
    }
  })
})
