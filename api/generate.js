// Serverless AI proxy. Runs as a Vercel function in production and via Vite dev
// middleware locally (see vite.config.js). Holds the API key server-side; the
// browser never sees it. Two actions: "parse" (blob → fields) and "content"
// (listing → per-platform × per-language copy). Falls back to labelled demo
// output when no key is configured or a call fails, so the app never dead-ends.

import { buildParsePrompt, buildContentPrompt, buildPlanPrompt, buildRefinePrompt, buildCoverPrompt } from './_lib/prompts.js'
import { runModel, runModelVision, extractJson, providerStatus } from './_lib/providers.js'
import { demoContent, demoParse, demoPlan } from '../shared/demo.js'

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

    if (action === 'plan') {
      const { brand, languages } = body
      const n = Math.min(Math.max(Number(body?.count) || 6, 1), 12)
      const langs = Array.isArray(languages) && languages.length ? languages : ['en']
      if (!status.configured) {
        return send(res, 200, { demo: true, ...demoPlan(n, langs) })
      }
      const text = await runModel(buildPlanPrompt(brand || {}, n, langs))
      const data = extractJson(text)
      return send(res, 200, { demo: false, provider: status.provider, posts: data?.posts || [] })
    }

    if (action === 'refine') {
      const { text, instruction, platform, lang } = body
      if (!text || !instruction) return send(res, 400, { error: 'text and instruction are required' })
      if (!status.configured) return send(res, 200, { demo: true, text }) // can't refine without a key
      const out = await runModel(buildRefinePrompt(text, instruction, platform, lang))
      return send(res, 200, { demo: false, provider: status.provider, text: (out || '').trim() })
    }

    if (action === 'cover') {
      const { images } = body
      if (!Array.isArray(images) || images.length < 2) return send(res, 400, { error: 'need 2+ images' })
      if (!status.configured) return send(res, 200, { demo: true, index: 0 }) // demo: keep first
      // Vision is Gemini-only. When the caption engine runs on another provider
      // (Groq), or Gemini is unavailable, choosing a cover is the one thing that
      // cannot run — so fall back to the FIRST photo instead of failing the whole
      // request. The sender's first photo is the cover by convention anyway, so
      // this degrades to their own choice rather than to nothing.
      try {
        const out = await runModelVision(buildCoverPrompt(images.length), images)
        const parsed = extractJson(out)
        const idx = Math.max(0, Math.min(images.length - 1, Number(parsed?.index) || 0))
        return send(res, 200, { demo: false, provider: status.provider, index: idx })
      } catch (e) {
        return send(res, 200, { demo: false, degraded: true, index: 0, error: String(e?.message || e).slice(0, 120) })
      }
    }

    return send(res, 400, { error: 'Unknown action. Use "parse", "content", "plan", "refine" or "cover".' })
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
    if (action === 'plan') {
      return send(res, 200, { demo: true, degraded: true, error: message, ...demoPlan(Math.min(Number(body?.count) || 6, 12), body?.languages || ['en']) })
    }
    if (action === 'refine' && body?.text) {
      return send(res, 200, { demo: true, degraded: true, error: message, text: body.text })
    }
    if (action === 'cover') {
      return send(res, 200, { demo: true, degraded: true, error: message, index: 0 })
    }
    return send(res, 500, { error: message })
  }
}
