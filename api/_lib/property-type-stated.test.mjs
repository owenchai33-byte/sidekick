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
