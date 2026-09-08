# Switching SideKick to Zernio

Why: a client's property Facebook Page never appears in the connect picker.
PostPeer's Meta app asks for five permissions, all `pages_*`, and **not**
`business_management` — which Meta requires to list Pages held in a Business
Portfolio. The same client had no trouble on Zernio, whose app does ask for it.

**The one thing no code can do:** an OAuth grant belongs to the provider's Meta
and TikTok apps. All three agents must reconnect their socials once. Nothing in
this runbook avoids that, and pretending otherwise would be the surprise that
ruins switch day.

**What is already safe:** identity no longer depends on the provider. Each
agent's `style`, `rules` and `brand` are keyed by an agent id that is *seeded to
the id they already have* — so nothing moves, nothing is copied, no Connect link
is re-sent and no `t=` token is invalidated. Only the *posting target* is looked
up per provider.

---

## Phase 0 — before any code

1. Confirm what you are protecting. Verified on production 2026-09-08:
   ```
   node tools/migrate-agent.mjs --show 6a90f9f6f59d1531f8d04018   # Owen   970 chars / 2 examples / 3 rules
   node tools/migrate-agent.mjs --show 6a9ceb0f8737dad86c409a7e   # Edward 970 / 2 / 3
   node tools/migrate-agent.mjs --show 6a9ceacd8737dad86c4099cc   # Wilson empty
   ```
   If any of those differ, **stop** — something has already been lost.

2. Clear Owen's one live pending (approve or skip). The other eleven belong to
   profiles nobody is mapped to; `retire --days 7` clears them once deployed.

3. Pause the rule sweeper for the duration. It writes rules every ten minutes
   with nobody watching:
   ```
   launchctl setenv SIDEKICK_SWEEPER_PAUSED 1     # or set it in the cron's env
   ```
   A flag rather than "disable the cron", because a disabled cron is a step
   somebody forgets to undo.

4. **Owen creates the three Zernio profiles in Zernio and writes the ids down.**
   Not scriptable here — there is no Zernio key on this machine, and a swapped
   row publishes one agent's listing to another agent's Facebook.

## Phase 1 — ship the code with PostPeer still live

5. Deploy with `POSTING_PROVIDER` still unset/postpeer and **no agent records
   written**. `resolvePostingProfile` falls through to the id it was given, so
   behaviour is byte-identical to today.

6. Check: `--show` all three again. Same numbers, and `record` now reads
   *"none — this agent resolves to itself"* rather than *"NOT SUPPORTED"*.
   Then send one real listing through and read the caption: area in CAPS, no
   fire emoji, a condo not called an apartment.

7. Write the three records, each carrying **both** providers:
   ```
   POST /api/style
   { "profile": "<agentId>", "kind": "agent", "label": "Owen",
     "postingProfile": { "postpeer": "<same id>", "zernio": "<new zernio id>" } }
   ```
   (needs `x-ingest-secret`)

8. Check: `/api/social-accounts?profile=<agentId>` still returns each agent's
   **PostPeer** accounts. That proves the map is being read *and* still resolving
   to the postpeer branch while nothing has changed.

## Phase 2 — the flip (Vercel dashboard, Production scope, in this order)

9. Set `ZERNIO_API_KEY`. Leave `ZERNIO_PROFILE_ID` absent.
10. Confirm `ZERNIO_TIKTOK_ACCOUNT_ID` is absent. **Leave `POSTPEER_API_KEY` in
    place — it is the rollback rope.**
11. Set `POSTING_PROVIDER=zernio` — lowercase, no trailing space. Redeploy.
12. **The check that matters:** `--show` all three. Owen and Edward must still
    read 970 / 2 / 3; Wilson empty. **If any changed, set `POSTING_PROVIDER`
    back to `postpeer`.**
13. `/api/social-accounts?profile=<agentId>` → expect **0 accounts, not an
    error**. Zero is correct: nobody has connected on Zernio yet. An *error*
    means the Zernio id in the record is wrong — fix the record, not the code.

## Phase 3 — reconnect, one agent at a time

14. **Owen first, alone.** His existing link works unchanged. Connect Facebook,
    Instagram and TikTok, send one real listing, read the published caption.
15. **Wilson** — and this is the test of the whole exercise: his property Page
    should now appear in the picker.
16. **Edward** — lowest risk, least connected today.
17. Unpause the sweeper. Run `selftest.mjs` and `healthcheck.mjs`.

## If it goes wrong

Flip `POSTING_PROVIDER` back to `postpeer`. Identity never moved, the PostPeer
ids are still in each record, and the PostPeer grants are still live — there is
nothing to undo on either half.

**Do not cancel PostPeer or disconnect a single account until all three agents
have published successfully on Zernio.** Those OAuth grants are the one thing
that cannot be re-created from here.

## What changed in the checks themselves

Two of the verification steps used to produce a **false green**, which is worse
than a false red because nobody goes looking:

- `selftest.mjs` was hardwired to PostPeer. After the flip it would have queried
  PostPeer, seen yesterday's still-active grants, and printed *"3 agent(s) ready
  · all active"* for a system that could publish nothing. It now asks the live
  app which provider is running and **fails** when it cannot verify, naming the
  real reason.
- `healthcheck.mjs` fell back to a hardcoded pilot profile when `tenants.json`
  was empty, so it reported that profile's health as the fleet's. An empty map
  is now the finding.

And one that would have hit a client's page: a Zernio publish polled
`6 × 2000ms` inside **each** of two groups — 24 seconds measured, against a
Vercel function that dies at ~10s. The listing goes live, the function is killed
before the feed record and the dedupe release, and a retry after ten minutes
publishes it a second time. The poll is now bounded by one wall clock across the
whole publish.
