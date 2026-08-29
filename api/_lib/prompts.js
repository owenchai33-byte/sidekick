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
  "sqft": number | null,             // BUILT-UP area only. null if only land size is given.
  "landSqft": number | null,         // LAND area only. Never put land size in "sqft".
  "tenure": "Freehold" | "Leasehold" | null,
  "furnishing": "Unfurnished" | "Partially Furnished" | "Fully Furnished" | null,
  "title": string | null             // a short human label, e.g. "3-room terrace @ Batu Kawa"
}

Rules:
- Infer listingType from context (words like "for rent", "sewa", "/month", "monthly" => rental; "for sale", "jual", "dijual" => sale). If a price looks monthly and small, it's a rental.
- Convert "k" to thousands, "juta"/"mil"/"m" to millions.
- BUILT-UP vs LAND are different numbers and buyers compare them. "built-up",
  "binaan", "floor area" -> sqft. "land", "tanah", "land area", "lot size" -> landSqft.
  If the text gives only one and does not say which, prefer landSqft for a landed
  house (terrace/semi-D/detached) and sqft for an apartment/condo.
- Malaysian land units: 1 point = 435.6 sq ft (1/100 acre); 1 acre = 43,560 sq ft.
  So "8.6 points" -> landSqft 3746, NOT sqft.
- If a field is genuinely absent, use null. Never invent values.

Listing text:
"""
${rawText}
"""`
}

/** CONTENT: listing + chosen platforms/languages → native copy per combination. */
export function buildContentPrompt(listing, platformIds, languageIds, styleGuide, contact) {
  const platforms = platformIds.map((id) => PLATFORM_MAP[id]).filter(Boolean)
  const languages = languageIds.map((id) => LANGUAGE_MAP[id]).filter(Boolean)

  // The agent's own trained style — overrides the defaults below when present.
  const sg = styleGuide || {}
  const styleRules = (sg.style || '').trim()
  const styleExamples = Array.isArray(sg.examples) ? sg.examples.filter((e) => e && e.trim()) : []
  const styleBlock = (styleRules || styleExamples.length)
    ? `\n\nTHE AGENT'S OWN STYLE — HIGHEST PRIORITY. Follow these exactly; they override any default tone/length/emoji/hashtag guidance below where they conflict:\n${styleRules || '(no written rules — match the examples)'}${styleExamples.length ? `\n\nMatch the voice, length and formatting of these example captions the agent wrote:\n${styleExamples.map((e, i) => `— Example ${i + 1} —\n${e}`).join('\n')}` : ''}`
    : ''

  const facts = [
    `Listing type: ${listing.listingType === 'rental' ? 'Rental (monthly)' : 'Sale'}`,
    listing.price != null && `Price: RM${Number(listing.price).toLocaleString('en-MY')}${listing.listingType === 'rental' ? '/month' : ''}`,
    listing.location && `Location: ${listing.location}, Kuching, Sarawak`,
    listing.propertyType && `Property type: ${listing.propertyType}`,
    listing.bedrooms != null && `Bedrooms: ${listing.bedrooms}`,
    listing.bathrooms != null && `Bathrooms: ${listing.bathrooms}`,
    listing.sqft != null && `Built-up area: ${listing.sqft} sq ft`,
    listing.landSqft != null && `LAND area: ${listing.landSqft} sq ft (this is LAND, not built-up — never describe it as built-up or floor area)`,
    listing.tenure && `Tenure: ${listing.tenure}`,
    listing.furnishing && `Furnishing: ${listing.furnishing}`,
  ].filter(Boolean).join('\n')

  // When the agent has their own style, IT governs length/tone/format — the
  // platform's default brief must not fight it (that's the "still came back
  // short" bug). Without a style, use the platform brief as normal.
  const styleActive = !!styleRules
  const platformBriefs = platforms
    .map((p) => styleActive
      ? `- "${p.id}" (${p.name}): write to THE AGENT'S STYLE above — length, detail, tone, emoji and hashtags all come from the style. Just keep it appropriate for ${p.name}.`
      : `- "${p.id}" (${p.name}): ${p.brief || p.style}`)
    .join('\n')

  // Pass the original message so rich numbers (price history, ROI, floor
  // breakdown, rental income) survive — the parser only keeps a few fields.
  const rawBlock = (listing.rawText || '').trim()
    ? `\n\nAGENT'S ORIGINAL MESSAGE — you MAY use any concrete property facts/numbers written here (price history, bank value, savings %, floor-by-floor sizes, facing, ROI %, rental income, deposit/terms). Use only what is actually written; never invent. IGNORE any person's name or phone in it (e.g. the original lister's contact) — the sign-off comes from the agent's style, not this message:\n"""\n${listing.rawText.trim()}\n"""`
    : ''

  const lengthRule = styleActive
    ? "- LENGTH, EMOJI & HASHTAGS: the agent's STYLE above governs — follow it exactly, even if that means a long, detailed, data-rich post with hashtags. Ignore any shorter default where it conflicts."
    : "- Follow each platform's length, emoji and hashtag rules exactly. Hashtags ONLY on TikTok and Instagram — never on Facebook Page, Marketplace, Mudah or Portals."

  // The agent's click-to-chat "WhatsApp button": a wa.me link Facebook renders tappable.
  const wa = String((contact && contact.whatsapp) || '').replace(/[^\d]/g, '')
  const contactLine = wa
    ? `- END every post with the agent's WhatsApp click-to-chat link, on its own final line, EXACTLY: https://wa.me/${wa} — on Facebook this becomes a tappable "message on WhatsApp" button. Keep the agent's own sign-off line just before it (e.g. their name / "PM me"). Never alter or omit the link.`
    : "- End every piece with a clear, on-voice way to contact the agent (DM / WhatsApp / call)."

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
${facts}${rawBlock}
${styleBlock}
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
- NO INVENTED CLAIMS. This is the most important rule and it is broken most often.
  Everything you write must be traceable to a fact above. In particular NEVER assert:
  * who it suits ("ideal for a young professional", "perfect for a small family",
    "great for investors") — you do not know who the buyer is;
  * views, light or outlook ("stunning views", "wake up to the sunrise", "bright and
    airy") unless the listing actually says so — a floor number is NOT a view;
  * location benefits ("close to schools", "minutes from town", "convenient access")
    unless a distance or place is actually given;
  * condition or feeling not stated ("cosy", "spacious", "modern", "luxurious") —
    say the SQ FT, not "spacious".
  If it is not in the facts, leave it out. A short honest post beats a padded one.
- USE the specifics the agent actually gave — floor/level, "negotiable", furnishing,
  tenure, deposit terms, the agent's own name and number. Those are what make a post
  read like a real agent wrote it; dropping them for lifestyle filler is the failure.
- Only use the facts above — never invent amenities, distances, schools or figures. If a fact is missing, write around it. Format money as RM.
${lengthRule}
${contactLine}
- Ready to post: no placeholders, no "[insert]", no markdown.

Return ONLY a JSON object — no markdown, no code fences, no commentary — shaped exactly like:
{
${platforms.map((p) => `  "${p.id}": { ${languages.map((l) => `"${l.id}": "..."`).join(', ')} }`).join(',\n')}
}`
}

/** REEL: a punchy TikTok voiceover script + short caption for a listing. */
export function buildReelPrompt(listing) {
  const facts = [
    `Type: ${listing.listingType === 'rental' ? 'For rent (monthly)' : 'For sale'}`,
    listing.price != null && `Price: RM${Number(listing.price).toLocaleString('en-MY')}${listing.listingType === 'rental' ? '/month' : ''}`,
    listing.location && `Location: ${listing.location}, Kuching, Sarawak`,
    listing.propertyType && `Type: ${listing.propertyType}`,
    listing.bedrooms != null && `${listing.bedrooms} bedrooms`,
    listing.bathrooms != null && `${listing.bathrooms} bathrooms`,
    listing.sqft != null && `${listing.sqft} sq ft`,
    listing.rawText && `Agent's message: ${String(listing.rawText).slice(0, 500)}`,
  ].filter(Boolean).join('\n')

  return `Write a TikTok reel for this Kuching property. Return ONLY JSON: { "script": "...", "caption": "..." }

LISTING:
${facts}

"script" = the SPOKEN voiceover, English, energetic and punchy for a 15-20 second TikTok:
- Open with a 1-line HOOK that stops the scroll (not "check out this property").
- Then 2-3 punchy selling points using the REAL numbers (price, beds, area, standout feature).
- End with a fast CTA (e.g. "DM before it's gone").
- 35-55 words total, ~3-5 short sentences. Spoken style: write numbers as words a voice reads naturally (say "four ninety-eight thousand" not "RM498,000"; "seven ninety-seven square feet"). No emojis, no hashtags, no markdown — it's read aloud.
- Only use facts above; never invent. NO invented views, no invented buyer type
  ("perfect for young professionals"), no invented nearby amenities. A floor number
  is not a view. If the listing says "negotiable" or gives a floor, USE those — real
  specifics are what make it sound like an agent instead of an advert.

"caption" = the TikTok post caption: 1 short line + 4-6 relevant hashtags (e.g. #KuchingProperty #Sarawak). Emojis ok here.`
}

/** PLAN: a month of non-listing content posts (tips, area spotlights, festive,
 *  engagement) that keep an agent's feed active between listings. */
export function buildPlanPrompt(brand, count, languageIds) {
  const languages = languageIds.map((id) => LANGUAGE_MAP[id]).filter(Boolean)
  const langList = languages.map((l) => `"${l.id}" = ${l.native}`).join(', ')
  const who = brand?.agency || brand?.name || 'a property agent'
  return `You are the social media manager for ${who}, a property agent in Kuching, Sarawak, Malaysia. Plan ${count} SHORT, engaging NON-LISTING posts that keep the feed active between property listings and build trust + enquiries.

MIX these categories (vary them, avoid repeats):
- market_tip: a genuine Kuching/Sarawak property insight (financing, MOT, legal fees, loan margin, timing)
- buyer_tip or seller_tip: one practical, true piece of advice
- area_spotlight: a Kuching area worth living in (BDC, Batu Kawa, Green Heights, Samarahan, Petra Jaya…) and why
- festive: a warm greeting for a relevant Malaysian/Sarawak occasion (CNY, Hari Raya, Deepavali, Gawai Dayak, Christmas, Merdeka)
- engagement: a light question that invites comments
- credibility: a soft "why work with a local agent" trust-builder (no fake numbers)

Write EACH post NATIVELY in each language (never translated): ${langList}. A 中文 post follows Chinese social conventions; Bahasa Malaysia must read like a local wrote it.

CRAFT:
- Punchy and real; vary length; sound like a trusted local, not a brochure.
- BAN AI clichés: "nestled", "boasts", "unlock", "dream home", "look no further", "in today's market".
- NEVER invent statistics, prices, projects or claims — keep tips general and true.
- Each post gets a very short punchy HEADLINE (max ~5 words, for a graphic) + the caption with 2–4 relevant hashtags at the end.
- End engagement/credibility posts with a soft CTA to DM / WhatsApp.

Return ONLY raw JSON — no markdown, no code fences — shaped exactly:
{
  "posts": [
    { "category": "market_tip", "headline": "...", "captions": { ${languages.map((l) => `"${l.id}": "..."`).join(', ')} } }
  ]
}
Produce exactly ${count} posts.`
}

/** REFINE: rewrite one existing post per a short instruction (Shorter, Punchier,
 *  More urgent, or a free-text ask) — the in-app "edit with ChatGPT". */
export function buildRefinePrompt(text, instruction, platformId, langId) {
  const p = PLATFORM_MAP[platformId]
  const l = LANGUAGE_MAP[langId]
  const native = l ? l.native : 'the same language'
  return `Rewrite this social post for ${p ? p.name : 'social media'}, following this instruction: "${instruction}".

Rules:
- Keep it in ${native}, written natively (NEVER translated), same platform voice.
- Ready to post: no placeholders, no markdown, no commentary, no quotes around it.
- Keep the platform's hashtag convention (hashtags only where that platform allows).
- Don't invent facts not in the original.

CURRENT POST:
${text}

Return ONLY the rewritten post text — nothing else.`
}

/** COVER: pick the best cover photo from a set of images (0-based index). */
export function buildCoverPrompt(count) {
  return `You are picking the single best COVER photo for a property listing social post. There are ${count} photos, numbered 0 to ${count - 1} in the order given.

Pick the one that best sells the property: a clear, well-lit hero shot — the exterior/facade, or a bright, attractive living space. AVOID as cover: blurry, dark, cluttered or empty shots, and bathroom / close-up detail shots.

Return ONLY JSON: {"index": N} where N is the 0-based number of the best cover photo.`
}
