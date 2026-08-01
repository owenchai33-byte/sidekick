import { useEffect, useState, useCallback } from 'react'

// The agent-facing "connect your accounts" portal. Each button starts a hosted
// OAuth on Zernio's audited app (via /api/social-connect) — the agent authorizes
// their OWN Facebook/Instagram/TikTok, we never see a password, and there's no
// Meta/TikTok app review on our side. /api/social-accounts reports what's linked.

const PLATFORMS = [
  { id: 'facebook', name: 'Facebook Page', color: '#1877F2', blurb: 'Post listings straight to your Page.' },
  { id: 'instagram', name: 'Instagram', color: '#E4405F', blurb: 'Business/Creator account linked to your Page.' },
  { id: 'tiktok', name: 'TikTok', color: '#111', blurb: 'Reels post publicly — no app review needed.' },
]

function PlatformGlyph({ id, color }) {
  const paths = {
    facebook: <path d="M14 8.5h2V5.5h-2c-2 0-3.2 1.2-3.2 3.2V11H9v3h1.8v6h3v-6H16l.5-3h-2.7V9c0-.4.3-.5.7-.5z" />,
    instagram: <><rect x="4" y="4" width="16" height="16" rx="5" /><circle cx="12" cy="12" r="3.5" /><circle cx="17" cy="7" r="1" fill="currentColor" stroke="none" /></>,
    tiktok: <path d="M14 4c.4 2.2 1.8 3.6 4 3.9v2.7c-1.5.1-2.9-.4-4-1.2v5.4a5.2 5.2 0 1 1-5.2-5.2c.3 0 .6 0 .9.1v2.8a2.5 2.5 0 1 0 1.7 2.3V4H14z" />,
  }
  return (
    <span className="glyph" style={{ background: color }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[id]}</svg>
    </span>
  )
}

export default function ConnectPage() {
  const [accounts, setAccounts] = useState(null) // null while loading
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/social-accounts')
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed to load accounts')
      setAccounts(j.accounts || [])
      setError('')
    } catch (e) { setError(e.message); setAccounts([]) }
  }, [])

  // Loads on mount, and again whenever the agent returns to the page (e.g. back
  // from the OAuth redirect). A just-connected account can take a few seconds to
  // register on Zernio, so also poll briefly — no tab-switch needed to see it.
  useEffect(() => {
    load()
    let tries = 0
    const poll = setInterval(() => { load(); if (++tries >= 5) clearInterval(poll) }, 2500)
    const refetch = () => { if (!document.hidden) load() }
    window.addEventListener('focus', refetch)
    document.addEventListener('visibilitychange', refetch)
    window.addEventListener('pageshow', refetch)
    return () => {
      clearInterval(poll)
      window.removeEventListener('focus', refetch)
      document.removeEventListener('visibilitychange', refetch)
      window.removeEventListener('pageshow', refetch)
    }
  }, [load])

  async function connect(platform) {
    setBusy(platform)
    setError('')
    try {
      const r = await fetch(`/api/social-connect?platform=${platform}&origin=${encodeURIComponent(window.location.origin)}`)
      const j = await r.json()
      if (!r.ok || !j.authUrl) throw new Error(j.error || 'Could not start connect')
      window.location.href = j.authUrl // hand off to the platform's login/authorize
    } catch (e) { setError(e.message); setBusy('') }
  }

  async function disconnect(acct) {
    if (!window.confirm(`Disconnect @${acct.username} (${acct.platform})? You can reconnect anytime.`)) return
    setBusy(acct.platform)
    setError('')
    try {
      const r = await fetch('/api/social-disconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: acct.id }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Disconnect failed')
      await load()
    } catch (e) { setError(e.message) }
    finally { setBusy('') }
  }

  async function sendTestPost() {
    setTesting(true)
    setTestResult('')
    try {
      const r = await fetch('/api/social-broadcast', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caption: '🏡 SideKick test post — one tap, everywhere. (test — safe to delete)' }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Post failed')
      setTestResult('Posted to ' + (j.posted || []).join(', ') + ' 🎉 — check your accounts (video may take a minute to process)')
    } catch (e) { setTestResult('Failed: ' + e.message) }
    finally { setTesting(false) }
  }

  const linked = (id) => (accounts || []).find((a) => a.platform === id)
  const connectedCount = (accounts || []).length

  return (
    <div className="container connect">
      <header className="connect-head">
        <h1 className="page-title">Connect your accounts</h1>
        <p className="muted">Link your socials once — then post a listing to all of them in a tap. You sign in on each platform yourself; we never see your password.</p>
        {accounts && <div className="connect-count">{connectedCount} of {PLATFORMS.length} connected</div>}
      </header>

      {error && <div className="connect-error">{error}</div>}

      <div className="connect-grid">
        {PLATFORMS.map((p) => {
          const acct = linked(p.id)
          return (
            <div key={p.id} className={`connect-card ${acct ? 'on' : ''}`}>
              <PlatformGlyph id={p.id} color={p.color} />
              <div className="connect-info">
                <div className="connect-name">{p.name}</div>
                {acct ? (
                  <div className="connect-status ok">✓ Connected · @{acct.username}</div>
                ) : (
                  <div className="connect-status muted">{p.blurb}</div>
                )}
              </div>
              {acct ? (
                <button className="btn btn-sm btn-subtle" onClick={() => disconnect(acct)} disabled={busy === p.id}>
                  {busy === p.id ? 'Working…' : 'Disconnect'}
                </button>
              ) : (
                <button className="btn btn-sm btn-primary" onClick={() => connect(p.id)} disabled={busy === p.id || accounts === null}>
                  {busy === p.id ? 'Opening…' : 'Connect'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {accounts === null && <p className="muted" style={{ textAlign: 'center', marginTop: 20 }}>Loading…</p>}

      {connectedCount > 0 && (
        <div className="connect-test">
          <button className="btn btn-primary" onClick={sendTestPost} disabled={testing}>
            {testing ? 'Posting…' : `Send a test post to ${connectedCount === 1 ? 'my account' : 'all ' + connectedCount + ' accounts'}`}
          </button>
          {testResult && <p className="connect-test-result">{testResult}</p>}
        </div>
      )}

      <style>{`
        .connect { max-width: 640px; }
        .connect-head { margin-bottom: 20px; }
        .page-title { font-size: 24px; font-weight: 800; margin: 0 0 6px; }
        .connect-count { margin-top: 10px; display: inline-block; font-size: 13px; font-weight: 700;
          color: var(--green-700); background: var(--green-100); padding: 4px 12px; border-radius: 999px; }
        @media (prefers-color-scheme: dark) { .connect-count { color: var(--green-400); } }
        .connect-error { background: var(--danger-100, #fde8e8); color: var(--danger-700, #b42318);
          border-radius: 10px; padding: 10px 14px; font-size: 13px; margin-bottom: 16px; }
        .connect-grid { display: flex; flex-direction: column; gap: 12px; }
        .connect-card { display: flex; align-items: center; gap: 14px; padding: 16px;
          background: var(--surface); border: 1px solid var(--line); border-radius: 14px; transition: border-color .15s; }
        .connect-card.on { border-color: var(--green-400); }
        .glyph { flex: none; width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; }
        .connect-info { flex: 1; min-width: 0; }
        .connect-name { font-weight: 700; font-size: 15px; }
        .connect-status { font-size: 13px; margin-top: 2px; }
        .connect-status.ok { color: var(--green-700); font-weight: 600; }
        @media (prefers-color-scheme: dark) { .connect-status.ok { color: var(--green-400); } }
        .connect-test { margin-top: 24px; text-align: center; }
        .connect-test-result { font-size: 13px; margin-top: 12px; color: var(--ink-600); }
      `}</style>
    </div>
  )
}
