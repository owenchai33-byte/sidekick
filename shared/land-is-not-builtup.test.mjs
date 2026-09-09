// A LAND AREA PUBLISHED AS A BUILT-UP AREA.
//
// demoParse took the FIRST area figure in the text and had no landSqft field at
// all, so the standard Malaysian terrace line
//
//     Land area 4,800 sqft, built-up 2,200 sqft
//
// parsed as sqft = 4800 and threw the agent's real built-up away. The facts
// block then stated "Built-up area: 4800 sq ft" — more than double the truth, on
// the number a buyer uses to work out price per square foot. prompts.js has
// carried a counterweight line for this ("this is LAND, not built-up") since
// before the field existed to trigger it.
//
// THE OTHER HALF OF THIS FILE IS WHY THE FIRST ATTEMPT WAS THROWN OUT. It
// matched bare "land" and "tanah" with a twelve-character reach, and review
// measured it turning ordinary listings into new lies: "Freehold land, 1,500
// sqft built up" became a LAND area with the real built-up gone, and "individual
// land title, 1,450 sqft" — a TENURE phrase, not an area — did the same, with
// whether it fired decided by character count. Those cases are tests now.
import { describe, it, expect } from 'vitest'
import { demoParse } from './demo.js'
import { buildContentPrompt } from '../api/_lib/prompts.js'
import { captionViolations } from '../api/_lib/postguard.js'

const parse = (t) => demoParse(t)

describe('a labelled land area is kept apart from the built-up', () => {
  it.each([
    ['both given', 'Terrace @ Batu Kawa. Land area 4,800 sqft, built-up 2,200 sqft. RM600,000', 2200, 4800],
    ['land only', 'Terrace for sale at Batu Kawa. Land area 6,000 sqft. RM520,000', null, 6000],
    ['land size', 'Bungalow lot. Land size 10,890 sqft. RM1,200,000', null, 10890],
    ['luas tanah', 'Rumah teres. Luas tanah 1,540 kaki. RM450,000', null, 1540],
    ['built-up alone', 'Condo. Built-up 1,100 sqft. RM380,000', 1100, null],
  ])('%s', (_l, text, sqft, land) => {
    const r = parse(text)
    expect(r.sqft, 'sqft').toBe(sqft)
    expect(r.landSqft ?? null, 'landSqft').toBe(land)
  })

  it('states both in the facts block, with the counterweight', () => {
    const src = 'Terrace @ Batu Kawa. Land area 4,800 sqft, built-up 2,200 sqft. RM600,000'
    const p = buildContentPrompt({ ...parse(src), rawText: src }, ['facebook_page'], ['en'], {}, null, [])
    expect(p).toMatch(/Built-up area: 2200 sq ft/)
    expect(p).toMatch(/LAND area: 4800 sq ft/)
    expect(p).not.toMatch(/Built-up area: 4800/)
  })

  it('a caption quoting both figures is still grounded', () => {
    const src = 'Terrace @ Batu Kawa. Land area 4,800 sqft, built-up 2,200 sqft. RM600,000'
    const l = { ...parse(src), rawText: src }
    expect(captionViolations('Terrace at Batu Kawa. Land 4,800 sqft, built-up 2,200 sqft. RM600,000', l).invented).toEqual([])
  })
})

describe('only an explicit AREA label binds — never a tenure phrase', () => {
  // Every one of these is a real Malaysian phrasing that the rejected first
  // attempt turned into a false land area.
  it.each([
    ['freehold land, then built up', 'Terrace @ BDC. Freehold land, 1,500 sqft built up. RM620,000', 1500],
    ['individual land title', 'Terrace at Tabuan Jaya. Freehold, individual land title, 1,450 sqft. RM520,000', 1450],
    ['land title on its own line', 'Freehold land title. 1,200 sqft. RM480,000', 1200],
    ['landed property', 'Landed property, 2,200 sqft. RM700,000', 2200],
    ['hartanah is not tanah', 'Hartanah 2,400 kaki persegi. RM800,000', 2400],
  ])('%s stays a built-up size', (_l, text, sqft) => {
    const r = parse(text)
    expect(r.sqft).toBe(sqft)
    expect(r.landSqft ?? null).toBe(null)
  })
})

describe('an unlabelled size behaves exactly as before', () => {
  it.each([
    ['plain sqft', 'Condo 787 sqft 2 bed RM2,500/month', 787],
    ['Owen RENNA', 'Brand New RENNA RESIDENCE for Rent\nSize: 787 Sqft | Fully Furnished\nRental price: RM2.5k', 787],
    ['kaki persegi', 'Apartment 1,200 kaki persegi, RM350,000', 1200],
  ])('%s', (_l, text, sqft) => {
    expect(parse(text).sqft).toBe(sqft)
    expect(parse(text).landSqft ?? null).toBe(null)
  })

  it('no size at all is still null, not zero', () => {
    expect(parse('Condo for rent RM2,500/month, 2 bedrooms').sqft).toBe(null)
  })
})
