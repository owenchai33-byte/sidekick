# SideKick — Property Listing Studio

Pick → Optimise → Approve → Publish. A tool for Kuching property agents that
automates the **copywriting and staging**, never the judgment. Built as a
proof-of-concept for a small property-agent pilot.

## What it does (Phase 1)

- **Listing input** — paste a raw WhatsApp/listing blob and AI parses the fields, or enter them by hand. Attach photos.
- **Content engine** — generates copy for **6 platforms × 3 languages** (English / 中文 / Bahasa Malaysia), each written **natively per language**, in each platform's own style.
- **Approve** — review every post, edit inline, approve. **Nothing publishes without approval.**
- **Per-listing platform + language selection.**
- **One-tap publish** — copy the finished post and open the platform's compose page. A human pastes and posts.
- **Rules-based filtering** — flags sales > RM600k and rentals > RM2k (thresholds editable in Settings).

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. `npm run dev` runs the app **and** the AI proxy
(`/api/generate`) together — no extra tooling.

### Demo mode vs live

Without an API key the app runs in **demo mode**: it produces realistic,
clearly-labelled *sample* copy so the whole flow is demonstrable offline. To go
live, copy `.env.example` to `.env.local` and add a key:

- **Gemini (free)** — get a key at https://aistudio.google.com/apikey, set `GEMINI_API_KEY`. Default provider.
- **Claude** — set `AI_PROVIDER=claude` and `ANTHROPIC_API_KEY`. Pay-per-use; flip on when revenue covers it.

The key stays server-side (in the dev middleware / Vercel function). The browser never sees it.

## Deploy (Vercel)

Push to a repo, import into Vercel, and set the env vars (`AI_PROVIDER`,
`GEMINI_API_KEY` or `ANTHROPIC_API_KEY`) in the project settings. `api/generate.js`
deploys as a serverless function automatically; `vercel.json` handles SPA routing.

## Architecture notes

- **Swappable data layer** — `src/lib/dataStore.js` is the only place that
  persists. It uses `localStorage` today; reimplement those same async functions
  against **Supabase** (Postgres + Storage + Auth) to ship the real backend.
- **Provider abstraction** — `api/_lib/providers.js` isolates Gemini/Claude
  behind one `runModel()`. Switching providers is one env var.
- **Shared constants** — `shared/constants.js` (platforms, languages, rules) is
  imported by both the client and the serverless function.

## Guardrails (do not build around these)

- **No auto-posting to Facebook Marketplace or Mudah** — no API exists; automation
  = account bans. One-tap only, by design and by contract.
- No browser automation (Puppeteer/Playwright) against any social platform.
- The system never chooses which listing to promote — that judgment stays human.

## Not yet (Phase 2+)

Lead-tracking dashboard + agent attribution + closed-deal logging, true
auto-posting for Facebook Page + Instagram (needs a Meta app + review), and
rules-based auto-drafting. Multi-agent auth (owner as admin) lands with Supabase.
