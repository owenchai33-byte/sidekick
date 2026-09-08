// Fallback property photos for listings that have none — so every listing looks
// photographed across cards, previews and exports (graphic / carousel / reel /
// share). Real user- or seed-supplied photos always win; this only fills the
// gap. The pick is deterministic per listing id (a listing keeps the same look
// each time) and matched to the property type, so a condo gets condo interiors
// and a landed home gets landed shots.

const POOLS = {
  condo: ['condo-1.jpg', 'condo-2.jpg', 'condo-3.jpg'],
  landed: ['green-1.jpg', 'green-2.jpg', 'green-3.jpg', 'terrace-1.jpg', 'terrace-2.jpg', 'terrace-3.jpg'],
}

function poolFor(listing) {
  const t = `${listing?.propertyType || ''}`.toLowerCase()
  if (/condo|apartment|serviced|studio|flat|soho|suite|penthouse/.test(t)) return POOLS.condo
  return POOLS.landed
}

// Stable, order-sensitive hash so a given id always maps to the same rotation.
function hash(s) {
  let h = 0
  const str = String(s || 'listing')
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Three type-matched fallback photos, rotated by listing id so different
// listings don't all open on the same cover.
export function fallbackPhotos(listing) {
  const pool = poolFor(listing)
  const start = hash(listing?.id || listing?.title) % pool.length
  const n = Math.min(3, pool.length)
  const out = []
  for (let i = 0; i < n; i++) out.push(`seed/${pool[(start + i) % pool.length]}`)
  return out
}

// THE PHOTOS OF THIS PROPERTY, AND NOTHING ELSE.
//
// public/seed/ holds nine real photographs of nine real properties. Any listing
// with no photos of its own was silently given three of them, keyed off its id,
// and src/lib/social.js resolved the first one to an absolute URL and handed it
// to /api/social-post -> Make -> Facebook and Instagram. Nothing requires a
// photo: NewListingPage's canGenerate only checks price, platforms and
// languages. So a listing an agent created without photos was published, under
// their name, illustrated by a photograph of somebody else's condo.
//
// A post with no picture is a post with no picture. A post with the WRONG
// picture is a false statement about a property somebody may come and view.
export function realPhotos(listing) {
  const real = listing?.photos
  return Array.isArray(real) ? real.filter(Boolean) : []
}

// FOR ON-SCREEN DISPLAY ONLY — never for anything that leaves the app.
// Falls back to the seed pool so a listing without photos still looks like a
// listing in the app's own cards and previews. Every caller that PUBLISHES or
// EXPORTS must use realPhotos() instead; see the note above.
export function listingPhotos(listing) {
  const real = realPhotos(listing)
  return real.length > 0 ? real : fallbackPhotos(listing)
}

// Single cover photo for cards / previews.
export function coverPhoto(listing) {
  return listingPhotos(listing)[0]
}

// --- PUBLISHING, WHICH IS NOT BROWSING ------------------------------------
//
// listingPhotos() substitutes seed photographs so the app has something to
// render while an agent is still writing a listing. That is fine on screen and
// a lie on Facebook: public/seed/ holds nine real photographs of nine real
// properties, and one of them was published as a client's listing because
// nothing on the create page requires a photo.
//
// Fixing the /api/social-post route alone was not enough — the app's PRIMARY
// Post button goes to /api/social-broadcast and reached the seed pool through
// coverPhoto(). So the split is made explicit here, and every path that
// produces media for PUBLISHING uses these two, which can return nothing.
// Nothing is the correct answer: a post with no picture is a post with no
// picture, and a post with the WRONG picture is a false statement about a
// property somebody may drive out to view.
export function publishPhotos(listing) {
  return realPhotos(listing)
}
export function publishCover(listing) {
  return realPhotos(listing)[0] || null
}
