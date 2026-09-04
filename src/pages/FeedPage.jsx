import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getFeed } from '../lib/feed.js'

function money(p, type) {
  if (p == null) return 'Price on ask'
  const n = Number(p).toLocaleString('en-MY')
  return type === 'rental' ? `RM${n}/mo` : `RM${n}`
}
function timeAgo(iso) {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
const PLAT = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' }

export default function FeedPage() {
  const [data, setData] = useState(null) // { status, posts }
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let on = true
    getFeed().then((d) => { if (on) { setData(d); setLoading(false) } })
    const id = setInterval(() => getFeed().then((d) => on && setData(d)), 20000)
    return () => { on = false; clearInterval(id) }
  }, [])

  const status = data?.status
  const posts = data?.posts || []
  const pending = data?.pending || []
  // null = the app could not tell (no default profile configured), which is not
  // the same as none connected. Saying "No accounts" there told the owner their
  // live accounts were missing.
  const accountsKnown = typeof status?.connectedAccounts === 'number'
  const accountsOn = accountsKnown && status.connectedAccounts > 0
  const live = !!status?.providerConfigured

  const card = (p, i, isPending) => (
    <article className={`feed-card ${isPending ? 'is-pending' : ''}`} key={(p.id || p.at || i) + (isPending ? 'p' : '')}>
      {p.cover ? <img className="feed-thumb" src={p.cover} alt="" loading="lazy" /> : <div className="feed-thumb feed-thumb-empty" />}
      <div className="feed-body">
        <div className="feed-row1">
          <span className="feed-price">{money(p.price, p.listingType)}</span>
          <span className="feed-time">{timeAgo(p.at)}</span>
        </div>
        {p.location ? <div className="feed-loc">{p.location}</div> : null}
        {p.caption ? <div className="feed-cap">{p.caption}</div> : null}
        {isPending ? (
          <div className="feed-wait">⏳ Waiting for your ✅ in WhatsApp</div>
        ) : (
          <div className="feed-plats">
            {(p.platforms || []).map((pl) => <span className="feed-plat" key={pl}>{PLAT[pl] || pl}</span>)}
          </div>
        )}
      </div>
    </article>
  )

  return (
    <div className="container feed">
      <header className="page-head">
        <h1>Auto-posts</h1>
        <p className="feed-sub">What your agent has posted to your socials — hands-free.</p>
      </header>

      {/* Agent status */}
      <div className="feed-status">
        <Link to="/settings" className={`fs-pill ${accountsOn ? 'ok' : 'warn'}`}>
          <span className="fs-dot" />
          {accountsOn ? `${status.connectedAccounts} account${status.connectedAccounts > 1 ? 's' : ''} connected` : accountsKnown ? 'No accounts — connect' : 'Accounts live per agent'}
        </Link>
        <span className={`fs-pill ${live ? 'ok' : 'muted-pill'}`}>
          <span className="fs-dot" />
          {live ? 'Content engine live' : 'Demo mode'}
        </span>
      </div>

      {loading ? (
        <div className="feed-empty"><p className="muted">Loading…</p></div>
      ) : pending.length || posts.length ? (
        <>
          {pending.length ? (
            <div className="feed-section">
              <div className="feed-sec-head">Awaiting your ✅ <span className="feed-count">{pending.length}</span></div>
              <div className="feed-list">{pending.map((p, i) => card(p, i, true))}</div>
            </div>
          ) : null}
          {posts.length ? (
            <div className="feed-section">
              {pending.length ? <div className="feed-sec-head">Posted</div> : null}
              <div className="feed-list">{posts.map((p, i) => card(p, i, false))}</div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="feed-empty">
          <div className="feed-empty-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v12H5.2L4 17.5V4z" /><path d="M8 9h8M8 12h5" /></svg>
          </div>
          <h2>No posts yet</h2>
          <p className="muted">When a listing lands in your WhatsApp group, your agent writes it up and posts it — it’ll show here automatically.</p>
          <div className="feed-empty-actions">
            {!accountsOn && <Link to="/settings" className="btn btn-primary">Connect accounts</Link>}
            <Link to="/create" className="btn btn-subtle">Post one manually</Link>
          </div>
        </div>
      )}

      <style>{`
        .feed { display: flex; flex-direction: column; gap: 18px; }
        .page-head h1 { font-size: 26px; letter-spacing: -0.02em; }
        .feed-sub { color: var(--ink-500); font-size: 14px; margin-top: 4px; max-width: 46ch; }

        .feed-status { display: flex; flex-wrap: wrap; gap: 8px; }
        .fs-pill { display: inline-flex; align-items: center; gap: 7px; padding: 7px 13px; border-radius: 999px;
          font-size: 12.5px; font-weight: 600; text-decoration: none; border: 1px solid var(--line); background: var(--surface); }
        .fs-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
        .fs-pill.ok { color: var(--green-700); background: var(--green-100); border-color: transparent; }
        @media (prefers-color-scheme: dark) { .fs-pill.ok { color: var(--green-400); } }
        .fs-pill.warn { color: var(--timber-600, #b06a2c); background: color-mix(in srgb, var(--timber-500) 14%, transparent); border-color: transparent; }
        .fs-pill.muted-pill { color: var(--ink-500); }

        .feed-section { display: flex; flex-direction: column; gap: 10px; }
        .feed-section + .feed-section { margin-top: 20px; }
        .feed-sec-head { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 800; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--ink-500); }
        .feed-count { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px;
          background: color-mix(in srgb, var(--timber-500) 20%, transparent); color: var(--timber-600, #b06a2c); font-size: 11px; }
        .feed-list { display: flex; flex-direction: column; gap: 10px; }
        .feed-card { display: flex; gap: 13px; padding: 12px; background: var(--surface); border: 1px solid var(--line);
          border-radius: var(--r-lg); }
        .feed-card.is-pending { border-color: color-mix(in srgb, var(--timber-500) 45%, var(--line)); background: color-mix(in srgb, var(--timber-500) 6%, var(--surface)); }
        .feed-wait { font-size: 12px; font-weight: 700; color: var(--timber-600, #b06a2c); margin-top: 5px; }
        .feed-thumb { width: 88px; height: 88px; flex: none; object-fit: cover; border-radius: var(--r-md); background: var(--surface-sunk); }
        .feed-thumb-empty { display: block; }
        .feed-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .feed-row1 { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
        .feed-price { font-size: 18px; font-weight: 800; color: var(--green-700); letter-spacing: -0.01em; }
        @media (prefers-color-scheme: dark) { .feed-price { color: var(--green-400); } }
        .feed-time { font-size: 11.5px; color: var(--ink-400); flex: none; }
        .feed-loc { font-size: 13.5px; font-weight: 600; color: var(--ink-900); }
        .feed-cap { font-size: 12.5px; color: var(--ink-500); line-height: 1.4; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .feed-plats { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }
        .feed-plat { font-size: 10.5px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; color: var(--ink-500);
          background: var(--surface-sunk); padding: 3px 8px; border-radius: 999px; }

        .feed-empty { text-align: center; padding: 40px 22px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-xl); }
        .feed-empty-icon { width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 50%; display: grid; place-items: center;
          background: var(--green-100); color: var(--green-700); }
        @media (prefers-color-scheme: dark) { .feed-empty-icon { color: var(--green-400); } }
        .feed-empty h2 { font-size: 18px; }
        .feed-empty .muted { font-size: 13.5px; margin: 6px auto 0; max-width: 42ch; line-height: 1.5; }
        .feed-empty-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 18px; }
      `}</style>
    </div>
  )
}
