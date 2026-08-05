import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'

// Per-agent link: `…/#/style?profile=<id>`. HashRouter keeps the query in the
// hash, so read it from there (same as the Connect page).
function readProfile() {
  const h = window.location.hash || ''
  const i = h.indexOf('?')
  return i === -1 ? '' : (new URLSearchParams(h.slice(i + 1)).get('profile') || '')
}

const PLACEHOLDER = `e.g.
- Keep it short and punchy — 3 short lines max.
- Lead with the location, then the price.
- Max 2 emojis. No hashtags on Facebook.
- Always end with: "DM Edward to view 👉".
- Write English first, then a short 中文 line.`

export default function StylePage() {
  const [profile] = useState(readProfile)
  const [style, setStyle] = useState('')
  const [examples, setExamples] = useState(['', '', ''])
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    if (!profile) { setLoaded(true); return }
    try {
      const r = await fetch(`/api/style?profile=${encodeURIComponent(profile)}`)
      const j = await r.json()
      if (r.ok) {
        setStyle(j.style || '')
        const ex = Array.isArray(j.examples) ? j.examples : []
        setExamples([ex[0] || '', ex[1] || '', ex[2] || ''])
      }
    } catch { /* keep blank */ }
    setLoaded(true)
  }, [profile])

  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true); setMsg('')
    try {
      const r = await fetch('/api/style', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile, style, examples: examples.map((e) => e.trim()).filter(Boolean) }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Save failed')
      setMsg('Saved ✓  Send a listing on WhatsApp to see it in action.')
    } catch (e) { setMsg('Failed: ' + e.message) }
    finally { setSaving(false) }
  }

  const setEx = (i, v) => setExamples((a) => a.map((x, k) => (k === i ? v : x)))

  if (!profile) {
    return (
      <div className="container style-page">
        <h1 className="page-title">Caption style</h1>
        <p className="muted">Open this from your personal SideKick link (it needs your <code>?profile=</code>). Ask your admin for it.</p>
      </div>
    )
  }

  return (
    <div className="container style-page">
      <header className="style-head">
        <h1 className="page-title">Your caption style</h1>
        <p className="muted">Tell SideKick exactly how you want your captions written. It follows these on every listing — and you approve before anything posts.</p>
      </header>

      {!loaded ? <p className="muted">Loading…</p> : (
        <>
          <label className="style-label">How should your captions be written?</label>
          <textarea className="style-input" rows={8} placeholder={PLACEHOLDER} value={style} onChange={(e) => setStyle(e.target.value)} />

          <label className="style-label">Example captions you love <span className="muted">(optional — the bot copies this voice)</span></label>
          {examples.map((ex, i) => (
            <textarea key={i} className="style-input style-ex" rows={3} placeholder={`Example ${i + 1} — paste a caption in your style`} value={ex} onChange={(e) => setEx(i, e.target.value)} />
          ))}

          <div className="style-actions">
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save my style'}</button>
            <Link className="btn btn-subtle" to={`/connect?profile=${encodeURIComponent(profile)}`}>Connect accounts →</Link>
          </div>
          {msg && <p className="style-msg">{msg}</p>}
          <p className="muted style-tip">💡 To test: message a listing (photos + caption) to your SideKick number on WhatsApp. The preview comes back in your style — tweak the rules above and try again.</p>
        </>
      )}

      <style>{`
        .style-page { max-width: 640px; }
        .page-title { font-size: 24px; font-weight: 800; margin: 0 0 6px; }
        .style-head { margin-bottom: 18px; }
        .style-label { display: block; font-size: 13.5px; font-weight: 700; margin: 16px 0 7px; }
        .style-input { width: 100%; border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px;
          background: var(--surface); color: var(--ink-900); font-size: 14px; line-height: 1.5; resize: vertical;
          font-family: inherit; }
        .style-input:focus { outline: none; border-color: var(--green-400); }
        .style-ex { margin-bottom: 8px; }
        .style-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px; }
        .style-msg { margin-top: 12px; font-size: 13.5px; font-weight: 600; color: var(--green-700); }
        @media (prefers-color-scheme: dark) { .style-msg { color: var(--green-400); } }
        .style-tip { font-size: 12.5px; margin-top: 18px; line-height: 1.5; background: var(--surface-sunk);
          padding: 12px 14px; border-radius: 10px; }
      `}</style>
    </div>
  )
}
