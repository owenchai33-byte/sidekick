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
  // Brand kit — applied to generated graphics/video. Logo is a data URL.
  brand: { agency: '', name: '', phone: '', color: '#2d6a4f', logo: null },
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

// ── Showcase seeding ─────────────────────────────────────
// Seeds example data once (first ever load). Clearing sets the seeded flag so
// it won't re-appear; "reset" re-seeds on demand. Both live in Settings.
// Bump SEED_VERSION when the showcase content changes (e.g. new demo photos) so
// existing demo-only users refresh — but real listings are never clobbered.
const SEED_VERSION = 2

export async function ensureSeeded(buildShowcase) {
  const state = read()
  const listings = Object.values(state.listings || {})

  // First ever load — seed a genuinely empty store.
  if (!state.meta?.seeded && listings.length === 0) {
    writeSeed(buildShowcase())
    return true
  }
  // Content refresh: if the store is still ALL example data and the seed
  // version is behind, refresh the showcase. Never touches real listings.
  const allExamples = listings.length > 0 && listings.every((l) => l.example)
  if (state.meta?.seedVersion !== SEED_VERSION && allExamples) {
    writeSeed(buildShowcase())
    return true
  }
  return false
}

export async function resetShowcase(buildShowcase) {
  writeSeed(buildShowcase())
}

export async function clearAll() {
  const { settings } = read()
  localStorage.setItem(LKEY, JSON.stringify({ settings, meta: { seeded: true } }))
}

function writeSeed({ listings, leads }) {
  const { settings } = read()
  const lmap = {}
  const ldmap = {}
  for (const l of listings) lmap[l.id] = l
  for (const x of leads) ldmap[x.id] = x
  localStorage.setItem(LKEY, JSON.stringify({ settings, listings: lmap, leads: ldmap, meta: { seeded: true, seedVersion: SEED_VERSION } }))
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

// ── Leads (Phase 2: lead tracking + attribution) ─────────
export async function listLeads() {
  const { leads = {} } = read()
  return Object.values(leads).sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
  )
}

export async function upsertLead(lead) {
  const { leads = {} } = read()
  const now = new Date().toISOString()
  const saved = {
    ...lead,
    createdAt: lead.createdAt || now,
    updatedAt: now,
  }
  leads[saved.id] = saved
  write({ leads })
  return saved
}

export async function deleteLead(id) {
  const { leads = {} } = read()
  delete leads[id]
  write({ leads })
}

// ── Settings ─────────────────────────────────────────────
export async function getSettings() {
  const { settings } = read()
  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    rules: { ...DEFAULT_SETTINGS.rules, ...(settings?.rules || {}) },
    brand: { ...DEFAULT_SETTINGS.brand, ...(settings?.brand || {}) },
  }
}

export async function saveSettings(settings) {
  write({ settings })
  return settings
}
