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
    expect(out[0]).toMatch(/is already said in/)
    expect(out[1]).toMatch(/MOC, Valuation borne by purchaser/)
  })

  it('reaches the repair round, and never blocks the post', () => {
    const v = captionViolations(CAPTION, { rawText: LISTING, listingType: 'sale', price: 198000 })
    expect(v.marketing.join(' ')).toMatch(/is already said in/)
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


// ---------------------------------------------------------------------------
// The repair that fixed the repeat left the heading behind. Live output,
// 2026-09-13, Edward's Penview listing, straight from the deployed engine.
import { dropEmptySections } from './format.js'

const LIVE_AFTER_REPAIR = `🏡 NEARBY PENVIEW HOTEL PENDING – FIRST FLOOR

✨ Commercial Shoplot for Sale

📍 PENVIEW HOTEL

━━━━━━━━━━━━━━━

💰 Selling Price

RM198,000

━━━━━━━━━━━━━━━

Property Details

🏬 Commercial Shoplot

📐 Built‑up Area: 742.7 sqft

📍 First Floor

✅ SNP and MOT legal fee and stamp duty half shared between vendor and purchaser.

✅ MOC, Valuation borne by purchaser

━━━━━━━━━━━━━━━

Why Buy This Property?

━━━━━━━━━━━━━━━

📲 PM For More Information Or Viewing Arrangement

#PCMY_Sale`

describe('a heading left with nothing under it is removed', () => {
  it('removes the empty "Why Buy This Property?" and one of its two dividers', () => {
    const out = dropEmptySections(LIVE_AFTER_REPAIR)
    expect(out).not.toMatch(/Why Buy This Property/)
    // everything with substance survives
    for (const kept of ['RM198,000', '742.7 sqft', 'First Floor', 'SNP and MOT', 'MOC, Valuation', 'PM For More Information', '#PCMY_Sale']) {
      expect(out).toContain(kept)
    }
    // no two dividers left back to back
    expect(out).not.toMatch(/━{5,}\s*\n\s*━{5,}/)
    expect((out.match(/━{5,}/g) || []).length).toBe((LIVE_AFTER_REPAIR.match(/━{5,}/g) || []).length - 1)
  })

  it('never removes a one-line FACT between two dividers', () => {
    const fact = 'HEADLINE\n\n━━━━━━━━━━━━━━━\n\n💰 RM2,500/month\n\n━━━━━━━━━━━━━━━\n\n📲 PM me'
    expect(dropEmptySections(fact)).toBe(fact)
  })

  it('leaves a heading that has content under it', () => {
    const full = 'X\n\n━━━━━━━━━━━━━━━\n\nWhy Buy This Property?\n\n✅ Corner lot\n\n━━━━━━━━━━━━━━━\n\nY'
    expect(dropEmptySections(full)).toBe(full)
  })

  it('leaves a caption with no dividers exactly as it is', () => {
    const plain = 'Why Buy This Property?\nRM198,000\nPM me'
    expect(dropEmptySections(plain)).toBe(plain)
  })
})


// The second live run, after the whole-line version shipped: both remarks joined
// into one all-caps highlight line, then repeated as bullets. No line matched a
// line, the check found nothing, and SNP and MOC were each printed twice.
const LIVE_JOINED = `🏡 NEARBY PENVIEW HOTEL PENDING – FIRST FLOOR SHOPLOT FOR SALE

✨ SNP AND MOT LEGAL FEE & STAMP DUTY HALF SHARED BETWEEN VENDOR AND PURCHASER • MOC, VALUATION BORNE BY PURCHASER

━━━━━━━━━━━━━━━

💰 Selling Price

RM198,000

━━━━━━━━━━━━━━━

Property Details

🏬 Commercial Shoplot

📐 Built-up Area: 742.7 sqft

📐 First Floor

━━━━━━━━━━━━━━━

Why Buy This Property?

✅ SNP and MOT legal fee and stamp duty half shared between vendor and purchaser.

✅ MOC, Valuation borne by purchaser.

━━━━━━━━━━━━━━━

📲 PM For More Information Or Viewing Arrangement

#PCMY_Sale`

describe('a fact repeated inside a longer line is still a repeat', () => {
  it('catches the remarks folded into the ✨ highlight and repeated as bullets', () => {
    const out = repeatedLines(LIVE_JOINED)
    expect(out.length).toBeGreaterThanOrEqual(1)
    expect(out.join(' ')).toMatch(/SNP and MOT legal fee/i)
  })

  it("does not flag Owen's normal highlight line against his detail lines", () => {
    const renna = '✨ Fully Furnished | 12th Floor | 2 Bed 2 Bath\n\n🛏️ 2 Bedrooms\n\n🛁 2 Bathrooms\n\n🛋️ Fully Furnished\n\n🏢 Level: 12th Floor\n\n✅ Fully Furnished\n\n✅ 12th Floor Living'
    expect(repeatedLines(renna)).toEqual([])
  })
})

describe('the house style restating a short detail is not a repeat', () => {
  // Measured over the 19 real captions in the chat history: this pattern is in
  // six of them, and Owen's own trained examples do it.
  it('leaves "Why Buy" bullets that restate a figure from the details', () => {
    const style = 'Property Details\n\n📐 Built-up Area: 787 sqft\n\n📜 Current Rental: RM1,300/month\n\n━━━━━━━━━━━━━━━\n\nWhy Buy This Property?\n\n✅ Built-up 787 sqft\n\n✅ Current Rental: RM1,300/month\n\n✅ 2 Bedrooms, 2 Bathrooms'
    expect(repeatedLines(style)).toEqual([])
  })
})
