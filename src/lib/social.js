// One-tap auto-post: SideKick → /api/social-post → Make → Facebook Page + IG.
// No Meta developer app — Make owns the approved app; the webhook URL lives
// server-side in the serverless function.

import { listingPhotos } from './photos.js'
import { uploadMedia, dataUrlToBlob } from './upload.js'

// Make/Facebook/Instagram fetch the image over the internet, so it needs an
// ABSOLUTE, publicly-reachable URL. Relative seed paths resolve against the
// current origin. A user upload (data: URL) has no public URL, so we host it
// on Vercel Blob first — that's also what makes Instagram (which, unlike FB,
// can't post text-only) work for listings with real uploaded photos.
async function coverImageUrl(listing) {
  const src = listingPhotos(listing)[0]
  if (!src) return ''
  if (src.startsWith('data:')) {
    try {
      const blob = await dataUrlToBlob(src)
      const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
      return await uploadMedia(blob, `listing-${listing?.id || 'photo'}.${ext}`)
    } catch { return '' }
  }
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

// Post a listing to the FB Page + IG via /api/social-post → Make.
// Pass an already-hosted `mediaUrl` (e.g. an uploaded Reel) with its
// `mediaType`; otherwise it posts the listing's cover photo, hosting a data:
// upload first if needed. `mediaType` drives the Router in the Make scenario
// (image → photo modules, video → Reel modules).
export async function postToSocial({ caption, listing, mediaUrl, mediaType = 'image', platforms = 'facebook,instagram' }) {
  const url = mediaUrl || (listing ? await coverImageUrl(listing) : '')
  const type = url ? mediaType : 'text'
  const res = await fetch('/api/social-post', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      caption,
      mediaUrl: url,
      mediaType: type,
      // Back-compat with the current FB "Upload a Photo" module (maps `imageUrl`).
      imageUrl: type === 'image' ? url : '',
      platforms,
    }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Post failed (${res.status})`)
  return { ...json, mediaUrl: url, mediaType: type }
}
