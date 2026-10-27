// Exchanges a Bungie OAuth code (or refresh token) for tokens. Runs on Netlify so the
// client secret never reaches the browser. Tokens are returned to the signed-in player's
// own browser and are not stored or logged here.
//
// Env: BUNGIE_CLIENT_SECRET (required), BUNGIE_CLIENT_ID or VITE_BUNGIE_CLIENT_ID,
//      BUNGIE_API_KEY or VITE_BUNGIE_API_KEY.

const TOKEN_URL = 'https://www.bungie.net/platform/app/oauth/token/'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  // Only this site may use the function.
  const origin = req.headers.get('origin')
  const self = new URL(req.url).origin
  if (origin && origin !== self) return json({ error: 'Cross-origin requests are not allowed.' }, 403)

  const env = (k) => (typeof Netlify !== 'undefined' ? Netlify.env.get(k) : undefined) ?? process.env[k]
  const clientId = env('BUNGIE_CLIENT_ID') || env('VITE_BUNGIE_CLIENT_ID')
  const secret = env('BUNGIE_CLIENT_SECRET')
  const apiKey = env('BUNGIE_API_KEY') || env('VITE_BUNGIE_API_KEY')
  if (!clientId || !secret) return json({ error: 'Bungie sign-in is not configured on the server (missing client id or secret).' }, 500)

  let body
  try { body = await req.json() } catch { return json({ error: 'Expected a JSON body.' }, 400) }
  const form = new URLSearchParams()
  if (body?.grant_type === 'authorization_code' && typeof body.code === 'string' && body.code.length < 200) {
    form.set('grant_type', 'authorization_code')
    form.set('code', body.code)
  } else if (body?.grant_type === 'refresh_token' && typeof body.refresh_token === 'string' && body.refresh_token.length < 2000) {
    form.set('grant_type', 'refresh_token')
    form.set('refresh_token', body.refresh_token)
  } else {
    return json({ error: 'Send grant_type "authorization_code" with code, or "refresh_token" with refresh_token.' }, 400)
  }

  const headers = {
    'content-type': 'application/x-www-form-urlencoded',
    authorization: 'Basic ' + Buffer.from(`${clientId}:${secret}`).toString('base64'),
  }
  if (apiKey) headers['x-api-key'] = apiKey

  let res, data
  try {
    res = await fetch(TOKEN_URL, { method: 'POST', headers, body: form })
    data = await res.json().catch(() => null)
  } catch {
    return json({ error: 'Could not reach Bungie. Try again in a moment.' }, 502)
  }
  if (!res.ok || !data?.access_token) {
    return json({ error: data?.error_description || data?.error || `Bungie refused the sign-in (HTTP ${res.status}).` }, res.status === 400 || res.status === 401 ? 400 : 502)
  }
  return json({
    access_token: data.access_token,
    expires_in: data.expires_in,
    refresh_token: data.refresh_token,
    refresh_expires_in: data.refresh_expires_in,
    membership_id: data.membership_id,
  })
}

export const config = { path: '/api/bungie-token' }
