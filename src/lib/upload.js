// Client-direct upload to Vercel Blob → returns a public https URL that FB/IG
// can fetch. Used for media that has no public URL yet: the Reel mp4 (an
// IndexedDB blob), the branded graphic (a canvas), and user-uploaded photos
// (data: URLs). Goes straight browser → Blob via a token minted by
// /api/media-upload, so it isn't bound by the 4.5 MB serverless body limit.

import { upload } from '@vercel/blob/client'

// Upload a Blob/File and get back its public https URL.
export async function uploadMedia(blob, filename) {
  const { url } = await upload(filename, blob, {
    access: 'public',
    handleUploadUrl: '/api/media-upload',
    contentType: blob.type || undefined,
  })
  return url
}

// Turn a data: URL (a user-uploaded photo) into a Blob so it can be uploaded.
export async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl)
  return res.blob()
}
