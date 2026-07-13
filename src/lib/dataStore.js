// ─────────────────────────────────────────────────────────────────────────
// SWAPPABLE DATA LAYER
// Every persistence call the app makes goes through this module's async API.
// Today it's backed by localStorage; to move to Supabase, reimplement these
// same functions against Postgres/Storage — nothing else in the app changes.
//   listListings / getListing / upsertListing / deleteListing
//   getSettings / saveSettings
// (Guardrail note: localStorage here is a deliberate stopgap for the real app,
//  not a preview artifact. The real backend is Supabase per the spec.)
// ─────────────────────────────────────────────────────────────────────────

import { DEFAULT_RULES } from '../../shared/constants.js'

const LKEY = 'sidekick.v1'

const DEFAULT_SETTINGS = {
  rules: { ...DEFAULT_RULES },
  defaultLanguages: ['en', 'zh', 'ms'],
  defaultPlatforms: ['facebook_page', 'marketplace'],
  // Placeholder identity until Supabase auth lands (account owner = admin).
  agent: { id: 'owner', name: 'Demo Account', role: 'admin' },
}

function read() {
  try {
    return JSON.parse(localStorage.getItem(LKEY)) || {}
  } catch {
    return {}
  }
}

function write(patch) {
  const next = { ...read(), ...patch }
  localStorage.setItem(LKEY, JSON.stringify(next))
  return next
}

export function newId() {
  return (crypto.randomUUID?.() || 'id-' + Math.random().toString(36).slice(2))
}

// ── Listings ─────────────────────────────────────────────
export async function listListings() {
  const { listings = {} } = read()
  return Object.values(listings).sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
  )
}

export async function getListing(id) {
  const { listings = {} } = read()
  return listings[id] || null
}

export async function upsertListing(listing) {
  const { listings = {} } = read()
  const now = new Date().toISOString()
  const saved = {
    ...listing,
    createdAt: listing.createdAt || now,
    updatedAt: now,
  }
  listings[saved.id] = saved
  write({ listings })
  return saved
}

export async function deleteListing(id) {
  const { listings = {} } = read()
  delete listings[id]
  write({ listings })
}

// ── Settings ─────────────────────────────────────────────
export async function getSettings() {
  const { settings } = read()
  return { ...DEFAULT_SETTINGS, ...(settings || {}), rules: { ...DEFAULT_SETTINGS.rules, ...(settings?.rules || {}) } }
}

export async function saveSettings(settings) {
  write({ settings })
  return settings
}
