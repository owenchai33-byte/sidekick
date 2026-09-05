import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import { parseListing, generateContent, pickCover } from '../lib/ai.js'
import { renderGraphicCanvas, loadImage, thumbBase64 } from '../lib/graphics.js'
import { uploadMedia } from '../lib/upload.js'
import { captionFor } from '../lib/social.js'
import { tenantFields, tenantQuery } from '../lib/tenant.js'
import MediaUploader from '../components/MediaUploader.jsx'
import PostPreview from '../components/PostPreview.jsx'
import { PLATFORM_MAP } from '../../shared/constants.js'

// One guided flow, start → finish: Listing → Photos → Write → Post. Wraps the
// same engine as the tabs (parse, generate, auto-post) so nobody has to hop
// between screens. The bottom tabs stay for power users.
const STEPS = ['Listing', 'Photos', 'Write', 'Post']

export default function CreatePostPage() {
  const { settings, saveListing, newId, listings, toast } = useApp()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [id, setId] = useState(null)
  const listing = listings.find((l) => l.id === id)

  // Step 1 — listing intake
  const [raw, setRaw] = useState('')
  const [parsed, setParsed] = useState({})
  const [type, setType] = useState('sale')
  const [price, setPrice] = useState('')
  const [loc, setLoc] = useState('')
  const [beds, setBeds] = useState('')
  const [baths, setBaths] = useState('')
  const [parsing, setParsing] = useState(false)

  const [busy, setBusy] = useState(false)
  const [coverBusy, setCoverBusy] = useState(false)
  const [accounts, setAccounts] = useState(null)

  const patch = (updater) => listing && saveListing(updater(listing))

  async function parse() {
    if (!raw.trim()) return
    setParsing(true)
    try {
      const { fields } = await parseListing(raw)
      setParsed(fields)
      if (fields.listingType) setType(fields.listingType)
      if (fields.price != null) setPrice(String(fields.price))
      if (fields.location) setLoc(fields.location)
      if (fields.bedrooms != null) setBeds(String(fields.bedrooms))
      if (fields.bathrooms != null) setBaths(String(fields.bathrooms))
      toast('Read the listing ✓', 'success')
    } catch (e) { toast('Couldn’t read that: ' + e.message, 'danger') }
    finally { setParsing(false) }
  }

  async function toPhotos() {
    if (!price) return toast('Add a price to continue', 'warn')
    const l = {
      id: newId(), agentId: settings.agent?.id,
      listingType: type, price: Number(price),
      location: loc || null, bedrooms: beds ? Number(beds) : null, bathrooms: baths ? Number(baths) : null,
      propertyType: parsed.propertyType || null, sqft: parsed.sqft ?? null, tenure: parsed.tenure || null, furnishing: parsed.furnishing || null,
      title: parsed.title || null, photos: [], videos: [],
      platforms: settings.defaultPlatforms, languages: settings.defaultLanguages,
      content: {}, approvals: {}, published: {}, status: 'draft',
    }
    const saved = await saveListing(l)
    setId(saved.id)
    setStep(1)
  }

  async function autoPickCover() {
    const photos = listing?.photos || []
    if (photos.length < 2) return
    setCoverBusy(true)
    try {
      const images = []
      for (const src of photos.slice(0, 8)) {
        const data = await thumbBase64(src)
        if (data) images.push({ mimeType: 'image/jpeg', data })
      }
      const r = await pickCover(images)
      if (r.demo) return toast('Auto-pick runs live on the deployed app', 'warn')
      const i = r.index || 0
      if (i > 0) { patch((l) => ({ ...l, photos: [photos[i], ...photos.filter((_, idx) => idx !== i)] })); toast('Best cover moved to front ✨', 'success') }
      else toast('First photo is already best ✓', 'success')
    } catch (e) { toast('Auto-pick failed: ' + e.message, 'danger') }
    finally { setCoverBusy(false) }
  }

  async function generate() {
    setBusy(true)
    try {
      const r = await generateContent(listing, listing.platforms, listing.languages)
      await saveListing({ ...listing, content: r.content, status: 'optimised' })
      toast(r.demo ? 'Sample copy generated (live copy on the deploy)' : 'Posts written ✓', r.demo ? 'warn' : 'success')
    } catch (e) { toast('Generate failed: ' + e.message, 'danger') }
    finally { setBusy(false) }
  }

  // On the Post step, check which accounts the agent has connected.
  useEffect(() => {
    if (step !== 3) return
    // Name the agent. Without a profile this asked for "the default account
    // list", which in production is nobody's — so it has been rendering zero
    // connected accounts since the switch to PostPeer — and would have been one
    // shared tenant's the moment a default was configured.
    const q = tenantQuery()
    fetch('/api/social-accounts' + (q ? `?${q}` : '')).then((r) => r.json()).then((j) => setAccounts(j.accounts || [])).catch(() => setAccounts([]))
  }, [step])

  async function autopost() {
    setBusy(true)
    try {
      const caption = captionFor(listing, 'facebook_page')
      if (!caption) throw new Error('Write the posts first (step 3)')
      const [photo, logo] = await Promise.all([loadImage((listing.photos || [])[0]), loadImage(settings.brand?.logo)])
      const canvas = renderGraphicCanvas({ listing, brand: settings.brand, format: 'square', photo, logo })
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92))
      const mediaUrl = await uploadMedia(blob, `${listing.id}-graphic.jpg`)
      const res = await fetch('/api/social-broadcast', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caption, mediaUrl, mediaType: 'image', ...tenantFields() }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Post failed')
      toast(`Posted to ${(j.posted || []).join(', ')} 🎉`, 'success')
      setStep(4)
    } catch (e) { toast('Post failed: ' + e.message, 'danger') }
    finally { setBusy(false) }
  }

  const caption = listing ? captionFor(listing, 'facebook_page') : ''
  const hasContent = !!(listing && Object.keys(listing.content || {}).length)

  return (
    <div className="container flow">
      <div className="flow-steps">
        {STEPS.map((s, i) => (
          <div key={s} className={`flow-step ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`}>
            <span className="flow-dot">{i < step || step === 4 ? '✓' : i + 1}</span>
            <span className="flow-label">{s}</span>
          </div>
        ))}
      </div>

      <div className="card flow-body">
        {step === 0 && (
          <>
            <h2 className="flow-title">Add the listing</h2>
            <p className="muted">Paste a forwarded WhatsApp listing — SideKick reads the details for you.</p>
            <textarea className="textarea" rows={5} placeholder="Paste the listing here…" value={raw} onChange={(e) => setRaw(e.target.value)} />
            <div className="row" style={{ gap: 10, margin: '10px 0 4px' }}>
              <button className="btn btn-subtle btn-sm" onClick={parse} disabled={!raw.trim() || parsing}>{parsing ? 'Reading…' : 'Read it with AI'}</button>
            </div>
            <div className="grid2" style={{ marginTop: 8 }}>
              <label className="field"><span>Type</span>
                <select className="select" value={type} onChange={(e) => setType(e.target.value)}><option value="sale">Sale</option><option value="rental">Rental</option></select>
              </label>
              <label className="field"><span>Price (RM){type === 'rental' ? '/mo' : ''}</span>
                <input className="input num" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ''))} placeholder={type === 'rental' ? '2500' : '680000'} />
              </label>
              <label className="field"><span>Location</span><input className="input" value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="e.g. Batu Kawa" /></label>
              <label className="field"><span>Beds / Baths</span>
                <div className="row" style={{ gap: 8 }}>
                  <input className="input num" inputMode="numeric" value={beds} onChange={(e) => setBeds(e.target.value.replace(/[^\d]/g, ''))} placeholder="Beds" />
                  <input className="input num" inputMode="numeric" value={baths} onChange={(e) => setBaths(e.target.value.replace(/[^\d]/g, ''))} placeholder="Baths" />
                </div>
              </label>
            </div>
          </>
        )}

        {step === 1 && listing && (
          <>
            <h2 className="flow-title">Add photos</h2>
            <p className="muted">Dump all the WhatsApp photos — the first is the cover. (You can skip and add later.)</p>
            <MediaUploader photos={listing.photos || []} videos={[]} onChangePhotos={(p) => patch((l) => ({ ...l, photos: p }))} onChangeVideos={() => {}} />
            {(listing.photos?.length || 0) > 1 && <button className="btn btn-subtle btn-sm" style={{ marginTop: 12 }} onClick={autoPickCover} disabled={coverBusy}>{coverBusy ? 'Picking…' : '✨ Auto-pick best cover'}</button>}
          </>
        )}

        {step === 2 && listing && (
          <>
            <h2 className="flow-title">Write the posts</h2>
            <p className="muted">One tap writes native EN / 中文 / BM copy for every platform.</p>
            {!hasContent ? (
              <button className="btn btn-primary" onClick={generate} disabled={busy}>{busy ? 'Writing…' : 'Generate posts'}</button>
            ) : (
              <>
                <div className="flow-preview"><PostPreview platform={PLATFORM_MAP.facebook_page} listing={listing} text={caption} /></div>
                <button className="btn btn-subtle btn-sm" style={{ marginTop: 10 }} onClick={generate} disabled={busy}>{busy ? 'Writing…' : 'Regenerate'}</button>
              </>
            )}
          </>
        )}

        {step === 3 && listing && (
          <>
            <h2 className="flow-title">Post it</h2>
            {accounts === null ? <p className="muted">Checking your connected accounts…</p> : accounts.length === 0 ? (
              <p className="muted">No social accounts connected yet. Connect them once in the <a href="#/connect">Connect</a> tab, then come back.</p>
            ) : (
              <p className="muted">Posting to: <strong>{accounts.map((a) => a.platform).join(', ')}</strong>. It goes out as a branded graphic + your caption.</p>
            )}
            <button className="btn btn-primary" onClick={autopost} disabled={busy || !accounts?.length || !hasContent} style={{ marginTop: 8 }}>{busy ? 'Posting…' : 'Auto-post now'}</button>
          </>
        )}

        {step === 4 && (
          <div className="flow-done">
            <div className="flow-check">🎉</div>
            <h2 className="flow-title">Posted!</h2>
            <p className="muted">It’s live on your connected accounts.</p>
            <div className="row" style={{ gap: 10, justifyContent: 'center', marginTop: 8 }}>
              <button className="btn btn-primary" onClick={() => { setStep(0); setId(null); setRaw(''); setParsed({}); setPrice(''); setLoc(''); setBeds(''); setBaths('') }}>New post</button>
              {id && <button className="btn btn-subtle" onClick={() => navigate(`/listing/${id}`)}>Open listing</button>}
            </div>
          </div>
        )}
      </div>

      {step < 4 && (
        <div className="flow-nav">
          <button className="btn btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>Back</button>
          {step === 0 && <button className="btn btn-primary" onClick={toPhotos} disabled={!price}>Continue →</button>}
          {step === 1 && <button className="btn btn-primary" onClick={() => setStep(2)}>Continue →</button>}
          {step === 2 && <button className="btn btn-primary" onClick={() => setStep(3)} disabled={!hasContent}>Continue →</button>}
        </div>
      )}

      <style>{`
        .flow { max-width: 640px; display: flex; flex-direction: column; gap: 16px; }
        .flow-steps { display: flex; gap: 6px; }
        .flow-step { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px; opacity: .5; }
        .flow-step.on, .flow-step.done { opacity: 1; }
        .flow-dot { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; font-size: 14px; background: var(--surface-sunk); color: var(--ink-500); border: 2px solid var(--line); }
        .flow-step.on .flow-dot { background: var(--green-600); color: #fff; border-color: var(--green-600); }
        .flow-step.done .flow-dot { background: var(--green-100); color: var(--green-700); border-color: var(--green-400); }
        .flow-label { font-size: 12px; font-weight: 700; color: var(--ink-500); }
        .flow-step.on .flow-label { color: var(--ink-900); }
        .flow-body { padding: 20px; }
        .flow-title { font-size: 20px; font-weight: 800; margin: 0 0 6px; }
        .flow-preview { margin-top: 12px; }
        .field { display: flex; flex-direction: column; gap: 5px; font-size: 13px; font-weight: 600; color: var(--ink-600); }
        .flow-nav { display: flex; justify-content: space-between; }
        .flow-done { text-align: center; padding: 24px 8px; }
        .flow-check { font-size: 44px; }
      `}</style>
    </div>
  )
}
