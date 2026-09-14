import { describe, it, expect } from 'vitest'
import { saysSize, dropSpokenSize } from './spoken-size.js'

const ON_BAR = { sqft: 742.7 }
const NO_SQFT = { sqft: null }

describe('the voice never reads out a floor area the price bar shows', () => {
  it.each([
    // Edward's Penview reel, 2026-09-14, word for word.
    ["Check this out! A commercial shoplot on the first floor, right next to Penview Hotel. It's 742.7 sq ft and priced at RM198,000. Message me for a viewing!",
      "Check this out! A commercial shoplot on the first floor, right next to Penview Hotel. It's priced at RM198,000. Message me for a viewing!"],
    ['This 825 sq ft unit is fully furnished. Message Lydia for a viewing!',
      'This unit is fully furnished. Message Lydia for a viewing!'],
    ["With 1,450 sq ft of space, it's ready to move in. Call Kelvin!",
      "It's ready to move in. Call Kelvin!"],
    ['Spanning 742.7 sq ft on the first floor, it sits right next to Penview Hotel.',
      'On the first floor, it sits right next to Penview Hotel.'],
    ['Brand new RENNA RESIDENCE, 787 sqft, fully furnished and just RM2,500 a month!',
      'Brand new RENNA RESIDENCE, fully furnished and just RM2,500 a month!'],
    ["It's 1,200 square feet. Two bedrooms, fully renovated. DM me!",
      'Two bedrooms, fully renovated. DM me!'],
    ['The shoplot is 742.7 sq. ft. Message Edward today!',
      'Message Edward today!'],
    ["It's 742.7 sq. ft. and priced at RM198,000.",
      "It's priced at RM198,000."],
    ['A spacious 2,800 sq ft corner lot with land on two sides!',
      'Corner lot with land on two sides!'],
  ])('%s', (before, after) => {
    expect(saysSize(before, ON_BAR)).toBe(true)
    const out = dropSpokenSize(before, ON_BAR)
    expect(out).toBe(after)
    expect(saysSize(out, ON_BAR)).toBe(false)
  })

  it('keeps every other figure: price, rooms, deposit, floor, land size in points', () => {
    const s = "It's 742.7 sq ft with 3 bedrooms, a 2+1 deposit and RM2,800 a month on the 12th floor."
    const out = dropSpokenSize(s, ON_BAR)
    for (const kept of ['3 bedrooms', '2+1 deposit', 'RM2,800 a month', '12th floor']) expect(out).toContain(kept)
    expect(out).not.toMatch(/742\.7/)
  })

  it('leaves the script alone when the bar does not show a size', () => {
    const s = "It's 742.7 sq ft and priced at RM198,000."
    expect(saysSize(s, NO_SQFT)).toBe(false)
    expect(dropSpokenSize(s, NO_SQFT)).toBe(s)
    expect(dropSpokenSize('Land for rent at Demak Laut, 42 points, RM2,800 a month!', ON_BAR)).toBe('Land for rent at Demak Laut, 42 points, RM2,800 a month!')
  })

  it('never empties a voiceover', () => {
    expect(dropSpokenSize('742.7 sq ft.', ON_BAR)).toBe('742.7 sq ft.')
    expect(dropSpokenSize('', ON_BAR)).toBe('')
  })

  it('does not touch words that only look like a unit', () => {
    const s = 'Message me at 5 sfx studios, 3 bedrooms.'
    expect(dropSpokenSize(s, ON_BAR)).toBe(s)
  })
})
