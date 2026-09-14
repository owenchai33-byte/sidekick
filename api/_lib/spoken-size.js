// THE FLOOR AREA IS ON SCREEN, SO THE VOICE DOES NOT SAY IT.
//
// Edward's Penview reel, 2026-09-14: "It's 742.7 sq ft and priced at RM 198,000"
// — the voice spent 2.6 seconds on "seven hundred forty-two point seven square
// feet" while the price bar above the photo already read "742.7 sqft" for the
// whole video. buildReelPrompt has told the model not to recite the square
// footage since 2026-09-11, and it recited it anyway. A rule the model can skip
// is not a rule, so the script is fixed here, after the model, every time.
//
// Only when the bar really shows it: the reel's info line carries the size only
// when the parse found `sqft` (sidekick.mjs `L.sqft != null`). A land size in
// points or acres is not on the bar, so it stays in the voice.
//
// Nothing is rewritten, only taken out: the size phrase and the words that only
// existed to carry it ("with", "of space", a trailing "and"). A sentence that is
// left with nothing to say ("It's.", "The shoplot is.") is dropped whole.

const NUM = String.raw`\d[\d,]*(?:\.\d+)?`
const UNIT = String.raw`(?:sq\.?\s*ft\.?|sqft|square\s+(?:feet|foot)|sf)(?![a-z])`
const SIZE = new RegExp(String.raw`\b${NUM}\s*-?\s*${UNIT}`, 'i')
// The size, the words in front of it that only introduce it, what follows it
// that only belongs to it, and the joint to the next phrase.
const PHRASE = new RegExp(
  String.raw`(?:\b(?:with|at|offering|spanning|measuring|boasting|featuring|about|around|roughly|over|nearly|approximately|approx\.?|a|an|spacious|generous|whopping)\s+)*` +
  String.raw`\b${NUM}\s*-?\s*${UNIT}` +
  String.raw`(?:\s+(?:of\s+)?(?:floor\s+)?(?:space|built-?up(?:\s+area)?|area))?` +
  String.raw`(?:\s*,\s*|\s+and\s+|\s+with\s+|\s+)?`,
  'gi')
// A sentence ending on one of these lost the thing it was saying.
const DANGLING = /\b(?:is|are|it['’]s|its|at|of|with|and|a|an|the|has|offers|measures|spans|about|around|over|just|only)\s*$/i

// "It's 742.7 sq ft and <rest>" — the commonest shape, and the one plain removal
// breaks: live 2026-09-14 it turned "It's 742.7 sq ft and the SNP… are split"
// into "It's the SNP… are split". What follows the joint decides the repair.
const SUBJECT_SIZE = new RegExp(
  String.raw`^(it['’]s|it is|that['’]s|(?:this|the) (?:[\w-]+ ){0,2}is)\s+(?:(?:about|around|roughly|over|nearly|a|an|spacious|generous)\s+)*` +
  String.raw`${NUM}\s*-?\s*${UNIT}(?:\s+(?:of\s+)?(?:floor\s+)?(?:space|built-?up(?:\s+area)?|area))?\s*(,|\band\b|\bwith\b)?\s*([\s\S]*)$`, 'i')
// A new clause starts here: its own subject, so the size clause goes whole.
const CLAUSE_START = new Set(['the', 'a', 'an', 'it', 'its', "it's", 'it’s', 'you', "you'll", 'you’ll', 'your', 'we', 'there', 'this', 'that', 'these', 'those', 'their', 'our', 'plus', 'and'])
const VERB_S = new Set(['has', 'comes', 'sits', 'offers', 'includes', 'features', 'boasts', 'gives', 'gets', 'faces', 'looks'])
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1)

/** Repair "<It's> <size> <joint> <rest>". null when the sentence is another shape. */
function subjectRepair(body) {
  const m = SUBJECT_SIZE.exec(body.trim())
  if (!m) return null
  const [, subject, joint = '', restRaw] = m
  const rest = restRaw.trim()
  if (!rest) return ''
  const first = rest.split(/\s+/)[0].toLowerCase().replace(/[^a-z'’]/g, '')
  const bare = /^(?:it['’]s|it is)$/i.test(subject) ? 'It' : /^that['’]s$/i.test(subject) ? 'That' : cap(subject.replace(/\s+is$/i, ''))
  if (/^with$/i.test(joint)) return `${bare} comes with ${rest}`
  if (CLAUSE_START.has(first)) return cap(rest.replace(/^and\s+/i, ''))
  if (VERB_S.has(first)) return `${bare} ${rest}`
  return `${cap(subject)} ${rest}`
}

/** True when the spoken script states a floor area the price bar already shows. */
export function saysSize(script, listing) {
  return listing?.sqft != null && SIZE.test(String(script || ''))
}

/** The script with the floor area taken out. Unchanged when there is nothing to take. */
export function dropSpokenSize(script, listing) {
  const s = String(script || '')
  if (!saysSize(s, listing)) return s
  // "sq. ft." carries full stops of its own, and "742.7" a decimal point; neither
  // ends a sentence. A sentence ends at . ! or ? followed by a space or the end.
  const src = s
    .replace(/\bsq\.\s*ft\.(?=\s+[a-z])/g, 'sq ft')        // "sq. ft. and priced" — mid-sentence
    .replace(/\bsq\.\s*ft\b/gi, 'sq ft')                    // "sq. ft." ending one keeps its full stop
  const sentences = src.match(/(?:[^.!?]|[.!?](?!\s|$))+[.!?]*(?:\s+|$)/g) || [src]
  const kept = []
  for (const sentence of sentences) {
    if (!SIZE.test(sentence)) { kept.push(sentence.trim()); continue }
    const stop = (sentence.match(/[.!?]+\s*$/) || [''])[0].trim()
    const repaired = subjectRepair(sentence.replace(/[.!?]+\s*$/, ''))
    if (repaired !== null) {
      if (repaired.split(/\s+/).filter(Boolean).length >= 3 && !DANGLING.test(repaired)) kept.push(`${repaired}${stop || '.'}`)
      continue
    }
    let t = sentence.replace(PHRASE, ' ')
    const end = (t.match(/[.!?]+\s*$/) || [''])[0].trim()
    let body = t.replace(/[.!?]+\s*$/, '')
      .replace(/\s+,/g, ',').replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ')
      .replace(/^[\s,;:\-–—]+|[\s,;:\-–—]+$/g, '')
    const words = body.split(/\s+/).filter(Boolean)
    if (words.length < 3 || DANGLING.test(body)) continue
    // Capitalise only when the size phrase was the start of the sentence.
    if (/^[a-z]/.test(body) && !/^[a-z]/.test(sentence.trim())) body = body.charAt(0).toUpperCase() + body.slice(1)
    kept.push(`${body}${end || '.'}`)
  }
  const out = kept.join(' ').trim()
  // Never an empty voiceover: a script that was nothing but the size keeps it.
  return out || s
}

/**
 * The listing as the reel writer should read it: every floor area taken out, and
 * a line left holding only its label ("Built-up:") dropped. What the model never
 * reads, it cannot say.
 */
export function withoutSize(text) {
  const size = new RegExp(String.raw`\b${NUM}\s*-?\s*${UNIT}(?:\s+(?:of\s+)?(?:floor\s+)?(?:space|built-?up(?:\s+area)?|area))?`, 'gi')
  const out = []
  for (const line of String(text || '').split('\n')) {
    if (!line.match(size)) { out.push(line); continue }
    const t = line.replace(size, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').replace(/[\s,;|•·]+$/, '').trim()
    // Nothing left, or only the label that introduced the size ("Built-up Area:").
    if (!t || /^[^\p{L}\p{N}]*$/u.test(t) || (/[:：]$/.test(t) && t.split(/\s+/).length <= 4)) continue
    out.push(t)
  }
  return out.join('\n')
}
