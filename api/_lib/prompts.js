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
    .map((p) => `- "${p.id}" (${p.name}): ${p.style}`)
    .join('\n')

  const langList = languages
    .map((l) => `"${l.id}" = ${l.native}`)
    .join(', ')

  return `You are an expert property copywriter for the Kuching, Sarawak market. You write native, natural marketing copy for property agents — never robotic, never machine-translated.

LISTING FACTS:
${facts}

Write marketing copy for EACH of these platforms, each in its own style:
${platformBriefs}

For EACH platform, produce the copy in EACH of these languages, written NATIVELY: ${langList}.
CRITICAL: Do NOT translate one language into the others. Write each language from scratch with its own idiom, tone and property vernacular. A Chinese (中文) property post follows different conventions than an English one; Bahasa Malaysia copy should read like a local agent wrote it, not a translation.

Guidelines:
- Only use the facts given. Do not invent amenities, distances or figures. If a fact is missing, write around it.
- Lead with the price where the platform style calls for it. Format money as RM.
- Keep each piece ready to post — no placeholders, no "[insert here]".
- Match each platform's length and tone brief above.

Return ONLY a JSON object — no markdown, no code fences, no commentary — shaped exactly like:
{
${platforms.map((p) => `  "${p.id}": { ${languages.map((l) => `"${l.id}": "..."`).join(', ')} }`).join(',\n')}
}`
}
