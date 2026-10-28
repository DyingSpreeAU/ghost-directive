// Production stand-in for DevTools.tsx: vite.config.ts swaps it in when the build has no test channel,
// so none of the test tools' code ships to production.
export default function DevTools() {
  return null
}
