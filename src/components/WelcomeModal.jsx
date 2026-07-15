// First-run welcome / "how it works" — so someone opening SideKick cold (e.g.
// a prospect in a pitch) instantly understands the product, the flow and why
// it's safe. Shown once on first load; re-openable from the top-bar "?" button.

const STEPS = [
  { n: '1', k: 'PICK', d: 'Choose a listing worth promoting. You decide what gets the push — never the AI.' },
  { n: '2', k: 'OPTIMISE', d: 'SideKick writes native copy for every platform in EN / 中文 / BM, and builds the graphics, carousel and reel.' },
  { n: '3', k: 'APPROVE', d: 'Review every word. Edit anything. Nothing moves without your yes.' },
  { n: '4', k: 'PUBLISH', d: 'One tap copies the caption and opens the compose page. You post it — so the account stays safe.' },
]

const TRUST = [
  { t: 'Written natively, not translated', d: 'Each language reads like a local wrote it — not a machine.' },
  { t: 'A complete content kit per listing', d: 'Captions, branded graphics, a carousel and a reel — download it all in one tap.' },
  { t: 'Never auto-posts', d: 'SideKick prepares; you publish. That’s what keeps Marketplace & Mudah accounts safe.' },
]

export default function WelcomeModal({ open, onClose }) {
  if (!open) return null
  return (
    <div className="wm-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Welcome to SideKick">
      <div className="wm-panel" onClick={(e) => e.stopPropagation()}>
        <button className="wm-close" onClick={onClose} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>

        <div className="wm-head">
          <span className="wm-logo" role="img" aria-label="SideKick" />
          <h2>Your listings, ready to post</h2>
          <p className="wm-tag">In three languages, with nothing left to design — and you approve every word.</p>
        </div>

        <div className="wm-steps">
          {STEPS.map((s) => (
            <div className="wm-step" key={s.n}>
              <span className="wm-step-n">{s.n}</span>
              <div>
                <div className="wm-step-k">{s.k}</div>
                <div className="wm-step-d">{s.d}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="wm-trust">
          {TRUST.map((t) => (
            <div className="wm-trust-row" key={t.t}>
              <svg className="wm-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
              <div><strong>{t.t}</strong><span>{t.d}</span></div>
            </div>
          ))}
        </div>

        <button className="btn btn-primary wm-cta" onClick={onClose}>Explore the examples →</button>
        <p className="wm-foot">You’re looking at example listings. Reset or clear them anytime in <strong>Settings → Showcase data</strong>.</p>
      </div>

      <style>{`
        .wm-overlay { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center;
          padding: calc(16px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom));
          background: rgba(15,20,15,0.62); backdrop-filter: blur(6px); animation: wm-fade 0.2s var(--ease); overflow-y: auto; }
        .wm-panel { position: relative; width: 100%; max-width: 440px; background: var(--surface); border: 1px solid var(--line);
          border-radius: var(--r-xl); box-shadow: var(--shadow-lg); padding: 30px 24px 22px; margin: auto;
          animation: wm-rise 0.26s var(--ease); }
        .wm-close { position: absolute; top: 14px; right: 14px; width: 34px; height: 34px; border-radius: 50%; border: none;
          background: var(--surface-sunk); color: var(--ink-500); display: grid; place-items: center; cursor: pointer; -webkit-tap-highlight-color: transparent; }
        .wm-close:hover { color: var(--ink-900); }

        .wm-head { text-align: center; margin-bottom: 22px; }
        .wm-logo { display: block; width: 132px; height: 27px; margin: 0 auto 16px; background: var(--ink-900);
          -webkit-mask: url(logo.png) center/contain no-repeat; mask: url(logo.png) center/contain no-repeat; }
        .wm-head h2 { font-size: 23px; letter-spacing: -0.02em; }
        .wm-tag { color: var(--ink-500); font-size: 14px; margin-top: 8px; line-height: 1.5; }

        .wm-steps { display: flex; flex-direction: column; gap: 2px; margin-bottom: 20px; }
        .wm-step { display: flex; gap: 13px; padding: 11px; border-radius: var(--r-md); }
        .wm-step:nth-child(odd) { background: var(--surface-sunk); }
        .wm-step-n { flex: none; width: 26px; height: 26px; border-radius: 50%; background: var(--green-700); color: #fff;
          font-size: 13px; font-weight: 800; display: grid; place-items: center; margin-top: 1px; }
        @media (prefers-color-scheme: dark) { .wm-step-n { background: var(--green-500); color: #0f2e21; } }
        .wm-step-k { font-size: 12px; font-weight: 800; letter-spacing: 0.06em; color: var(--green-700); }
        @media (prefers-color-scheme: dark) { .wm-step-k { color: var(--green-400); } }
        .wm-step-d { font-size: 13px; color: var(--ink-700); line-height: 1.45; margin-top: 2px; }

        .wm-trust { display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: var(--r-lg);
          background: var(--green-100); margin-bottom: 22px; }
        .wm-trust-row { display: flex; gap: 10px; align-items: flex-start; }
        .wm-check { flex: none; color: var(--green-600); margin-top: 1px; }
        @media (prefers-color-scheme: dark) { .wm-check { color: var(--green-400); } }
        .wm-trust-row strong { display: block; font-size: 13.5px; color: var(--ink-900); }
        .wm-trust-row span { display: block; font-size: 12.5px; color: var(--ink-500); line-height: 1.45; margin-top: 1px; }

        .wm-cta { width: 100%; padding: 13px; font-size: 15px; }
        .wm-foot { text-align: center; font-size: 11.5px; color: var(--ink-400); margin-top: 14px; line-height: 1.5; }

        @keyframes wm-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes wm-rise { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  )
}
