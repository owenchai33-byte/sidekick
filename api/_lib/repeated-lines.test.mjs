// THE SAME FACT, TWICE, TO FILL A TEMPLATE.
//
// Edward, 2026-09-13, Penview Hotel shoplot — "SNP MOT repeat 3 times, is it
// normal?". His listing had two remarks and little else; his template has a ✨
// highlight line and a "Why Buy This Property?" section, and the model printed
// both remarks in full under each. The contract found nothing, so nothing
// repaired it. (The third copy was the TikTok caption, shown straight after it
// in the preview with no label — that half is fixed in AGENTS.md.)
//
// Fixtures are his real listing and the real caption from that preview.
import { describe, it, expect } from 'vitest'
import { repeatedLines, captionViolations } from './postguard.js'
import { buildContentPrompt } from './prompts.js'

const LISTING = `Nearby Penview Hotel Pending First floor
Commercial shoplot for Sale

742.7 sqft
First Floor
Selling price:
Rm198,000

✨ Remarks:
✅SNP and MOT legal fee and stamp duty half shared between vendor and purchaser.
✅MOC, Valuation borne by purchaser`
const CAPTION = `🏡 NEARBY PENVIEW HOTEL PENDING – FIRST FLOOR

✨ Remarks

✅ SNP and MOT legal fee and stamp duty half shared between vendor and purchaser.

✅ MOC, Valuation borne by purchaser.

📍 PENVIEW HOTEL

━━━━━━━━━━━━━━━

💰 Selling Price

RM198,000

━━━━━━━━━━━━━━━

Property Details

🏬 Commercial Shoplot

📐 Built-up Area: 742.7 sqft

📍 First Floor

━━━━━━━━━━━━━━━

Why Buy This Property?

✅ SNP and MOT legal fee and stamp duty half shared between vendor and purchaser.

✅ MOC, Valuation borne by purchaser.

━━━━━━━━━━━━━━━

📲 PM For More Information Or Viewing Arrangement

#PCMY_Sale`

describe('a fact printed twice is caught', () => {
  it("finds both of Edward's remarks, each printed twice", () => {
    const out = repeatedLines(CAPTION)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatch(/SNP and MOT legal fee/)
    expect(out[0]).toMatch(/appears 2 times/)
    expect(out[1]).toMatch(/MOC, Valuation borne by purchaser/)
  })

  it('reaches the repair round, and never blocks the post', () => {
    const v = captionViolations(CAPTION, { rawText: LISTING, listingType: 'sale', price: 198000 })
    expect(v.marketing.join(' ')).toMatch(/appears 2 times/)
    expect(v.invented).toEqual([])
  })

  it('passes the same caption once the repeat is gone', () => {
    const once = CAPTION.replace(/Why Buy This Property\?[\s\S]*?━━━━━━━━━━━━━━━\n\n/, '')
    expect(repeatedLines(once)).toEqual([])
  })

  it('ignores short template lines that legitimately recur', () => {
    expect(repeatedLines('🛏️ 2 Bedrooms\n━━━━━━━━━━━━━━━\n🛏️ 2 Bedrooms\n#PCMY_Sale\n#PCMY_Sale')).toEqual([])
  })

  it('does not count the same line across two language versions', () => {
    const two = 'Call Edward on 012-345 6789 for a viewing today\n\n• • •\n\nCall Edward on 012-345 6789 for a viewing today'
    expect(repeatedLines(two)).toEqual([])
  })
})

describe('the prompt says it first, so the repair is rarely needed', () => {
  it('tells the writer to say each fact once and leave empty sections out', () => {
    const p = buildContentPrompt({ rawText: LISTING, listingType: 'sale', price: 198000 }, ['facebook_page'], ['en'], { style: 's', examples: [] }, null, [])
    expect(p).toMatch(/SAY EACH FACT ONCE/)
    expect(p).toMatch(/LEFT OUT/)
  })
})
