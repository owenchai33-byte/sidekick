// Native Web Share (Level 2). Hands the caption + photos to the phone's OS
// share sheet, so the agent picks Facebook / Instagram / WhatsApp and posts in
// the native app with everything pre-attached — they just tap post. 100% safe:
// a human still does the final tap, no automation, no ToS risk.

export function canShare() {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

async function urlToFile(src, name) {
  const res = await fetch(src)
  const blob = await res.blob()
  const type = blob.type || 'image/jpeg'
  const ext = (type.split('/')[1] || 'jpg').split('+')[0].replace('jpeg', 'jpg')
  return new File([blob], `${name}.${ext}`, { type })
}

/**
 * Share caption text + photos to the OS share sheet.
 * @returns {{ ok: boolean, withFiles?: boolean, reason?: string }}
 *   reason: 'unsupported' | 'cancelled' | <error message>
 */
export async function sharePost({ title, text, photos = [], base = 'listing' }) {
  if (!canShare()) return { ok: false, reason: 'unsupported' }

  const files = []
  for (let i = 0; i < photos.length; i++) {
    try { files.push(await urlToFile(photos[i], `${base}-${i + 1}`)) } catch { /* skip a bad photo */ }
  }

  const payload = { title, text }
  const withFiles = files.length > 0 && !!navigator.canShare && navigator.canShare({ files })
  if (withFiles) payload.files = files

  try {
    await navigator.share(payload)
    return { ok: true, withFiles }
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, reason: 'cancelled' }
    return { ok: false, reason: (e && e.message) || 'failed' }
  }
}
