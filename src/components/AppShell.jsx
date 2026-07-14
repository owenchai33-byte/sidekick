import { NavLink, useLocation } from 'react-router-dom'
import Toasts from './Toasts.jsx'

function Logo() {
  return <span className="brand" role="img" aria-label="SideKick" />
}

const NAV = [
  { to: '/', label: 'Listings', icon: 'M4 10.5 12 4l8 6.5M6 9.5V20h12V9.5', end: true },
  { to: '/pipeline', label: 'Dashboard', icon: 'M3 3v18h18M7 15l3-3 3 2 4-5' },
  { to: '/settings', label: 'Settings', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM12 3v2M12 19v2M5 5l1.5 1.5M17.5 17.5 19 19M3 12h2M19 12h2M5 19l1.5-1.5M17.5 6.5 19 5' },
]

function NavIcon({ d }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export default function AppShell({ children }) {
  const loc = useLocation()
  return (
    <div className="shell">
      <header className="topbar">
        <div className="container topbar-inner">
          <NavLink to="/" className="brand-link"><Logo /></NavLink>
          <nav className="topnav" aria-label="Primary">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className="topnav-link">
                <NavIcon d={n.icon} />
                <span>{n.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="content" key={loc.pathname}>
        {children}
      </main>

      <nav className="bottomnav" aria-label="Primary mobile">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="bottomnav-link">
            <NavIcon d={n.icon} />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>

      <Toasts />

      <style>{`
        .shell { min-height: 100%; display: flex; flex-direction: column; }
        .brand { display: block; width: 138px; height: 28px; background: var(--ink-900);
          -webkit-mask: url(logo.png) left center / contain no-repeat; mask: url(logo.png) left center / contain no-repeat; }
        .brand-link { text-decoration: none; display: inline-flex; align-items: center; -webkit-tap-highlight-color: transparent; }

        .topbar { position: sticky; top: 0; z-index: 40; background: color-mix(in srgb, var(--paper) 86%, transparent);
          backdrop-filter: saturate(1.4) blur(10px); border-bottom: 1px solid var(--line);
          padding-top: env(safe-area-inset-top); }
        .topbar-inner { height: var(--nav-h); display: flex; align-items: center; justify-content: space-between; }
        .topnav { display: none; gap: 4px; }
        .topnav-link { display: inline-flex; align-items: center; gap: 7px; padding: 8px 14px; border-radius: 999px;
          font-size: 14px; font-weight: 600; color: var(--ink-500); text-decoration: none; transition: all 0.15s var(--ease); }
        .topnav-link:hover { color: var(--ink-900); background: var(--surface-sunk); }
        .topnav-link.active { color: var(--green-700); background: var(--green-100); }
        @media (prefers-color-scheme: dark) { .topnav-link.active { color: var(--green-400); } }

        .content { flex: 1; padding: 28px 0 calc(var(--nav-h) + env(safe-area-inset-bottom) + 24px); }

        .bottomnav { position: fixed; bottom: 0; left: 0; right: 0; z-index: 40;
          height: calc(var(--nav-h) + env(safe-area-inset-bottom));
          display: flex; background: var(--surface); border-top: 1px solid var(--line);
          padding-bottom: env(safe-area-inset-bottom); }
        .bottomnav-link { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
          font-size: 11px; font-weight: 600; color: var(--ink-400); text-decoration: none; transition: color 0.15s; }
        .bottomnav-link.active { color: var(--green-600); }
        @media (prefers-color-scheme: dark) { .bottomnav-link.active { color: var(--green-400); } }

        @media (min-width: 720px) {
          .topnav { display: flex; }
          .bottomnav { display: none; }
          .content { padding-bottom: 40px; }
        }
      `}</style>
    </div>
  )
}
