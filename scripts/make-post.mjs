#!/usr/bin/env node
/**
 * make-post.mjs — send a SideKick listing to a Make.com webhook, which then
 * posts it to Facebook Page + Instagram using Make's built-in modules.
 * No Meta developer app needed — Make owns the approved app; you just connect
 * your accounts inside Make with a normal login. Free tier ≈ 1,000 ops/month.
 *
 * ── One-time setup in Make.com (free) ──────────────────────────────────────
 *   1. New scenario → first module: "Webhooks → Custom webhook" → Add → copy
 *      the webhook URL it gives you.
 *   2. + module: "Facebook Pages → Create a Post" → connect your Page →
 *        Message   = {{1.caption}}
 *        Photo URL = {{1.imageUrl}}
 *   3. (optional) + "Instagram for Business → Create a Photo Post" the same way
 *        Photo URL = {{1.imageUrl}} , Caption = {{1.caption}}
 *   4. Toggle the scenario ON (bottom-left), then paste the webhook URL into
 *      scripts/.env  as  MAKE_WEBHOOK_URL
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *   node --env-file=scripts/.env scripts/make-post.mjs \
 *     --caption "FOR SALE · Semi-D @ Green Heights · RM1,280,000" \
 *     --media "https://picsum.photos/1080"
 *
 * --media must be a PUBLIC image url (Make/FB fetch it). SideKick's generated
 * graphic gets hosted + passed here in the in-app version.
 */

const HOOK = process.env.MAKE_WEBHOOK_URL
const argv = process.argv.slice(2)
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const caption = arg('caption') || ''
const media = arg('media') || ''
const platforms = arg('platforms') || 'facebook,instagram'

function die(m) { console.error(`\n❌ ${m}\n`); process.exit(1) }
if (!HOOK) die('Set MAKE_WEBHOOK_URL in scripts/.env (copy it from your Make "Custom webhook" module).')
if (!caption) die('Pass --caption "your post text".')

const payload = { caption, imageUrl: media, platforms }

console.log('→ Sending listing to your Make scenario…')
const res = await fetch(HOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
const text = await res.text().catch(() => '')
if (!res.ok) die(`Make webhook error (${res.status}): ${text}`)

console.log(`✅ Delivered to Make (${res.status}) — it now posts to ${platforms}.`)
if (text) console.log(`   Make replied: ${text.slice(0, 200)}`)
console.log('\nOpen your Make scenario → History to watch it run, then check your feeds.\n')
