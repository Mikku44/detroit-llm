import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import http from 'node:http'

// Avoid reusing keep-alive sockets across uvicorn --reload restarts.
// A pooled socket pointing at a dead worker causes `read ECONNRESET`
// on the next proxied request (e.g. /api/conversations).
const freshAgent = new http.Agent({ keepAlive: false, maxSockets: 64 })

export default defineConfig({
  // @ts-ignore - esbuild drop is valid at runtime, type missing in vite 8 ESBuildOptions
  esbuild: { drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [] } as never,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      src: fileURLToPath(new URL('./src', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/auth': { target: 'http://localhost:8000', agent: freshAgent },
      '/admin': { target: 'http://localhost:8000', agent: freshAgent },
      '/api': { target: 'http://localhost:8000', agent: freshAgent },
      '/v1': { target: 'http://localhost:8000', agent: freshAgent },
      '/stripe': { target: 'http://localhost:8000', agent: freshAgent },
      '/health': { target: 'http://localhost:8000', agent: freshAgent },
    },
  },
})
