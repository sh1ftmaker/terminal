import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

// iOS fetches the apple-touch-icon in a request without the page's cookies.
// Behind a login gate (Cloudflare Access) that request is redirected to the
// login page and "Add to Home Screen" falls back to a letter tile. Inlining
// the icon as a data: URI means there is nothing to fetch.
function inlineAppleTouchIcon(): Plugin {
  return {
    name: 'inline-apple-touch-icon',
    apply: 'build',
    transformIndexHtml(html) {
      const png = readFileSync(fileURLToPath(new URL('./public/apple-touch-icon.png', import.meta.url)))
      return html.replace(
        /<link rel="apple-touch-icon" href="[^"]*"\s*\/?>/,
        `<link rel="apple-touch-icon" sizes="180x180" href="data:image/png;base64,${png.toString('base64')}" />`,
      )
    },
  }
}

// Comma-separated list of extra hosts (e.g. a tunnel subdomain) Vite should accept
// in dev mode. Set VITE_ALLOWED_HOSTS in .env, e.g. "terminal.example.com,other.example.com".
const extraHosts = (process.env.VITE_ALLOWED_HOSTS || '')
  .split(',')
  .map(h => h.trim())
  .filter(Boolean);

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs: the built app must work at the origin root *and*
  // under a path prefix (e.g. another server's /lp/<port>/ proxy). Runtime
  // paths (API, websockets, routes) come from src/lib/base.ts.
  base: './',
  plugins: [react(), tailwindcss(), inlineAppleTouchIcon()],
  server: {
    allowedHosts: extraHosts.length > 0 ? extraHosts : undefined,
    proxy: {
      '/api': 'http://localhost:3002',
      '/ws': {
        target: 'ws://localhost:3002',
        ws: true,
      },
    },
  },
})
