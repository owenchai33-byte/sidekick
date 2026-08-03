import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { generateContentPlan } from '../lib/ai.js'
import ContentPostCard from '../components/ContentPostCard.jsx'

// "Max"-style AI content planner: a month of non-listing posts (tips, area
// spotlights, festive, engagement) in native EN / 中文 / BM, so an agent's feed
// stays active between listings. Generated via the same AI proxy (Gemini free
// tier, or the labelled demo fallback). Persists per-browser in localStorage.

const CATS = {
  market_tip: { label: 'Market tip', color: '#1b7f4d' },
  buyer_tip: { label: 'Buyer tip', color: '#1d4ed8' },
  seller_tip: { label: 'Seller tip', color: '#7c3aed' },
  area_spotlight: { label: 'Area spotlight', color: '#c2410c' },
  festive: { label: 'Festive', color: '#b42318' },
  engagement: { label: 'Engagement', color: '#0891b2' },
  credibility: { label: 'Credibility', color: '#b45309' },
}
const LANGS = [{ id: 'en', label: 'EN' }, { id: 'zh', label: '中文' }, { id: 'ms', label: 'BM' }]
const KEY = 'sidekick.plan.v1'

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || [] } catch { return [] } }

export default function ContentPlanPage() {
  const { settings, toast } = useApp()
  const [plan, setPlan] = useState(load)
  const [busy, setBusy] = useState(false)
  const [lang, setLang] = useState('en')

  function save(next) {
    setPlan(next)
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }

  async function generate() {
    setBusy(true)
    try {
      const r = await generateContentPlan(settings.brand, 6, ['en', 'zh', 'ms'])
      const posts = (r.posts || []).map((p, i) => ({ ...p, id: `p${i}-${plan.length + i}`, approved: false }))
      if (!posts.length) throw new Error('No posts returned')
      save(posts)
      toast(r.demo ? 'Sample plan generated (add an AI key for live copy)' : 'Content plan generated 🎉', r.demo ? 'warn' : 'success')
    } catch (e) { toast('Couldn’t generate: ' + e.message, 'danger') }
    finally { setBusy(false) }
  }

  const toggle = (id) => save(plan.map((p) => (p.id === id ? { ...p, approved: !p.approved } : p)))
  const remove = (id) => save(plan.filter((p) => p.id !== id))
  const approved = plan.filter((p) => p.approved).length

  return (
    <div className="container plan">
      <header className="plan-head">
        <div>
          <h1 className="page-title">Content plan</h1>
          <p className="muted">AI-planned posts to keep your feed alive between listings — native EN / 中文 / BM. Review, approve, then Auto-post from each.</p>
          {plan.length > 0 && <div className="plan-count">{approved}/{plan.length} approved</div>}
        </div>
        <button className="btn btn-primary btn-sm" onClick={generate} disabled={busy}>
          {busy ? 'Planning…' : plan.length ? 'Regenerate' : "Generate this month's content"}
        </button>
      </header>

      {plan.length > 0 && (
        <div className="seg plan-langs" role="group" aria-label="Language">
          {LANGS.map((l) => (
            <button key={l.id} className={`seg-btn ${lang === l.id ? 'on' : ''}`} onClick={() => setLang(l.id)}>{l.label}</button>
          ))}
        </div>
      )}

      {plan.length === 0 && !busy && (
        <div className="plan-empty">
          <p className="muted">No plan yet. Generate a month of ready-to-post content in one tap.</p>
        </div>
      )}

      <div className="plan-grid">
        {plan.map((p) => {
          const cat = CATS[p.category] || { label: p.category, color: 'var(--ink-500)' }
          return (
            <ContentPostCard
              key={p.id} post={p} lang={lang} brand={settings.brand}
              catLabel={cat.label} catColor={cat.color}
              onToggle={() => toggle(p.id)} onRemove={() => remove(p.id)} toast={toast}
            />
          )
        })}
      </div>

      <style>{`
        .plan { max-width: 720px; }
        .plan-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 16px; }
        .page-title { font-size: 24px; font-weight: 800; margin: 0 0 6px; }
        .plan-count { margin-top: 10px; display: inline-block; font-size: 13px; font-weight: 700; color: var(--green-700); background: var(--green-100); padding: 4px 12px; border-radius: 999px; }
        @media (prefers-color-scheme: dark) { .plan-count { color: var(--green-400); } }
        .plan-langs { margin-bottom: 16px; }
        .plan-empty { text-align: center; padding: 40px 20px; }
        .plan-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
        @media (min-width: 640px) { .plan-grid { grid-template-columns: 1fr 1fr; } }
        .plan-card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 10px; transition: border-color .15s; }
        .plan-card.on { border-color: var(--green-400); }
        .plan-card-top { display: flex; align-items: center; justify-content: space-between; }
        .plan-cat { color: #fff; font-size: 11px; font-weight: 700; letter-spacing: .02em; padding: 3px 10px; border-radius: 999px; }
        .plan-x { border: none; background: transparent; color: var(--ink-400); font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px; }
        .plan-x:hover { color: var(--danger-600, #d92d20); }
        .plan-canvas { width: 100%; aspect-ratio: 1; border-radius: 10px; display: block; background: var(--surface-sunk); }
        .plan-caption { font-size: 13px; color: var(--ink-600); white-space: pre-wrap; margin: 0; flex: 1; }
        .plan-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .plan-approve { margin-right: auto; }
      `}</style>
    </div>
  )
}
