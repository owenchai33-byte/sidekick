// THE AGENT'S FORMAT, MEASURED.
//
// The repair round used to be judged by one number: did the new caption have
// fewer contract findings than the old one? That number cannot see format. On
// 2026-09-11 a caption in Owen's trained layout — full ━━━━ rules, one property
// detail per line, double-spaced — was swapped for one with a single "━", every
// detail crammed onto one line and two sections gone, because the flat one had
// fewer findings. The agent pays for the format; losing it is a failure too.
//
// This measures the shape of a caption — not its words — so a repair that
// throws the format away can be told apart from one that fixed a word in place.

// A line made only of rule characters: ━━━━━, -----, ═══, ___ .
const RULE_LINE = /^[\s━─═—–_=~\-]+$/

/** The shape of a caption: content lines, rule lines, longest rule, spacing. */
export function captionShape(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  const body = lines.filter((l) => l.trim())
  const rules = body.filter((l) => RULE_LINE.test(l) && /[━─═—–_=~\-]/.test(l))
  const gaps = lines.length - body.length
  return {
    lines: body.length,
    rules: rules.length,
    longestRule: rules.reduce((n, l) => Math.max(n, [...l.trim()].length), 0),
    // blank lines per content line: ~1 when double-spaced, ~0 when bunched
    spacing: body.length ? gaps / body.length : 0,
  }
}

/**
 * Did `after` keep the format of `before`? Returns the first way it did not,
 * or null when it did. Each test only fires when `before` actually HAS the
 * feature, so an agent whose style has no dividers or no double spacing is never
 * held to one.
 */
export function formatLost(before, after) {
  const b = captionShape(before), a = captionShape(after)
  if (b.rules >= 2 && a.rules < Math.ceil(b.rules / 2)) return `dividers ${b.rules} → ${a.rules}`
  if (b.longestRule >= 5 && a.longestRule < 3) return `divider ${'━'.repeat(Math.min(b.longestRule, 15))} → ${a.longestRule ? '━'.repeat(a.longestRule) : 'none'}`
  if (b.spacing >= 0.6 && a.spacing < 0.35) return 'double spacing collapsed'
  if (b.lines >= 8 && a.lines < Math.ceil(b.lines * 0.6)) return `lines ${b.lines} → ${a.lines}`
  return null
}
