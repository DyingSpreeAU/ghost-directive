import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Netlify sets CONTEXT and BRANCH while building; anything but a production deploy is a test channel.
// VITE_CHANNEL overrides it (e.g. VITE_CHANNEL=nightly for a local test build).
const channel = process.env.VITE_CHANNEL ?? (process.env.CONTEXT && process.env.CONTEXT !== 'production' ? process.env.BRANCH || 'test' : '')

// The build's commit (Netlify sets COMMIT_REF; locally, ask git) and date, for bug reports.
const commit = (process.env.COMMIT_REF || (() => { try { return execSync('git rev-parse HEAD').toString().trim() } catch { return '' } })()).slice(0, 7)
const version = `${commit || 'unknown'} (${new Date().toISOString().slice(0, 10)})`

// SINGLE=1 inlines everything into one HTML file for static hosting
export default defineConfig({
  plugins: process.env.SINGLE ? [react(), viteSingleFile()] : [react()],
  define: { __CHANNEL__: JSON.stringify(channel), __VERSION__: JSON.stringify(version) },
  // Test tools only exist in test builds; production gets an empty stand-in.
  resolve: { alias: channel ? [] : [{ find: /^\.\/DevTools$/, replacement: fileURLToPath(new URL('./src/DevToolsOff.tsx', import.meta.url)) }] },
})
