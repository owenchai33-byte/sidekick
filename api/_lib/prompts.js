// Prompt construction for the two AI jobs: parsing a pasted blob into fields,
// and generating per-platform × per-language copy. Both instruct the model to
// return raw JSON only. Files prefixed `_` are not treated as routes by Vercel.

import { PLATFORM_MAP, LANGUAGE_MAP } from '../../shared/constants.js'

/** PARSE: raw WhatsApp/listing blob → structured fields the agent can correct. */
export function buildParsePrompt(rawText) {
  return `You extract structured data from messy Malaysian property listing text (often from WhatsApp groups, mixing English, Malay and Chinese).

Return ONLY a JSON object — no markdown, no code fences, no commentary — with exactly these keys:
{
  "listingType": "sale" | "rental",
  "price": number | null,            // in RM, digits only (e.g. "RM 450k" -> 450000, "2.5k/month" -> 2500)
  "location": string | null,         // area/neighbourhood, Kuching-centric
  "bedrooms": number | null,
  "bathrooms": number | null,
  "propertyType": one of "Terrace","Semi-D","Detached","Apartment","Condo","Shoplot","Land" or null,
  "sqft": number | null,
  "tenure": "Freehold" | "Leasehold" | null,
  "furnishing": "Unfurnished" | "Partially Furnished" | "Fully Furnished" | null,
  "title": string | null             // a short human label, e.g. "3-room terrace @ Batu Kawa"
}

Rules:
- Infer listingType from context (words like "for rent", "sewa", "/month", "monthly" => rental; "for sale", "jual", "dijual" => sale). If a price looks monthly and small, it's a rental.
- Convert "k" to thousands, "juta"/"mil"/"m" to millions.
- If a field is genuinely absent, use null. Never invent values.

Listing text:
"""
${rawText}
"""`
}

/** CONTENT: listing + chosen platforms/languages → native copy per combination. */
export function buildContentPrompt(listing, platformIds, languageIds) {
  const platforms = platformIds.map((id) => PLATFORM_MAP[id]).filter(Boolean)
  const languages = languageIds.map((id) => LANGUAGE_MAP[id]).filter(Boolean)

  const facts = [
    `Listing type: ${listing.listingType === 'rental' ? 'Rental (monthly)' : 'Sale'}`,
    listing.price != null && `Price: RM${Number(listing.price).toLocaleString('en-MY')}${listing.listingType === 'rental' ? '/month' : ''}`,
    listing.location && `Location: ${listing.location}, Kuching, Sarawak`,
    listing.propertyType && `Property type: ${listing.propertyType}`,
    listing.bedrooms != null && `Bedrooms: ${listing.bedrooms}`,
    listing.bathrooms != null && `Bathrooms: ${listing.bathrooms}`,
    listing.sqft != null && `Built-up: ${listing.sqft} sq ft`,
    listing.tenure && `Tenure: ${listing.tenure}`,
    listing.furnishing && `Furnishing: ${listing.furnishing}`,
  ].filter(Boolean).join('\n')

  const platformBriefs = platforms
    .map((p) => `- "${p.id}" (${p.name}): ${p.brief || p.style}`)
    .join('\n')

  const langList = languages
    .map((l) => `"${l.id}" = ${l.native}`)
    .join(', ')

  // Only spell out conventions for the languages actually requested.
  const CONVENTIONS = {
    en: '- English — confident, warm, professional. Contractions are fine; clean Malaysian-English is fine. Avoid stiff corporate phrasing.',
    zh: '- 中文 — use real property vernacular: 售价/月租, X房X厕, 建筑面积◯平方尺, 永久地契/租赁地契, 家具齐全/部分家具. Sincere, trustworthy tone (诚意出售, 交通便利, 生活机能齐全, 环境清幽). WhatsApp/DM = 私信. Never sound translated.',
    ms: '- Bahasa Malaysia — natural agent Malay: bilik tidur, bilik air/tandas, kaki persegi, pegangan bebas/pajakan, lengkap perabot, lokasi strategik, mesra keluarga. PM/WhatsApp untuk pertanyaan. Elakkan bahasa terjemahan yang kaku.',
  }
  const conventions = languages.map((l) => CONVENTIONS[l.id]).filter(Boolean).join('\n')

  return `You are the property copywriter every agent in Kuching, Sarawak wishes they could hire. You write native, natural, high-converting marketing copy — never robotic, never machine-translated, never templated.

LISTING FACTS:
${facts}

Write copy for EACH platform, in its own voice:
${platformBriefs}

Produce EACH platform's copy in EACH language, written NATIVELY: ${langList}.
CRITICAL: Do NOT translate one language into another. Write each from scratch in its own idiom — a 中文 post follows different conventions than an English one; Bahasa Malaysia must read like a local agent wrote it.
NATIVE-LANGUAGE CONVENTIONS:
${conventions}

CRAFT STANDARD — write like a real top agent, not a template:
- Be specific and concrete. Use the real numbers and help the reader picture living there.
- Vary sentence length. One strong opening line beats three flat ones.
- BAN these clichés / AI tells: "nestled", "boasts", "dream home awaits", "won't last long", "a rare gem", "priced to sell", "look no further", "unparalleled", "boasts a".
- Only use the facts above — never invent amenities, distances, schools or figures. If a fact is missing, write around it. Format money as RM.
- Follow each platform's length, emoji and hashtag rules exactly. Hashtags ONLY on TikTok and Instagram — never on Facebook Page, Marketplace, Mudah or Portals.
- End every piece with a clear, on-voice way to contact the agent (DM / WhatsApp / call). Ready to post: no placeholders, no "[insert]", no markdown.

Return ONLY a JSON object — no markdown, no code fences, no commentary — shaped exactly like:
{
${platforms.map((p) => `  "${p.id}": { ${languages.map((l) => `"${l.id}": "..."`).join(', ')} }`).join(',\n')}
}`
}
