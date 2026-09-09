// "📲 WhatsApp for more info: https://wa.me/YourNumber"
//
// Edward, 2026-09-08. He asked for a TikTok reel for his Stapok Oaks listing.
// The caption came back three times ending in a link to nobody. Every check in
// this file passed it — it is not money, not a room count, not a material
// claim, not a distance — so it was one ✅ away from a paying client's TikTok
// under his own name. He only escaped because the model happened to notice.
//
// A contact link is the one line in a property post that exists to be acted on.
// Getting it wrong is worse than a typo: the post looks legitimate, the buyer
// taps, nothing happens, and the agent never learns the enquiry was lost.
//
// Worth recording, because it sent the diagnosis to the wrong place: the model
// told Edward "this is clearly a hardcoded issue in the reel caption template".
// It is not. `wa.me/YourNumber` appears nowhere in this codebase, and
// buildReelPrompt takes no contact argument at all. The string was generated,
// not templated.
import { describe, it, expect } from 'vitest'
import { captionViolations } from './postguard.js'

// Edward's listing, as he actually sent it. No phone number anywhere in it.
const SRC = `Stapok Oaks 23 Residence at Stapok
Brand New Double Storey SemiD FOR SALE

4 bedrooms 4 bathrooms 1 maids room 1 Store room
Land Size 10.94 pts

EXCELLEN LOCATION
5 mins to pine square
3 mins to Chung Hua No 6
3 mins to Klinik Kesihatan Stapok

Asking price RM 1,500,000

Lister: Edward`

const listing = { rawText: SRC, price: 1500000, location: 'Stapok', bedrooms: 4, bathrooms: 4, listingType: 'sale' }
const withPhone = { ...listing, rawText: `${SRC}\nEdward 018-392 9100` }
const invented = (cap, l = listing) => captionViolations(cap, l).invented

describe('a contact link nobody gave is refused', () => {
  it("blocks the caption Edward actually got", () => {
    const cap = 'Stapok Oaks 23 Residence – Semi-D FOR SALE\n\nRM1,500,000\n\n📲 WhatsApp for more info: https://wa.me/YourNumber\n\n#PCMY_Sale'
    expect(invented(cap).join(' ')).toMatch(/wa\.me\/YourNumber/)
  })

  it.each([
    ['bare wa.me placeholder', 'Message me: wa.me/YourNumber'],
    ['no protocol', 'wa.me/YourNumber'],
    ['api.whatsapp form', 'https://api.whatsapp.com/send?phone=60999888777'],
    ['a number the agent never wrote', 'WhatsApp https://wa.me/60123456789'],
  ])('blocks %s', (_label, cap) => {
    expect(invented(cap).length).toBeGreaterThan(0)
  })

  it.each([
    ['[Your Number]', 'Contact [Your Number] today'],
    ['[Specify Location]', '📍 Location: [Specify Location]'],
    ['[insert price]', 'Asking [insert price] negotiable'],
    ['bare YourNumber token', 'Reach me at YourNumber'],
  ])('blocks the unfilled placeholder %s', (_label, cap) => {
    // The same run that produced wa.me/YourNumber produced "[Specify Location]"
    // on the feed path. A bracketed slot is the model showing its scaffolding.
    expect(invented(cap).length).toBeGreaterThan(0)
  })
})

describe("an agent's real number still publishes", () => {
  // The other half. This must not become another guard that refuses real work.
  it('accepts a wa.me link built from the number he gave', () => {
    expect(invented('Call Edward https://wa.me/60183929100', withPhone)).toEqual([])
  })

  it('accepts it despite local formatting on his side', () => {
    // He writes 018-392 9100; the link needs 60183929100. Digits only, leading
    // 60 optional — otherwise every correct link in the system would be refused.
    expect(invented('wa.me/60183929100', withPhone)).toEqual([])
    expect(invented('wa.me/0183929100', withPhone)).toEqual([])
  })

  it('accepts a plain phone number with no link', () => {
    expect(invented('Edward 018-392 9100', withPhone)).toEqual([])
  })

  it('accepts a caption with no contact line at all', () => {
    expect(invented('Stapok Oaks Semi-D FOR SALE RM1,500,000. DM us to arrange a viewing.')).toEqual([])
  })

  it("accepts Owen's published RENNA caption", () => {
    const cap = '🏠 RENNA RESIDENCE – FOR RENT\n\nRM2,500/month\n\n📲 Lydia 0143998011'
    expect(invented(cap, { rawText: 'RENNA RESIDENCE for Rent RM2.5k Lydia 0143998011', price: 2500, listingType: 'rental' })).toEqual([])
  })

  it('does not fire on ordinary square brackets in a listing', () => {
    const l = { ...listing, rawText: `${SRC}\nNote [renovated 2024]` }
    expect(invented('Semi-D for sale, RM1,500,000 [renovated 2024]', l)).toEqual([])
  })
})
