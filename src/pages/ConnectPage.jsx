import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getProfile, tenantFields, tenantQuery } from '../lib/tenant.js'
import { isInAppBrowser } from '../lib/inAppBrowser.js'
import { copyText } from '../lib/clipboard.js'

// DID *THIS* PAGE START THE CONNECT, OR DID WE COME BACK FROM ONE?
//
// Module scope, so a fresh page load after the platform redirects back starts
// false, while a page that never navigated keeps it true. That is the difference
// between "they went to Facebook and came back with nothing" — worth an
// explanation — and "the hand-off never happened", which must never be reported
// as a Facebook Page problem. Measured 2026-09-12: Wilson's tap never reached
// Facebook, and the poll 2s later would have told him his Page admin rights
// were wrong.
let startedHere = false

// Per-agent link is `…/#/connect?profile=<id>`. With HashRouter the query lives
// inside window.location.hash (not .search), so it is read from there — and
// remembered (src/lib/tenant.js), because AppShell navigates with bare paths and
// the query used to die on the first nav tap. Coming back from the OAuth
// redirect lands here without it too.
const readProfile = getProfile

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

// The provider already returns "@walauwilson100". Prefixing another @ printed
// "@@walauwilson100" on the client's own connect page — small, but it is the
// first screen an agent ever sees.
function handle(username) {
  const u = String(username || '').trim()
  if (!u) return ''
  return u.startsWith('@') ? u : `@${u}`
}

export default function ConnectPage() {
  const [profile, setProfile] = useState(readProfile) // per-agent link scopes to their profile
  useEffect(() => {
    const on = () => setProfile(readProfile())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const q = profile ? tenantQuery() : ''

  const [accounts, setAccounts] = useState(null) // null while loading
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')
  const [returnedEmpty, setReturnedEmpty] = useState('')
  const [callbackError, setCallbackError] = useState('')
  // The platform link we handed off to, kept on screen so there is always
  // something to tap if the browser did not follow it by itself.
  const [handoff, setHandoff] = useState(null)
  const [copied, setCopied] = useState(false)
  const inApp = isInAppBrowser(typeof navigator === 'undefined' ? '' : navigator.userAgent)

  // WHATEVER THE CALLBACK SAYS, SAY IT.
  //
  // This page never looked at the URL it was returned to — no location.search,
  // no URLSearchParams anywhere — so every message the provider sent back was
  // discarded and the agent saw the Connect button again with no explanation.
  // Both places are read because the app is hash-routed: the provider's params
  // can land before the # or after it, depending on how it builds the redirect.
  useEffect(() => {
    const keys = ['error_description', 'error_message', 'error_reason', 'error', 'message', 'reason']
    const grab = (qs) => {
      for (const k of keys) {
        const v = qs.get(k)
        if (v && v.trim() && !/^(0|false|none|null)$/i.test(v.trim())) return v.trim()
      }
      return ''
    }
    let found = grab(new URLSearchParams(window.location.search))
    if (!found) {
      const h = window.location.hash || ''
      const i = h.indexOf('?')
      if (i !== -1) found = grab(new URLSearchParams(h.slice(i + 1)))
    }
    if (!found) return
    setCallbackError(found.replace(/\+/g, ' ').slice(0, 300))
    // Cleared from the address bar so a refresh does not re-accuse.
    try {
      const url = new URL(window.location.href)
      for (const k of keys) url.searchParams.delete(k)
      window.history.replaceState({}, '', url.toString())
    } catch { /* older browsers: leave it */ }
  }, [])

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/social-accounts' + (q ? `?${q}` : ''))
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed to load accounts')
      const list = j.accounts || []
      setAccounts(list)
      setError('')
      // WHY DID NOTHING HAPPEN? Authorising and coming back with no account
      // attached produced no error anywhere: the fetch succeeded, the redirect
      // succeeded, and the agent simply saw the same "Connect" button. For
      // Facebook that is the NORMAL outcome when they have no Page — Meta
      // removed personal-profile posting years ago, and every scope this asks
      // for (pages_show_list, pages_manage_posts, …) is a Page scope. Wilson
      // connected Instagram and TikTok and stalled here with nothing to read.
      try {
        const tried = sessionStorage.getItem('sk_connecting')
        // `startedHere` gates it: only a page that did NOT start this connect
        // can be the page they came back to.
        if (tried && !startedHere) {
          sessionStorage.removeItem('sk_connecting')
          if (!list.some((a) => a.platform === tried)) setReturnedEmpty(tried)
          else setReturnedEmpty('')
        }
      } catch { /* private mode */ }
    } catch (e) { setError(e.message); setAccounts([]) }
  }, [q])

  // Loads on mount, and again whenever the agent returns to the page (e.g. back
  // from the OAuth redirect). A just-connected account can take a few seconds to
  // register on Zernio, so also poll briefly — no tab-switch needed to see it.
  useEffect(() => {
    load()
    let tries = 0
    const poll = setInterval(() => { load(); if (++tries >= 5) clearInterval(poll) }, 2500)
    // Coming back (a real back-tap, or a bfcache restore that keeps React
    // state) must never leave the button reading "Opening…" and disabled, which
    // it did until a hard refresh.
    const refetch = () => { if (!document.hidden) { setBusy(''); load() } }
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

  async function copy(text) {
    const ok = await copyText(text)
    setCopied(ok)
    if (ok) setTimeout(() => setCopied(false), 2500)
  }
  const copyPageLink = () => copy(window.location.href)

  async function connect(platform) {
    setBusy(platform)
    setError('')
    setHandoff(null)
    try {
      const r = await fetch(`/api/social-connect?platform=${platform}&origin=${encodeURIComponent(window.location.origin)}${q ? `&${q}` : ''}`)
      const j = await r.json()
      if (!r.ok || !j.authUrl) throw new Error(j.error || 'Could not start connect')
      // Set only NOW, with the hand-off about to happen — see `startedHere`.
      // It used to be written before the fetch, so a connect that failed here
      // still produced "Facebook finished, but no Page came back" on the next
      // poll: advice about Page admin rights for a Facebook nobody reached.
      startedHere = true
      try { sessionStorage.setItem('sk_connecting', platform) } catch { /* private mode */ }
      // THE LINK IS ALWAYS OFFERED, whether or not this navigation lands.
      // Assigning location.href is not guaranteed to go anywhere: inside an
      // in-app browser, or on a phone whose Facebook app claims the dialog URL,
      // the tab simply stays — and the button sat on "Opening…" with no way
      // forward and no way to clear it (no finally, no timeout). Now the real
      // link is on screen a second later, and a tap on it is an ordinary link
      // navigation, which those browsers do handle.
      setHandoff({ platform, url: j.authUrl })
      window.location.href = j.authUrl
      setTimeout(() => setBusy(''), 1200)
    } catch (e) { setError(e.message); setBusy(''); try { sessionStorage.removeItem('sk_connecting') } catch { /* private mode */ } }
  }

  async function disconnect(acct) {
    if (!window.confirm(`Disconnect ${handle(acct.username)} (${acct.platform})? You can reconnect anytime.`)) return
    setBusy(acct.platform)
    setError('')
    try {
      const r = await fetch('/api/social-disconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // WHOSE account. /api/social-disconnect took an accountId alone and
        // unlinked it — no profile, no owner check, no credential — so anyone
        // holding a profileId could list a client's accounts and then unlink
        // their Facebook, Instagram and TikTok. It now verifies the account is
        // actually on this profile before touching it.
        body: JSON.stringify({ accountId: acct.id, ...tenantFields() }),
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
        body: JSON.stringify({ caption: '🏡 SideKick test post — one tap, everywhere. (test — safe to delete)', ...tenantFields() }),
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
        <div style={{ marginTop: 12 }}>
          <Link className="btn btn-subtle btn-sm" to={`/style${q ? `?${q}` : ''}`}>✍️ Set your caption style →</Link>
        </div>
      </header>

      {error && <div className="connect-error">{error}</div>}

      {inApp && (
        <div className="connect-note" style={{ marginTop: 12 }}>
          <strong>Open this page in Safari or Chrome first.</strong> You're in an
          app's built-in browser (WhatsApp, Facebook, Instagram), and Facebook
          will not complete a login inside one. Tap the ⋯ or ↗ button and choose
          "Open in browser", or copy the link:
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-sm btn-subtle" onClick={copyPageLink}>
              {copied ? 'Copied ✓' : 'Copy my link'}
            </button>
          </div>
        </div>
      )}

      {handoff && (
        <div className="connect-note" style={{ marginTop: 12 }}>
          <strong>Didn't {handoff.platform === 'facebook' ? 'Facebook' : handoff.platform === 'instagram' ? 'Instagram' : 'TikTok'} open?</strong>{' '}
          Some browsers block the jump. Tap this link instead — it is the same
          sign-in page:
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a className="btn btn-sm btn-primary" href={handoff.url} rel="noopener">
              Continue to {handoff.platform === 'facebook' ? 'Facebook' : handoff.platform === 'instagram' ? 'Instagram' : 'TikTok'} →
            </a>
            <button className="btn btn-sm btn-subtle" onClick={() => copy(handoff.url)}>
              {copied ? 'Copied ✓' : 'Copy sign-in link'}
            </button>
          </div>
        </div>
      )}

      <div className="connect-grid">
        {PLATFORMS.map((p) => {
          const acct = linked(p.id)
          return (
            <div key={p.id} className={`connect-card ${acct ? 'on' : ''}`}>
              <PlatformGlyph id={p.id} color={p.color} />
              <div className="connect-info">
                <div className="connect-name">{p.name}</div>
                {acct ? (
                  <div className="connect-status ok">✓ Connected · {handle(acct.username)}</div>
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

      {callbackError && (
        <div className="connect-note" style={{ marginTop: 16 }}>
          <strong>Facebook sent this back:</strong> {callbackError}
        </div>
      )}
      {returnedEmpty === 'facebook' && (
        <div className="connect-note" style={{ marginTop: 16 }}>
          <strong>Facebook finished, but no Page came back.</strong> Posting to a
          personal profile isn't something Facebook allows any more, so this asks
          for permission to post to a <em>Page</em> you manage. Three things stop
          a Page appearing:
          <br /><br />
          <strong>1. You weren't shown a Page to tick.</strong> Facebook leaves them
          unticked by default — go through again and make sure your Page is
          selected before you continue.
          <br /><br />
          <strong>2. You're not a full admin of it.</strong> Editor or Moderator
          isn't enough to grant posting.
          <br /><br />
          <strong>3. The Page belongs to a Business Portfolio.</strong> Pages held
          in Meta Business Suite often don't appear in this list. Try connecting
          while signed in to the personal account that owns the Page, and tell
          Owen if it still doesn't show — that one needs a change on our side, not
          yours.
          <br /><br />
          No Page at all? Create one — it's free and can carry your own name.
        </div>
      )}
      {returnedEmpty && returnedEmpty !== 'facebook' && (
        <div className="connect-note" style={{ marginTop: 16 }}>
          That didn't finish — nothing was connected. Tap Connect to try again,
          and allow every permission it asks for.
        </div>
      )}

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
        .connect-note {
          border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px;
          font-size: 13.5px; line-height: 1.55; color: var(--ink-700);
          background: var(--surface);
        }
        .connect-note strong { color: var(--ink-900); }
        .connect-status { font-size: 13px; margin-top: 2px; }
        .connect-status.ok { color: var(--green-700); font-weight: 600; }
        @media (prefers-color-scheme: dark) { .connect-status.ok { color: var(--green-400); } }
        .connect-test { margin-top: 24px; text-align: center; }
        .connect-test-result { font-size: 13px; margin-top: 12px; color: var(--ink-600); }
      `}</style>
    </div>
  )
}
