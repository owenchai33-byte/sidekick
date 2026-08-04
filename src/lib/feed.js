// Client helper for the agent-first home. Reads /api/feed (status + posts).
// Never throws — on any failure the Feed screen shows its empty/offline state.

export async function getFeed() {
  try {
    const r = await fetch('/api/feed')
    if (!r.ok) return { status: null, posts: [] }
    const d = await r.json().catch(() => null)
    return d && typeof d === 'object' ? { status: d.status || null, posts: d.posts || [] } : { status: null, posts: [] }
  } catch {
    return { status: null, posts: [] }
  }
}
