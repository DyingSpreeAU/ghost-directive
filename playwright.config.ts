import { defineConfig } from '@playwright/test'

// End-to-end tests: `npm run test:e2e`. Three local servers start automatically:
// a nightly build with test tools (no Bungie), the same build wired to a simulated Bungie account
// and a local lobby server, and that lobby server. Ports are kept clear of the usual dev ones.
export const PORTS = { app: 5176, bungie: 5175, peer: 9100 }
const env = `VITE_CHANNEL=nightly VITE_BUNGIE_API_KEY=testkey VITE_BUNGIE_CLIENT_ID=12345 VITE_PEERJS_HOST=127.0.0.1 VITE_PEERJS_PORT=${PORTS.peer} VITE_PEERJS_PATH=/gd VITE_PEERJS_SECURE=false`

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 3,
  reporter: [['list']],
  use: { viewport: { width: 1440, height: 900 } },
  projects: [
    { name: 'app', testIgnore: /(bungie|multiplayer)\.spec\.ts/, use: { baseURL: `http://localhost:${PORTS.app}` } },
    { name: 'bungie', testMatch: /(bungie|multiplayer)\.spec\.ts/, use: { baseURL: `http://localhost:${PORTS.bungie}` } },
  ],
  webServer: [
    { command: `VITE_CHANNEL=nightly npx vite build --outDir .e2e/app --emptyOutDir && npx vite preview --outDir .e2e/app --port ${PORTS.app} --strictPort`, port: PORTS.app, timeout: 240_000, reuseExistingServer: false },
    { command: `${env} npx vite build --outDir .e2e/bungie --emptyOutDir && npx vite preview --outDir .e2e/bungie --port ${PORTS.bungie} --strictPort`, port: PORTS.bungie, timeout: 240_000, reuseExistingServer: false },
    { command: `node e2e/peer-server.mjs ${PORTS.peer}`, url: `http://127.0.0.1:${PORTS.peer}/gd`, reuseExistingServer: false },
  ],
})
