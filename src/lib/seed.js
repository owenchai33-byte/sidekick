// Showcase seed — pre-loads the app with realistic example listings + a live
// pipeline so it opens as a finished, working system (not an empty screen).
// This is the "template" a prospect wants to SEE. Seeded once on first load;
// clearing or resetting is available in Settings. Content uses the built-in
// generator so it's instant and offline; a prospect's own listing uses live AI.

import { demoContent } from '../../shared/demo.js'

const now = Date.now()
const ago = (mins) => new Date(now - mins * 60000).toISOString()
const LANGS = ['en', 'zh', 'ms']

function makeListing(fields, platforms, opts = {}) {
  const id = crypto.randomUUID()
  const content = demoContent(fields, platforms, LANGS)
  const approvals = {}
  const published = {}
  if (opts.approveAll) {
    for (const p of platforms) {
      approvals[p] = {}
      for (const l of LANGS) approvals[p][l] = true
    }
  }
  for (const p of opts.published || []) {
    published[p] = {}
    for (const l of LANGS) published[p][l] = ago(opts.pubMins ?? 120)
  }
  return {
    id,
    agentId: 'owner',
    ...fields,
    photos: opts.photos || [],
    platforms,
    languages: LANGS,
    content,
    approvals,
    published,
    example: true, // pre-loaded showcase listing
    demo: false,
    status: opts.status || 'optimised',
    createdAt: ago(opts.ageMins ?? 600),
    updatedAt: ago(opts.updMins ?? 120),
  }
}

function makeLead(listingId, platform, name, contact, stage, value, note, mins) {
  const closed = stage === 'won' || stage === 'lost'
  return {
    id: crypto.randomUUID(),
    listingId,
    platform,
    agentId: 'owner',
    name,
    contact,
    stage,
    value: value ?? null,
    note: note || null,
    closedAt: closed ? ago(mins) : null,
    createdAt: ago(mins + 260),
    updatedAt: ago(mins),
  }
}

export function buildShowcase() {
  // 1) Flagship high-value sale — fully approved, two platforms already published.
  const l1 = makeListing(
    { listingType: 'sale', price: 1280000, location: 'Green Heights', bedrooms: 5, bathrooms: 5, propertyType: 'Semi-D', sqft: 3200, tenure: 'Freehold', furnishing: 'Partially Furnished', title: 'Semi-D @ Green Heights' },
    ['facebook_page', 'marketplace', 'instagram'],
    { approveAll: true, published: ['facebook_page', 'marketplace'], status: 'published', ageMins: 2880, updMins: 55, pubMins: 300, photos: ['seed/green-1.jpg', 'seed/green-3.jpg', 'seed/green-2.jpg'] },
  )
  // 2) High-value rental — flagged (> RM2k), approved, live on Marketplace.
  const l2 = makeListing(
    { listingType: 'rental', price: 2800, location: 'BDC', bedrooms: 3, bathrooms: 2, propertyType: 'Condo', sqft: 1150, furnishing: 'Fully Furnished', title: 'Condo @ BDC' },
    ['marketplace', 'mudah', 'facebook_page'],
    { approveAll: true, published: ['marketplace'], status: 'published', ageMins: 1440, updMins: 190, pubMins: 600, photos: ['seed/condo-1.jpg', 'seed/condo-2.jpg', 'seed/condo-3.jpg'] },
  )
  // 3) Mid-market sale — generated, still in review (shows the approval stage).
  const l3 = makeListing(
    { listingType: 'sale', price: 620000, location: 'Batu Kawa', bedrooms: 4, bathrooms: 3, propertyType: 'Terrace', sqft: 1900, tenure: 'Freehold', title: 'Terrace @ Batu Kawa' },
    ['facebook_page', 'marketplace'],
    { status: 'optimised', ageMins: 180, updMins: 25, photos: ['seed/terrace-1.jpg', 'seed/terrace-2.jpg', 'seed/terrace-3.jpg'] },
  )

  const leads = [
    makeLead(l1.id, 'marketplace', 'Datuk Lim', '012-8•• ••••', 'won', 1280000, 'Cash buyer — closed in 3 weeks', 240),
    makeLead(l1.id, 'facebook_page', 'Sarah Wong', 'FB: Sarah Wong', 'negotiating', null, 'Second viewing done, negotiating price', 90),
    makeLead(l2.id, 'marketplace', 'Ahmad Faizal', '011-2•• ••••', 'viewing', null, 'Viewing booked this Saturday', 60),
    makeLead(l2.id, 'mudah', 'Ms Chen', '013-4•• ••••', 'contacted', null, 'Asked for the floor plan', 30),
    makeLead(l3.id, 'facebook_page', 'Mr Raj', '018-7•• ••••', 'new', null, 'Enquired via Facebook DM', 12),
  ]

  return { listings: [l1, l2, l3], leads }
}
