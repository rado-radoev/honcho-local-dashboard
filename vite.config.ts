import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// The Honcho API does not reliably send CORS headers for browser apps, so in
// development we proxy API calls through Vite: the app calls `/honcho-api/...`
// and Vite forwards them to the real Honcho server (VITE_HONCHO_TARGET).
// See README.md ("CORS and the dev proxy") for the production story.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const honchoTarget = env.VITE_HONCHO_TARGET || 'http://localhost:8000'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/honcho-api': {
          target: honchoTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/honcho-api/, ''),
        },
      },
    },
    preview: {
      proxy: {
        '/honcho-api': {
          target: honchoTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/honcho-api/, ''),
        },
      },
    },
    test: {
      environment: 'node',
      include: ['src/__test__/**/*.test.ts'],
    },
  }
})
