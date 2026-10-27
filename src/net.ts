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
function setStatus(b: Bus, s: TransportStatus, d?: string) {
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
type PeerObj = { on: (e: string, f: (x: never) => void) => void; connect: (id: string, o?: object) => PeerConn; destroy: () => void; destroyed: boolean }

const peerId = (code: string) => `ghost-directive-${code.toLowerCase()}`

function peerTransport(code: string, role: 'host' | 'guest'): Transport {
  const b = bus()
  const conns = new Map<string, PeerConn>()
  let peer: PeerObj | null = null
  let toHost: PeerConn | null = null
  let closed = false
  let retry: ReturnType<typeof setTimeout> | undefined

  const wire = (c: PeerConn) => {
    c.on('data', (d) => b.msg.forEach((f) => f(d, c.peer)))
    c.on('close', () => {
      conns.delete(c.peer)
      if (role === 'guest' && !closed) { setStatus(b, 'offline', 'Lost the host. Reconnecting…'); schedule() }
    })
  }
  const schedule = () => { clearTimeout(retry); retry = setTimeout(start, 3000) }

  const start = async () => {
    if (closed) return
    const { Peer } = await import('peerjs')
    peer?.destroy()
    peer = (role === 'host' ? new Peer(peerId(code)) : new Peer()) as unknown as PeerObj
    peer.on('open', () => {
      if (role === 'host') return setStatus(b, 'online')
      toHost = peer!.connect(peerId(code), { reliable: true })
      toHost.on('open', () => setStatus(b, 'online'))
      wire(toHost)
    })
    peer.on('connection', (c: PeerConn) => {
      if (role !== 'host') return c.close()
      conns.set(c.peer, c)
      wire(c)
    })
    peer.on('error', (e: { type?: string }) => {
      if (closed) return
      if (role === 'host' && e.type === 'unavailable-id') setStatus(b, 'offline', 'Lobby code still held by an earlier session. Retrying…')
      else if (e.type === 'peer-unavailable') setStatus(b, 'offline', 'Host not reachable. Is the host’s window open?')
      else setStatus(b, 'offline', 'Connection problem. Retrying…')
      schedule()
    })
    peer.on('disconnected', () => { if (!closed) schedule() })
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
    close: () => { closed = true; clearTimeout(retry); peer?.destroy() },
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
