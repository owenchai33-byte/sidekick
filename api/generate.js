// Serverless AI proxy. Runs as a Vercel function in production and via Vite dev
// middleware locally (see vite.config.js). Holds the API key server-side; the
// browser never sees it. Two actions: "parse" (blob → fields) and "content"
// (listing → per-platform × per-language copy). Falls back to labelled demo
// output when no key is configured or a call fails, so the app never dead-ends.

import { buildParsePrompt, buildContentPrompt } from './_lib/prompts.js'
import { runModel, extractJson, providerStatus } from './_lib/providers.js'
import { demoContent, demoParse } from '../shared/demo.js'

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
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' })

  let body
  try {
    body = req.body ?? (await readJson(req))
  } catch {
    return send(res, 400, { error: 'Invalid JSON body' })
  }

  const { action } = body || {}
  const status = providerStatus()

  try {
    if (action === 'status') {
      return send(res, 200, { provider: status.provider, configured: status.configured })
    }

    if (action === 'parse') {
      const { rawText } = body
      if (!rawText || !rawText.trim()) return send(res, 400, { error: 'rawText is required' })
      if (!status.configured) {
        return send(res, 200, { demo: true, fields: demoParse(rawText) })
      }
      const text = await runModel(buildParsePrompt(rawText))
      const fields = extractJson(text)
      return send(res, 200, { demo: false, provider: status.provider, fields })
    }

    if (action === 'content') {
      const { listing, platforms, languages } = body
      if (!listing || !Array.isArray(platforms) || !Array.isArray(languages)) {
        return send(res, 400, { error: 'listing, platforms[] and languages[] are required' })
      }
      if (platforms.length === 0 || languages.length === 0) {
        return send(res, 400, { error: 'Select at least one platform and one language' })
      }
      if (!status.configured) {
        return send(res, 200, { demo: true, content: demoContent(listing, platforms, languages) })
      }
      const text = await runModel(buildContentPrompt(listing, platforms, languages))
      const content = extractJson(text)
      return send(res, 200, { demo: false, provider: status.provider, content })
    }

    return send(res, 400, { error: 'Unknown action. Use "parse" or "content".' })
  } catch (err) {
    // Never dead-end a demo: on a real API failure, degrade to labelled samples.
    const message = err?.message || String(err)
    if (action === 'parse' && body?.rawText) {
      return send(res, 200, { demo: true, degraded: true, error: message, fields: demoParse(body.rawText) })
    }
    if (action === 'content' && body?.listing) {
      return send(res, 200, {
        demo: true,
        degraded: true,
        error: message,
        content: demoContent(body.listing, body.platforms || [], body.languages || []),
      })
    }
    return send(res, 500, { error: message })
  }
}
