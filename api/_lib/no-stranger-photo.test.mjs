// A PHOTOGRAPH OF A DIFFERENT PROPERTY MUST NOT BE PUBLISHED AS THIS ONE.
//
// public/seed/ holds nine real property photographs (160–360 KB each). Any
// listing with no photos of its own was given three of them, keyed off its id:
//
//   listingPhotos({ id: 'l_9931', location: 'Miri', photos: [] })
//     -> ['seed/condo-2.jpg', 'seed/condo-3.jpg', 'seed/condo-1.jpg']
//
// src/lib/social.js resolved the first to an absolute URL and handed it to
// /api/social-post -> Make -> Facebook and Instagram, and PropertyVideo encoded
// them into the MP4 that goes to TikTok. Nothing requires a photo:
// NewListingPage's canGenerate checks price, platforms and languages only.
//
// The code framed this as demo polish. It does not distinguish a demo listing
// from a paying agent's real one.
import { describe, it, expect } from 'vitest'
import { realPhotos, listingPhotos, fallbackPhotos, coverPhoto } from '../../src/lib/photos.js'

const PHOTOLESS = { id: 'l_9931', propertyType: 'Apartment', location: 'Miri', photos: [] }

describe('nothing that leaves the app substitutes a photo', () => {
  it('a listing with no photos has no photos to publish', () => {
    expect(realPhotos(PHOTOLESS)).toEqual([])
    expect(realPhotos({ id: 'x' })).toEqual([])
    expect(realPhotos({ id: 'x', photos: null })).toEqual([])
  })

  it('the seed pool really is other people\'s properties, so this is not academic', () => {
    // If this ever returns [] the fallback has been removed and the risk is gone;
    // while it returns seed paths, realPhotos() is what keeps them off the wire.
    expect(fallbackPhotos(PHOTOLESS).every((p) => p.startsWith('seed/'))).toBe(true)
    expect(listingPhotos(PHOTOLESS).length).toBeGreaterThan(0)
  })

  it('a listing WITH photos publishes its own, in its own order', () => {
    const real = { id: 'l_1', photos: ['https://blob.test/a.jpg', 'https://blob.test/b.jpg'] }
    expect(realPhotos(real)).toEqual(real.photos)
    expect(coverPhoto(real)).toBe('https://blob.test/a.jpg')
  })

  it('the in-app display fallback still works — the app does not go blank', () => {
    expect(listingPhotos(PHOTOLESS)).toEqual(fallbackPhotos(PHOTOLESS))
  })
})

// The two call sites that put an image in front of the public. Read as source so
// this fails if either is switched back, without needing a DOM or a network.
describe('the publish and encode paths do not call the substituting helper', () => {
  const read = async (p) => (await import('node:fs')).readFileSync(new URL(p, import.meta.url), 'utf8')

  it('src/lib/social.js — the Facebook/Instagram cover', async () => {
    const src = await read('../../src/lib/social.js')
    expect(src).toContain('realPhotos(listing)[0]')
    // the call, not the word — both files name listingPhotos() in a comment
    // explaining why they must not use it
    expect(src).not.toContain('listingPhotos(listing)')
  })

  it('src/components/PropertyVideo.jsx — the encoded MP4', async () => {
    const src = await read('../../src/components/PropertyVideo.jsx')
    expect(src).not.toContain('listingPhotos(listing)')
    expect(src).toContain('realPhotos(listing)')
  })
})
