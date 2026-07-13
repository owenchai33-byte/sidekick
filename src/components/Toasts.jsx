import { useApp } from '../context/AppContext.jsx'

export default function Toasts() {
  const { toasts } = useApp()
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span className="toast-dot" aria-hidden="true" />
          {t.message}
        </div>
      ))}
      <style>{`
        .toasts { position: fixed; left: 0; right: 0; bottom: calc(var(--nav-h) + 16px); z-index: 60;
          display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; padding: 0 12px; }
        .toast { pointer-events: auto; display: flex; align-items: center; gap: 9px;
          background: var(--green-800); color: #fff; padding: 11px 16px; border-radius: 999px;
          font-size: 13.5px; font-weight: 600; box-shadow: var(--shadow-lg); max-width: 100%;
          animation: toast-in 0.22s var(--ease); }
        .toast-danger { background: var(--danger); }
        .toast-warn { background: var(--timber-700); }
        .toast-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green-400); flex: none; }
        .toast-danger .toast-dot { background: #ffd7cd; }
        @keyframes toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @media (min-width: 720px) { .toasts { bottom: 24px; } }
      `}</style>
    </div>
  )
}
