import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import { generateContent } from '../lib/ai.js'
import { evaluateRules } from '../lib/rules.js'
import { formatPrice, listingLabel } from '../lib/format.js'
import { PLATFORM_MAP } from '../../shared/constants.js'
import PriceTag from '../components/PriceTag.jsx'
import PostCard from '../components/PostCard.jsx'
import PropertyGraphic from '../components/PropertyGraphic.jsx'
import PlatformPicker from '../components/PlatformPicker.jsx'
import LanguagePicker from '../components/LanguagePicker.jsx'

const GRAPHIC_FORMATS = [
  { id: 'square', name: 'Square', sub: 'Feed · Marketplace' },
  { id: 'portrait', name: 'Portrait', sub: 'Instagram feed' },
  { id: 'story', name: 'Story', sub: 'Reels · Status' },
]

export default function ListingDetailPage() {
  const { id } = useParams()
  const routeState = useLocation().state
  const navigate = useNavigate()
  const { settings, saveListing, removeListing, toast, listings, loading } = useApp()

  const [listing, setListing] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [demo, setDemo] = useState(false)
  const [editTargets, setEditTargets] = useState(false)
  const [graphicFormat, setGraphicFormat] = useState('square')
  const autoRan = useRef(false)

  // Hydrate from context (already loaded from the store)
  useEffect(() => {
    if (loading) return
    const found = listings.find((l) => l.id === id)
    setListing(found || null)
    setDemo(!!found?.demo)
  }, [id, loading, listings])

  const rule = useMemo(() => (listing ? evaluateRules(listing, settings.rules) : { flagged: false }), [listing, settings.rules])

  const hasContent = listing && Object.keys(listing.content || {}).length > 0

  const stats = useMemo(() => {
    if (!listing) return { total: 0, approved: 0, published: 0 }
    let total = 0, approved = 0, published = 0
    for (const p of listing.platforms) {
      for (const l of listing.languages) {
        total++
        if (listing.approvals?.[p]?.[l]) approved++
        if (listing.published?.[p]?.[l]) published++
      }
    }
    return { total, approved, published }
  }, [listing])

  async function runGenerate(target = listing) {
    if (!target) return
    setGenerating(true)
    try {
      const { content, demo: isDemo, degraded, error } = await generateContent(
        {
          listingType: target.listingType, price: target.price, location: target.location,
          bedrooms: target.bedrooms, bathrooms: target.bathrooms, propertyType: target.propertyType,
          sqft: target.sqft, tenure: target.tenure, furnishing: target.furnishing,
        },
        target.platforms,
        target.languages,
      )
      const next = { ...target, content, approvals: {}, published: {}, demo: isDemo, status: 'optimised' }
      await saveListing(next)
      setListing(next)
      setDemo(isDemo)
      if (degraded) toast('AI busy — showing sample copy. ' + (error || ''), 'warn')
      else toast(isDemo ? 'Generated sample copy (demo mode)' : 'Copy generated — review & approve', isDemo ? 'warn' : 'success')
    } catch (e) {
      toast('Generation failed: ' + e.message, 'danger')
    } finally {
      setGenerating(false)
    }
  }

  // Auto-generate once when arriving from the New Listing flow
  useEffect(() => {
    if (routeState?.autoGenerate && listing && !hasContent && !autoRan.current && !generating) {
      autoRan.current = true
      runGenerate(listing)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeState, listing])

  async function patch(updater) {
    const next = typeof updater === 'function' ? updater(listing) : { ...listing, ...updater }
    setListing(next)
    await saveListing(next)
  }

  function editText(platform, lang, text) {
    patch((l) => ({ ...l, content: { ...l.content, [platform]: { ...l.content[platform], [lang]: text } } }))
  }
  function toggleApprove(platform, lang) {
    patch((l) => {
      const cur = l.approvals?.[platform]?.[lang]
      return { ...l, approvals: { ...l.approvals, [platform]: { ...l.approvals?.[platform], [lang]: !cur } } }
    })
  }
  function markPublished(platform, lang) {
    patch((l) => ({
      ...l,
      published: { ...l.published, [platform]: { ...l.published?.[platform], [lang]: new Date().toISOString() } },
      status: 'published',
    }))
  }

  function approveAll() {
    patch((l) => {
      const approvals = {}
      for (const p of l.platforms) { approvals[p] = {}; for (const lang of l.languages) approvals[p][lang] = true }
      return { ...l, approvals }
    })
    toast('All posts approved', 'success')
  }

  async function handleDelete() {
    if (!confirm('Delete this listing and its posts?')) return
    await removeListing(listing.id)
    toast('Listing deleted', 'success')
    navigate('/')
  }

  function toggleTarget(kind, val) {
    patch((l) => {
      const arr = l[kind]
      const nextArr = arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]
      return { ...l, [kind]: nextArr.length ? nextArr : arr }
    })
  }

  if (loading) return <div className="container" style={{ padding: 40 }}>Loading…</div>
  if (!listing) {
    return (
      <div className="container" style={{ padding: '48px 16px', textAlign: 'center' }}>
        <p className="muted">That listing doesn't exist.</p>
        <Link to="/" className="btn btn-ghost" style={{ marginTop: 12 }}>Back to listings</Link>
      </div>
    )
  }

  return (
    <div className="container detail">
      <Link to="/" className="back">← Listings</Link>

      {/* Summary header */}
      <header className="summary card">
        {listing.photos?.length > 0 && (
          <div
            className={`summary-photos${listing.photos.length === 1 ? ' single' : ''}`}
            style={{ gridTemplateColumns: `repeat(${Math.min(listing.photos.length, 4)}, 1fr)` }}
          >
            {listing.photos.slice(0, 4).map((src, i) => <img key={i} src={src} alt="" />)}
          </div>
        )}
        <div className="summary-body">
          <div className="summary-top">
            <div>
              <div className="row wrap" style={{ gap: 8, marginBottom: 6 }}>
                <span className="badge badge-neutral">{listing.listingType === 'rental' ? 'Rental' : 'Sale'}</span>
                {rule.flagged && <span className="badge badge-flag">Flagged</span>}
                {listing.example && <span className="badge badge-example">Example</span>}
                {demo && <span className="badge badge-demo">Sample copy</span>}
              </div>
              <h1>{listingLabel(listing)}</h1>
              <p className="summary-specs muted">
                {[listing.propertyType, listing.bedrooms != null && `${listing.bedrooms} bed`, listing.bathrooms != null && `${listing.bathrooms} bath`, listing.sqft != null && `${listing.sqft} sqft`, listing.tenure, listing.furnishing].filter(Boolean).join(' · ') || 'No specs added'}
              </p>
            </div>
            <PriceTag value={listing.price} listingType={listing.listingType} size="md" />
          </div>

          {rule.flagged && <div className="summary-rule">{rule.reason}</div>}

          <button className="targets-toggle" onClick={() => setEditTargets((v) => !v)}>
            {listing.platforms.length} platforms × {listing.languages.length} languages
            <span className="muted"> · edit</span>
          </button>

          {editTargets && (
            <div className="targets-edit">
              <div className="field"><label>Platforms</label><PlatformPicker compact selected={listing.platforms} onToggle={(v) => toggleTarget('platforms', v)} /></div>
              <div className="field"><label>Languages</label><LanguagePicker selected={listing.languages} onToggle={(v) => toggleTarget('languages', v)} /></div>
              <p className="muted" style={{ fontSize: 12 }}>Changed the mix? Regenerate to refresh the copy.</p>
            </div>
          )}
        </div>
      </header>

      {/* Action bar */}
      <div className="actionbar">
        <div className="progress">
          <div className="progress-track"><div className="progress-fill" style={{ width: `${stats.total ? (stats.approved / stats.total) * 100 : 0}%` }} /></div>
          <span className="progress-label num">{stats.approved}/{stats.total} approved{stats.published ? ` · ${stats.published} published` : ''}</span>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {hasContent && <button className="btn btn-ghost btn-sm" onClick={approveAll} disabled={stats.approved === stats.total}>Approve all</button>}
          <button className="btn btn-subtle btn-sm" onClick={() => runGenerate()} disabled={generating}>
            {generating ? 'Generating…' : hasContent ? 'Regenerate' : 'Generate'}
          </button>
        </div>
      </div>

      {/* Post graphics */}
      <section className="card graphics">
        <div className="graphics-head">
          <div>
            <h2 className="block-title">Post graphics</h2>
            <p className="muted block-sub">Branded, ready to post — your photo with the price, specs and details baked in.{!settings.brand?.agency && !settings.brand?.name && <> Add your logo &amp; details in <Link to="/settings">Settings → Brand kit</Link>.</>}</p>
          </div>
        </div>
        <div className="seg graphics-seg" role="group" aria-label="Graphic format">
          {GRAPHIC_FORMATS.map((f) => (
            <button key={f.id} className={`seg-btn ${graphicFormat === f.id ? 'on' : ''}`} onClick={() => setGraphicFormat(f.id)} title={f.sub}>{f.name}</button>
          ))}
        </div>
        <PropertyGraphic listing={listing} brand={settings.brand} format={graphicFormat} />
        <p className="muted graphics-note">{GRAPHIC_FORMATS.find((f) => f.id === graphicFormat)?.sub}{!listing.photos?.length && ' · add a photo to the listing for a photo background'}</p>
      </section>

      {/* Posts */}
      {generating && !hasContent ? (
        <div className="gen-skeleton">
          {listing.platforms.map((p) => <div key={p} className="skel card"><div className="skel-bar" /><div className="skel-line" /><div className="skel-line short" /></div>)}
        </div>
      ) : hasContent ? (
        <div className="posts">
          {listing.platforms.map((pid) => {
            const platform = PLATFORM_MAP[pid]
            if (!platform) return null
            return (
              <PostCard
                key={pid}
                platform={platform}
                listing={listing}
                languages={listing.languages}
                content={listing.content[pid] || {}}
                approvals={listing.approvals?.[pid] || {}}
                published={listing.published?.[pid] || {}}
                demo={demo}
                onEditText={(lang, text) => editText(pid, lang, text)}
                onToggleApprove={(lang) => toggleApprove(pid, lang)}
                onPublish={(lang) => markPublished(pid, lang)}
                toast={toast}
              />
            )
          })}
        </div>
      ) : (
        <div className="card empty-gen">
          <p>No copy generated yet.</p>
          <button className="btn btn-primary" onClick={() => runGenerate()} disabled={generating}>Generate posts</button>
        </div>
      )}

      <div className="detail-foot">
        <button className="btn btn-ghost btn-sm danger-ghost" onClick={handleDelete}>Delete listing</button>
      </div>

      <style>{`
        .detail { display: flex; flex-direction: column; gap: 14px; }
        .back { align-self: flex-start; font-size: 13.5px; font-weight: 600; color: var(--ink-500); text-decoration: none; }
        .back:hover { color: var(--ink-900); }

        .summary { overflow: hidden; }
        .summary-photos { display: grid; gap: 3px; background: var(--line); }
        .summary-photos img { width: 100%; height: 150px; object-fit: cover; display: block; }
        .summary-photos.single img { height: 230px; }
        .summary-body { padding: 20px; }
        .summary-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
        .summary-top h1 { font-size: 21px; letter-spacing: -0.01em; line-height: 1.25; }
        .summary-specs { font-size: 13px; margin-top: 6px; line-height: 1.5; }
        .summary-rule { margin-top: 10px; font-size: 12.5px; font-weight: 600; color: var(--timber-700); background: color-mix(in srgb, var(--timber-500) 12%, transparent); padding: 7px 11px; border-radius: var(--r-sm); }
        @media (prefers-color-scheme: dark) { .summary-rule { color: var(--timber-300); } }

        .targets-toggle { margin-top: 14px; background: none; border: none; padding: 0; font-size: 13px; font-weight: 700; color: var(--green-700); cursor: pointer; }
        @media (prefers-color-scheme: dark) { .targets-toggle { color: var(--green-400); } }
        .targets-edit { margin-top: 12px; display: flex; flex-direction: column; gap: 14px; padding-top: 14px; border-top: 1px solid var(--line); }

        .actionbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
        .progress { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 200px; }
        .progress-track { flex: 1; height: 7px; background: var(--surface-sunk); border-radius: 999px; overflow: hidden; }
        .progress-fill { height: 100%; background: var(--green-500); border-radius: 999px; transition: width 0.3s var(--ease); }
        .progress-label { font-size: 12.5px; font-weight: 600; color: var(--ink-500); white-space: nowrap; }

        .posts { display: flex; flex-direction: column; gap: 14px; }
        .empty-gen { padding: 30px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 14px; }

        .graphics { padding: 16px; }
        .block-title { font-size: 15px; }
        .block-sub { font-size: 12.5px; margin: 3px 0 0; }
        .graphics-seg { display: inline-flex; gap: 4px; background: var(--surface-sunk); padding: 4px; border-radius: var(--r-md); margin: 12px 0 14px; }
        .seg-btn { border: none; background: transparent; padding: 8px 16px; border-radius: var(--r-sm); font-size: 13px; font-weight: 700; color: var(--ink-500); cursor: pointer; transition: all 0.15s var(--ease); }
        .seg-btn.on { background: var(--green-700); color: #fff; }
        @media (prefers-color-scheme: dark) { .seg-btn.on { background: var(--green-500); color: #0f2e21; } }
        .graphics-note { font-size: 12px; text-align: center; margin-top: 10px; }

        .gen-skeleton { display: flex; flex-direction: column; gap: 14px; }
        .skel { padding: 18px; }
        .skel-bar { height: 16px; width: 40%; background: var(--surface-sunk); border-radius: 6px; margin-bottom: 14px; animation: pulse 1.3s ease-in-out infinite; }
        .skel-line { height: 12px; background: var(--surface-sunk); border-radius: 6px; margin-bottom: 9px; animation: pulse 1.3s ease-in-out infinite; }
        .skel-line.short { width: 60%; }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }

        .detail-foot { margin-top: 10px; }
        .danger-ghost { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 35%, transparent); }
        .danger-ghost:hover { background: color-mix(in srgb, var(--danger) 10%, transparent); }
      `}</style>
    </div>
  )
}
