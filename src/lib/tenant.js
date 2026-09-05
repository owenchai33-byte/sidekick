// WHICH AGENT IS THIS BROWSER?
//
// Until now the app had no answer anywhere. `?profile=` was read by exactly two
// screens (Connect and Style) straight out of the hash, and AppShell navigates
// with bare paths (`to="/"`, `to="/connect"`), so the query died the moment the
// agent tapped a nav item. Everything else — the home feed, the posting buttons,
// the account list — sent no identity at all and got whatever the server's
// default happened to be. That default was the cross-tenant hole.
//
// So the profile from the agent's own SideKick link is captured ONCE, on the
// first load that carries it, and kept in localStorage. From then on every
// screen can say whose data it wants, including after a nav tap, a refresh, or
// a return from the OAuth redirect.
//
// TWO THINGS THIS IS NOT:
//   * Not a login. A profileId is in the link WhatsApped to the agent, in their
//     address bar, and in /api/ingest's response body. It scopes data so one
//     tenant does not ACCIDENTALLY see another's — the realistic failure at 50
//     agents — and it stops nothing deliberate.
//   * Not a lockout. Nothing here can refuse anybody: a device with no stored
//     profile behaves as an agent who has not opened their link yet, and the
//     screens say so in words.
//
// `t` is the optional per-profile link token (api/_lib/tenant.js mints it). No
// link in anyone's WhatsApp carries one yet, because the two scripts that
// compose those links live outside this repo — so it is forwarded when present
// and never required.

const PROFILE_KEY = 'sidekick.profile'
const TOKEN_KEY = 'sidekick.linkToken'

// HashRouter keeps the query INSIDE window.location.hash, not in .search.
function fromHash(name) {
  try {
    const h = window.location.hash || ''
    const i = h.indexOf('?')
    if (i !== -1) {
      const v = new URLSearchParams(h.slice(i + 1)).get(name)
      if (v) return v
    }
    // A link pasted without the hash (`?profile=…#/connect`) still works.
    return new URLSearchParams(window.location.search || '').get(name) || ''
  } catch { return '' }
}

function read(key) {
  try { return window.localStorage.getItem(key) || '' } catch { return '' }
}
function write(key, value) {
  try { if (value) window.localStorage.setItem(key, value) } catch { /* private mode — the link still works for this page load */ }
}

/**
 * Capture `?profile=` / `?t=` from the current URL, if present, and remember
 * them. Safe to call on every render and every hashchange.
 */
export function captureProfileFromUrl() {
  const p = fromHash('profile')
  if (p) write(PROFILE_KEY, p)
  const t = fromHash('t')
  if (t) write(TOKEN_KEY, t)
  return p || read(PROFILE_KEY)
}

/** This device's agent profile: the one in the URL, else the one remembered. */
export function getProfile() {
  return fromHash('profile') || read(PROFILE_KEY)
}

/** The link token, when the agent's link carried one. Usually ''. */
export function getLinkToken() {
  return fromHash('t') || read(TOKEN_KEY)
}

/** `{ profile, t }` for a POST body — omits what it does not have. */
export function tenantFields() {
  const profile = getProfile()
  const t = getLinkToken()
  return { ...(profile ? { profile } : {}), ...(t ? { t } : {}) }
}

/** `profile=…&t=…` for a query string, or '' when this device has no profile. */
export function tenantQuery() {
  const profile = getProfile()
  if (!profile) return ''
  const t = getLinkToken()
  return `profile=${encodeURIComponent(profile)}${t ? `&t=${encodeURIComponent(t)}` : ''}`
}
