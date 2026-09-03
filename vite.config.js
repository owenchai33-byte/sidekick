import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-only middleware that mounts the same serverless handler used on Vercel
// (`api/generate.js`) at /api/generate, so `npm run dev` runs the whole app
// — client + AI proxy — with no extra tooling. The API key stays server-side.
function devApi(env) {
  return {
    name: 'sidekick-dev-api',
    apply: 'serve',
    configureServer(server) {
      // Expose non-VITE_ env to the handlers (which read process.env at call time)
      for (const key of ['AI_PROVIDER', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_MODEL', 'ANTHROPIC_MODEL', 'MAKE_WEBHOOK_URL', 'BLOB_READ_WRITE_TOKEN', 'ZERNIO_API_KEY', 'ZERNIO_TIKTOK_ACCOUNT_ID', 'ZERNIO_PROFILE_ID', 'INGEST_SECRET', 'INGEST_LANGS']) {
        if (env[key]) process.env[key] = env[key]
      }
      // Mount each serverless handler at /api/<name>, same as Vercel does in prod.
      const mount = (name) =>
        server.middlewares.use(`/api/${name}`, async (req, res) => {
          try {
            const mod = await server.ssrLoadModule(`/api/${name}.js`)
            await mod.default(req, res)
          } catch (err) {
            server.config.logger.error('[dev-api] ' + (err?.stack || err))
            res.statusCode = 500
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ error: 'Dev API error: ' + (err?.message || String(err)) }))
          }
        })
      mount('generate')
      mount('social-post')
      mount('media-upload')
      mount('social-connect')
      mount('social-accounts')
      mount('social-broadcast')
      mount('social-disconnect')
      mount('ingest')
      mount('feed')
      mount('approve')
      mount('style')
      mount('hold')
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    // Relative base so the built assets work under any path — root on Vercel,
    // or a project sub-path like /sidekick/ on GitHub Pages.
    base: './',
    plugins: [react(), devApi(env)],
    server: { port: 5173 },
    // Vitest's 5s default is not enough headroom on a loaded machine. One test
    // in roughly fifteen full runs failed with "timed out in 5000ms" - always a
    // trivial synchronous one, never the same failure twice in isolation, and
    // never reproducible when that file ran alone (0 in 30). Raising the limit
    // to 20s: 0 failures in 30 runs, while serialising the files or guarding the
    // network changed nothing. So it is an occasional worker/transform stall,
    // not a deadlock in the code - and it matters more, not less, on a slower
    // laptop. A genuine hang still fails, just 15s later.
    test: { testTimeout: 20000, hookTimeout: 20000 },
  }
})
