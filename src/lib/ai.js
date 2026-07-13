// Thin client for the serverless AI proxy. The browser never holds a key — it
// posts to /api/generate, which runs the active provider (or demo fallback).
//
// Host-agnostic: on a static host with no serverless function (e.g. GitHub
// Pages), /api/generate is absent, so we run the same demo module locally.
// On Vercel / local dev the real function answers and this fallback never fires.

import { demoContent, demoParse } from '../../shared/demo.js'

function localDemo(payload) {
  if (payload.action === 'status') return { provider: 'gemini', configured: false }
  if (payload.action === 'parse') return { demo: true, offline: true, fields: demoParse(payload.rawText) }
  if (payload.action === 'content') {
    return { demo: true, offline: true, content: demoContent(payload.listing, payload.platforms, payload.languages) }
  }
  return {}
}

async function callApi(payload) {
  let res
  try {
    res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    return localDemo(payload) // network error / no server
  }
  if (res.status === 404) return localDemo(payload) // static host, function absent
  const data = await res.json().catch(() => null)
  if (!data) return localDemo(payload) // got HTML (SPA fallback), not JSON
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

/** Parse a pasted blob into structured fields. Returns { fields, demo }. */
export async function parseListing(rawText) {
  return callApi({ action: 'parse', rawText })
}

/** Generate per-platform × per-language copy. Returns { content, demo }. */
export async function generateContent(listing, platforms, languages) {
  return callApi({ action: 'content', listing, platforms, languages })
}

/** Whether a real provider key is configured. Returns { provider, configured }. */
export async function getStatus() {
  return callApi({ action: 'status' })
}
