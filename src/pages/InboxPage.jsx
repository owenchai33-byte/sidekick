import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import { parseListing } from '../lib/ai.js'
import { formatPrice } from '../lib/format.js'

// Quick Intake: paste the flood of forwarded WhatsApp listings, one at a time,
// and triage fast — SideKick parses each into a draft, then Keep (→ a listing,
// no retyping) or Skip. Kills the "read 100 messages, pick which, retype" grind.
const KEY = 'sidekick.inbox.v1'
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || [] } catch { return [] } }

export default function InboxPage() {
  const { settings, saveListing, newId, toast } = useApp()
  const [raw, setRaw] = useState('')
  const [drafts, setDrafts] = useState(load)
  const [busy, setBusy] = useState(false)

  const save = (next) => { setDrafts(next); try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode */ } }

  async function add() {
    const text = raw.trim()
    if (!text) return
    setBusy(true)
    try {
      const { fields } = await parseListing(text)
      save([{ id: `d${Date.now()}`, raw: text, fields, kept: false }, ...drafts])
      setRaw('')
    } catch (e) { toast('Parse failed: ' + e.message, 'danger') }
    finally { setBusy(false) }
  }

  const skip = (id) => save(drafts.filter((d) => d.id !== id))

  async function keep(d) {
    const f = d.fields || {}
    const listing = {
      id: newId(), agentId: settings.agent?.id,
      listingType: f.listingType || 'sale',
      price: f.price != null && f.price !== '' ? Number(f.price) : null,
      location: f.location || null, bedrooms: f.bedrooms ?? null, bathrooms: f.bathrooms ?? null,
      propertyType: f.propertyType || null, sqft: f.sqft ?? null, tenure: f.tenure || null, furnishing: f.furnishing || null,
      title: f.title || null, photos: [], videos: [],
      platforms: settings.defaultPlatforms, languages: settings.defaultLanguages,
      content: {}, approvals: {}, published: {}, status: 'draft',
    }
    try {
      const saved = await saveListing(listing)
      save(drafts.map((x) => (x.id === d.id ? { ...x, kept: true, listingId: saved.id } : x)))
      toast('Added to Listings — add photos & generate there', 'success')
    } catch (e) { toast('Could not add: ' + e.message, 'danger') }
  }

  const pending = drafts.filter((d) => !d.kept).length

  return (
    <div className="container inbox">
      <header className="inbox-head">
        <h1 className="page-title">Inbox</h1>
        <p className="muted">Paste a forwarded WhatsApp listing → SideKick pulls out the details → Keep it or Skip. No retyping, no ChatGPT — the copy gets written for you when you generate.</p>
      </header>

      <section className="card inbox-paste">
        <textarea
          className="textarea" rows={5}
          placeholder="Paste one forwarded listing here (price, beds, location, terms…)"
          value={raw} onChange={(e) => setRaw(e.target.value)}
        />
        <div className="row" style={{ gap: 10, marginTop: 10 }}>
          <button className="btn btn-primary" onClick={add} disabled={!raw.trim() || busy}>{busy ? 'Reading…' : 'Add to inbox'}</button>
          <span className="muted" style={{ fontSize: 12.5, alignSelf: 'center' }}>Paste, add, keep/skip — then paste the next.</span>
        </div>
      </section>

      {drafts.length > 0 && <div className="inbox-count">{pending} to review · {drafts.length - pending} kept</div>}

      <div className="inbox-list">
        {drafts.map((d) => {
          const f = d.fields || {}
          const specs = [f.propertyType, f.bedrooms != null && `${f.bedrooms} bed`, f.bathrooms != null && `${f.bathrooms} bath`, f.location].filter(Boolean).join(' · ')
          return (
            <div key={d.id} className={`inbox-card ${d.kept ? 'kept' : ''}`}>
              <div className="inbox-card-main">
                <div className="inbox-price">{f.price != null && f.price !== '' ? formatPrice(Number(f.price), f.listingType) : 'No price found'}</div>
                <div className="inbox-specs muted">{specs || 'Details unclear — check after Keep'}</div>
                <div className="inbox-raw">{d.raw.replace(/\s+/g, ' ').slice(0, 120)}…</div>
              </div>
              {d.kept ? (
                <Link className="btn btn-subtle btn-sm" to={`/listing/${d.listingId}`}>Open →</Link>
              ) : (
                <div className="inbox-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => keep(d)}>Keep</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => skip(d.id)}>Skip</button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {drafts.length === 0 && <p className="muted" style={{ textAlign: 'center', padding: '30px 0' }}>Nothing here yet. Paste a listing above to start.</p>}

      <style>{`
        .inbox { max-width: 720px; display: flex; flex-direction: column; gap: 16px; }
        .page-title { font-size: 24px; font-weight: 800; margin: 0 0 6px; }
        .inbox-head p { font-size: 14px; }
        .inbox-paste { padding: 16px; }
        .inbox-count { font-size: 13px; font-weight: 700; color: var(--green-700); }
        @media (prefers-color-scheme: dark) { .inbox-count { color: var(--green-400); } }
        .inbox-list { display: flex; flex-direction: column; gap: 10px; }
        .inbox-card { display: flex; gap: 14px; align-items: center; justify-content: space-between; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; }
        .inbox-card.kept { opacity: .6; }
        .inbox-card-main { min-width: 0; }
        .inbox-price { font-weight: 800; font-size: 16px; }
        .inbox-specs { font-size: 13px; margin-top: 2px; }
        .inbox-raw { font-size: 12px; color: var(--ink-400); margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .inbox-actions { display: flex; gap: 8px; flex: none; }
      `}</style>
    </div>
  )
}
