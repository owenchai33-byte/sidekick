import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import * as store from '../lib/dataStore.js'
import { buildShowcase } from '../lib/seed.js'

const AppContext = createContext(null)

export function AppProvider({ children }) {
  const [listings, setListings] = useState([])
  const [leads, setLeads] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toasts, setToasts] = useState([])
  const toastId = useRef(0)

  useEffect(() => {
    let alive = true
    store
      .ensureSeeded(buildShowcase)
      .then(() => Promise.all([store.listListings(), store.listLeads(), store.getSettings()]))
      .then(([ls, lds, s]) => {
        if (!alive) return
        setListings(ls)
        setLeads(lds)
        setSettings(s)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const resetShowcase = useCallback(async () => {
    await store.resetShowcase(buildShowcase)
    setListings(await store.listListings())
    setLeads(await store.listLeads())
  }, [])

  const clearAll = useCallback(async () => {
    await store.clearAll()
    setListings([])
    setLeads([])
  }, [])

  const toast = useCallback((message, kind = 'success') => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, message, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
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

  const saveLead = useCallback(async (lead) => {
    const saved = await store.upsertLead(lead)
    setLeads(await store.listLeads())
    return saved
  }, [])

  const removeLead = useCallback(async (id) => {
    await store.deleteLead(id)
    setLeads(await store.listLeads())
  }, [])

  const updateSettings = useCallback(async (next) => {
    const merged = { ...settings, ...next, rules: { ...settings.rules, ...(next.rules || {}) } }
    await store.saveSettings(merged)
    setSettings(merged)
    return merged
  }, [settings])

  const value = {
    listings, leads, settings, loading, toasts, toast,
    saveListing, removeListing, saveLead, removeLead, updateSettings,
    resetShowcase, clearAll,
    newId: store.newId,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
