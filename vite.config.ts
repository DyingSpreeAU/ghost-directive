import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Netlify sets CONTEXT and BRANCH while building; anything but a production deploy is a test channel.
// VITE_CHANNEL overrides it (e.g. VITE_CHANNEL=nightly for a local test build).
const channel = process.env.VITE_CHANNEL ?? (process.env.CONTEXT && process.env.CONTEXT !== 'production' ? process.env.BRANCH || 'test' : '')

// SINGLE=1 inlines everything into one HTML file for static hosting
export default defineConfig({
  plugins: process.env.SINGLE ? [react(), viteSingleFile()] : [react()],
  define: { __CHANNEL__: JSON.stringify(channel) },
})
