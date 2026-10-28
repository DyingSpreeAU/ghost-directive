// Hands the browser short-lived TURN relay credentials, so lobbies connect even where a browser,
// VPN or network blocks direct WebRTC routes. Uses Cloudflare's TURN service; the API token stays
// here on Netlify and never reaches the browser.
//
// Env: CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN (Cloudflare dashboard → Realtime → TURN Server).

const TTL_SECONDS = 12 * 60 * 60

const json = (body, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } })

export default async (req) => {
  // Only this site may use the function.
  const origin = req.headers.get('origin')
  const self = new URL(req.url).origin
  if (origin && origin !== self) return json({ error: 'Cross-origin requests are not allowed.' }, 403)

  const env = (k) => (typeof Netlify !== 'undefined' ? Netlify.env.get(k) : undefined) ?? process.env[k]
  const keyId = env('CLOUDFLARE_TURN_KEY_ID')
  const token = env('CLOUDFLARE_TURN_API_TOKEN')
  if (!keyId || !token) return json({ error: 'No TURN relay is configured.' }, 404)

  let res, data
  try {
    res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
    })
    data = await res.json().catch(() => null)
  } catch {
    return json({ error: 'Could not reach the TURN service.' }, 502)
  }
  if (!res.ok || !data?.iceServers) return json({ error: `The TURN service refused the request (HTTP ${res.status}).` }, 502)

  // Cloudflare also lists port 53 URLs, which browsers block; drop them as Cloudflare advises.
  const list = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers]
  const iceServers = list
    .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)) }))
    .filter((s) => s.urls.length)
  // Credentials last 12 hours; let the browser reuse them for an hour.
  return json({ iceServers }, 200, 'private, max-age=3600')
}

export const config = { path: '/api/turn' }
