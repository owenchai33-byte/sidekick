# SideKick — Session Log: Content Polish + Auto-Posting Build

_A complete record of a long working session on SideKick (the Kuching property
marketing app for Edward → TRR's ~30 agents). Covers the reel/video/photo
polish, the entire auto-posting exploration, and the working Make.com
integration that shipped live._

> **TL;DR — what's live right now:**
> On **sidekick-beryl-eight.vercel.app**, open a listing → tap **“Auto-post FB + IG”** →
> it posts the caption + a **native photo** to the Facebook Page (**psycho.pass**),
> **one click, free, no Meta developer app, no ban risk.** Runs through a **Make.com**
> scenario. Instagram + video are the next phase (see Roadmap).

---

## 1. The headline result

We shipped **one-tap auto-posting** wired into the app:

```
Tap "Auto-post FB + IG" in SideKick
      │
      ▼
/api/social-post   (Vercel serverless function, holds the webhook URL)
      │  POST { caption, imageUrl, platforms }
      ▼
Make.com webhook  →  HTTP "Download a file" (fetch the image)  →  Facebook "Upload a Photo"
      │
      ▼
Native photo post on the FB Page (psycho.pass)
```

- Verified working **locally** and on **production** (Vercel returned `{ok:true}` and the post landed).
- **Cost: $0** — Make free tier (~1,000 ops/month). Make owns the approved Meta app, so **we never touched Facebook's developer portal.**

---

## 2. The auto-posting system (architecture + how it works)

### 2.1 SideKick side (code, shipped to Vercel)

| File | Role |
|---|---|
| `api/social-post.js` | Serverless proxy. Receives `{caption, imageUrl, platforms}` from the browser, forwards to the Make webhook (`MAKE_WEBHOOK_URL`, server-side only). Returns `{ok:true}` or a clear error. Gracefully 501s if not configured. |
| `src/lib/social.js` | Client helper: `postToSocial()` (builds an absolute public image URL, calls the endpoint) + `captionFor()` (picks the best generated caption). |
| `src/pages/ListingDetailPage.jsx` | The **“Auto-post FB + IG”** button in the action bar (next to “Post everywhere”) + `autoPost()` handler with toasts. |
| `vite.config.js` | Mounts `/api/social-post` in dev too (Vite middleware), exposes `MAKE_WEBHOOK_URL`. |

**Config / env vars (never committed):**
- `MAKE_WEBHOOK_URL` — the Make Custom-webhook URL. Lives in:
  - `scripts/.env` (for the CLI test scripts, gitignored)
  - root `.env.local` (for the local dev app function, gitignored)
  - **Vercel → Settings → Environment Variables** (for production)
- ⚠️ The raw webhook URL is a **capability secret** (anyone with it can trigger a post) — it is **deliberately kept out of this doc**. Find it in `scripts/.env`.

### 2.2 Make.com scenario (built in the Make UI)

```
[Custom webhook: "sidekick"]  →  [HTTP: Download a file]  →  [Facebook Pages: Upload a Photo]
     caption / imageUrl              URL = imageUrl              File name = HTTP File name
     / platforms                                                 Data      = HTTP Data
                                                                 Caption   = caption
```

- **Why the HTTP “Download a file” step:** Facebook’s “Upload a Photo” module needs the image as **binary** (File name + Data), not a URL. The HTTP module downloads the image from `imageUrl` and hands over the binary. Result = a **native photo post**, not a link-card.
- FB Page connected: **psycho.pass** (connection named “SideKick (Owen Chai)”).
- The webhook “learns” its fields (`caption`, `imageUrl`, `platforms`) only when it’s in **Detect new values** mode and receives a request — that’s why we fire a test payload during setup.

### 2.3 The CLI test scripts (in `scripts/`, for proving the pipe without the app)

| Script | What it does |
|---|---|
| `scripts/make-post.mjs` | Sends `{caption, imageUrl, platforms}` to the Make webhook (the path the app uses). **This is the one currently in use.** |
| `scripts/ayrshare-post.mjs` | Posts via **Ayrshare** API (alternative provider — not used, kept as a fallback). |
| `scripts/meta-post.mjs` | Posts directly via **Meta Graph API** (for when/if the own-app path works — $0 at scale). |
| `scripts/meta-token.mjs` | Mints a long-lived (non-expiring) Meta Page token from one short-lived token. |
| `scripts/.env.example` | Template for all the above keys. Copy to `scripts/.env` (gitignored). |

Run any with:
```bash
node --env-file=scripts/.env scripts/make-post.mjs \
  --caption "🏡 FOR SALE ..." --media "https://.../photo.jpg"
```

### 2.4 How to use it (the one-click)

1. Go to **sidekick-beryl-eight.vercel.app** (auto-post only works on the **Vercel** deploy — the GitHub Pages mirror is static, no serverless).
2. Open any listing.
3. Tap **“Auto-post FB + IG”** in the action bar.
4. It posts the caption + the listing’s photo to the FB Page automatically.

> **Honest note on the label:** the button says “FB + IG” and *sends* both platforms, but the Make scenario currently has **only a Facebook module**, so today it posts to **FB only**. Add the Instagram module and the same click hits IG too.

---

## 3. Everything built this session (full deliverable list)

### 3.1 Reel animation overhaul — `src/components/PropertyVideo.jsx`
Brought the polish of the onboard video into the canvas/WebCodecs Reel:
- **Story-style segmented progress bar** (Instagram/TikTok-style, one segment per beat)
- **Branded intro** — mint “FOR SALE” pill (easeOutBack pop), big price with an accent underline that draws out, subtitle
- **Accent stat cards** — vertical mint accent bar, big number, uppercase tracked mint label; auto-fit fonts so long values don’t overflow
- **Refined multi-directional Ken Burns** with a settle-pop zoom on photo changes
- **Directional slide + crossfade** caption transitions (no in-place overlap)
- **Cinematic vignette + top scrim**, gradient brand bar
- **Outro** — “Book a viewing” + price + WhatsApp pill (shows when a brand phone is set)
- Verified via the dev-only `window.__pvidFrame(sec)` inspector (all beats render clean, no console errors). Encode pipeline untouched.

### 3.2 30-second onboard video + auto-attach share walkthrough
Project: `~/Documents/sidekick-walkthrough/video/` (Remotion, 1080×1920, 30fps).
- File: `src/Walkthrough.tsx`. Replaced the static “Publish” screenshot in **Step 4** with a **fully animated share-flow demo**: tap Share → OS share sheet (real brand icons) → pick Instagram → composer opens with the **photo already attached + “caption copied”** → **“Posted”** success card (“nothing auto-posted · 100% within platform rules”).
- Tightened other scenes to keep total **~31.5s**.
- Rendered: `~/Documents/SideKick-onboard.mp4` (13 MB, full) + `~/Documents/SideKick-onboard-share.mp4` (862 KB, compressed for WhatsApp).
- (Superseded the older `~/Documents/SideKick-onboard-30s*.mp4` files.)

### 3.3 Photo fallback system — `src/lib/photos.js` (NEW)
- Any listing **without photos** now auto-fills with **type-matched** property images (condo vs landed), picked **deterministically per listing id** so they look distinct and stable.
- Real user/seed photos always win; the photo **uploader is untouched** (fallbacks never look like the user uploaded them).
- Wired into: `ListingsPage`, `ListingDetailPage` (summary grid + PublishSheet), `PropertyGraphic`, `PropertyCarousel`, `PostCard`, `PostPreview`, `lib/kit.js`, `PropertyVideo`.
- Committed + deployed earlier this session (commit `892d5ac`, on Vercel + gh-pages).

### 3.4 Auto-posting integration (section 2) — commit `0225512`, deployed to Vercel.

**Git state:** working on `main` (the deploy branch; `ALLOW_DEPLOY=1 git push` per the pre-push hook). Two commits this session: `892d5ac` (photo fallback + reel) and `0225512` (auto-posting).

---

## 4. The full journey & decisions (how we got here)

This was a long, winding exploration. The condensed story:

1. **Goal:** let SideKick auto-post listings for Edward’s ~30 agents, safely and cheaply.
2. **Edward’s vision:** an AI agent that does the posting; he just approves (“ping me → I say yes → it posts”). He’d tried **OpenClaw** (a personal AI agent) and imagined installing a trained bot per agent’s computer.
3. **Reframe delivered:** that “robot per agent” model doesn’t scale to 30, and full-autonomy browser-posting = bans. The **app + official APIs** is the same dream, safely. His approval step = the perfect UX (one-tap approve).
4. **OpenClaw** got installed on the Mac (real, legit; `openclaw 2026.7.1-2`, Claude Code as its brain, gateway running). But **WhatsApp linking failed** — the home router/ISP kept closing the WhatsApp Web socket (“connection ended before fully opening”). Even on a phone hotspot it wouldn’t hold; the phone showed “failed internet connection.” **Telegram was ruled out by Owen.** WhatsApp/OpenClaw chat control was **parked.**
5. **Meta’s own Graph API** ($0 forever, the cheapest at scale) was blocked: creating a Meta **developer app** kept failing with **“No available AuthProof to sign contact point”** / verify-your-account loops, even after clearing the Security Checkup, confirming the phone, and enabling 2FA — for two days. Diagnosis: an account/eligibility gate on Meta’s side (docs point to needing a **Business Portfolio** / app limits). **Abandoned** in favour of a provider.
6. **Mudah / FB Marketplace / FB groups:** confirmed **no posting API exists anywhere** — the only “automation” is browser bots, which violate ToS and get accounts banned. These **stay human-tap / assisted** (auto-prep + one-tap open the form). Owen pushed to build the browser bot anyway; **declined** (won’t build ToS-evasion mass-posting automation — it’d get the agents’ accounts banned and is the exact “SnapPost” trap Edward is positioned against).
7. **Providers compared:**
   - **Ayrshare** — clean multi-user API, but **$599/mo for 30 profiles** (~$20/agent). Too pricey for a pilot.
   - **Make.com** — free tier (~1,000 ops/mo), native FB/IG modules using **Make’s own approved Meta app**, connect via normal OAuth. **Chosen.** ✅
8. **Built it end-to-end** (section 2), tested, and **shipped live.** Upgraded FB from link-card to **native photo** via the HTTP “Download a file” module.

---

## 5. Key facts & numbers (for the Edward pitch)

- **What can be safely auto-posted (official APIs):** Facebook Page, Instagram (Business), TikTok, WhatsApp (Business API). ✅
- **What CANNOT be safely automated (no API anywhere):** FB Marketplace, Mudah, FB groups, personal timelines. Browser bots = **ban wave** at scale. These stay **assisted** (prep + one-tap). ⚠️
- **Cost options for auto-posting:**
  - **Own Meta Graph API app** → **$0 forever** (Meta doesn’t charge for posting). Blocked by the dev-portal bug; the fix path is Business Manager app creation or a fresh account.
  - **Make.com** → **free** tier (~1,000 posts/mo), 1 connection. Chosen for the pilot. Scaling to 30 agents needs a paid Make plan or per-agent connections.
  - **Ayrshare** → **$599/mo for 30** profiles (turnkey multi-user).
- **Lead tracking / “See what works” (the dashboard):** it’s **manual/agent-logged attribution**, not surveillance. Agents log each enquiry + its source platform; the dashboard aggregates enquiries/won/value/win-rate. The **click-to-WhatsApp link** (`waEnquiryLink`) pre-fills “saw it on {platform}”, so the source is handed to the agent. Honest by design — “tracks what you log.”

---

## 6. Hard constraints & guardrails (do not violate)

- **Never auto-post to Marketplace / Mudah / FB groups.** No API; browser bots get accounts banned. Written into Edward’s contract and the whole product’s positioning.
- **Human-in-the-loop:** nothing publishes without a human tap. (Edward’s “I approve → it posts” = this.)
- **Tri-language content** must be generated **natively** per language (EN / 中文 / BM), never machine-translated.
- **Free-tier preference** (Owen avoids paid API keys).
- **Deploy = push to `main`** (Vercel auto-deploys). Pre-push hook blocks it unless `ALLOW_DEPLOY=1`. **Never push to main without Owen’s explicit OK.**
- Keep `npx vitest run` green and `npm run build` clean before shipping. _(Note: vitest isn’t currently wired into this checkout — the clean build is the real gate.)_

---

## 7. Roadmap / what's next

Ordered by effort:

1. **Add Instagram (photo)** — quick (~3 min in Make). Add an **Instagram for Business → Create a Post** module to the same scenario; connect the IG **Business/Creator** account (must be linked to the psycho.pass Page); map **Image URL = `imageUrl`** (IG takes a URL, not binary) + **Caption = `caption`**. Then “FB + IG” is literally true.
2. **Video + all content types** — a real phase, hinges on:
   - **Media hosting (the linchpin).** The branded graphic (canvas) and the Reel (in-browser mp4 blob) have no public URL. FB/IG can only post media they can fetch. Build a SideKick **upload endpoint + storage** (Vercel Blob / Cloudinary) → get a public URL → send it. **This unlocks branded-graphic posts AND video.**
   - **SideKick sends a `mediaType`** (`image` / `video` / `carousel`).
   - **Make Router** — branch: photo → photo module, video → FB **Upload a Video** + IG **Reel**, multiple → carousel.
3. **Branded graphic instead of raw photo** — currently the button posts the listing’s cover photo. Once media hosting exists, post the SideKick-designed graphic/reel.
4. **Scale to 30 agents** — either a paid Make plan (per-agent connections), or revisit the **own Meta app** ($0) via Business Manager, or Ayrshare ($599/mo). The `api/social-post.js` shape stays the same — it’s a backend swap.
5. **(Parked) OpenClaw + WhatsApp/Telegram chat control** — blocked by the local network on WhatsApp; revisit on a clean connection or via Telegram if Owen changes his mind.

---

## 8. Environment / where things live

| Thing | Location |
|---|---|
| SideKick app repo | `~/Documents/sidekick` |
| Live app (auto-post works here) | `sidekick-beryl-eight.vercel.app` |
| Onboard video project | `~/Documents/sidekick-walkthrough/video/` |
| Rendered videos | `~/Documents/SideKick-onboard.mp4`, `…-share.mp4` |
| Make webhook URL | `scripts/.env` (gitignored) + root `.env.local` + Vercel env |
| Make scenario | make.com → your scenario (Webhook → HTTP Download → FB Upload a Photo) |
| FB Page posted to | **psycho.pass** |
| OpenClaw | installed on the Mac (`openclaw` CLI); WhatsApp not linked |

**Env setup to run locally:** `cp scripts/.env.example scripts/.env`, fill `MAKE_WEBHOOK_URL`; for the in-app dev button, also put `MAKE_WEBHOOK_URL` in a root `.env.local`.

---

## 9. Chronological timeline (the whole session, condensed)

1. Improved the in-app **Reel animations** (story bar, branded intro/outro, accent cards, refined Ken Burns).
2. Built the **auto-attach share walkthrough** into the 30s **onboard video**; re-rendered (~31.5s).
3. Added the **photo fallback** so image-less listings look photographed; deployed (`892d5ac`).
4. Explained the **lead-tracking dashboard** (manual attribution + click-to-WhatsApp).
5. Long **auto-posting exploration:** OpenClaw (installed; WhatsApp link failed on the network), Meta Graph API (dev-portal AuthProof bug, 2 days, abandoned), Mudah/Marketplace reality (no API; declined the browser bot), Ayrshare vs Make.
6. Chose **Make.com** (free, no Meta app). Built `scripts/make-post.mjs` + `api/social-post.js` + `src/lib/social.js` + the **Auto-post button**; deployed (`0225512`) and set the Vercel env var.
7. Set up the **Make scenario** click-by-click (webhook → HTTP Download a file → FB Upload a Photo); fired tests; confirmed a **native photo** post on **psycho.pass**.
8. Confirmed **one-tap auto-post is live** on the deployed app.
9. Next: add **Instagram**, then the **video / all-content** phase (needs media hosting).

---

_End of log. Generated by Claude Code (Opus 4.8), 2026-07-30._
