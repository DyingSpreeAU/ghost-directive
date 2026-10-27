// Lobby transport. The host's browser is the only place a run is stored; this
// layer just relays messages. Inside a claude.ai artifact it uses the `room`
// capability; anywhere else it falls back to PeerJS (WebRTC, star topology).

export type TransportStatus = 'connecting' | 'online' | 'offline' | 'unavailable'

export type Transport = {
  kind: 'room' | 'peer'
  /** Host: broadcast to every guest. Guest: send to the host. */
  send: (msg: unknown) => void
  onMessage: (fn: (msg: unknown, from: string) => void) => void
  onStatus: (fn: (s: TransportStatus, detail?: string) => void) => void
  close: () => void
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function makeLobbyCode() {
  const a = new Uint32Array(6)
  crypto.getRandomValues(a)
  return Array.from(a, (n) => ALPHABET[n % ALPHABET.length]).join('')
}
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
export const isValidCode = (s: string) => /^[A-HJ-NP-Z2-9]{6}$/.test(s)

type Bus = {
  msg: ((m: unknown, from: string) => void)[]
  status: ((s: TransportStatus, d?: string) => void)[]
  last: [TransportStatus, string?]
}
function bus(): Bus { return { msg: [], status: [], last: ['connecting'] } }
const DEBUG = Number(import.meta.env.VITE_PEERJS_DEBUG ?? 0) > 0
function setStatus(b: Bus, s: TransportStatus, d?: string) {
  if (DEBUG) console.log('[ghost-directive]', s, d ?? '')
  b.last = [s, d]
  b.status.forEach((f) => f(s, d))
}

// ------------------------------------------------------------------ claude.ai room

type RoomMsg = { data?: unknown; peer: string; isMe: boolean; sameTab: boolean }
type NamedRoom = {
  emit: (t: string, d?: unknown) => Promise<void>
  on: (t: string, fn: (m: RoomMsg) => void, err?: (e: { code: string }) => void) => () => void
  onConnection: (fn: (c: boolean) => void, err?: (e: { code: string }) => void) => () => void
  leave: () => Promise<void>
}
type RoomNs = { join: (name: string) => Promise<NamedRoom> }
type ClaudeWin = { claude?: { use: (n: string) => Promise<unknown> } }

export const inClaudeViewer = () => typeof (window as unknown as ClaudeWin).claude?.use === 'function'

function roomTransport(code: string): Transport {
  const b = bus()
  let room: NamedRoom | null = null
  let closed = false
  const offs: (() => void)[] = []
  ;(async () => {
    const ns = (await (window as unknown as ClaudeWin).claude!.use('room')) as RoomNs | null
    if (closed) return
    if (!ns) return setStatus(b, 'unavailable', 'Live lobbies need this page opened in claude.ai by someone it is shared with.')
    try {
      room = await ns.join(`gd-${code.toLowerCase()}`)
    } catch (e) {
      return setStatus(b, 'unavailable', `Could not open the lobby channel (${(e as { code?: string }).code ?? 'error'}).`)
    }
    if (closed) { room.leave(); return }
    const fail = (e: { code: string }) => setStatus(b, 'unavailable', `Lobby channel closed (${e.code}).`)
    offs.push(room.on('gd', (m) => { if (!(m.isMe && m.sameTab)) b.msg.forEach((f) => f(m.data, m.peer)) }, fail))
    offs.push(room.onConnection((c) => setStatus(b, c ? 'online' : 'offline'), fail))
  })()
  return {
    kind: 'room',
    send: (msg) => { room?.emit('gd', msg).catch(() => { /* dropped; state is re-sent */ }) },
    onMessage: (fn) => { b.msg.push(fn) },
    onStatus: (fn) => { b.status.push(fn); fn(...b.last) },
    close: () => { closed = true; offs.forEach((o) => o()); room?.leave() },
  }
}

// ------------------------------------------------------------------ PeerJS fallback

type PeerConn = { peer: string; open: boolean; send: (d: unknown) => void; on: (e: string, f: (x?: unknown) => void) => void; close: () => void }
type PeerObj = {
  on: (e: string, f: (x: never) => void) => void
  connect: (id: string, o?: object) => PeerConn
  reconnect: () => void
  destroy: () => void
  destroyed: boolean
  disconnected: boolean
}

const peerId = (code: string) => `ghost-directive-${code.toLowerCase()}`

/**
 * Signalling server and ICE servers. Defaults to the free public PeerJS cloud and public STUN.
 * Set VITE_PEERJS_HOST / _PORT / _PATH / _SECURE to use your own PeerServer, and
 * VITE_TURN_URLS (comma-separated) + VITE_TURN_USERNAME + VITE_TURN_CREDENTIAL to add a TURN relay
 * for players behind strict NATs or firewalls.
 */
function peerOptions() {
  const env = import.meta.env
  const iceServers: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ]
  if (env.VITE_TURN_URLS) {
    iceServers.push({ urls: String(env.VITE_TURN_URLS).split(','), username: env.VITE_TURN_USERNAME, credential: env.VITE_TURN_CREDENTIAL })
  }
  const opts: Record<string, unknown> = { config: { iceServers }, debug: Number(env.VITE_PEERJS_DEBUG ?? 0) }
  if (env.VITE_PEERJS_HOST) {
    opts.host = env.VITE_PEERJS_HOST
    if (env.VITE_PEERJS_PORT) opts.port = Number(env.VITE_PEERJS_PORT)
    if (env.VITE_PEERJS_PATH) opts.path = env.VITE_PEERJS_PATH
    opts.secure = env.VITE_PEERJS_SECURE !== 'false'
  }
  return opts
}

const DIAL_TIMEOUT_MS = 15000

/** Explains why a direct connection did not open, from the WebRTC state of the attempt. */
async function diagnoseDial(c: PeerConn): Promise<string> {
  const pc = (c as unknown as { peerConnection?: RTCPeerConnection }).peerConnection
  if (typeof RTCPeerConnection === 'undefined') return 'This browser has direct connections (WebRTC) turned off.'
  if (!pc) return 'Could not start a direct connection to the host.'
  const answered = !!pc.remoteDescription
  let local = 0
  try {
    const stats = await pc.getStats()
    stats.forEach((r) => { if (r.type === 'local-candidate') local++ })
  } catch { /* stats unavailable */ }
  const tech = `(answer: ${answered ? 'yes' : 'no'}, routes: ${local}, state: ${pc.iceConnectionState})`
  if (!answered) return `The host\u2019s tab did not answer. Keep the host\u2019s tab open and in front, and check it isn\u2019t asleep. ${tech}`
  if (local === 0) return `Your browser offered no network routes for a direct connection. A privacy setting, extension, VPN or Brave Shields is blocking WebRTC. ${tech}`
  return `The host answered but no direct route worked. A browser privacy setting or extension, VPN, or firewall is blocking it. Try another browser; if that fails too, a TURN relay fixes it (see README). ${tech}`
}

function peerTransport(code: string, role: 'host' | 'guest'): Transport {
  const b = bus()
  const conns = new Map<string, PeerConn>()
  let peer: PeerObj | null = null
  let toHost: PeerConn | null = null
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  // The direct-connection timeout has its own timer so retries elsewhere can't cancel it.
  let dialTimer: ReturnType<typeof setTimeout> | undefined
  let dialStarted = 0
  const later = (fn: () => void, ms: number) => { clearTimeout(timer); timer = setTimeout(() => { if (!closed) fn() }, ms) }

  // Guest: open a data connection to the host, retrying until it opens.
  const dial = () => {
    if (closed || !peer || peer.destroyed) return
    const prev = toHost
    // Keep the first attempt's diagnosis message up while retrying, instead of resetting it.
    if (!dialStarted) { dialStarted = Date.now(); setStatus(b, 'connecting', 'Lobby server reached. Opening a direct connection to the host\u2026') }
    const c = peer.connect(peerId(code), { reliable: true })
    toHost = c
    prev?.close()
    clearTimeout(dialTimer)
    dialTimer = setTimeout(async () => {
      if (closed || c.open || toHost !== c) return
      setStatus(b, 'offline', `${await diagnoseDial(c)} Retrying\u2026`)
      dial()
    }, DIAL_TIMEOUT_MS)
    c.on('open', () => { clearTimeout(dialTimer); dialStarted = 0; setStatus(b, 'online') })
    c.on('data', (d) => b.msg.forEach((f) => f(d, c.peer)))
    c.on('close', () => {
      if (closed || toHost !== c) return
      // A failed attempt also closes; let the dial timeout handle those so it can explain why.
      if (!dialStarted) setStatus(b, 'offline', 'Lost the host. Reconnecting\u2026')
      else if (DEBUG) console.log('[ghost-directive] attempt closed before opening')
      if (!dialStarted) later(dial, 2000)
    })
    c.on('error', () => { /* surfaced through the peer's error or the dial timeout */ })
  }

  const start = async () => {
    if (closed) return
    const { Peer } = await import('peerjs')
    if (closed) return
    peer?.destroy()
    setStatus(b, 'connecting', 'Reaching the lobby server\u2026')
    const opts = peerOptions()
    const p = (role === 'host' ? new Peer(peerId(code), opts) : new Peer(opts)) as unknown as PeerObj
    peer = p
    p.on('open', () => {
      if (peer !== p) return
      if (role === 'host') setStatus(b, 'online')
      else if (!toHost?.open) dial()
    })
    p.on('connection', (c: PeerConn) => {
      if (role !== 'host') return c.close()
      conns.get(c.peer)?.close()
      conns.set(c.peer, c)
      c.on('data', (d) => b.msg.forEach((f) => f(d, c.peer)))
      c.on('close', () => { if (conns.get(c.peer) === c) conns.delete(c.peer) })
      c.on('error', () => { /* the guest redials */ })
    })
    // Losing the signalling server does not drop open data connections; just re-register.
    p.on('disconnected', () => {
      if (closed || peer !== p || p.destroyed) return
      if (role === 'host') setStatus(b, 'offline', 'Lost the lobby server. Players already connected stay connected. Reconnecting\u2026')
      later(() => { if (!p.destroyed && p.disconnected) p.reconnect() }, 2000)
    })
    p.on('error', (e: { type?: string }) => {
      if (closed || peer !== p) return
      const t = e.type ?? 'unknown'
      if (t === 'peer-unavailable') {
        // Guest only: nobody is hosting this code right now.
        setStatus(b, 'offline', `No lobby ${code} is open right now. Check the code, and that the host\u2019s window is open. Retrying\u2026`)
        return later(dial, 3000)
      }
      if (t === 'unavailable-id') {
        setStatus(b, 'offline', 'This lobby code is still held by an earlier session (it frees up within a minute). Retrying\u2026')
        return later(start, 5000)
      }
      if (t === 'browser-incompatible') return setStatus(b, 'unavailable', 'This browser does not support direct connections (WebRTC).')
      if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') {
        setStatus(b, 'offline', 'Cannot reach the lobby server. Retrying\u2026')
        return later(() => (p.destroyed ? start() : p.reconnect()), 4000)
      }
      setStatus(b, 'offline', `Connection problem (${t}). Retrying\u2026`)
      later(start, 4000)
    })
  }
  start()

  return {
    kind: 'peer',
    send: (msg) => {
      if (role === 'host') conns.forEach((c) => c.open && c.send(msg))
      else if (toHost?.open) toHost.send(msg)
    },
    onMessage: (fn) => { b.msg.push(fn) },
    onStatus: (fn) => { b.status.push(fn); fn(...b.last) },
    close: () => { closed = true; clearTimeout(timer); clearTimeout(dialTimer); peer?.destroy() },
  }
}

export function connect(code: string, role: 'host' | 'guest'): Transport {
  return inClaudeViewer() ? roomTransport(code) : peerTransport(code, role)
}

// ------------------------------------------------------------------ chunked snapshots
// Room messages are capped at 4 KiB, so snapshots travel gzip+base64 in chunks.

const CHUNK = 2800

async function gzip(text: string): Promise<string> {
  if (typeof CompressionStream === 'undefined') return 'r' + text
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  const buf = new Uint8Array(await new Response(stream).arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return 'z' + btoa(s)
}

async function gunzip(packed: string): Promise<string> {
  if (packed[0] === 'r') return packed.slice(1)
  const bin = atob(packed.slice(1))
  const buf = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

export type StateChunk = { k: 'state'; v: string; i: number; n: number; d: string }

export async function encodeSnapshot(v: string, value: unknown): Promise<StateChunk[]> {
  const packed = await gzip(JSON.stringify(value))
  const n = Math.max(1, Math.ceil(packed.length / CHUNK))
  return Array.from({ length: n }, (_, i) => ({ k: 'state' as const, v, i, n, d: packed.slice(i * CHUNK, (i + 1) * CHUNK) }))
}

/** Reassembles chunks; resolves a snapshot once every chunk of a version arrives. */
export function snapshotAssembler(onSnapshot: (v: string, value: unknown) => void) {
  const parts = new Map<string, string[]>()
  return (c: StateChunk) => {
    if (typeof c.v !== 'string' || typeof c.d !== 'string' || !(c.n > 0 && c.n < 400) || !(c.i >= 0 && c.i < c.n)) return
    const arr = parts.get(c.v) ?? new Array<string>(c.n)
    arr[c.i] = c.d
    parts.set(c.v, arr)
    if (arr.filter((x) => x !== undefined).length === c.n) {
      parts.clear()
      gunzip(arr.join('')).then((t) => onSnapshot(c.v, JSON.parse(t))).catch(() => { /* corrupt: wait for next */ })
    }
    if (parts.size > 6) parts.delete(parts.keys().next().value!)
  }
}
