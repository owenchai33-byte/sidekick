// Prompt construction for the two AI jobs: parsing a pasted blob into fields,
// and generating per-platform × per-language copy. Both instruct the model to
// return raw JSON only. Files prefixed `_` are not treated as routes by Vercel.

import { propertyNames } from './postguard.js'

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
export function buildContentPrompt(listing, platformIds, languageIds, styleGuide, contact, rules) {
  const platforms = platformIds.map((id) => PLATFORM_MAP[id]).filter(Boolean)
  const languages = languageIds.map((id) => LANGUAGE_MAP[id]).filter(Boolean)

  // The agent's own trained style — overrides the defaults below when present.
  const sg = styleGuide || {}
  const styleRules = (sg.style || '').trim()
  const styleExamples = Array.isArray(sg.examples) ? sg.examples.filter((e) => e && e.trim()) : []
  const styleBlock = (styleRules || styleExamples.length)
    ? `\n\nTHE AGENT'S OWN STYLE — HIGHEST PRIORITY. Follow these exactly; they override any default tone/length/emoji/hashtag guidance below where they conflict:\n${styleRules || '(no written rules — match the examples)'}${styleExamples.length ? `\n\nMatch the voice, length and formatting of these example captions the agent wrote:\n${styleExamples.map((e, i) => `— Example ${i + 1} —\n${e}`).join('\n')}` : ''}`
    : ''

  // Spell the price out as ONE asking price with an explicit prohibition, rather
  // than leaving the model to reason from "RM100k below value". Left to itself it
  // derived a bank value and then advertised it as a former asking price.
  const priceLine = listing.price != null
    ? `Asking price: RM${Number(listing.price).toLocaleString('en-MY')}${listing.listingType === 'rental' ? '/month' : ''} — this is the ONLY price. There is no earlier or higher asking price. Do not state one, do not imply a reduction.`
    : null

  // The property's NAME as a labelled fact, not something to spot in prose.
  // Measured: Edward's listing puts "Tropics City" on line 2, right under a
  // headline line that says nearly the same thing - the model read line 2 as a
  // duplicate and dropped it, losing the name in 2 of 6 captions. Extracted with
  // the SAME function the validator uses, so the prompt and the gate can never
  // disagree about what the name is.
  const names = propertyNames(listing.rawText || '', listing)
  const nameLine = names.length
    ? `PROPERTY NAME: ${names[0]} — this is what the property is CALLED. It MUST appear in the caption, near the top. Do not treat it as a repeat of the headline.`
    : null

  const facts = [
    `Listing type: ${listing.listingType === 'rental' ? 'Rental (monthly)' : 'Sale'}`,
    nameLine,
    priceLine,
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

  // The agent's own listing is the SOURCE, not reference material.
  //
  // This prompt used to cast the model as a copywriter AUTHORING an advert from
  // extracted fields (price, beds, baths), with the original text offered as
  // optional background it "MAY use". That framing is the root of every
  // invention chased for months: parse a rich listing down to six numbers, ask
  // a model to reconstruct an advert from them, and it fills the gaps — which
  // is where "Fully Furnished" appeared on a unit that never claimed it, while
  // the agent's own hook (RM100K below value) and the property name were lost.
  //
  // Editing is a far narrower task than authoring. The job below is: take their
  // words, reshape into their house format, keep every fact, add nothing.
  const rawBlock = (listing.rawText || '').trim()
    ? `

THE AGENT'S OWN LISTING — THIS IS YOUR SOURCE TEXT. You are REWRITING it, not writing a new advert:
"""
${listing.rawText.trim()}
"""

YOUR JOB, EXACTLY:
1. KEEP EVERY FACT above — every price, size, rental figure, yield, distance,
   nearby amenity, selling point, and the property's NAME. If it is in their
   listing it belongs in the caption. Dropping their selling points is as much
   a failure as inventing new ones.
2. ADD NO FACT that is not above. No furnishing, condition, tenure, view,
   travel time, nearby place or "ideal for" that they did not write. If you are
   unsure whether something is in the source, it is not — leave it out.
3. RESHAPE it into the agent's format: their layout, emoji, dividers, spacing,
   ordering and sign-off. THIS is where you make it better — a sharper
   headline, better ordering, cleaner structure, their strongest number given
   the most weight. Better presentation of THEIR facts, never more facts.
4. ALWAYS keep the phone number from the source, exactly as written. Measured:
   with a softer rule the number survived only 2 rewrites in 6 — an advert with
   no phone number is a broken advert. If the style has its own sign-off line,
   keep BOTH: the sign-off, then the number.
5. Checklist before you answer — every one of these that appears in the source
   MUST appear in your caption: the property NAME · every RM figure (asking
   price, monthly rental, ANNUAL rental, savings/below-value) · size · yield or
   ROI · every named nearby place, amenity and travel time · the phone number.
   Re-read the source and confirm each one is present before returning.`
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

  // The agent's format goes FIRST, not buried after the facts. Measured
  // 2026-09-02: with the style mid-prompt, both Gemini and Groq returned a
  // flowing paragraph and ignored the CAPS headline, the 📍 line, the ━ dividers
  // and the double-spacing. Moving the same style to the top — with an explicit
  // "reproduce the STRUCTURE" instruction — produced the agent's layout almost
  // exactly. The model was never the problem; the ordering was.
  // Corrections this agent has already made. They are here, above the listing,
  // because an agent should never have to give the same correction twice - that
  // is the whole promise of a trainable assistant.
  const ruleList = (Array.isArray(rules) ? rules : []).filter(Boolean)
  const rulesBlock = ruleList.length
    ? `THIS AGENT'S OWN RULES — they told you these; follow every one:
${ruleList.map((r) => `- ${r}`).join('\n')}

`
    : ''

  const styleFirst = styleActive
    ? `${styleBlock}

REPRODUCE THAT FORMAT. The layout, emoji placement, CAPS, dividers and blank-line
spacing must match the examples in STRUCTURE — not just in tone. This overrides
every craft note below where they conflict; if the style is a rigid template,
follow the template.

`
    : ''

  // "You write marketing copy" invited authoring. The job is to take a Kuching
  // agent's own listing and present it better - an editor's job, not a writer's.
  return `You are an expert property EDITOR for agents in Kuching, Sarawak. Agents send you their own listing; you republish it in their house format, sharper and better organised. You never add facts they did not give you, and you never drop the selling points they did.

${rulesBlock}${styleFirst}LISTING FACTS:
${facts}${rawBlock}
${styleActive ? '' : styleBlock}
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
- NEVER INVENT PRICE HISTORY. "below value" / "below bank value" is a COMPARISON,
  not a previous asking price. Do NOT write "was RM438,000, NOW ONLY RM338,000",
  do not add an earlier price, and do not write "PRICE REDUCED" or "PRICE DROP"
  unless the listing itself states an earlier asking price or an actual reduction.
  Measured 2026-09-02: given "RM338,000, RM100k below value" the model produced
  "RM438,000 / NOW ONLY RM338,000 / PRICE REDUCED" — inventing a reduction that
  never happened. In a property advert that is a misleading claim, not a flourish.
  State a bank value as a bank value (🏦) and a saving as a saving (💥).
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
export function buildReelPrompt(listing, styleGuide, rules) {
  // A reel is the agent's advert too. It used to receive neither their trained
  // style nor the rules they had taught the system, so an agent could correct
  // the caption a dozen times and the reel would keep making the same mistake -
  // exactly the "don't make the same mistake twice" complaint, on the surface
  // the client sees most.
  const ruleList = (Array.isArray(rules) ? rules : []).filter(Boolean)
  const rulesBlock = ruleList.length
    ? `\nTHIS AGENT'S OWN RULES — they told you these, follow every one:\n${ruleList.map((r) => `- ${r}`).join('\n')}\n`
    : ''
  const voiceBlock = (styleGuide?.style || '').trim()
    ? `\nTHE AGENT'S VOICE — match this tone (the reel is spoken, so adapt the format, keep the voice):\n${String(styleGuide.style).slice(0, 1200)}\n`
    : ''
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
${rulesBlock}${voiceBlock}

LISTING:
${facts}

"script" = the SPOKEN voiceover, English, energetic and punchy for a 15-20 second TikTok:
- Open with a 1-line HOOK that stops the scroll (not "check out this property").
- Then 2-3 punchy selling points. IMPORTANT: the price, bedrooms, bathrooms and
  square footage are ALREADY shown on screen for the whole video in a caption bar.
  Reading them out as well makes the reel feel cluttered and repetitive — the
  viewer sees and hears the same three facts at once. Say the price at most ONCE
  (it is the headline), and do NOT recite beds/baths/sqft. Spend the words on what
  the numbers cannot show: the standout feature, the condition, the location's
  practical advantage, who it suits based ONLY on stated facts.
- End with a fast CTA (e.g. "DM before it's gone").
- 35-55 words total, ~3-5 short sentences. Spoken style: write numbers as words a voice reads naturally (say "four ninety-eight thousand" not "RM498,000"; "seven ninety-seven square feet"). No emojis, no hashtags, no markdown — it's read aloud.
- EVERY WORD must be traceable to the facts above. This is spoken aloud under
  the agent's name, so an invented detail is the agent lying to a buyer. Do not
  reach for atmosphere: no "hidden gem", "vibrant", "prime", "sought-after",
  "just dropped", "won't last" — none of those are facts about this property.
- Only use facts above; never invent. NO invented views, no invented buyer type
  ("perfect for young professionals"), no invented nearby amenities. A floor number
  is not a view. If the listing says "negotiable" or gives a floor, USE those — real
  specifics are what make it sound like an agent instead of an advert.

"caption" = the TikTok post caption. A published reel came back reading only
"Ready to invest in Kuching? #KuchingProperty #Sarawak" — a viewer learned
nothing, and TikTok captions are searchable, so an empty one is a wasted
listing. Write 3-5 SHORT lines carrying the real details, then 4-6 hashtags:
- line 1: the property NAME and what it is (for sale / for rent)
- then: the price, the size and beds/baths, and the single strongest number the
  listing gives (below-value saving, rental income or yield) — one per line
- last line: how to reach the agent
- then the hashtags
Use ONLY facts from the listing above; invent nothing. Emojis are fine here.`
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

/** READLISTING: photos/screenshots of a listing → the text that is actually in
 *  them. OCR, not extraction: the parse prompt above turns text into fields, so
 *  this one only has to read. */
export function buildReadListingPrompt(count) {
  return `You are transcribing ${count} image${count === 1 ? '' : 's'} an estate agent in Kuching, Sarawak sent: photos or screenshots of a property listing (a WhatsApp message, a flyer, a poster, a portal page). Read the text out of them.

You are a TRANSCRIBER, not a copywriter and not an analyst. Transcribe what is visibly written. Nothing else.

HARD RULES — a wrong number here becomes a wrong number on a real public listing, and that is worse than no OCR at all:
- NEVER infer, complete, correct or reformat a PRICE, a PHONE NUMBER or a SIZE. Copy the digits exactly as printed, including "k", "juta", "RM", "/month", "sq ft", spaces and dashes. If a digit is blurred, cropped or ambiguous, do NOT guess the whole number — leave that value out of "text" and name the field in "unreadable".
- NEVER add a fact that is not printed in the image: no bedrooms, no tenure, no furnishing, no area name, no agent name you cannot actually read.
- Do not translate. Keep the original language and mixed English/Malay/Chinese exactly as written.
- Do not tidy the wording. Keep the agent's own lines, emoji and ordering; keep line breaks.
- If the images contain no listing text at all (they are only photos of rooms), return an empty "text" and confidence "none". An empty answer is a correct answer.

Return ONLY a JSON object — no markdown, no code fences, no commentary:
{
  "text": string,              // the transcription, verbatim, line breaks kept. "" if there is no readable listing text.
  "confidence": "high" | "medium" | "low" | "none",
                               // high = every character is crisp; medium = readable but some doubt;
                               // low = you had to strain; none = nothing readable.
  "unreadable": string[]       // names of fields you could NOT read cleanly, e.g. ["price","phone"].
                               // Anything you left out because you were unsure MUST be named here.
}`
}
