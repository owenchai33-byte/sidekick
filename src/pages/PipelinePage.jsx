import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import { formatPrice, listingLabel } from '../lib/format.js'
import { LEAD_STAGES, LEAD_STAGE_MAP, PLATFORM_MAP } from '../../shared/constants.js'
import PriceTag from '../components/PriceTag.jsx'

const EMPTY_LEAD = { listingId: '', platform: '', name: '', contact: '', stage: 'new', note: '' }
const STAGE_ORDER = Object.fromEntries(LEAD_STAGES.map((s, i) => [s.id, i]))

export default function PipelinePage() {
  const { listings, leads, settings, saveLead, removeLead, newId, toast } = useApp()
  const [view, setView] = useState('leads') // leads | listings | liveposts | closed
  const [logging, setLogging] = useState(false)
  const [form, setForm] = useState(EMPTY_LEAD)

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const selectedListing = listings.find((l) => l.id === form.listingId)

  const data = useMemo(() => {
    const livePosts = []
    let liveCount = 0
    for (const l of listings) {
      const plats = Object.keys(l.published || {}).filter((p) => Object.keys(l.published[p] || {}).length)
      plats.forEach((p) => (liveCount += Object.keys(l.published[p]).length))
      if (plats.length) livePosts.push({ listing: l, platforms: plats })
    }
    const openLeads = leads.filter((l) => LEAD_STAGE_MAP[l.stage]?.open).sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage])
    const won = leads.filter((l) => l.stage === 'won')
    const lost = leads.filter((l) => l.stage === 'lost')
    const wonValue = won.reduce((s, l) => s + (Number(l.value) || 0), 0)
    const closedCount = won.length + lost.length
    return {
      livePosts, liveCount, openLeads, won, lost, wonValue,
      winRate: closedCount ? Math.round((won.length / closedCount) * 100) : null,
    }
  }, [listings, leads])

  const tiles = [
    { key: 'listings', label: 'Active listings', value: listings.length },
    { key: 'liveposts', label: 'Live posts', value: data.liveCount },
    { key: 'leads', label: 'Open leads', value: data.openLeads.length },
    { key: 'closed', label: 'Closed won', value: data.won.length },
    { key: 'closed', label: 'Won value', value: formatPrice(data.wonValue), money: true },
    { key: null, label: 'Win rate', value: data.winRate == null ? '—' : data.winRate + '%' },
  ]

  function submitLead(e) {
    e.preventDefault()
    if (!form.listingId || !form.platform) return toast('Pick a listing and the platform the lead came from', 'warn')
    saveLead({
      id: newId(), listingId: form.listingId, platform: form.platform, agentId: settings.agent.id,
      name: form.name.trim() || 'Unnamed lead', contact: form.contact.trim() || null,
      stage: form.stage, note: form.note.trim() || null, value: null,
    })
    setForm(EMPTY_LEAD)
    setLogging(false)
    setView('leads')
    toast('Lead logged', 'success')
  }
  function moveStage(lead, stage) {
    saveLead({ ...lead, stage, closedAt: stage === 'won' || stage === 'lost' ? new Date().toISOString() : null })
  }
  function setValue(lead, value) {
    saveLead({ ...lead, value: value === '' ? null : Number(value) })
  }

  return (
    <div className="container dash">
      <header className="dash-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Tap any number to see what's behind it. Every lead is tied to the listing &amp; platform it came from.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setView('leads'); setLogging(true) }} disabled={listings.length === 0}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          Log a lead
        </button>
      </header>

      <div className="tiles">
        {tiles.map((t, i) => {
          const clickable = !!t.key
          const active = clickable && view === t.key
          return (
            <button
              key={i}
              className={`tile ${active ? 'tile-on' : ''} ${clickable ? '' : 'tile-static'}`}
              onClick={() => clickable && setView(t.key)}
              disabled={!clickable}
            >
              <span className={`tile-value num ${t.money ? 'tile-money' : ''}`}>{t.value}</span>
              <span className="tile-label">{t.label}</span>
              {clickable && <span className="tile-caret" aria-hidden="true">›</span>}
            </button>
          )
        })}
      </div>

      {/* Log a lead */}
      {logging && view === 'leads' && (
        <form className="card logform" onSubmit={submitLead}>
          <div className="grid2">
            <div className="field">
              <label htmlFor="ll-listing">Listing</label>
              <select id="ll-listing" className="select" value={form.listingId} onChange={(e) => { setF('listingId', e.target.value); setF('platform', '') }}>
                <option value="">Select listing…</option>
                {listings.map((l) => <option key={l.id} value={l.id}>{listingLabel(l)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ll-platform">Came in via</label>
              <select id="ll-platform" className="select" value={form.platform} onChange={(e) => setF('platform', e.target.value)} disabled={!selectedListing}>
                <option value="">Select platform…</option>
                {(selectedListing?.platforms || []).map((p) => <option key={p} value={p}>{PLATFORM_MAP[p]?.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ll-name">Lead name</label>
              <input id="ll-name" className="input" placeholder="e.g. Mr Tan" value={form.name} onChange={(e) => setF('name', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ll-contact">Contact <span className="muted">optional</span></label>
              <input id="ll-contact" className="input" placeholder="phone / WhatsApp / IG" value={form.contact} onChange={(e) => setF('contact', e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button type="submit" className="btn btn-primary btn-sm">Save lead</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setLogging(false); setForm(EMPTY_LEAD) }}>Cancel</button>
          </div>
        </form>
      )}

      {/* Drill-down views */}
      {view === 'leads' && (
        <Section title="Open leads" hint="Move a lead along as it progresses. Marking it Won files it under Closed won.">
          {data.openLeads.length === 0 ? (
            <Empty icon="📥" text={listings.length === 0 ? <>Create a listing first, then log the leads it brings in. <Link to="/new">Add a listing →</Link></> : 'No open leads. Tap “Log a lead” when someone enquires.'} />
          ) : (
            <div className="lead-list">
              {data.openLeads.map((lead) => <LeadRow key={lead.id} lead={lead} listings={listings} onStage={moveStage} onDelete={removeLead} onValue={setValue} />)}
            </div>
          )}
        </Section>
      )}

      {view === 'listings' && (
        <Section title="Active listings" hint="Every listing in the system.">
          {listings.length === 0 ? <Empty icon="🏡" text={<>No listings yet. <Link to="/new">Add one →</Link></>} /> : (
            <div className="rows">{listings.map((l) => <ListingRow key={l.id} listing={l} />)}</div>
          )}
        </Section>
      )}

      {view === 'liveposts' && (
        <Section title="Live posts" hint="Listings you've published, and where.">
          {data.livePosts.length === 0 ? <Empty icon="📣" text="Nothing published yet. Open a listing, approve a post, then tap Publish." /> : (
            <div className="rows">
              {data.livePosts.map(({ listing, platforms }) => (
                <Link key={listing.id} to={`/listing/${listing.id}`} className="row-link">
                  <div className="row-info">
                    <div className="row-title">{listingLabel(listing)}</div>
                    <div className="row-sub muted"><span className="row-plats">{platforms.map((p) => <span key={p} title={PLATFORM_MAP[p]?.name}>{PLATFORM_MAP[p]?.icon}</span>)}</span> {platforms.length} platform{platforms.length !== 1 ? 's' : ''} live</div>
                  </div>
                  <span className="row-caret">›</span>
                </Link>
              ))}
            </div>
          )}
        </Section>
      )}

      {view === 'closed' && (
        <Section title="Closed deals" hint="Logged closed deals — the basis for the referral share.">
          {data.won.length === 0 && data.lost.length === 0 ? <Empty icon="🤝" text="No closed deals logged yet. Move a lead to “Closed — Won” to record it." /> : (
            <>
              {data.wonValue > 0 && (
                <div className="won-total">
                  <span className="muted">Total won value</span>
                  <PriceTag value={data.wonValue} size="md" />
                </div>
              )}
              <div className="lead-list">
                {[...data.won, ...data.lost].map((lead) => <LeadRow key={lead.id} lead={lead} listings={listings} onStage={moveStage} onDelete={removeLead} onValue={setValue} showValue />)}
              </div>
            </>
          )}
        </Section>
      )}

      <p className="muted trust-note">The system tracks what agents log — it can't see deals closed offline. Clean logging in, clear attribution out.</p>

      <style>{`
        .dash { display: flex; flex-direction: column; gap: 24px; }
        .dash-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding-top: 4px; }
        .dash-head h1 { font-size: 26px; letter-spacing: -0.02em; }
        .dash-head p { margin-top: 5px; font-size: 13px; max-width: 46ch; }

        .tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
        @media (min-width: 560px) { .tiles { grid-template-columns: repeat(3, 1fr); } }
        @media (min-width: 900px) { .tiles { grid-template-columns: repeat(6, 1fr); } }
        .tile { position: relative; text-align: left; padding: 15px 14px; border-radius: var(--r-md);
          background: var(--surface); border: 1px solid var(--line); cursor: pointer;
          display: flex; flex-direction: column; gap: 3px; transition: all 0.14s var(--ease); }
        .tile:hover:not(.tile-static) { border-color: var(--green-500); transform: translateY(-1px); }
        .tile-on { border-color: var(--green-600); background: var(--green-100); }
        @media (prefers-color-scheme: dark) { .tile-on { background: color-mix(in srgb, var(--green-700) 22%, transparent); } }
        .tile-static { cursor: default; }
        .tile-value { font-size: 21px; font-weight: 800; letter-spacing: -0.02em; color: var(--ink-900); line-height: 1.05; }
        .tile-money { font-size: 16px; color: var(--green-700); }
        @media (prefers-color-scheme: dark) { .tile-money { color: var(--green-400); } }
        .tile-label { font-size: 11px; font-weight: 600; color: var(--ink-500); text-transform: uppercase; letter-spacing: 0.03em; }
        .tile-caret { position: absolute; top: 11px; right: 11px; color: var(--ink-400); font-size: 16px; line-height: 1; }
        .tile-on .tile-caret { color: var(--green-600); }

        .logform { padding: 16px; }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; }

        .dash-section-head h2 { font-size: 16px; letter-spacing: -0.01em; }
        .dash-section-head p { font-size: 12.5px; margin-top: 3px; }

        .lead-list { display: grid; grid-template-columns: 1fr; gap: 12px; }
        @media (min-width: 720px) { .lead-list { grid-template-columns: 1fr 1fr; } }

        .rows { display: flex; flex-direction: column; gap: 10px; }
        .row-link { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: var(--r-md);
          background: var(--surface); border: 1px solid var(--line); text-decoration: none; color: inherit; transition: all 0.14s var(--ease); }
        .row-link:hover { border-color: var(--line-strong); background: var(--surface-sunk); }
        .row-info { flex: 1; min-width: 0; }
        .row-title { font-size: 14px; font-weight: 700; }
        .row-sub { font-size: 12.5px; margin-top: 2px; display: flex; align-items: center; gap: 6px; }
        .row-plats { display: inline-flex; gap: 2px; font-size: 13px; }
        .row-caret { color: var(--ink-400); font-size: 18px; flex: none; }
        .row-status { font-size: 11px; }

        .won-total { display: flex; align-items: center; justify-content: space-between; padding: 12px 15px;
          background: var(--green-100); border-radius: var(--r-md); margin-bottom: 4px; }
        @media (prefers-color-scheme: dark) { .won-total { background: color-mix(in srgb, var(--green-700) 20%, transparent); } }
        .won-total .muted { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }

        .trust-note { font-size: 12px; text-align: center; padding: 6px 0 14px; max-width: 54ch; margin: 0 auto; }
      `}</style>
    </div>
  )
}

function Section({ title, hint, children }) {
  return (
    <section>
      <div className="dash-section-head">
        <h2>{title}</h2>
        {hint && <p className="muted">{hint}</p>}
      </div>
      <div style={{ marginTop: 12 }}>{children}</div>
    </section>
  )
}

function Empty({ icon, text }) {
  return (
    <div className="card" style={{ padding: '34px 22px', textAlign: 'center' }}>
      <div style={{ fontSize: 34, marginBottom: 6 }} aria-hidden="true">{icon}</div>
      <p className="muted" style={{ fontSize: 13.5, maxWidth: '40ch', margin: '0 auto' }}>{text}</p>
    </div>
  )
}

function ListingRow({ listing }) {
  const live = Object.keys(listing.published || {}).some((p) => Object.keys(listing.published[p] || {}).length)
  const status = live ? 'Live' : Object.keys(listing.content || {}).length ? 'Draft ready' : 'New'
  return (
    <Link to={`/listing/${listing.id}`} className="row-link">
      <div className="row-info">
        <div className="row-title">{listingLabel(listing)}</div>
        <div className="row-sub muted">
          <span className="row-plats">{listing.platforms.map((p) => <span key={p}>{PLATFORM_MAP[p]?.icon}</span>)}</span>
          <span className={`badge ${live ? 'badge-live' : 'badge-neutral'} row-status`}>{status}</span>
        </div>
      </div>
      <PriceTag value={listing.price} listingType={listing.listingType} size="sm" />
      <span className="row-caret">›</span>
    </Link>
  )
}

function LeadRow({ lead, listings, onStage, onDelete, onValue, showValue }) {
  const listing = listings.find((l) => l.id === lead.listingId)
  const platform = PLATFORM_MAP[lead.platform]
  const stage = LEAD_STAGE_MAP[lead.stage]
  return (
    <div className="lc card">
      <div className="lc-body">
        <div className="lc-top">
          <strong className="lc-name">{lead.name}</strong>
          <span className={`badge stage-${stage?.tone}`}>{stage?.name}</span>
        </div>
        <div className="lc-meta muted">
          <span className="lc-plat">{platform?.icon} {platform?.short}</span>
          <span>·</span>
          {listing ? <Link to={`/listing/${listing.id}`} className="lc-listing">{listingLabel(listing)}</Link> : <span>deleted listing</span>}
          {lead.contact && <><span>·</span><span>{lead.contact}</span></>}
        </div>
        {lead.note && <div className="lc-note muted">{lead.note}</div>}
        {showValue && lead.stage === 'won' && (
          <div className="lc-value">RM <input className="input num" inputMode="numeric" placeholder="deal value" value={lead.value ?? ''} onChange={(e) => onValue(lead, e.target.value.replace(/[^\d]/g, ''))} /></div>
        )}
      </div>
      <div className="lc-actions">
        <select className="select lc-stage" value={lead.stage} onChange={(e) => onStage(lead, e.target.value)} aria-label="Change stage">
          {LEAD_STAGES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="lc-del" onClick={() => onDelete(lead.id)} aria-label="Delete lead" title="Delete">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
        </button>
      </div>
      <style>{`
        .lc { padding: 14px 15px; display: flex; flex-direction: column; gap: 10px; }
        .lc-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .lc-name { font-size: 14.5px; }
        .lc-meta { font-size: 12.5px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .lc-plat { font-weight: 600; color: var(--ink-700); }
        .lc-listing { color: var(--green-700); text-decoration: none; font-weight: 600; }
        @media (prefers-color-scheme: dark) { .lc-listing { color: var(--green-400); } }
        .lc-listing:hover { text-decoration: underline; }
        .lc-note { font-size: 12px; }
        .lc-value { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: var(--green-700); }
        .lc-value .input { width: 130px; padding: 7px 9px; font-size: 13px; }
        .lc-actions { display: flex; align-items: center; gap: 8px; }
        .lc-stage { flex: 1; padding: 8px 10px; font-size: 12.5px; }
        .lc-del { border: none; background: transparent; color: var(--ink-400); cursor: pointer; padding: 7px; border-radius: 6px; flex: none; }
        .lc-del:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }
        .stage-neutral { background: var(--surface-sunk); color: var(--ink-500); }
        .stage-info { background: var(--green-100); color: var(--green-700); }
        .stage-warn { background: color-mix(in srgb, var(--timber-500) 20%, transparent); color: var(--timber-700); }
        .stage-win { background: var(--green-600); color: #fff; }
        .stage-lost { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }
        @media (prefers-color-scheme: dark) { .stage-info { color: var(--green-400); } .stage-warn { color: var(--timber-300); } }
      `}</style>
    </div>
  )
}
