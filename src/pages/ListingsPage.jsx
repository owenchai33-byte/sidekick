import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import { evaluateRules } from '../lib/rules.js'
import { listingLabel, relativeTime } from '../lib/format.js'
import { PLATFORM_MAP } from '../../shared/constants.js'
import PriceTag from '../components/PriceTag.jsx'

function statusOf(l) {
  let total = 0, approved = 0, published = 0
  for (const p of l.platforms) for (const lang of l.languages) {
    total++
    if (l.approvals?.[p]?.[lang]) approved++
    if (l.published?.[p]?.[lang]) published++
  }
  const hasContent = Object.keys(l.content || {}).length > 0
  if (published > 0 && published === total) return { key: 'published', label: 'Published', cls: 'badge-approved' }
  if (published > 0) return { key: 'live', label: `${published} live`, cls: 'badge-live' }
  if (approved === total && total > 0) return { key: 'ready', label: 'Ready to publish', cls: 'badge-live' }
  if (hasContent) return { key: 'review', label: 'In review', cls: 'badge-neutral' }
  return { key: 'draft', label: 'Draft', cls: 'badge-neutral' }
}

export default function ListingsPage() {
  const { listings, settings } = useApp()
  const navigate = useNavigate()

  return (
    <div className="container listings">
      <header className="lp-head">
        <div>
          <h1>Listings</h1>
          <p className="muted">Pick what's worth promoting — SideKick handles the copy and staging.</p>
        </div>
        <Link to="/new" className="btn btn-primary lp-new">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          New listing
        </Link>
      </header>

      {listings.length === 0 ? (
        <div className="empty card">
          <div className="empty-mark" aria-hidden="true">🏡</div>
          <h2>No listings yet</h2>
          <p className="muted">Paste a listing from a WhatsApp group and get publish-ready posts in three languages — in under a minute.</p>
          <Link to="/new" className="btn btn-primary" style={{ marginTop: 6 }}>Add your first listing</Link>
        </div>
      ) : (
        <div className="cards">
          {listings.map((l) => {
            const rule = evaluateRules(l, settings.rules)
            const st = statusOf(l)
            return (
              <button key={l.id} className="lcard card" onClick={() => navigate(`/listing/${l.id}`)}>
                {l.photos?.[0] ? (
                  <img className="lcard-photo" src={l.photos[0]} alt="" />
                ) : (
                  <div className="lcard-photo lcard-noimg" aria-hidden="true">{l.listingType === 'rental' ? '🔑' : '🏠'}</div>
                )}
                <div className="lcard-body">
                  <div className="lcard-top">
                    <span className={`badge ${st.cls}`}>{st.label}</span>
                    {rule.flagged && <span className="badge badge-flag">Flagged</span>}
                    {l.example && <span className="badge badge-example">Example</span>}
                  </div>
                  <div className="lcard-title">{listingLabel(l)}</div>
                  <PriceTag value={l.price} listingType={l.listingType} size="sm" />
                  <div className="lcard-foot">
                    <div className="lcard-platforms">
                      {l.platforms.slice(0, 6).map((p) => <span key={p} title={PLATFORM_MAP[p]?.name}>{PLATFORM_MAP[p]?.icon}</span>)}
                    </div>
                    <span className="lcard-time muted num">{relativeTime(l.updatedAt)}</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <style>{`
        .listings { display: flex; flex-direction: column; gap: 18px; }
        .lp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
        .lp-head h1 { font-size: 25px; }
        .lp-head p { margin-top: 4px; font-size: 13.5px; max-width: 42ch; }
        .lp-new { flex: none; }

        .empty { padding: 48px 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; }
        .empty-mark { font-size: 44px; }
        .empty h2 { font-size: 18px; }
        .empty p { max-width: 40ch; font-size: 13.5px; }

        .cards { display: grid; grid-template-columns: 1fr; gap: 12px; }
        @media (min-width: 560px) { .cards { grid-template-columns: 1fr 1fr; } }
        @media (min-width: 860px) { .cards { grid-template-columns: 1fr 1fr 1fr; } }

        .lcard { text-align: left; padding: 0; overflow: hidden; cursor: pointer; border: 1px solid var(--line);
          transition: transform 0.14s var(--ease), box-shadow 0.15s, border-color 0.15s; background: var(--surface); }
        .lcard:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); border-color: var(--line-strong); }
        .lcard-photo { width: 100%; height: 130px; object-fit: cover; display: block; background: var(--surface-sunk); }
        .lcard-noimg { display: grid; place-items: center; font-size: 34px; }
        .lcard-body { padding: 13px 14px 14px; display: flex; flex-direction: column; gap: 7px; }
        .lcard-top { display: flex; gap: 6px; flex-wrap: wrap; }
        .lcard-title { font-size: 14.5px; font-weight: 700; line-height: 1.3; }
        .lcard-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 3px; }
        .lcard-platforms { display: flex; gap: 3px; font-size: 14px; }
        .lcard-time { font-size: 12px; }
      `}</style>
    </div>
  )
}
