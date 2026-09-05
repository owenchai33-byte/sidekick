import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import { AppProvider } from './context/AppContext.jsx'
import { captureProfileFromUrl } from './lib/tenant.js'
import './styles/global.css'

// Remember which agent this device belongs to, BEFORE the first render.
//
// The per-agent link is `…/#/connect?profile=<id>`, and AppShell navigates with
// bare paths — so the query was lost on the first nav tap and every screen but
// two was tenant-blind. Captured once here, it survives navigation, refreshes
// and the return trip from the OAuth redirect, which is what lets the feed and
// the posting buttons ask for this agent's data instead of everybody's.
captureProfileFromUrl()
window.addEventListener('hashchange', captureProfileFromUrl)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProvider>
        <App />
      </AppProvider>
    </HashRouter>
  </React.StrictMode>,
)

// Register the service worker on the deployed build so the app is installable
// to the homescreen and works offline. Skipped in dev to keep HMR clean.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {})
  })
}
