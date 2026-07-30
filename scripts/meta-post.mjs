#!/usr/bin/env node
/**
 * meta-post.mjs — the "hands" for auto-posting.
 *
 * Posts an image + caption to a Facebook Page and/or an Instagram (Business)
 * account using Meta's OFFICIAL Graph API. This is the safe path — no browser
 * automation, no ban risk. It's the same mechanism Buffer/Hootsuite use.
 *
 * It reads credentials from environment variables (never hard-code a token):
 *   META_PAGE_ID      — your Facebook Page's numeric ID
 *   META_PAGE_TOKEN   — a Page access token with pages_manage_posts (+ for IG:
 *                       instagram_content_publish, instagram_basic)
 *   META_IG_USER_ID   — (optional) the IG Business account id linked to the Page
 *
 * Usage:
 *   node scripts/meta-post.mjs --image "https://.../photo.jpg" \
 *        --caption "FOR SALE · Semi-D @ Green Heights · RM1,280,000" --fb --ig
 *
 * Flags: --fb (post to the Page), --ig (post to Instagram), --image, --caption.
 * IG requires a PUBLIC image URL (Meta fetches it), so host the graphic first.
 *
 * Get a token to test with fast: developers.facebook.com → your app →
 * Tools → Graph API Explorer → select your Page → add the permissions above →
 * Generate Access Token → copy. (That token is short-lived; the real app will
 * mint long-lived tokens via OAuth — this script is just to see it work today.)
 */

const GRAPH = 'v21.0' // bump to the current Graph API version if Meta deprecates this

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = arr[i + 1]
      acc.push([key, next && !next.startsWith('--') ? next : true])
    }
    return acc
  }, []),
)

const PAGE_ID = process.env.META_PAGE_ID
const PAGE_TOKEN = process.env.META_PAGE_TOKEN
const IG_USER_ID = process.env.META_IG_USER_ID
const image = args.image
const caption = typeof args.caption === 'string' ? args.caption : ''

function die(msg) {
  console.error(`\n❌ ${msg}\n`)
  process.exit(1)
}

if (!image) die('Pass --image <public image URL>.')
if (!PAGE_TOKEN) die('Set META_PAGE_TOKEN (see the header of this file).')
if (!args.fb && !args.ig) die('Pass --fb and/or --ig to choose where to post.')

async function graph(path, params) {
  const url = `https://graph.facebook.com/${GRAPH}/${path}`
  const body = new URLSearchParams({ ...params, access_token: PAGE_TOKEN })
  const res = await fetch(url, { method: 'POST', body })
  const json = await res.json()
  if (!res.ok || json.error) {
    throw new Error(`${path} → ${json.error?.message || res.status} ${JSON.stringify(json.error || json)}`)
  }
  return json
}

// ── Facebook Page ──────────────────────────────────────────────────────────
async function postToPage() {
  if (!PAGE_ID) die('Set META_PAGE_ID to post to the Page.')
  console.log('→ Posting to Facebook Page…')
  const out = await graph(`${PAGE_ID}/photos`, { url: image, caption })
  console.log(`✅ Facebook Page post created: ${out.post_id || out.id}`)
}

// ── Instagram (2-step: create container → publish) ──────────────────────────
async function postToInstagram() {
  if (!IG_USER_ID) die('Set META_IG_USER_ID to post to Instagram.')
  console.log('→ Creating Instagram media container…')
  const container = await graph(`${IG_USER_ID}/media`, { image_url: image, caption })
  console.log(`   container ${container.id} — publishing…`)
  const out = await graph(`${IG_USER_ID}/media_publish`, { creation_id: container.id })
  console.log(`✅ Instagram post published: ${out.id}`)
}

try {
  if (args.fb) await postToPage()
  if (args.ig) await postToInstagram()
  console.log('\n🎉 Done — go check your feed.\n')
} catch (e) {
  die(e.message)
}
