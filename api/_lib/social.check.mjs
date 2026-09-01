// Run: node api/_lib/social.check.mjs  — verifies BOTH backends shape their
// requests correctly (auth header, profile scoping, video media, TikTok caption
// handling) with fetch stubbed, so a provider swap can be checked without keys.
// Verify both backends shape their requests correctly, with fetch stubbed.
const calls = []
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null })
  const u = String(url)
  if (u.includes('/connect/integrations')) return json({ integrations: [
    { id: 'pp_fb', platform: 'facebook', username: 'agentfb', authStatus: 'active' },
    { id: 'pp_ig', platform: 'instagram', username: 'agentig', authStatus: 'active' },
    { id: 'pp_tt', platform: 'tiktok', username: 'agenttt', authStatus: 'active' } ] })
  if (u.includes('/accounts?')) return json({ accounts: [
    { _id: 'z_fb', platform: 'facebook', username: 'agentfb' },
    { _id: 'z_tt', platform: 'tiktok', username: 'agenttt' } ] })
  if (u.includes('/connect/')) return json(u.includes('postpeer') ? { url: 'https://pp/oauth' } : { authUrl: 'https://z/oauth' })
  if (u.includes('/posts')) return json({ ok: true })
  return json({})
}
const json = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) })

let fails = 0
const check = (label, cond, extra='') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  <- ' + extra}`); if (!cond) fails++ }

async function run(providerName, envKey) {
  process.env.POSTING_PROVIDER = providerName
  process.env.ZERNIO_API_KEY = ''; process.env.POSTPEER_API_KEY = ''
  process.env[envKey] = 'TESTKEY'
  const m = await import(`./social.js?v=${providerName}${Date.now()}`)
  calls.length = 0

  const accts = await m.connectedAccounts('PROF1')
  check(`${providerName}: accounts normalised to {id,platform}`, accts.every(a => a.id && a.platform), JSON.stringify(accts))

  calls.length = 0
  await m.connectUrl({ platform: 'tiktok', profileId: 'PROF1', redirectUrl: 'https://app/#/connect' })
  const c = calls[0]
  check(`${providerName}: connect URL profile-scoped`, c.url.includes('PROF1'), c.url)
  check(`${providerName}: correct redirect param`,
    providerName === 'postpeer' ? c.url.includes('redirectUri=') : c.url.includes('redirect_url='), c.url)

  calls.length = 0
  const r = await m.postToConnected({ caption: 'X'.repeat(200), captionShort: 'SHORT', mediaItems: [{ url: 'https://blob/r.mp4', type: 'video' }], profileId: 'PROF1' })
  check(`${providerName}: post ok`, r.ok === true, JSON.stringify(r))
  const posts = calls.filter(x => x.url.includes('/posts'))
  check(`${providerName}: auth header correct`,
    providerName === 'postpeer' ? !!posts[0].headers['x-access-key'] : !!posts[0].headers.authorization,
    JSON.stringify(posts[0].headers))
  check(`${providerName}: video mediaItem passed through`,
    posts[0].body.mediaItems?.[0]?.type === 'video', JSON.stringify(posts[0].body.mediaItems))
  if (providerName === 'postpeer') {
    check('postpeer: ONE call (per-platform override, not 2 calls)', posts.length === 1, `${posts.length} calls`)
    const tt = posts[0].body.platforms.find(p => p.platform === 'tiktok')
    check('postpeer: tiktok gets the 90-char short caption', tt?.content === 'SHORT', JSON.stringify(tt))
    check('postpeer: non-tiktok uses full caption', posts[0].body.content.length === 200, String(posts[0].body.content.length))
    check('postpeer: accountId is the integration id', posts[0].body.platforms.every(p => p.accountId?.startsWith('pp_')), JSON.stringify(posts[0].body.platforms))
  } else {
    check('zernio: TWO calls (no per-platform text)', posts.length === 2, `${posts.length} calls`)
    check('zernio: accountId is _id', posts.every(p => p.body.platforms.every(x => x.accountId?.startsWith('z_'))), '')
  }
}
await run('zernio', 'ZERNIO_API_KEY')
console.log('')
await run('postpeer', 'POSTPEER_API_KEY')
console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS')
process.exit(fails ? 1 : 0)
