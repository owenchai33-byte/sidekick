#!/usr/bin/env node
/**
 * meta-token.mjs — turn ONE short-lived token into a long-lived (non-expiring)
 * Page token, so you never hand-grab tokens from Graph API Explorer again.
 *
 * Page tokens derived from a long-lived USER token don't expire (until the
 * account changes password / revokes access), so this is a one-time step per
 * account.
 *
 * Steps:
 *   1. In Graph API Explorer, select your app + your Page, add permissions:
 *      pages_show_list, pages_manage_posts, pages_read_engagement,
 *      instagram_basic, instagram_content_publish, business_management
 *      → Generate Access Token → copy it (this short-lived token is fine).
 *   2. Put META_APP_ID + META_APP_SECRET in scripts/.env (secret stays local).
 *   3. Run:
 *      node --env-file=scripts/.env scripts/meta-token.mjs --user-token "EAAB..."
 *
 * It prints the META_PAGE_ID / META_PAGE_TOKEN / META_IG_USER_ID lines to paste
 * into scripts/.env. Then `meta-post.mjs` just keeps working.
 */

const GRAPH = 'v21.0' // bump if Meta deprecates this version

const APP_ID = process.env.META_APP_ID
const APP_SECRET = process.env.META_APP_SECRET
const argv = process.argv.slice(2)
const userToken = argv[argv.indexOf('--user-token') + 1]
const wantPageId = argv.includes('--page-id') ? argv[argv.indexOf('--page-id') + 1] : null

function die(m) { console.error(`\n❌ ${m}\n`); process.exit(1) }
if (!APP_ID || !APP_SECRET) die('Set META_APP_ID and META_APP_SECRET in scripts/.env')
if (!userToken || userToken.startsWith('--')) die('Pass --user-token "<short-lived token from Graph API Explorer>"')

async function get(path, params = {}) {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${path}?${qs}`)
  const json = await res.json()
  if (!res.ok || json.error) throw new Error(`${path} → ${json.error?.message || res.status}`)
  return json
}

try {
  // 1. short-lived user token → long-lived user token (~60 days)
  console.log('→ Upgrading to a long-lived user token…')
  const longUser = await get('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: APP_ID,
    client_secret: APP_SECRET,
    fb_exchange_token: userToken,
  })

  // 2. list Pages you admin + their (non-expiring) page tokens
  const pages = await get('me/accounts', { access_token: longUser.access_token, fields: 'id,name,access_token' })
  const list = pages.data || []
  if (!list.length) die('No Pages found. Make sure the token has pages_show_list and you admin a Page.')

  const page = wantPageId ? list.find((p) => p.id === wantPageId) : list[0]
  if (!page) die(`Page ${wantPageId} not found. Available: ${list.map((p) => `${p.name} (${p.id})`).join(', ')}`)
  if (list.length > 1 && !wantPageId) {
    console.log(`   Multiple Pages found — using "${page.name}". To pick another, re-run with --page-id <id>:`)
    list.forEach((p) => console.log(`     • ${p.name} — ${p.id}`))
  }

  // 3. IG business account linked to the Page (optional)
  let igId = ''
  try {
    const ig = await get(page.id, { access_token: page.access_token, fields: 'instagram_business_account' })
    igId = ig.instagram_business_account?.id || ''
  } catch { /* IG not linked — leave blank */ }

  console.log(`\n✅ Non-expiring token minted for "${page.name}".\nPaste these into scripts/.env:\n`)
  console.log(`META_PAGE_ID=${page.id}`)
  console.log(`META_PAGE_TOKEN=${page.access_token}`)
  console.log(`META_IG_USER_ID=${igId}${igId ? '' : '   # (Instagram not linked to this Page — link a Business/Creator IG to enable IG posting)'}`)
  console.log('')
} catch (e) {
  die(e.message)
}
