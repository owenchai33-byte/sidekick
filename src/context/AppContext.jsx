import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import * as store from '../lib/dataStore.js'

const AppContext = createContext(null)

export function AppProvider({ children }) {
  const [listings, setListings] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toasts, setToasts] = useState([])
  const toastId = useRef(0)

  useEffect(() => {
    let alive = true
    Promise.all([store.listListings(), store.getSettings()]).then(([ls, s]) => {
      if (!alive) return
      setListings(ls)
      setSettings(s)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  const toast = useCallback((message, kind = 'success') => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, message, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])

  const refresh = useCallback(async () => {
    setListings(await store.listListings())
  }, [])

  const saveListing = useCallback(async (listing) => {
    const saved = await store.upsertListing(listing)
    setListings(await store.listListings())
    return saved
  }, [])

  const removeListing = useCallback(async (id) => {
    await store.deleteListing(id)
    setListings(await store.listListings())
  }, [])

  const updateSettings = useCallback(async (next) => {
    const merged = { ...settings, ...next, rules: { ...settings.rules, ...(next.rules || {}) } }
    await store.saveSettings(merged)
    setSettings(merged)
    return merged
  }, [settings])

  const value = {
    listings, settings, loading, toasts, toast,
    refresh, saveListing, removeListing, updateSettings,
    newId: store.newId,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
