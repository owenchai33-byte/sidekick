import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import { generateContent } from '../lib/ai.js'
import { evaluateRules } from '../lib/rules.js'
import { formatPrice, listingLabel } from '../lib/format.js'
import { listingPhotos, coverPhoto } from '../lib/photos.js'
import { captionFor } from '../lib/social.js'
import { MARKET_STATUSES, isHighlightStatus } from '../lib/marketStatus.js'
import { getVideoBlob } from '../lib/media.js'
import { uploadMedia } from '../lib/upload.js'
import { renderGraphicCanvas, loadImage, thumbBase64 } from '../lib/graphics.js'
import { pickCover } from '../lib/ai.js'
import { PLATFORM_MAP } from '../../shared/constants.js'
import BackButton from '../components/BackButton.jsx'
import PriceTag from '../components/PriceTag.jsx'
import PostCard from '../components/PostCard.jsx'
import PublishSheet from '../components/PublishSheet.jsx'
import PropertyGraphic from '../components/PropertyGraphic.jsx'
import PropertyCarousel from '../components/PropertyCarousel.jsx'
import PropertyVideo from '../components/PropertyVideo.jsx'
import MediaUploader from '../components/MediaUploader.jsx'
import { downloadKit } from '../lib/kit.js'
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
  const [kitBusy, setKitBusy] = useState(false)
  const [queue, setQueue] = useState(null)
  const [posting, setPosting] = useState(false)
  const [showSchedule, setShowSchedule] = useState(false)
  const [scheduleAt, setScheduleAt] = useState('')
  const [coverBusy, setCoverBusy] = useState(false)
  const autoRan = useRef(false)

  // Gemini vision picks the best cover photo, so agents don't sift through the
  // pile — just dump all the WhatsApp photos and let it choose the hero shot.
  async function autoPickCover() {
    const photos = listing.photos || []
    if (photos.length < 2) return
    setCoverBusy(true)
    try {
      const images = []
      for (const src of photos.slice(0, 8)) {
        const data = await thumbBase64(src)
        if (data) images.push({ mimeType: 'image/jpeg', data })
      }
      if (images.length < 2) throw new Error('Could not read the photos')
      const r = await pickCover(images)
      if (r.demo) return toast('Auto-pick cover runs live on the deployed app (needs an AI key)', 'warn')
      const i = r.index || 0
      if (i > 0 && i < photos.length) {
        patch((l) => ({ ...l, photos: [photos[i], ...photos.filter((_, idx) => idx !== i)] }))
        toast('Cover updated to the best shot ✨', 'success')
      } else toast('First photo is already the best cover ✓', 'success')
    } catch (e) { toast('Auto-pick failed: ' + e.message, 'danger') }
    finally { setCoverBusy(false) }
  }

  // The one "Post": publishes to the agent's connected accounts (their Connect-tab
  // Zernio profile) — best asset (reel if made, else the branded graphic) + the
  // right caption (status caption when Sold/Reduced/etc). Optional schedule.
  async function doPost(scheduledFor) {
    const caption = captionFor(listing, 'facebook_page')
    if (!caption) return toast('Generate the copy first', 'warn')
    setPosting(true)
    try {
      let mediaUrl, mediaType
      const v = listing.videos?.[0]
      if (v?.name?.endsWith('.mp4')) {
        const blob = await getVideoBlob(v.id)
        if (blob) { mediaUrl = await uploadMedia(blob, v.name); mediaType = 'video' }
      }
      if (!mediaUrl) {
        const [photo, logo] = await Promise.all([loadImage(coverPhoto(listing)), loadImage(settings.brand?.logo)])
        const canvas = renderGraphicCanvas({ listing, brand: settings.brand, format: 'square', photo, logo })
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92))
        mediaUrl = await uploadMedia(blob, `${listing.id}-graphic.jpg`)
        mediaType = 'image'
      }
      const res = await fetch('/api/social-broadcast', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caption, mediaUrl, mediaType, scheduledFor }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Post failed')
      toast(j.scheduled ? `Scheduled to ${(j.posted || []).join(', ')} 🗓️` : `Posted to ${(j.posted || []).join(', ')} 🎉`, 'success')
      setShowSchedule(false); setScheduleAt('')
    } catch (e) {
      toast('Post failed: ' + e.message, 'danger')
    } finally {
      setPosting(false)
    }
  }

  function startPostEverywhere() {
    const plats = (listing.platforms || []).filter((p) => listing.content?.[p] && Object.keys(listing.content[p]).length)
    if (!plats.length) return toast('Generate the copy first', 'warn')
    setQueue({ platforms: plats, index: 0, lang: listing.languages[0] })
  }
  function advanceQueue() {
    setQueue((q) => {
      if (!q) return null
      const next = q.index + 1
      if (next >= q.platforms.length) { toast('Nice — you’ve gone through every platform 🎉', 'success'); return null }
      return { ...q, index: next }
    })
  }

  async function handleDownloadKit() {
    setKitBusy(true)
    try {
      const res = await downloadKit({ listing, brand: settings.brand })
      toast(`Kit ready — ${res.slides} carousel slides, ${res.captionCount} caption set${res.captionCount === 1 ? '' : 's'} + graphics`, 'success')
    } catch (e) {
      toast('Could not build the kit: ' + e.message, 'danger')
    } finally {
      setKitBusy(false)
    }
  }

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
      <BackButton to="/" label="Listings" />

      {/* Summary header */}
      <header className="summary card">
        {(() => {
          const photos = listingPhotos(listing)
          return (
            <div
              className={`summary-photos${photos.length === 1 ? ' single' : ''}`}
              style={{ gridTemplateColumns: `repeat(${Math.min(photos.length, 4)}, 1fr)` }}
            >
              {photos.slice(0, 4).map((src, i) => <img key={i} src={src} alt="" />)}
            </div>
          )
        })()}
        <div className="summary-body">
          <div className="summary-top">
            <div>
              <div className="row wrap" style={{ gap: 8, marginBottom: 6, alignItems: 'center' }}>
                <span className="badge badge-neutral">{listing.listingType === 'rental' ? 'Rental' : 'Sale'}</span>
                {rule.flagged && <span className="badge badge-flag">Flagged</span>}
                {listing.example && <span className="badge badge-example">Example</span>}
                {demo && <span className="badge badge-demo">Sample copy</span>}
                <label className="status-pick">
                  <span>Status</span>
                  <select value={listing.marketStatus || 'available'} onChange={(e) => patch((l) => ({ ...l, marketStatus: e.target.value }))}>
                    {MARKET_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </label>
                {isHighlightStatus(listing) && <span className="muted" style={{ fontSize: 12 }}>graphic updated ✓</span>}
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
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          {hasContent && !showSchedule && (
            <>
              <button className="btn btn-primary btn-sm" onClick={() => doPost()} disabled={posting}>{posting ? 'Auto-posting…' : 'Auto-post'}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowSchedule(true)} title="Schedule for later" aria-label="Schedule for later">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
              </button>
            </>
          )}
          {hasContent && showSchedule && (
            <>
              <input type="datetime-local" className="schedule-input" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
              <button className="btn btn-primary btn-sm" onClick={() => scheduleAt && doPost(new Date(scheduleAt).toISOString())} disabled={posting || !scheduleAt}>{posting ? 'Scheduling…' : 'Schedule'}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowSchedule(false); setScheduleAt('') }}>Cancel</button>
            </>
          )}
          {hasContent && <button className="btn btn-ghost btn-sm" onClick={approveAll} disabled={stats.approved === stats.total}>Approve all</button>}
          <button className="btn btn-subtle btn-sm" onClick={() => runGenerate()} disabled={generating}>
            {generating ? 'Generating…' : hasContent ? 'Regenerate' : 'Generate'}
          </button>
        </div>
      </div>

      {/* Photos */}
      <section className="card block" style={{ padding: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
          <div>
            <h2 className="block-title">Photos</h2>
            <p className="muted block-sub" style={{ margin: '3px 0 0' }}>Dump all the WhatsApp photos — first one is the cover.</p>
          </div>
          {(listing.photos?.length || 0) > 1 && (
            <button className="btn btn-subtle btn-sm" onClick={autoPickCover} disabled={coverBusy}>{coverBusy ? 'Picking…' : '✨ Auto-pick cover'}</button>
          )}
        </div>
        <MediaUploader
          photos={listing.photos || []} videos={[]}
          onChangePhotos={(p) => patch((l) => ({ ...l, photos: p }))}
          onChangeVideos={() => {}}
        />
      </section>

      {/* Post assets */}
      <section className="card assets">
        <div className="assets-head">
          <div>
            <h2 className="block-title">Post assets</h2>
            <p className="muted block-sub">Branded, ready to post.{!settings.brand?.agency && !settings.brand?.name && <> Add your logo in <Link to="/settings">Settings</Link>.</>}</p>
          </div>
          <button className="btn btn-primary btn-sm kit-btn" onClick={handleDownloadKit} disabled={kitBusy}>
            {kitBusy ? 'Building…' : (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" /></svg>
                Download whole kit
              </>
            )}
          </button>
        </div>
        <div className="assets-grid">
          <div className="asset">
            <div className="asset-label">Graphic</div>
            <PropertyGraphic listing={listing} brand={settings.brand} format={graphicFormat}>
              <div className="seg graphics-seg" role="group" aria-label="Graphic format">
                {GRAPHIC_FORMATS.map((f) => (
                  <button key={f.id} className={`seg-btn ${graphicFormat === f.id ? 'on' : ''}`} onClick={() => setGraphicFormat(f.id)} title={f.sub}>{f.name}</button>
                ))}
              </div>
            </PropertyGraphic>
          </div>
          <div className="asset">
            <div className="asset-label">Carousel</div>
            <PropertyCarousel listing={listing} brand={settings.brand} />
          </div>
          <div className="asset">
            <div className="asset-label">Reel video</div>
            <PropertyVideo listing={listing} brand={settings.brand} onVideo={(v) => patch((l) => ({ ...l, videos: [v] }))} />
          </div>
        </div>
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

      {queue && (() => {
        const pid = queue.platforms[queue.index]
        const platform = PLATFORM_MAP[pid]
        if (!platform) return null
        const langMap = listing.content?.[pid] || {}
        const lng = langMap[queue.lang] ? queue.lang : Object.keys(langMap)[0]
        return (
          <PublishSheet
            platform={platform}
            listing={listing}
            lang={lng}
            text={langMap[lng] || ''}
            photos={listingPhotos(listing)}
            videos={listing.videos || []}
            onClose={() => setQueue(null)}
            onPublished={() => markPublished(pid, lng)}
            toast={toast}
            queue={{ current: queue.index + 1, total: queue.platforms.length, onNext: advanceQueue }}
          />
        )
      })()}

      <style>{`
        .detail { display: flex; flex-direction: column; gap: 14px; }
        .status-pick { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--ink-500); }
        .status-pick select { font: inherit; color: var(--ink-900); background: var(--surface-sunk); border: 1px solid var(--line-strong); border-radius: 999px; padding: 4px 10px; cursor: pointer; -webkit-appearance: none; appearance: none; }
        .schedule-input { font: inherit; font-size: 13px; color: var(--ink-900); background: var(--surface); border: 1px solid var(--line-strong); border-radius: 8px; padding: 5px 8px; }

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

        .assets { padding: 20px; }
        .block-title { font-size: 16px; }
        .block-sub { font-size: 12.5px; margin: 4px 0 0; }
        .assets-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; flex-wrap: wrap; }
        .kit-btn { flex: none; }
        .assets-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 24px; margin-top: 20px; }
        .asset { display: flex; flex-direction: column; align-items: center; }
        .asset-label { align-self: flex-start; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-500); margin-bottom: 10px; }
        .graphics-seg { display: inline-flex; gap: 4px; background: var(--surface-sunk); padding: 4px; border-radius: var(--r-md); margin: 2px 0; }
        .seg-btn { border: none; background: transparent; padding: 8px 14px; border-radius: var(--r-sm); font-size: 12.5px; font-weight: 700; color: var(--ink-500); cursor: pointer; transition: all 0.15s var(--ease); }
        .seg-btn.on { background: var(--green-700); color: #fff; }
        @media (prefers-color-scheme: dark) { .seg-btn.on { background: var(--green-500); color: #0f2e21; } }

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
