// Mints Vercel Blob client-upload tokens so the browser can upload media
// (Reel mp4s, branded graphics, user photos) DIRECTLY to Blob storage and get
// back a public https URL that Facebook / Instagram can fetch.
//
// Why client-direct (not a proxy through this function): Vercel serverless
// functions cap the request body at 4.5 MB, and a 9:16 Reel is ~15 MB. The
// browser calls upload() from @vercel/blob/client with
// handleUploadUrl:'/api/media-upload'; this route only issues the short-lived
// token, so the file never passes through the function. The Blob store's
// BLOB_READ_WRITE_TOKEN stays server-side. Runs as a Vercel function in
// production and via Vite dev middleware locally (see vite.config.js).

import { handleUpload } from '@vercel/blob/client'

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    // Not wired yet — tell the UI clearly instead of dead-ending.
    return send(res, 501, { error: 'Media hosting is not connected yet. Create a Vercel Blob store to enable it (BLOB_READ_WRITE_TOKEN).' })
  }

  let body
  try { body = await readJson(req) } catch { return send(res, 400, { error: 'Invalid JSON' }) }

  try {
    // handleUpload accepts a raw Node request (it branches IncomingMessage vs
    // web Request internally). It runs the two-phase client-upload handshake:
    // issue a token, then (in prod) receive the upload-completed callback.
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'],
        addRandomSuffix: true,
        maximumSizeInBytes: 100 * 1024 * 1024, // 100 MB — comfortably over a Reel
      }),
      // The browser already has the URL from the direct upload, so nothing to
      // do here. (Not called on localhost — Blob can't reach a local callback.)
      onUploadCompleted: async () => {},
    })
    return send(res, 200, result)
  } catch (e) {
    // Thrown on a bad token, a disallowed content type, or an oversize file.
    return send(res, 400, { error: e?.message || String(e) })
  }
}
