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

// Real photos when the listing has them, otherwise a deterministic fallback set.
export function listingPhotos(listing) {
  const real = listing?.photos
  return Array.isArray(real) && real.length > 0 ? real : fallbackPhotos(listing)
}

// Single cover photo for cards / previews.
export function coverPhoto(listing) {
  return listingPhotos(listing)[0]
}
