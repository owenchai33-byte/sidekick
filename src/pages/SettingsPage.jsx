import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { getStatus } from '../lib/ai.js'
import PlatformPicker from '../components/PlatformPicker.jsx'
import LanguagePicker from '../components/LanguagePicker.jsx'

export default function SettingsPage() {
  const { settings, updateSettings, toast } = useApp()
  const [saleT, setSaleT] = useState(String(settings.rules.saleThreshold))
  const [rentT, setRentT] = useState(String(settings.rules.rentalThreshold))
  const [status, setStatus] = useState(null)

  useEffect(() => {
    getStatus().then(setStatus).catch(() => setStatus({ error: true }))
  }, [])

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

      <p className="muted foot-note">
        Signed-in as <strong>{settings.agent.name}</strong> ({settings.agent.role}). Multi-agent accounts, lead attribution and closed-deal logging arrive in Phase 2.
      </p>

      <style>{`
        .settings { display: flex; flex-direction: column; gap: 16px; }
        .page-head h1 { font-size: 24px; }
        .block { padding: 16px; }
        .block-title { font-size: 15px; }
        .block-sub { font-size: 12.5px; margin: 3px 0 12px; }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; }

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
