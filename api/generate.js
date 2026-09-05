// Serverless AI proxy. Runs as a Vercel function in production and via Vite dev
// middleware locally (see vite.config.js). Holds the API key server-side; the
// browser never sees it. Two actions: "parse" (blob → fields) and "content"
// (listing → per-platform × per-language copy). Falls back to labelled demo
// output when no key is configured or a call fails, so the app never dead-ends.

import { buildParsePrompt, buildContentPrompt, buildPlanPrompt, buildRefinePrompt, buildCoverPrompt, buildReadListingPrompt } from './_lib/prompts.js'
import { runModel, runModelVision, extractJson, providerStatus, visionStatus } from './_lib/providers.js'
import { demoContent, demoParse, demoPlan } from '../shared/demo.js'
import { clientIp, hasIngestSecret, rateLimit } from './_lib/tenant.js'

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

  // THE TOKEN BUDGET IS THE PRODUCT CEILING. This route is unauthenticated by
  // necessity - six screens call it through src/lib/ai.js and not one of them
  // has an identity to present - so anyone with the URL could spend the whole
  // 200,000-tokens-a-day allowance in an afternoon, and a previous agent did
  // exactly that by accident while load-testing. Every agent's captions stop
  // working when it runs out, and nothing tells them why.
  //
  // A RATE LIMIT, NOT A LOCK. Gating this on identity is the single most likely
  // way to lock a paying agent out of their own app, because the screens that
  // call it genuinely have no credential. So the limits below are set far above
  // what a working agent does: preparing one listing costs a handful of calls,
  // and a busy hour is nowhere near 40. If a real user ever meets this, the
  // limit is wrong, not the user.
  //
  // Honest about what it is: the counter lives in this lambda's memory, so it is
  // per-instance and forgotten on a cold start. A distributed caller gets a
  // multiple of it. It turns "unlimited" into "expensive and slow", which is the
  // difference between a bad afternoon and a dead product.
  const MODEL_ACTIONS = new Set(['parse', 'content', 'plan', 'refine', 'cover', 'readlisting'])
  if (MODEL_ACTIONS.has(action) && !hasIngestSecret(req)) {
    const ip = clientIp(req)
    // Vision costs the most per call, so it gets its own, tighter bucket on top
    // of the shared one.
    const limits = [{ key: `gen:${ip}`, limit: 40, windowMs: 60_000 }, { key: `gen1h:${ip}`, limit: 600, windowMs: 3_600_000 }]
    if (action === 'cover' || action === 'readlisting') limits.push({ key: `genv:${ip}`, limit: 20, windowMs: 60_000 })
    for (const l of limits) {
      const rl = rateLimit(l.key, l)
      if (!rl.ok) {
        // src/lib/ai.js throws `data.error` up to the screen's toast, so this
        // reaches the agent in words rather than dead-ending.
        return send(res, 429, {
          error: `The AI is being asked for too much at once — wait ${rl.retryAfter}s and try again.`,
          retryAfter: rl.retryAfter,
        })
      }
    }
  }

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
      // Choosing a cover is the one job that cannot run without vision, so it
      // falls back to the FIRST photo rather than failing the whole request.
      // The sender's first photo is the cover by convention anyway, so this
      // degrades to their own choice rather than to nothing. The caller is told
      // WHY in words - a raw upstream error string told an agent nothing.
      const vision = visionStatus()
      if (!vision.configured) {
        return send(res, 200, { demo: false, degraded: true, index: 0, reason: `${vision.reason} - kept the first photo as cover` })
      }
      try {
        const { text: out, provider } = await runModelVision(buildCoverPrompt(images.length), images)
        const parsed = extractJson(out)
        const idx = Math.max(0, Math.min(images.length - 1, Number(parsed?.index) || 0))
        return send(res, 200, { demo: false, provider, index: idx })
      } catch (e) {
        return send(res, 200, {
          demo: false,
          degraded: true,
          index: 0,
          reason: `vision failed on ${vision.chain.join(' then ')} - kept the first photo as cover`,
          error: String(e?.message || e).slice(0, 120),
        })
      }
    }

    if (action === 'readlisting') {
      const { images } = body
      if (!Array.isArray(images) || images.length < 1) return send(res, 400, { error: 'need 1+ images' })
      // OCR degrades to an EMPTY transcription, never a partial guess: the agent
      // then types the listing as they do today. A half-read price is the one
      // outcome worse than no OCR at all.
      // Unauthenticated route taking base64 images, so it needs its own limits
      // rather than relying on the platform's. Eight is more photos than any
      // listing has needed, and a listing photo well under 6MB decoded.
      const MAX_IMAGES = 8, MAX_BYTES = 6 * 1024 * 1024
      if (images.length > MAX_IMAGES) return send(res, 400, { error: `Too many images (max ${MAX_IMAGES})` })
      const tooBig = images.some((i) => (String(i?.data || '').length * 3) / 4 > MAX_BYTES)
      if (tooBig) return send(res, 413, { error: 'One of those photos is too large to read' })

      const vision = visionStatus()
      const blank = (reason) => ({ degraded: true, reason, text: '', confidence: 'none', unreadable: [] })
      if (!vision.configured) {
        return send(res, 200, blank(`${vision.reason} - nothing was read, type the listing instead`))
      }
      try {
        const { text: out, provider } = await runModelVision(buildReadListingPrompt(images.length), images)
        const parsed = extractJson(out)
        // Take only the three fields we asked for. A model that also returns a
        // "price" it worked out must not have it forwarded as if it were read
        // off the image.
        const text = typeof parsed?.text === 'string' ? parsed.text.trim() : ''
        // Case-fold first: a model answering "High" used to land as 'low',
        // which is the signal telling the agent to retype the price by hand.
        const said = String(parsed?.confidence || '').trim().toLowerCase()
        const confidence = ['high', 'medium', 'low', 'none'].includes(said) ? said : 'low'
        const unreadable = Array.isArray(parsed?.unreadable)
          ? parsed.unreadable.filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim())
          : []
        return send(res, 200, {
          degraded: false,
          provider,
          text,
          confidence: text ? confidence : 'none',
          unreadable,
        })
      } catch (e) {
        return send(res, 200, {
          ...blank(`vision failed on ${vision.chain.join(' then ')} - nothing was read, type the listing instead`),
          error: String(e?.message || e).slice(0, 120),
        })
      }
    }

    return send(res, 400, { error: 'Unknown action. Use "parse", "content", "plan", "refine", "cover" or "readlisting".' })
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
      return send(res, 200, { demo: true, degraded: true, error: message, reason: 'cover selection failed - kept the first photo as cover', index: 0 })
    }
    if (action === 'readlisting') {
      return send(res, 200, { degraded: true, error: message, reason: 'listing OCR failed - nothing was read, type the listing instead', text: '', confidence: 'none', unreadable: [] })
    }
    return send(res, 500, { error: message })
  }
}
