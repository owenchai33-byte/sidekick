import { Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './components/AppShell.jsx'
import { useApp } from './context/AppContext.jsx'
import ListingsPage from './pages/ListingsPage.jsx'
import NewListingPage from './pages/NewListingPage.jsx'
import ListingDetailPage from './pages/ListingDetailPage.jsx'
import PipelinePage from './pages/PipelinePage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'

export default function App() {
  const { loading } = useApp()
  return (
    <AppShell>
      {loading ? (
        <div className="container" style={{ padding: '60px 16px', textAlign: 'center', color: 'var(--ink-500)' }}>
          Loading…
        </div>
      ) : (
        <Routes>
          <Route path="/" element={<ListingsPage />} />
          <Route path="/new" element={<NewListingPage />} />
          <Route path="/listing/:id" element={<ListingDetailPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </AppShell>
  )
}
