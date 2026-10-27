import { createContext, useContext } from 'react'
import type { Slot } from './data'
import { PRESETS, uid, type Intent, type Lobby, type LobbyIntent, type Ruleset, type Run } from './model'
import type { TransportStatus } from './net'

/** Everything the host's browser keeps. Guests keep nothing but their device id. */
export type HostStore = {
  hostCid: string
  lobby: Lobby | null
  active: Run | null
  history: Run[]
  protocols: Ruleset[]
  hideIntro: boolean
}

const KEY = 'ghost-directive:v2'
const GUEST_KEY = 'ghost-directive:guest'
const LAST_CODE = 'ghost-directive:last-code'

export function loadHostStore(): HostStore {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as HostStore
      if (s && Array.isArray(s.history) && Array.isArray(s.protocols) && s.hostCid) return s
    }
  } catch { /* storage unavailable */ }
  return { hostCid: uid() + uid(), lobby: null, active: null, history: [], protocols: [], hideIntro: false }
}

export function saveHostStore(s: HostStore) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

export const hasHostSession = (s: HostStore) => !!(s.lobby || s.active)

/** A guest's device id lives in sessionStorage: a reload keeps the seat, a second tab is a second device. */
export function guestSession(): { cid: string; code: string | null } {
  try {
    const raw = sessionStorage.getItem(GUEST_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { cid: uid() + uid(), code: null }
}
export function saveGuestSession(g: { cid: string; code: string | null }) {
  try { sessionStorage.setItem(GUEST_KEY, JSON.stringify(g)) } catch { /* ignore */ }
  try { if (g.code) localStorage.setItem(LAST_CODE, g.code) } catch { /* ignore */ }
}
export function lastCode(): string {
  try { return localStorage.getItem(LAST_CODE) ?? '' } catch { return '' }
}

export const allProtocols = (s: HostStore) => [...PRESETS, ...s.protocols]

/** What the host broadcasts. Absolute state, re-sent on change and on request. */
export type Snapshot =
  | { phase: 'lobby'; lobby: Lobby; online: string[]; hostCid: string }
  | { phase: 'run'; run: Run; online: string[]; hostCid: string }

export type Flow =
  | { type: 'clear'; chests: number }
  | { type: 'wipe' }
  | { type: 'register'; playerId: string; slot?: Slot }
  | { type: 'tradeup'; playerId: string; slot: Slot }
  | { type: 'swap'; playerId: string; slot: Slot }
  | { type: 'reward'; pendingId: string }
  | { type: 'abandon' }

export type View = 'briefing' | 'protocols' | 'history'

export type HostApi = {
  store: HostStore
  /** Synchronous mutation of the host's state (works from network handlers). */
  mutate: (fn: (s: HostStore) => HostStore | void) => void
  updateRun: (fn: (r: Run) => void) => void
  updateLobby: (fn: (l: Lobby) => void) => void
  closeSession: (archive: boolean) => void
}

export type Ctx = {
  role: 'host' | 'guest'
  me: string
  run: Run | null
  lobby: Lobby | null
  online: string[]
  myPlayerId: string | null
  /** Your own Guardian, or (host only) a Guardian with no device linked. */
  canControl: (playerId: string) => boolean
  dispatch: (intent: Intent, playerId?: string) => void
  lobbyAct: (intent: LobbyIntent) => void
  claimSeat: (playerId: string) => void
  host: HostApi | null
  net: { status: TransportStatus; detail?: string; kind: 'room' | 'peer' | 'none' }
  openFlow: (f: Flow | null) => void
  go: (v: View, anchor?: string) => void
  toast: (msg: string) => void
  leave: () => void
}

export const GDContext = createContext<Ctx>(null!)
export const useGD = () => useContext(GDContext)
