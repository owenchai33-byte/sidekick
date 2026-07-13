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
      // Expose non-VITE_ env to the handler (which reads process.env at call time)
      for (const key of ['AI_PROVIDER', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_MODEL', 'ANTHROPIC_MODEL']) {
        if (env[key]) process.env[key] = env[key]
      }
      server.middlewares.use('/api/generate', async (req, res) => {
        try {
          const mod = await server.ssrLoadModule('/api/generate.js')
          await mod.default(req, res)
        } catch (err) {
          server.config.logger.error('[dev-api] ' + (err?.stack || err))
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: 'Dev API error: ' + (err?.message || String(err)) }))
        }
      })
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
  }
})
