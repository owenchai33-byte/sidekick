// One-tap auto-post: SideKick → /api/social-post → Make → Facebook Page + IG.
// No Meta developer app — Make owns the approved app; the webhook URL lives
// server-side in the serverless function.

import { listingPhotos } from './photos.js'

// Make/Facebook fetch the image over the internet, so it needs an ABSOLUTE,
// publicly-reachable URL. Relative seed paths are resolved against the current
// origin. data: URLs (user uploads) and the branded canvas graphic can't be
// fetched remotely yet — those post text-only until image hosting lands.
function publicImageUrl(listing) {
  const src = listingPhotos(listing)[0]
  if (!src || src.startsWith('data:')) return ''
  try { return new URL(src, window.location.href).href } catch { return '' }
}

// Pick the best caption for a listing: the given platform/lang, else the first
// generated copy available.
export function captionFor(listing, platformId = 'facebook_page', lang) {
  const byPlatform = listing?.content?.[platformId] || {}
  const chosen = (lang && byPlatform[lang]) || byPlatform.en || byPlatform[Object.keys(byPlatform)[0]]
  if (chosen) return chosen
  // Fall back to any platform's copy.
  for (const p of Object.values(listing?.content || {})) {
    const first = p?.en || p?.[Object.keys(p)[0]]
    if (first) return first
  }
  return ''
}

export async function postToSocial({ caption, listing, platforms = 'facebook,instagram' }) {
  const imageUrl = listing ? publicImageUrl(listing) : ''
  const res = await fetch('/api/social-post', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caption, imageUrl, platforms }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Post failed (${res.status})`)
  return { ...json, imageUrl }
}
