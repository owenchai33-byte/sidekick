import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import { formatPrice, listingLabel } from '../lib/format.js'
import { LEAD_STAGES, LEAD_STAGE_MAP, PLATFORM_MAP } from '../../shared/constants.js'

const EMPTY_LEAD = { listingId: '', platform: '', name: '', contact: '', stage: 'new', note: '' }

export default function PipelinePage() {
  const { listings, leads, settings, saveLead, removeLead, newId, toast } = useApp()
  const [logging, setLogging] = useState(false)
  const [form, setForm] = useState(EMPTY_LEAD)

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const selectedListing = listings.find((l) => l.id === form.listingId)

  const metrics = useMemo(() => {
    let livePosts = 0
    for (const l of listings) {
      for (const p of Object.values(l.published || {})) livePosts += Object.keys(p).length
    }
    const open = leads.filter((ld) => LEAD_STAGE_MAP[ld.stage]?.open).length
    const won = leads.filter((ld) => ld.stage === 'won')
    const wonValue = won.reduce((sum, ld) => sum + (Number(ld.value) || 0), 0)
    const closed = leads.filter((ld) => ld.stage === 'won' || ld.stage === 'lost').length
    const convRate = closed > 0 ? Math.round((won.length / closed) * 100) : null
    return { livePosts, open, wonCount: won.length, wonValue, convRate }
  }, [listings, leads])

  const grouped = useMemo(() => {
    const g = {}
    for (const s of LEAD_STAGES) g[s.id] = []
    for (const ld of leads) (g[ld.stage] || (g[ld.stage] = [])).push(ld)
    return g
  }, [leads])

  function submitLead(e) {
    e.preventDefault()
    if (!form.listingId || !form.platform) {
      toast('Pick a listing and the platform the lead came from', 'warn')
      return
    }
    saveLead({
      id: newId(),
      listingId: form.listingId,
      platform: form.platform,
      agentId: settings.agent.id,
      name: form.name.trim() || 'Unnamed lead',
      contact: form.contact.trim() || null,
      stage: form.stage,
      note: form.note.trim() || null,
      value: null,
    })
    setForm(EMPTY_LEAD)
    setLogging(false)
    toast('Lead logged', 'success')
  }

  function moveStage(lead, stage) {
    saveLead({ ...lead, stage, closedAt: stage === 'won' || stage === 'lost' ? new Date().toISOString() : null })
  }
  function setValue(lead, value) {
    saveLead({ ...lead, value: value === '' ? null : Number(value) })
  }

  const hasLeads = leads.length > 0

  return (
    <div className="container pipeline">
      <header className="pl-head">
        <div>
          <h1>Pipeline</h1>
          <p className="muted">Every lead is tied to the listing and platform it came from — that attribution is the basis for the referral share.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setLogging((v) => !v)} disabled={listings.length === 0}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          Log a lead
        </button>
      </header>

      {/* Summary */}
      <div className="stats">
        <Stat label="Active listings" value={listings.length} />
        <Stat label="Live posts" value={metrics.livePosts} />
        <Stat label="Open leads" value={metrics.open} accent />
        <Stat label="Closed won" value={metrics.wonCount} />
        <Stat label="Won value" value={formatPrice(metrics.wonValue)} money />
        <Stat label="Win rate" value={metrics.convRate == null ? '—' : metrics.convRate + '%'} />
      </div>

      {/* Log lead form */}
      {logging && (
        <form className="card logform" onSubmit={submitLead}>
          <h2 className="block-title">Log a lead</h2>
          <div className="grid2">
            <div className="field">
              <label htmlFor="ll-listing">Listing</label>
              <select id="ll-listing" className="select" value={form.listingId} onChange={(e) => { setF('listingId', e.target.value); setF('platform', '') }}>
                <option value="">Select listing…</option>
                {listings.map((l) => <option key={l.id} value={l.id}>{listingLabel(l)} · {formatPrice(l.price, l.listingType)}</option>)}
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
              <input id="ll-contact" className="input" placeholder="phone / WhatsApp / IG handle" value={form.contact} onChange={(e) => setF('contact', e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="ll-note">Note <span className="muted">optional</span></label>
            <input id="ll-note" className="input" placeholder="e.g. wants a viewing this weekend" value={form.note} onChange={(e) => setF('note', e.target.value)} />
          </div>
          <div className="row" style={{ gap: 8, marginTop: 4 }}>
            <button type="submit" className="btn btn-primary btn-sm">Save lead</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setLogging(false); setForm(EMPTY_LEAD) }}>Cancel</button>
          </div>
        </form>
      )}

      {/* Pipeline by stage */}
      {!hasLeads ? (
        <div className="card empty">
          <div className="empty-mark" aria-hidden="true">📈</div>
          <h2>No leads yet</h2>
          <p className="muted">
            {listings.length === 0
              ? <>Create a listing first, then log the leads it brings in. <Link to="/new">Add a listing →</Link></>
              : 'When someone messages about a listing, log it here so the closed deal is attributed to you.'}
          </p>
        </div>
      ) : (
        <div className="stages">
          {LEAD_STAGES.map((stage) => {
            const items = grouped[stage.id] || []
            if (items.length === 0) return null
            return (
              <section key={stage.id} className="stage">
                <div className="stage-head">
                  <span className={`dot dot-${stage.tone}`} />
                  <h2>{stage.name}</h2>
                  <span className="stage-count num">{items.length}</span>
                </div>
                <div className="lead-list">
                  {items.map((lead) => {
                    const listing = listings.find((l) => l.id === lead.listingId)
                    const platform = PLATFORM_MAP[lead.platform]
                    return (
                      <div key={lead.id} className="lead card">
                        <div className="lead-top">
                          <strong className="lead-name">{lead.name}</strong>
                          {lead.contact && <span className="lead-contact muted">{lead.contact}</span>}
                        </div>
                        <div className="lead-src">
                          <span className="lead-plat" title={platform?.name}>{platform?.icon} {platform?.short}</span>
                          <span className="muted">·</span>
                          {listing ? <Link to={`/listing/${listing.id}`} className="lead-listing">{listingLabel(listing)}</Link> : <span className="muted">deleted listing</span>}
                        </div>
                        {lead.note && <p className="lead-note">{lead.note}</p>}
                        <div className="lead-actions">
                          <select className="select lead-stage" value={lead.stage} onChange={(e) => moveStage(lead, e.target.value)} aria-label="Move stage">
                            {LEAD_STAGES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                          {lead.stage === 'won' && (
                            <div className="lead-value">
                              <span>RM</span>
                              <input className="input num" inputMode="numeric" placeholder="deal value" value={lead.value ?? ''} onChange={(e) => setValue(lead, e.target.value.replace(/[^\d]/g, ''))} />
                            </div>
                          )}
                          <button className="lead-del" onClick={() => removeLead(lead.id)} aria-label="Delete lead" title="Delete">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <p className="muted trust-note">
        The system tracks what agents log — it can't see deals closed offline and unreported. Clean logging in, clear attribution out.
      </p>

      <style>{`
        .pipeline { display: flex; flex-direction: column; gap: 16px; }
        .pl-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
        .pl-head h1 { font-size: 25px; }
        .pl-head p { margin-top: 4px; font-size: 13px; max-width: 48ch; }
        .block-title { font-size: 15px; margin-bottom: 12px; }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; }

        .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
        @media (min-width: 560px) { .stats { grid-template-columns: repeat(3, 1fr); } }
        @media (min-width: 860px) { .stats { grid-template-columns: repeat(6, 1fr); } }

        .logform { padding: 16px; display: flex; flex-direction: column; gap: 12px; }

        .empty { padding: 44px 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .empty-mark { font-size: 40px; }
        .empty h2 { font-size: 17px; }
        .empty p { max-width: 42ch; font-size: 13.5px; }

        .stages { display: flex; flex-direction: column; gap: 18px; }
        .stage-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
        .stage-head h2 { font-size: 14px; font-weight: 700; }
        .stage-count { margin-left: 2px; font-size: 12px; font-weight: 700; color: var(--ink-500); background: var(--surface-sunk); padding: 1px 8px; border-radius: 999px; }
        .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
        .dot-neutral { background: var(--ink-400); }
        .dot-info { background: var(--green-500); }
        .dot-warn { background: var(--timber-500); }
        .dot-win { background: var(--green-600); }
        .dot-lost { background: var(--danger); }

        .lead-list { display: grid; grid-template-columns: 1fr; gap: 10px; }
        @media (min-width: 620px) { .lead-list { grid-template-columns: 1fr 1fr; } }
        .lead { padding: 13px; display: flex; flex-direction: column; gap: 8px; }
        .lead-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
        .lead-name { font-size: 14.5px; }
        .lead-contact { font-size: 12.5px; }
        .lead-src { display: flex; align-items: center; gap: 7px; font-size: 12.5px; }
        .lead-plat { font-weight: 600; color: var(--ink-700); }
        .lead-listing { color: var(--green-700); text-decoration: none; font-weight: 600; }
        @media (prefers-color-scheme: dark) { .lead-listing { color: var(--green-400); } }
        .lead-listing:hover { text-decoration: underline; }
        .lead-note { font-size: 12.5px; color: var(--ink-500); background: var(--surface-sunk); padding: 6px 9px; border-radius: var(--r-sm); }
        .lead-actions { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
        .lead-stage { flex: 1; padding: 7px 10px; font-size: 13px; }
        .lead-value { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; color: var(--green-700); }
        .lead-value .input { width: 110px; padding: 7px 9px; font-size: 13px; }
        .lead-del { border: none; background: transparent; color: var(--ink-400); cursor: pointer; padding: 6px; border-radius: 6px; flex: none; }
        .lead-del:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }

        .trust-note { font-size: 12px; text-align: center; padding: 6px 0 14px; max-width: 54ch; margin: 0 auto; }
      `}</style>
    </div>
  )
}

function Stat({ label, value, accent, money }) {
  return (
    <div className={`stat card ${accent ? 'stat-accent' : ''}`}>
      <div className={`stat-value num ${money ? 'stat-money' : ''}`}>{value}</div>
      <div className="stat-label">{label}</div>
      <style>{`
        .stat { padding: 13px 14px; }
        .stat-accent { border-color: var(--green-500); }
        .stat-value { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; color: var(--ink-900); line-height: 1.1; }
        .stat-money { font-size: 17px; color: var(--green-700); }
        @media (prefers-color-scheme: dark) { .stat-money { color: var(--green-400); } }
        .stat-label { font-size: 11.5px; font-weight: 600; color: var(--ink-500); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.03em; }
      `}</style>
    </div>
  )
}
