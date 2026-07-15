// Shared, framework-free constants imported by BOTH the React client (src/)
// and the serverless AI function (api/). Keep it pure data — no imports.

/**
 * The six publishing surfaces. `style` is the copywriting brief handed to the
 * model; `compose` is where one-tap publish opens a fresh compose page.
 * `autopost` records the real-world posting reality from the spec (§5) — every
 * platform is one-tap in Phase 1; the flags document what becomes possible later.
 */
export const PLATFORMS = [
  {
    id: 'facebook_page',
    name: 'Facebook Page',
    short: 'FB Page',
    icon: '📘',
    style: 'Long-form, warm, storytelling. Emoji-light. Full detail. End with a call to action to DM.',
    brief: 'Warm, story-led post of 4–6 short lines. Open with a hook about the lifestyle or who would love it — not the specs. Work in 2–3 concrete facts (price, beds, area). At most 1–2 emoji. Close by inviting a DM/WhatsApp to arrange a viewing. No hashtags.',
    compose: 'https://www.facebook.com/',
    autopost: 'phase2', // Graph API possible after Meta app review
    note: 'Paste into a new Page post.',
  },
  {
    id: 'marketplace',
    name: 'Facebook Marketplace',
    short: 'Marketplace',
    icon: '🏷️',
    style: 'Punchy and scannable. Keyword-heavy for search. Price forward. Short lines.',
    brief: 'Buyer-search copy, highly scannable. Line 1: price + property type + area. Then 2–4 short spec lines (beds/baths/sqft/furnishing/tenure). Keyword-rich so it surfaces in search. No emoji, no hashtags. End with a one-line "WhatsApp/PM to view".',
    compose: 'https://www.facebook.com/marketplace/create/item',
    autopost: 'never', // No posting API — automation = ban. One-tap only, forever.
    note: 'Never automated — copy in and post by hand (protects the account).',
  },
  {
    id: 'mudah',
    name: 'Mudah',
    short: 'Mudah',
    icon: '🧾',
    style: 'Structured and factual. Portal-conventional. Keyword-rich. Clear spec lines.',
    brief: 'Portal-style factual listing. A clear title line, then clean labelled spec lines (Type, Bedrooms, Bathrooms, Built-up, Tenure, Furnishing). Neutral and complete, keyword-rich. No emoji, no hashtags. Close with a plain contact-to-view line.',
    compose: 'https://www.mudah.my/malaysia/properties-for-sale-3000',
    autopost: 'never',
    note: 'No posting API — one-tap only.',
  },
  {
    id: 'portals',
    name: 'Property Portals',
    short: 'Portals',
    icon: '🏢',
    style: 'Formal and complete. Full specs. Professional tone. Suited to iProperty / EdgeProp.',
    brief: 'Formal iProperty/EdgeProp listing. A professional 2–3 sentence description in full prose, then a concise spec summary. Complete, credible, no slang, no emoji, no hashtags. Close by inviting an inspection through the marketing agent.',
    compose: 'https://www.iproperty.com.my/',
    autopost: 'never',
    note: 'iProperty / EdgeProp — one-tap only.',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    short: 'TikTok',
    icon: '🎵',
    style: 'Hook-first opening line. Short. Trend-aware. Hashtags at the end.',
    brief: 'Scroll-stopping hook in the first 5 words (e.g. "POV:", "Stop scrolling", "This one…"). 2–4 punchy lines, playful and current. 1–3 emoji. End with a comment/DM prompt, then 4–6 niche hashtags (#kuchingproperty #sarawak …).',
    compose: 'https://www.tiktok.com/upload',
    autopost: 'phase2', // Posting API exists but approval is slow
    note: 'Prepare the caption; upload the video yourself.',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    short: 'Instagram',
    icon: '📸',
    style: 'Caption with intentional line breaks, then a hashtag block. Visual-first framing.',
    brief: 'Aspirational caption of 3–5 short lines with intentional line breaks. Include price + 2–3 key specs. 2–4 emoji used naturally. A clear "DM to view" CTA, then a block of 6–10 relevant hashtags on their own line.',
    compose: 'https://www.instagram.com/',
    autopost: 'phase2', // Content Publishing API possible after Meta app review
    note: 'Paste the caption when you post the photos.',
  },
]

export const PLATFORM_MAP = Object.fromEntries(PLATFORMS.map((p) => [p.id, p]))

/** The signature tri-language output. Each is generated NATIVELY, never translated. */
export const LANGUAGES = [
  { id: 'en', name: 'English', label: 'EN', native: 'English' },
  { id: 'zh', name: 'Chinese', label: '中文', native: '中文' },
  { id: 'ms', name: 'Malay', label: 'BM', native: 'Bahasa Malaysia' },
]

export const LANGUAGE_MAP = Object.fromEntries(LANGUAGES.map((l) => [l.id, l]))

export const PROPERTY_TYPES = [
  'Terrace',
  'Semi-D',
  'Detached',
  'Apartment',
  'Condo',
  'Shoplot',
  'Land',
]

export const LISTING_TYPES = [
  { id: 'sale', name: 'Sale' },
  { id: 'rental', name: 'Rental' },
]

/** Default rules-based thresholds (§7). Editable in Settings — never hardcoded downstream. */
export const DEFAULT_RULES = {
  saleThreshold: 600000, // flag sale listings above RM600k
  rentalThreshold: 2000, // flag rentals above RM2,000/month
}

/** Kuching-centric area suggestions to speed up entry between viewings. */
export const KUCHING_AREAS = [
  'Kota Sentosa', 'Batu Kawa', 'Stutong', 'Tabuan Jaya', 'Tabuan Heights',
  'Matang', 'Petra Jaya', 'Samarahan', 'Jalan Song', 'Green Heights',
  'BDC', 'Stampin', 'Pending', 'Demak Laut', 'Kenyalang',
]

/**
 * Lead pipeline stages (§6). A lead is "system-sourced" because it's logged
 * against a listing + the platform it came in on — that attribution is the
 * basis for the referral share. Trust-based: the system tracks what agents log.
 */
export const LEAD_STAGES = [
  { id: 'new', name: 'New', open: true, tone: 'neutral' },
  { id: 'contacted', name: 'Contacted', open: true, tone: 'info' },
  { id: 'viewing', name: 'Viewing', open: true, tone: 'info' },
  { id: 'negotiating', name: 'Negotiating', open: true, tone: 'warn' },
  { id: 'won', name: 'Closed — Won', open: false, tone: 'win' },
  { id: 'lost', name: 'Closed — Lost', open: false, tone: 'lost' },
]

export const LEAD_STAGE_MAP = Object.fromEntries(LEAD_STAGES.map((s) => [s.id, s]))
