import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { getStatus } from '../lib/ai.js'
import PlatformPicker from '../components/PlatformPicker.jsx'
import LanguagePicker from '../components/LanguagePicker.jsx'

export default function SettingsPage() {
  const { settings, updateSettings, toast, resetShowcase, clearAll } = useApp()
  const [saleT, setSaleT] = useState(String(settings.rules.saleThreshold))
  const [rentT, setRentT] = useState(String(settings.rules.rentalThreshold))
  const [brand, setBrand] = useState(settings.brand)
  const [status, setStatus] = useState(null)

  useEffect(() => {
    getStatus().then(setStatus).catch(() => setStatus({ error: true }))
  }, [])

  const setB = (k, v) => setBrand((b) => ({ ...b, [k]: v }))

  function uploadLogo(file) {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => setB('logo', reader.result)
    reader.readAsDataURL(file)
  }

  async function saveBrand() {
    await updateSettings({ brand })
    toast('Brand kit saved', 'success')
  }

  async function saveRules() {
    await updateSettings({ rules: { saleThreshold: Number(saleT) || 0, rentalThreshold: Number(rentT) || 0 } })
    toast('Thresholds saved', 'success')
  }

  function toggleDefault(kind, val) {
    const arr = settings[kind]
    const next = arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]
    updateSettings({ [kind]: next.length ? next : arr })
  }

  const live = status && !status.error && status.configured
  const provider = status?.provider === 'claude' ? 'Claude' : 'Gemini'

  return (
    <div className="container settings">
      <header className="page-head"><h1>Settings</h1></header>

      {/* Content engine */}
      <section className="card block">
        <h2 className="block-title">Content engine</h2>
        <div className={`engine ${live ? 'engine-live' : 'engine-demo'}`}>
          <span className="engine-dot" />
          <div>
            <div className="engine-state">{status == null ? 'Checking…' : live ? `Live — ${provider}` : 'Demo mode'}</div>
            <div className="muted engine-note">
              {live
                ? `Generating real copy with ${provider}.`
                : `No API key set — the app produces clearly-labelled sample copy so you can demo the full flow. Add a ${provider === 'Claude' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY'} to .env.local to go live.`}
            </div>
          </div>
        </div>
      </section>

      {/* Brand kit */}
      <section className="card block">
        <h2 className="block-title">Brand kit</h2>
        <p className="muted block-sub">Your logo, colour and contact are baked into every generated graphic and video.</p>
        <div className="brand-grid">
          <div className="brand-logo">
            <div className="brand-logo-preview" style={{ background: brand.color || '#2d6a4f' }}>
              {brand.logo ? <img src={brand.logo} alt="Logo" /> : <span>{(brand.agency || brand.name || 'SK').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>}
            </div>
            <label className="btn btn-ghost btn-sm brand-upload">
              {brand.logo ? 'Change logo' : 'Upload logo'}
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => { uploadLogo(e.target.files[0]); e.target.value = '' }} />
            </label>
            {brand.logo && <button className="btn btn-subtle btn-sm" onClick={() => setB('logo', null)}>Remove</button>}
          </div>
          <div className="brand-fields">
            <div className="grid2">
              <div className="field"><label htmlFor="b-agency">Agency / business</label><input id="b-agency" className="input" placeholder="e.g. TRR Realty" value={brand.agency} onChange={(e) => setB('agency', e.target.value)} /></div>
              <div className="field"><label htmlFor="b-name">Your name</label><input id="b-name" className="input" placeholder="e.g. Edward" value={brand.name} onChange={(e) => setB('name', e.target.value)} /></div>
              <div className="field"><label htmlFor="b-phone">WhatsApp number</label><input id="b-phone" className="input" placeholder="e.g. 012-345 6789" value={brand.phone} onChange={(e) => setB('phone', e.target.value)} /></div>
              <div className="field"><label htmlFor="b-color">Brand colour</label>
                <div className="brand-color"><input id="b-color" type="color" value={brand.color || '#2d6a4f'} onChange={(e) => setB('color', e.target.value)} /><span className="num">{brand.color}</span></div>
              </div>
            </div>
          </div>
        </div>
        <button className="btn btn-primary btn-sm" style={{ marginTop: 14 }} onClick={saveBrand}>Save brand kit</button>
        <style>{`
          .brand-grid { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
          .brand-logo { display: flex; flex-direction: column; align-items: center; gap: 8px; }
          .brand-logo-preview { width: 92px; height: 92px; border-radius: 20px; display: grid; place-items: center; overflow: hidden; color: #fff; font-size: 30px; font-weight: 800; flex: none; }
          .brand-logo-preview img { width: 100%; height: 100%; object-fit: cover; }
          .brand-upload { cursor: pointer; }
          .brand-fields { flex: 1; min-width: 240px; }
          .brand-color { display: flex; align-items: center; gap: 10px; }
          .brand-color input[type=color] { width: 46px; height: 42px; padding: 2px; border: 1px solid var(--line-strong); border-radius: var(--r-md); background: var(--surface); cursor: pointer; }
          .brand-color span { font-size: 13px; color: var(--ink-500); text-transform: uppercase; }
        `}</style>
      </section>

      {/* Rules */}
      <section className="card block">
        <h2 className="block-title">Rules-based filtering</h2>
        <p className="muted block-sub">Flags high-value listings as worth drafting. Flagging never publishes on its own.</p>
        <div className="grid2">
          <div className="field">
            <label htmlFor="saleT">Flag sales above (RM)</label>
            <input id="saleT" className="input num" inputMode="numeric" value={saleT} onChange={(e) => setSaleT(e.target.value.replace(/[^\d]/g, ''))} />
          </div>
          <div className="field">
            <label htmlFor="rentT">Flag rentals above (RM/month)</label>
            <input id="rentT" className="input num" inputMode="numeric" value={rentT} onChange={(e) => setRentT(e.target.value.replace(/[^\d]/g, ''))} />
          </div>
        </div>
        <button className="btn btn-primary btn-sm" style={{ marginTop: 14 }} onClick={saveRules}>Save thresholds</button>
      </section>

      {/* Defaults */}
      <section className="card block">
        <h2 className="block-title">Default platforms</h2>
        <p className="muted block-sub">Pre-selected on every new listing. You can still change them per listing.</p>
        <PlatformPicker selected={settings.defaultPlatforms} onToggle={(v) => toggleDefault('defaultPlatforms', v)} />
      </section>

      <section className="card block">
        <h2 className="block-title">Default languages</h2>
        <p className="muted block-sub">Each is generated natively — never machine-translated.</p>
        <LanguagePicker selected={settings.defaultLanguages} onToggle={(v) => toggleDefault('defaultLanguages', v)} />
      </section>

      <section className="card block">
        <h2 className="block-title">Showcase data</h2>
        <p className="muted block-sub">The app opens pre-loaded with example listings and a live pipeline so it demos as a finished system. Reset them anytime, or clear everything to start from scratch.</p>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn btn-subtle btn-sm" onClick={async () => { await resetShowcase(); toast('Showcase examples reset', 'success') }}>Reset examples</button>
          <button className="btn btn-ghost btn-sm danger-ghost" onClick={async () => { if (confirm('Clear all listings and leads? This starts the app empty.')) { await clearAll(); toast('All data cleared', 'success') } }}>Clear everything</button>
        </div>
      </section>

      <p className="muted foot-note">
        Signed-in as <strong>{settings.agent.name}</strong> ({settings.agent.role}). Multi-agent accounts, lead attribution and closed-deal logging arrive in Phase 2.
      </p>

      <style>{`.danger-ghost { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 35%, transparent); }
        .danger-ghost:hover { background: color-mix(in srgb, var(--danger) 10%, transparent); }`}</style>

      <style>{`
        .settings { display: flex; flex-direction: column; gap: 22px; }
        .page-head { padding-top: 4px; }
        .page-head h1 { font-size: 26px; letter-spacing: -0.02em; }
        .block { padding: 20px; }
        .block-title { font-size: 16px; letter-spacing: -0.01em; }
        .block-sub { font-size: 12.5px; margin: 4px 0 16px; max-width: 60ch; }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

        .engine { display: flex; gap: 11px; align-items: flex-start; padding: 13px; border-radius: var(--r-md); }
        .engine-live { background: var(--green-100); }
        .engine-demo { background: color-mix(in srgb, var(--timber-500) 12%, transparent); }
        .engine-dot { width: 10px; height: 10px; border-radius: 50%; margin-top: 4px; flex: none; }
        .engine-live .engine-dot { background: var(--green-500); box-shadow: 0 0 0 4px color-mix(in srgb, var(--green-500) 25%, transparent); }
        .engine-demo .engine-dot { background: var(--timber-500); }
        .engine-state { font-size: 14px; font-weight: 700; }
        .engine-note { font-size: 12.5px; margin-top: 2px; max-width: 60ch; }

        .foot-note { font-size: 12.5px; text-align: center; padding: 4px 0 12px; }
      `}</style>
    </div>
  )
}
