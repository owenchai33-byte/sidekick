// Edward, 2026-09-15: "Please add on my WhatsApp link https://wa.me/60183929100".
// The agent saved it as a rule; from then on every caption carrying the link was
// refused as "invented", because the link is in the rule, not in the listing.
import { describe, it, expect } from 'vitest'
import { captionViolations, contactNumbersFromRules, nonMoneyInventions } from './postguard.js'
import { sourceFrom } from '../hold.js'

const EDWARD_RULE = "Always include my WhatsApp link https://wa.me/60183929100 as the contact line in captions (instead of just 'PM For More Information')"
const LISTING = `🏡 Brand New Double Storey Intermediate House For Sale

📍 Tapang Height, 7 Mile Sentosa
💰 Selling Price: RM850,000 Nego

🏠 Property Details:
• Brand New Unit
• 4 Bedrooms
• 4 Bathrooms
• Land Size: Approx. 4.5 Points`
const CAPTION = '🏡 BRAND NEW DOUBLE STOREY INTERMEDIATE HOUSE FOR SALE\n\n📍 TAPANG HEIGHT, 7 MILE SENTOSA\n\n💰 Selling Price\n\nRM850,000 Nego\n\n🛏️ 4 Bedrooms\n\n🛁 4 Bathrooms\n\n📲 https://wa.me/60183929100\n\n#PCMY_Sale'
const inventedLinks = (r) => r.invented.filter((x) => /wa\.me/.test(x))

describe("a WhatsApp link the agent taught as a rule is the agent's", () => {
  it('reads the number out of the rule', () => {
    expect(contactNumbersFromRules([EDWARD_RULE])).toEqual(['183929100'])
    expect(contactNumbersFromRules(['WhatsApp me at 018-392 9100', 'never use the fire emoji'])).toEqual(['183929100'])
    expect(contactNumbersFromRules(['from now on always put the area name in CAPS'])).toEqual([])
    expect(contactNumbersFromRules(['prices above RM500,000 get a Luxury tag'])).toEqual([])
  })

  it('the caption with that link is no longer refused — before the rule was grounded it was', () => {
    expect(inventedLinks(captionViolations(CAPTION, { rawText: LISTING }))).toEqual(['https://wa.me/60183929100'])
    expect(inventedLinks(captionViolations(CAPTION, { rawText: LISTING, contactLinks: contactNumbersFromRules([EDWARD_RULE]) }))).toEqual([])
  })

  it('a different number is still invented', () => {
    const other = CAPTION.replace('60183929100', '60123456789')
    expect(inventedLinks(captionViolations(other, { rawText: LISTING, contactLinks: contactNumbersFromRules([EDWARD_RULE]) }))).toEqual(['https://wa.me/60123456789'])
  })

  it('the ✅ check grounds it the same way, from what the pending stored', () => {
    const source = sourceFrom({ sourceText: LISTING, listing: { price: 850000, contactLinks: contactNumbersFromRules([EDWARD_RULE]) } })
    expect(source.contactLinks).toEqual(['183929100'])
    expect(nonMoneyInventions(captionViolations(CAPTION, { ...source, rawText: source.text }).invented).filter((x) => /wa\.me/.test(x))).toEqual([])
    const noRule = sourceFrom({ sourceText: LISTING, listing: { price: 850000 } })
    expect(noRule.contactLinks).toBeUndefined()
  })
})
