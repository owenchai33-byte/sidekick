#!/usr/bin/env node
/**
 * ayrshare-post.mjs — auto-post SideKick content through Ayrshare.
 *
 * Ayrshare is a third-party social API that already owns the approved
 * Meta / TikTok apps — so you NEVER touch Facebook's developer portal. You just
 * connect your Page/IG in the Ayrshare dashboard (a normal OAuth login), and
 * SideKick calls this to publish.
 *
 * One-time setup:
 *   1. Sign up free at ayrshare.com
 *   2. Dashboard → connect your Facebook Page + Instagram (+ TikTok if you want)
 *   3. Copy your API Key → put it in scripts/.env as AYRSHARE_API_KEY
 *      (Per-agent later: each agent gets a Profile Key → AYRSHARE_PROFILE_KEY.)
 *
 * Usage:
 *   node --env-file=scripts/.env scripts/ayrshare-post.mjs \
 *     --caption "FOR SALE · Semi-D @ Green Heights · RM1,280,000" \
 *     --media "https://picsum.photos/1080" \
 *     --platforms facebook,instagram
 *
 * NOTE: --media must be a PUBLIC url (Ayrshare fetches it). SideKick's generated
 * graphic/reel lives in the browser, so the next step is to upload it to public
 * storage and pass that url here — but this proves the pipe end-to-end first.
 */

const API = 'https://api.ayrshare.com/api/post'
const KEY = process.env.AYRSHARE_API_KEY
const PROFILE = process.env.AYRSHARE_PROFILE_KEY // optional — only for multi-user

const argv = process.argv.slice(2)
const arg = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined }
const caption = arg('caption') || ''
const media = arg('media')
const platforms = (arg('platforms') || 'facebook,instagram').split(',').map((s) => s.trim()).filter(Boolean)

function die(m) { console.error(`\n❌ ${m}\n`); process.exit(1) }
if (!KEY) die('Set AYRSHARE_API_KEY in scripts/.env (copy it from your Ayrshare dashboard).')
if (!caption) die('Pass --caption "your post text".')

const body = { post: caption, platforms }
if (media) body.mediaUrls = [media]

const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` }
if (PROFILE) headers['Profile-Key'] = PROFILE

console.log(`→ Posting to ${platforms.join(', ')} via Ayrshare…`)
const res = await fetch(API, { method: 'POST', headers, body: JSON.stringify(body) })
const json = await res.json().catch(() => ({}))

if (!res.ok || json.status === 'error') {
  die(`Ayrshare error (${res.status}): ${json.message || JSON.stringify(json)}`)
}

console.log('✅ Posted:')
for (const p of json.postIds || []) console.log(`   ${p.platform}: ${p.status || 'ok'}  ${p.postUrl || p.id || ''}`)
if (!json.postIds) console.log(JSON.stringify(json, null, 2))
console.log('\n🎉 Done — check your feeds.\n')
