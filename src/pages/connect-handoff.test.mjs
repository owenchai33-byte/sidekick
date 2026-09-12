// THE CONNECT HAND-OFF, PINNED.
//
// 2026-09-12, Wilson: he tapped Connect on Facebook at 10:32:01, the server
// answered 200 with a valid authUrl, and his browser never went to Facebook —
// an in-app browser, or the Facebook app claiming the dialog URL. Six minutes
// later his screenshot still read "Opening…". Two defects made that a dead end,
// and both are ordering, which a browser test cannot hold still:
//
//   1. `busy` was cleared only in the catch — no finally, no timeout — so the
//      button stayed disabled on "Opening…" until a hard refresh, and a
//      bfcache restore brought it back in that state.
//   2. `sk_connecting` was written BEFORE the request, and the account poll
//      2.5s later turned it into "Facebook finished, but no Page came back" —
//      advice about Page admin rights for a Facebook that was never reached.
//
// Verified live in the browser at the time (fallback shown, no false advice,
// button recovered, and a genuine empty return still explained). These
// assertions are what stops the order drifting back.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('./ConnectPage.jsx', import.meta.url), 'utf8')

describe('the connect hand-off cannot strand an agent', () => {
  it('marks the connect as started only AFTER the authUrl comes back', () => {
    const check = SRC.indexOf("throw new Error(j.error || 'Could not start connect')")
    const mark = SRC.indexOf("sessionStorage.setItem('sk_connecting'")
    expect(check, 'the authUrl check exists').toBeGreaterThan(-1)
    expect(mark, 'the flag is written').toBeGreaterThan(-1)
    expect(mark, 'the flag is written after the check, never before').toBeGreaterThan(check)
  })

  it('only explains an empty return on a page that did not start the connect', () => {
    expect(SRC).toMatch(/if \(tried && !startedHere\)/)
    expect(SRC).toMatch(/^let startedHere = false$/m)
    expect(SRC).toMatch(/startedHere = true/)
  })

  it('offers a real link to the platform, so a blocked jump is not a dead end', () => {
    expect(SRC).toMatch(/<a className="btn btn-sm btn-primary" href=\{handoff\.url\}/)
    expect(SRC).toMatch(/setHandoff\(\{ platform, url: j\.authUrl \}\)/)
  })

  it('always releases the button', () => {
    // after the hand-off attempt...
    expect(SRC).toMatch(/setTimeout\(\(\) => setBusy\(''\), \d+\)/)
    // ...and on coming back, including a bfcache restore
    expect(SRC).toMatch(/const refetch = \(\) => \{ if \(!document\.hidden\) \{ setBusy\(''\); load\(\) \} \}/)
  })

  it('warns when the page is open in a browser Facebook will not log in from', () => {
    expect(SRC).toMatch(/isInAppBrowser/)
    expect(SRC).toMatch(/Open this page in Safari or Chrome first/)
  })
})
