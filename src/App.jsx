import { Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './components/AppShell.jsx'
import { useApp } from './context/AppContext.jsx'
import FeedPage from './pages/FeedPage.jsx'
import ListingsPage from './pages/ListingsPage.jsx'
import NewListingPage from './pages/NewListingPage.jsx'
import ListingDetailPage from './pages/ListingDetailPage.jsx'
import PipelinePage from './pages/PipelinePage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import ConnectPage from './pages/ConnectPage.jsx'
import ContentPlanPage from './pages/ContentPlanPage.jsx'
import InboxPage from './pages/InboxPage.jsx'
import CreatePostPage from './pages/CreatePostPage.jsx'

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
          <Route path="/" element={<FeedPage />} />
          <Route path="/listings" element={<ListingsPage />} />
          <Route path="/new" element={<NewListingPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/create" element={<CreatePostPage />} />
          <Route path="/listing/:id" element={<ListingDetailPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/connect" element={<ConnectPage />} />
          <Route path="/content" element={<ContentPlanPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </AppShell>
  )
}
