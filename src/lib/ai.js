// Thin client for the serverless AI proxy. The browser never holds a key — it
// posts to /api/generate, which runs the active provider (or demo fallback).

async function callApi(payload) {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
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
