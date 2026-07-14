import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import BackButton from '../components/BackButton.jsx'
import { parseListing } from '../lib/ai.js'
import { evaluateRules } from '../lib/rules.js'
import { PROPERTY_TYPES, KUCHING_AREAS } from '../../shared/constants.js'
import MediaUploader from '../components/MediaUploader.jsx'
import PlatformPicker from '../components/PlatformPicker.jsx'
import LanguagePicker from '../components/LanguagePicker.jsx'

const SAMPLE = `For Sale - Double storey terrace at Batu Kawa, Kuching. Freehold, 4 bed 3 bath, built up around 2000 sqft. Renovated, partially furnished. Asking RM680k nego. Near shops and school. Owner urgent sale.`

const EMPTY = {
  listingType: 'sale', price: '', location: '', bedrooms: '', bathrooms: '',
  propertyType: '', sqft: '', tenure: '', furnishing: '', title: '',
}

export default function NewListingPage() {
  const { settings, saveListing, newId, toast } = useApp()
  const navigate = useNavigate()

  const [mode, setMode] = useState('paste') // 'paste' | 'form'
  const [raw, setRaw] = useState('')
  const [parsing, setParsing] = useState(false)
  const [fields, setFields] = useState(EMPTY)
  const [photos, setPhotos] = useState([])
  const [videos, setVideos] = useState([])
  const [platforms, setPlatforms] = useState(settings.defaultPlatforms)
  const [languages, setLanguages] = useState(settings.defaultLanguages)
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setFields((f) => ({ ...f, [k]: v }))

  const listingForRules = useMemo(
    () => ({ listingType: fields.listingType, price: fields.price === '' ? null : Number(fields.price) }),
    [fields.listingType, fields.price],
  )
  const rule = evaluateRules(listingForRules, settings.rules)

  const canGenerate = fields.price !== '' && platforms.length > 0 && languages.length > 0

  async function handleParse() {
    if (!raw.trim()) return
    setParsing(true)
    try {
      const { fields: parsed, demo, degraded } = await parseListing(raw)
      setFields((f) => ({
        ...f,
        listingType: parsed.listingType || f.listingType,
        price: parsed.price ?? f.price,
        location: parsed.location ?? f.location,
        bedrooms: parsed.bedrooms ?? f.bedrooms,
        bathrooms: parsed.bathrooms ?? f.bathrooms,
        propertyType: parsed.propertyType ?? f.propertyType,
        sqft: parsed.sqft ?? f.sqft,
        tenure: parsed.tenure ?? f.tenure,
        furnishing: parsed.furnishing ?? f.furnishing,
        title: parsed.title ?? f.title,
      }))
      setMode('form')
      toast(demo ? (degraded ? 'AI busy — parsed with basic rules. Check fields.' : 'Parsed in demo mode — check the fields') : 'Parsed — review and correct anything', demo ? 'warn' : 'success')
    } catch (e) {
      toast('Parse failed: ' + e.message, 'danger')
    } finally {
      setParsing(false)
    }
  }

  async function handleGenerate() {
    if (!canGenerate) return
    setSaving(true)
    try {
      const listing = {
        id: newId(),
        agentId: settings.agent.id,
        listingType: fields.listingType,
        price: fields.price === '' ? null : Number(fields.price),
        location: fields.location.trim() || null,
        bedrooms: fields.bedrooms === '' ? null : Number(fields.bedrooms),
        bathrooms: fields.bathrooms === '' ? null : Number(fields.bathrooms),
        propertyType: fields.propertyType || null,
        sqft: fields.sqft === '' ? null : Number(fields.sqft),
        tenure: fields.tenure || null,
        furnishing: fields.furnishing || null,
        title: fields.title.trim() || null,
        photos,
        videos,
        platforms,
        languages,
        content: {},
        approvals: {},
        published: {},
        status: 'draft',
      }
      const saved = await saveListing(listing)
      navigate(`/listing/${saved.id}`, { state: { autoGenerate: true } })
    } catch (e) {
      toast('Could not save: ' + e.message, 'danger')
      setSaving(false)
    }
  }

  return (
    <div className="container newlisting">
      <BackButton to="/" label="Listings" />
      <header className="page-head">
        <h1>New listing</h1>
        <p className="muted">You pick what's worth promoting. SideKick does the copywriting.</p>
      </header>

      <div className="mode-toggle" role="tablist" aria-label="Input mode">
        <button role="tab" aria-selected={mode === 'paste'} className={`mode-btn ${mode === 'paste' ? 'on' : ''}`} onClick={() => setMode('paste')}>Paste text</button>
        <button role="tab" aria-selected={mode === 'form'} className={`mode-btn ${mode === 'form' ? 'on' : ''}`} onClick={() => setMode('form')}>Enter manually</button>
      </div>

      {mode === 'paste' ? (
        <section className="card block">
          <div className="field">
            <label htmlFor="raw">Paste the listing blob</label>
            <textarea
              id="raw"
              className="textarea"
              rows={8}
              placeholder="Paste from a WhatsApp group or listing sheet — SideKick pulls out the fields."
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
          </div>
          <div className="row wrap" style={{ gap: 10, marginTop: 12 }}>
            <button className="btn btn-primary" onClick={handleParse} disabled={!raw.trim() || parsing}>
              {parsing ? 'Parsing…' : 'Parse with AI'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setRaw(SAMPLE)} disabled={parsing}>Try a sample</button>
            <span className="muted" style={{ fontSize: 12.5 }}>You can correct every field before generating.</span>
          </div>
        </section>
      ) : null}

      {mode === 'form' && (
        <>
          <section className="card block">
            <div className="seg" role="group" aria-label="Listing type">
              {[{ id: 'sale', label: 'Sale' }, { id: 'rental', label: 'Rental' }].map((t) => (
                <button key={t.id} className={`seg-btn ${fields.listingType === t.id ? 'on' : ''}`} onClick={() => set('listingType', t.id)}>{t.label}</button>
              ))}
            </div>

            <div className="grid2">
              <div className="field">
                <label htmlFor="price">Price (RM){fields.listingType === 'rental' ? ' / month' : ''}</label>
                <input id="price" className="input num" inputMode="numeric" placeholder={fields.listingType === 'rental' ? '2000' : '680000'} value={fields.price} onChange={(e) => set('price', e.target.value.replace(/[^\d]/g, ''))} />
              </div>
              <div className="field">
                <label htmlFor="location">Location</label>
                <input id="location" className="input" list="areas" placeholder="e.g. Batu Kawa" value={fields.location} onChange={(e) => set('location', e.target.value)} />
                <datalist id="areas">{KUCHING_AREAS.map((a) => <option key={a} value={a} />)}</datalist>
              </div>
              <div className="field">
                <label htmlFor="beds">Bedrooms</label>
                <input id="beds" className="input num" inputMode="numeric" placeholder="4" value={fields.bedrooms} onChange={(e) => set('bedrooms', e.target.value.replace(/[^\d]/g, ''))} />
              </div>
              <div className="field">
                <label htmlFor="baths">Bathrooms</label>
                <input id="baths" className="input num" inputMode="numeric" placeholder="3" value={fields.bathrooms} onChange={(e) => set('bathrooms', e.target.value.replace(/[^\d]/g, ''))} />
              </div>
              <div className="field">
                <label htmlFor="ptype">Property type</label>
                <select id="ptype" className="select" value={fields.propertyType} onChange={(e) => set('propertyType', e.target.value)}>
                  <option value="">Select…</option>
                  {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="sqft">Built-up (sq ft) <span className="muted">optional</span></label>
                <input id="sqft" className="input num" inputMode="numeric" placeholder="2000" value={fields.sqft} onChange={(e) => set('sqft', e.target.value.replace(/[^\d]/g, ''))} />
              </div>
              <div className="field">
                <label htmlFor="tenure">Tenure <span className="muted">optional</span></label>
                <select id="tenure" className="select" value={fields.tenure} onChange={(e) => set('tenure', e.target.value)}>
                  <option value="">Select…</option>
                  <option value="Freehold">Freehold</option>
                  <option value="Leasehold">Leasehold</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="furn">Furnishing <span className="muted">optional</span></label>
                <select id="furn" className="select" value={fields.furnishing} onChange={(e) => set('furnishing', e.target.value)}>
                  <option value="">Select…</option>
                  <option value="Unfurnished">Unfurnished</option>
                  <option value="Partially Furnished">Partially Furnished</option>
                  <option value="Fully Furnished">Fully Furnished</option>
                </select>
              </div>
            </div>

            {rule.flagged && (
              <div className="rule-hint">
                <span className="badge badge-flag">Flagged</span>
                {rule.reason}
              </div>
            )}
          </section>

          <section className="card block">
            <h2 className="block-title">Photos & video</h2>
            <p className="muted block-sub">Carried through to every post. A video is used for the Reels/TikTok preview.</p>
            <MediaUploader photos={photos} videos={videos} onChangePhotos={setPhotos} onChangeVideos={setVideos} />
          </section>

          <section className="card block">
            <h2 className="block-title">Platforms</h2>
            <p className="muted block-sub">Choose where this listing goes. You decide per listing.</p>
            <PlatformPicker selected={platforms} onToggle={(id) => setPlatforms((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])} />
          </section>

          <section className="card block">
            <h2 className="block-title">Languages</h2>
            <p className="muted block-sub">Each language is written natively — not translated.</p>
            <LanguagePicker selected={languages} onToggle={(id) => setLanguages((l) => l.includes(id) ? l.filter((x) => x !== id) : [...l, id])} />
          </section>

          <div className="generate-bar">
            <div className="gen-meta">
              <strong className="num">{platforms.length * languages.length}</strong> posts · {platforms.length} platform{platforms.length !== 1 ? 's' : ''} × {languages.length} language{languages.length !== 1 ? 's' : ''}
            </div>
            <button className="btn btn-primary" onClick={handleGenerate} disabled={!canGenerate || saving}>
              {saving ? 'Saving…' : 'Generate posts'}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </div>
          {!canGenerate && <p className="muted gen-warn">Add a price and pick at least one platform and language to generate.</p>}
        </>
      )}

      <style>{`
        .newlisting { display: flex; flex-direction: column; gap: 16px; }
        .page-head h1 { font-size: 24px; }
        .page-head p { margin-top: 4px; font-size: 14px; }
        .block { padding: 16px; }
        .block-title { font-size: 15px; }
        .block-sub { font-size: 12.5px; margin: 3px 0 12px; }

        .mode-toggle { display: inline-flex; gap: 4px; background: var(--surface-sunk); padding: 4px; border-radius: var(--r-md); width: fit-content; }
        .mode-btn { border: none; background: transparent; padding: 9px 18px; border-radius: var(--r-sm); font-size: 13.5px; font-weight: 700; color: var(--ink-500); cursor: pointer; transition: all 0.15s; }
        .mode-btn.on { background: var(--surface); color: var(--green-700); box-shadow: var(--shadow-sm); }
        @media (prefers-color-scheme: dark) { .mode-btn.on { color: var(--green-400); } }

        .seg { display: inline-flex; gap: 4px; background: var(--surface-sunk); padding: 4px; border-radius: var(--r-md); margin-bottom: 16px; }
        .seg-btn { border: none; background: transparent; padding: 8px 22px; border-radius: var(--r-sm); font-size: 13.5px; font-weight: 700; color: var(--ink-500); cursor: pointer; }
        .seg-btn.on { background: var(--green-700); color: #fff; }
        @media (prefers-color-scheme: dark) { .seg-btn.on { background: var(--green-500); color: #0f2e21; } }

        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; }

        .rule-hint { display: flex; align-items: center; gap: 9px; margin-top: 14px; font-size: 13px; font-weight: 600; color: var(--timber-700); }
        @media (prefers-color-scheme: dark) { .rule-hint { color: var(--timber-300); } }

        .generate-bar { position: sticky; bottom: calc(var(--nav-h) + 12px); display: flex; align-items: center; justify-content: space-between; gap: 14px;
          background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--r-lg); padding: 12px 16px; box-shadow: var(--shadow-lg); }
        .gen-meta { font-size: 13px; color: var(--ink-700); }
        .gen-meta strong { font-size: 17px; color: var(--green-700); }
        @media (prefers-color-scheme: dark) { .gen-meta strong { color: var(--green-400); } }
        .gen-warn { font-size: 12.5px; text-align: right; }
        @media (min-width: 720px) { .generate-bar { bottom: 16px; } }
      `}</style>
    </div>
  )
}
