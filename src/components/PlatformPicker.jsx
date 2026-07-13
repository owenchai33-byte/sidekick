import { PLATFORMS } from '../../shared/constants.js'

// Per-listing platform selection (§2). A rental might go to Marketplace + Mudah;
// a high-value sale to all six. The agent decides — never the system.
export default function PlatformPicker({ selected, onToggle, compact = false }) {
  return (
    <div className={`pp ${compact ? 'pp-compact' : ''}`}>
      {PLATFORMS.map((p) => {
        const on = selected.includes(p.id)
        return (
          <button
            key={p.id}
            type="button"
            className={`pp-item ${on ? 'on' : ''}`}
            aria-pressed={on}
            onClick={() => onToggle(p.id)}
          >
            <span className="pp-icon" aria-hidden="true">{p.icon}</span>
            <span className="pp-name">{compact ? p.short : p.name}</span>
            {on && (
              <svg className="pp-check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            )}
          </button>
        )
      })}
      <style>{`
        .pp { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
        @media (min-width: 560px) { .pp { grid-template-columns: 1fr 1fr 1fr; } }
        .pp-item { display: flex; align-items: center; gap: 9px; text-align: left;
          padding: 12px 13px; border-radius: var(--r-md); border: 1.5px solid var(--line-strong);
          background: var(--surface); color: var(--ink-700); font-size: 13.5px; font-weight: 600;
          cursor: pointer; transition: all 0.15s var(--ease); }
        .pp-item:hover { border-color: var(--green-500); }
        .pp-item.on { border-color: var(--green-600); background: var(--green-100); color: var(--green-800); }
        @media (prefers-color-scheme: dark) { .pp-item.on { color: var(--green-400); background: color-mix(in srgb, var(--green-700) 25%, transparent); } }
        .pp-icon { font-size: 17px; line-height: 1; }
        .pp-name { flex: 1; }
        .pp-check { color: var(--green-600); flex: none; }
        @media (prefers-color-scheme: dark) { .pp-check { color: var(--green-400); } }
        .pp-compact .pp-item { padding: 9px 11px; font-size: 12.5px; }
      `}</style>
    </div>
  )
}
