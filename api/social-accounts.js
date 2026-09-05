// Portal: list the social accounts an agent has connected for their profile, so
// the Connect screen can show status and the post flow knows which accountIds to
// target.  GET /api/social-accounts?profile=<profileId>
//
// `profile` is now REQUIRED. It used to fall back to defaultProfile(), which
// meant a bare GET enumerated the pilot tenant's live accounts — and, under
// Zernio, a hardcoded profile constant that is now gone.
//
// WHAT THIS IS STILL NOT: authentication. A profileId is in every Connect link
// WhatsApped to a client and in their address bar, so anyone holding one can
// still list that agent's accounts. The account ids in this response are what
// /api/social-disconnect takes, which is why the refusal that matters lives
// there — membership checked, and never on an id alone.
//
// Every caller was enumerated before this was tightened:
//   src/pages/ConnectPage.jsx:53   sends ?profile= (from the link, or the one
//                                  this browser stored from it)
//   src/pages/CreatePostPage.jsx   now sends the stored profile; it sent none
//                                  before, so in production it has been getting
//                                  a 502 and rendering zero accounts already
//   ~/.openclaw/tools/healthcheck.mjs:150   sends ?profile=
//   ~/.openclaw/tools/selftest.mjs:215,224  sends ?profile= (one of them a
//                                  deliberate cross-tenant leak probe)
// Both crons read only `a.platform`, never `a.id`.
import { connectedAccounts, providerConfigured } from './_lib/social.js'

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}

export default async function handler(req, res) {
  const { configured } = providerConfigured()
  if (!configured) return send(res, 501, { error: 'Posting provider not connected — set its API key in Vercel' })

  let q
  try { q = new URL(req.url, 'http://localhost').searchParams } catch { q = new URLSearchParams() }
  const profileId = (q.get('profile') || '').trim()
  if (!profileId) {
    return send(res, 400, {
      error: 'profile is required — open your own SideKick link (it carries ?profile=). There is no default account list.',
      accounts: [],
    })
  }
  try {
    return send(res, 200, { accounts: await connectedAccounts(profileId) })
  } catch (e) {
    return send(res, 502, { error: e?.message || String(e) })
  }
}
