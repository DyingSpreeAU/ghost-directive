import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Briefing } from './Briefing'
import { CHANNEL } from './channel'
import { BungieStart, SynapticLink, useAutoSync } from './BungiePanel'
import { bungieAccountId, bungieConfigured, onAuthChange, signOut, takeSignInResult } from './bungie'
import { FlowHost } from './Flows'
import { History } from './History'
import { LobbyView } from './Lobby'
import { Protocols } from './Protocols'
import {
  GDContext, useGD, deleteRun, guestSession, hasHostSession, lastCode, loadHostStore, resumableRuns, resumeRun, saveGuestSession, saveHostStore, shelveActive, storageIsPersistent,
  type Ctx, type Flow, type HostStore, type Snapshot, type View,
} from './store'
import {
  PRESETS, applyIntent, applyLobbyIntent, bindBungieId, capacityOf, claimRunSeat, computeWarnings, createLobby, current, exampleRun, itemsIn,
  type Intent, type LobbyIntent, type Run,
} from './model'
import { connect, encodeSnapshot, inClaudeViewer, isValidCode, makeLobbyCode, normalizeCode, snapshotAssembler, type StateChunk, type Transport, type TransportStatus } from './net'

type Mode = { kind: 'landing' } | { kind: 'host' } | { kind: 'guest'; code: string }

// Test tools exist only in test builds: in production CHANNEL is '' at build time, so this is never loaded.
const DevTools = CHANNEL ? lazy(() => import('./DevTools')) : null

/** A corner badge on test deploys so nobody mistakes them for the real app. */
function ChannelBadge() {
  useEffect(() => { if (CHANNEL) document.title = `Ghost Directive (${CHANNEL})` }, [])
  if (!CHANNEL) return null
  return <div className="channel-badge" title="Test version: runs and lobbies here are separate from the main app.">{CHANNEL}</div>
}

export default function App() {
  return <><ChannelBadge /><Root /></>
}

function Root() {
  const [mode, setMode] = useState<Mode>(() => {
    // Only the tab that was hosting resumes by itself; other tabs offer "Resume hosting".
    if (hostingTab() && hasHostSession(loadHostStore())) return { kind: 'host' }
    const g = guestSession()
    return g.code ? { kind: 'guest', code: g.code } : { kind: 'landing' }
  })
  useEffect(() => markHostingTab(mode.kind === 'host'), [mode.kind])
  if (mode.kind === 'host') return <HostApp onLeave={() => setMode({ kind: 'landing' })} />
  if (mode.kind === 'guest') return <GuestApp code={mode.code} onLeave={() => setMode({ kind: 'landing' })} />
  return <Landing onHost={() => setMode({ kind: 'host' })} onJoin={(code) => setMode({ kind: 'guest', code })} />
}

const ROLE_KEY = 'ghost-directive:hosting'
function hostingTab() { try { return sessionStorage.getItem(ROLE_KEY) === '1' } catch { return false } }
function markHostingTab(on: boolean) { try { if (on) sessionStorage.setItem(ROLE_KEY, '1'); else sessionStorage.removeItem(ROLE_KEY) } catch { /* ignore */ } }

// ====================================================================== landing

function Landing({ onHost, onJoin }: { onHost: () => void; onJoin: (code: string) => void }) {
  const [code, setCode] = useState(lastCode())
  const [err, setErr] = useState('')
  const [store, setStore] = useState(loadHostStore)
  const runs = resumableRuns(store)
  // An open lobby, or a finished run not yet archived, resumes from its own card.
  const saved = hasHostSession(store) && !(store.active && runs.includes(store.active)) ? store : null
  const host = (example: boolean) => {
    const s = loadHostStore()
    // Starting fresh keeps an unfinished run in Saved runs.
    shelveActive(s)
    s.lobby = null
    const c = makeLobbyCode()
    if (example) s.active = exampleRun(c, s.hostCid)
    else s.lobby = createLobby(c, s.hostCid, PRESETS[0])
    saveHostStore(s)
    onHost()
  }
  const join = () => {
    const c = normalizeCode(code)
    if (!isValidCode(c)) return setErr('Lobby codes are 6 letters and numbers, like K7QM2X.')
    const g = guestSession()
    saveGuestSession({ ...g, code: c })
    onJoin(c)
  }
  return (
    <div className="landing">
      <div className="landing-inner">
        <div className="brand big"><GhostGlyph /><div><div className="brand-name">Ghost Directive</div><div className="brand-sub">Destiny 2 roguelite companion</div></div></div>
        <p className="landing-lede">Play Destiny 2 as normal. The host keeps the run; every Guardian joins from their own device to pick rewards and manage their own gear.</p>
        <BungieStart />
        {bungieConfigured && <div className="eyebrow landing-step">Step 2 &middot; Host or join</div>}
        <SavedRuns
          runs={runs}
          onResume={(id) => { const s = loadHostStore(); resumeRun(s, id); saveHostStore(s); onHost() }}
          onDelete={(id) => { const s = loadHostStore(); deleteRun(s, id); saveHostStore(s); setStore(s) }}
        />
        <div className="landing-grid">
          {saved && (
            <section className="panel landing-card is-resume">
              <div className="eyebrow">Saved in this browser</div>
              <h2>{saved.active ? saved.active.name : 'Your lobby'}</h2>
              <p className="muted">
                Lobby <span className="mono">{saved.active?.code ?? saved.lobby?.code}</span>
                {saved.active ? ` · ${saved.active.status === 'active' ? `${saved.active.integrity} Integrity, in progress` : saved.active.status}` : ` · ${saved.lobby!.seats.length} in lobby`}
              </p>
              <button className="btn btn-light" onClick={onHost}>Resume hosting</button>
            </section>
          )}
          <section className="panel landing-card">
            <div className="eyebrow">Host</div>
            <h2>{saved || runs.length ? 'Start a new lobby' : 'Start a lobby'}</h2>
            <p className="muted">Your browser stores the run, so you can close the window and pick it up later. You get a code to share with your fireteam.</p>
            <button className={`btn ${saved || runs.length ? 'btn-ghost' : 'btn-light'}`} onClick={() => host(false)}>{saved || runs.length ? 'Create new lobby' : 'Create lobby'}</button>
            {runs.length > 0 && <p className="small muted">Unfinished runs stay in Saved runs.</p>}
            <button className="link" onClick={() => host(true)}>Or explore an example run</button>
          </section>
          <section className="panel landing-card">
            <div className="eyebrow">Player</div>
            <h2>Join a lobby</h2>
            <p className="muted">Enter the code from your host. Nothing about the run is stored on your device.</p>
            <form className="join-form" onSubmit={(e) => { e.preventDefault(); join() }}>
              <label htmlFor="join-code" className="sr-only">Lobby code</label>
              <input id="join-code" className="code-input" value={code} onChange={(e) => { setCode(normalizeCode(e.target.value)); setErr('') }} placeholder="K7QM2X" autoComplete="off" spellCheck={false} />
              <button className="btn btn-light" type="submit">Join</button>
            </form>
            {err && <p className="small tone-danger">{err}</p>}
          </section>
        </div>
        {!inClaudeViewer() && <p className="small muted">Outside claude.ai, lobbies connect browsers directly (WebRTC) through the public PeerJS broker.</p>}
      </div>
    </div>
  )
}

function SavedRuns({ runs, onResume, onDelete }: { runs: Run[]; onResume: (id: string) => void; onDelete: (id: string) => void }) {
  const [confirm, setConfirm] = useState<string | null>(null)
  const [persistent, setPersistent] = useState<boolean | null>(null)
  const me = bungieAccountId()
  useEffect(() => { storageIsPersistent().then(setPersistent) }, [runs.length])
  if (!runs.length) return null
  const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <section className="panel saved-runs" aria-labelledby="saved-runs-title">
      <header className="saved-runs-head">
        <div>
          <div className="eyebrow">Saved in this browser</div>
          <h2 id="saved-runs-title">Saved runs</h2>
        </div>
        <p className="small muted">
          Unlocks, route progress, inventory and each Guardian&rsquo;s last setup are kept in this browser&rsquo;s storage
          {persistent ? ', which the browser has agreed not to clear.' : '. Clearing site data removes them.'}
        </p>
      </header>
      <ul className="saved-list">
        {runs.map((r) => {
          const { dungeon, encounter, done, total } = current(r)
          const mine = !!me && r.players.some((p) => p.bungieId === me)
          return (
            <li key={r.id} className="saved-run">
              <div className="saved-run-main">
                <span className="saved-run-title"><strong>{r.name}</strong>{mine && <span className="tag tag-bungie">You played</span>}</span>
                <span className="muted small">
                  Lobby <span className="mono">{r.code}</span> &middot; {dungeon.name}, {encounter.name} ({done}/{total}) &middot; {r.integrity} Integrity &middot; last played {when(r.log[0]?.at ?? r.startedAt)}
                </span>
                <span className="small">{r.players.map((p) => p.bungie ? `${p.name} (${p.bungie.name})` : p.name).join(', ')}</span>
              </div>
              {confirm === r.id ? (
                <div className="row-acts">
                  <span className="small tone-danger">Delete this run for good?</span>
                  <button className="btn btn-danger btn-sm" onClick={() => { onDelete(r.id); setConfirm(null) }}>Delete</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)}>Keep</button>
                </div>
              ) : (
                <div className="row-acts">
                  <button className="btn btn-light btn-sm" onClick={() => onResume(r.id)}>Resume</button>
                  <button className="link" onClick={() => setConfirm(r.id)}>Delete</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ====================================================================== host

const SEEN_MS = 15000

function HostApp({ onLeave }: { onLeave: () => void }) {
  const [store, setStore] = useState<HostStore>(loadHostStore)
  const ref = useRef(store)
  // The host's own browser is always online; others appear as their devices check in.
  const [online, setOnline] = useState<string[]>(() => [store.hostCid])
  const [net, setNet] = useState<{ status: TransportStatus; detail?: string }>({ status: 'connecting' })
  const seen = useRef(new Map<string, { peer: string; at: number }>())
  const tRef = useRef<Transport | null>(null)
  const version = useRef({ epoch: Date.now().toString(36), n: 0, last: '' })
  const toastRef = useRef<(m: string) => void>(() => {})

  const mutate = useCallback((fn: (s: HostStore) => HostStore | void) => {
    const draft = structuredClone(ref.current)
    const next = fn(draft) ?? draft
    ref.current = next
    setStore(next)
  }, [])
  useEffect(() => saveHostStore(store), [store])

  const code = store.active?.code ?? store.lobby?.code ?? ''
  const isOnline = useCallback((cid: string) => cid === ref.current.hostCid || (Date.now() - (seen.current.get(cid)?.at ?? 0) < SEEN_MS), [])
  const refreshOnline = useCallback(() => {
    const ids = [ref.current.hostCid, ...[...seen.current.entries()].filter(([, v]) => Date.now() - v.at < SEEN_MS).map(([k]) => k)].sort()
    setOnline((o) => (o.join() === ids.join() ? o : ids))
  }, [])

  // ---- broadcast snapshots
  const snapshot = useCallback((): Snapshot | null => {
    const s = ref.current
    const ids = [s.hostCid, ...[...seen.current.entries()].filter(([, v]) => Date.now() - v.at < SEEN_MS).map(([k]) => k)]
    if (s.active) return { phase: 'run', run: { ...s.active, log: s.active.log.slice(0, 120) }, online: ids, hostCid: s.hostCid }
    if (s.lobby) return { phase: 'lobby', lobby: s.lobby, online: ids, hostCid: s.hostCid }
    return null
  }, [])
  const broadcast = useCallback(async () => {
    const snap = snapshot()
    if (!snap || !tRef.current) return
    const v = `${version.current.epoch}.${++version.current.n}`
    version.current.last = v
    for (const c of await encodeSnapshot(v, snap)) tRef.current?.send({ r: 'h', ...c })
  }, [snapshot])
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const scheduleBroadcast = useCallback((delay = 120) => { clearTimeout(timer.current); timer.current = setTimeout(broadcast, delay) }, [broadcast])
  useEffect(() => { scheduleBroadcast() }, [store.active, store.lobby, online, scheduleBroadcast])

  // ---- transport
  useEffect(() => {
    if (!code) return
    const t = connect(code, 'host')
    tRef.current = t
    t.onStatus((status, detail) => { setNet({ status, detail }); if (status === 'online') scheduleBroadcast(300) })
    t.onMessage((raw, from) => {
      const m = raw as { r?: string; k?: string; cid?: unknown; id?: unknown; scope?: unknown; intent?: unknown; playerId?: unknown; bid?: unknown }
      if (m?.r !== 'g' || typeof m.cid !== 'string' || m.cid.length > 40) return
      const cid = m.cid
      const prev = seen.current.get(cid)
      // A device id already live on another connection can't be borrowed.
      if (prev && prev.peer !== from && Date.now() - prev.at < SEEN_MS / 2) return
      seen.current.set(cid, { peer: from, at: Date.now() })
      refreshOnline()
      // A signed-in player's Bungie account finds their Guardian again from a new device or session.
      const bindBid = () => {
        if (typeof m.bid !== 'string' || !(ref.current.active || ref.current.lobby)) return
        const probe = structuredClone({ run: ref.current.active, lobby: ref.current.lobby })
        if (bindBungieId(probe, cid, m.bid, isOnline)) mutate((d) => { bindBungieId({ run: d.active, lobby: d.lobby }, cid, m.bid as string, isOnline) })
      }
      bindBid()
      if (m.k === 'hello' || m.k === 'sync') return scheduleBroadcast(50)
      if (m.k !== 'intent') return
      let err: string | null = null
      const s = ref.current
      if (m.scope === 'lobby' && s.lobby) {
        mutate((d) => { err = applyLobbyIntent(d.lobby!, cid, m.intent as LobbyIntent, isOnline) })
      } else if (m.scope === 'claim' && s.active) {
        mutate((d) => { err = claimRunSeat(d.active!, cid, String(m.playerId), isOnline) })
      } else if (m.scope === 'run' && s.active) {
        const p = s.active.players.find((x) => x.clientId === cid)
        if (!p) err = 'Pick your Guardian first.'
        else mutate((d) => { err = applyIntent(d.active!, p.id, m.intent as Intent) })
      } else err = 'The lobby has moved on. Refreshing…'
      if (err) { ref.current = s; setStore(s) }
      else bindBid() // a seat just claimed gets the player's Bungie account straight away
      t.send({ r: 'h', k: 'ack', to: cid, id: m.id, err })
    })
    const tick = setInterval(() => {
      t.send({ r: 'h', k: 'tick', v: version.current.last })
      refreshOnline()
    }, 4000)
    return () => { clearInterval(tick); t.close(); tRef.current = null }
  }, [code, mutate, isOnline, refreshOnline, scheduleBroadcast])

  const api = useMemo(() => ({
    store,
    mutate,
    updateRun: (fn: (r: Run) => void) => mutate((s) => { if (s.active) fn(s.active) }),
    updateLobby: (fn: (l: NonNullable<HostStore['lobby']>) => void) => mutate((s) => { if (s.lobby) fn(s.lobby) }),
    closeSession: (archive: boolean) => {
      tRef.current?.send({ r: 'h', k: 'closed' })
      mutate((s) => {
        if (archive && s.active && !s.active.example) s.history.unshift({ ...s.active, status: s.active.status === 'active' ? 'abandoned' : s.active.status, endedAt: s.active.endedAt ?? Date.now() })
        s.active = null
        s.lobby = null
      })
      onLeave()
    },
  }), [store, mutate, onLeave])

  // The host's own Bungie account goes on their seat or Guardian too.
  useEffect(() => {
    const bind = () => {
      const bid = bungieAccountId()
      const s = ref.current
      if (bid && bindBungieId(structuredClone({ run: s.active, lobby: s.lobby }), s.hostCid, bid, isOnline)) mutate((d) => { bindBungieId({ run: d.active, lobby: d.lobby }, d.hostCid, bid, isOnline) })
    }
    bind()
    return onAuthChange(bind)
  }, [code, isOnline, mutate])

  const myPlayerId = store.active?.players.find((p) => p.clientId === store.hostCid)?.id ?? null
  const ctx: Omit<Ctx, 'openFlow' | 'go' | 'toast'> = {
    role: 'host',
    me: store.hostCid,
    run: store.active,
    lobby: store.lobby,
    online,
    myPlayerId,
    canControl: (pid) => {
      const p = store.active?.players.find((x) => x.id === pid)
      return !!p && (p.clientId === store.hostCid || p.clientId === null)
    },
    dispatch: (intent, pid) => {
      const target = pid ?? myPlayerId
      const p = ref.current.active?.players.find((x) => x.id === target)
      if (!p || !(p.clientId === store.hostCid || p.clientId === null)) return toastRef.current('Only that Guardian’s player can do this.')
      let err: string | null = null
      const before = ref.current
      mutate((s) => { err = applyIntent(s.active!, p.id, intent) })
      if (err) { ref.current = before; setStore(before); toastRef.current(err) }
    },
    lobbyAct: (intent) => {
      let err: string | null = null
      mutate((s) => { if (s.lobby) err = applyLobbyIntent(s.lobby, s.hostCid, intent, isOnline) })
      if (err) toastRef.current(err)
    },
    claimSeat: () => {},
    host: api,
    net: { ...net, kind: tRef.current?.kind ?? (inClaudeViewer() ? 'room' : 'peer') },
    leave: () => onLeave(),
  }
  return <Shell base={ctx} toastRef={toastRef} />
}

// ====================================================================== guest

function GuestApp({ code, onLeave }: { code: string; onLeave: () => void }) {
  const [g] = useState(() => { const s = guestSession(); const n = { ...s, code }; saveGuestSession(n); return n })
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [net, setNet] = useState<{ status: TransportStatus; detail?: string }>({ status: 'connecting' })
  const [lastHeard, setLastHeard] = useState(0)
  const [closed, setClosed] = useState(false)
  const [now, setNow] = useState(Date.now())
  const tRef = useRef<Transport | null>(null)
  const vRef = useRef('')
  const syncAt = useRef(0)
  const toastRef = useRef<(m: string) => void>(() => {})

  useEffect(() => {
    const t = connect(code, 'guest')
    tRef.current = t
    const send = (m: object) => t.send({ r: 'g', cid: g.cid, bid: bungieAccountId() ?? undefined, ...m })
    const sync = () => { if (Date.now() - syncAt.current > 1500) { syncAt.current = Date.now(); send({ k: 'sync' }) } }
    const assemble = snapshotAssembler((v, value) => { vRef.current = v; setSnap(value as Snapshot); setClosed(false) })
    t.onStatus((status, detail) => { setNet({ status, detail }); if (status === 'online') send({ k: 'hello' }) })
    t.onMessage((raw) => {
      const m = raw as { r?: string; k?: string; v?: string; to?: string; err?: string | null }
      if (m?.r !== 'h') return
      setLastHeard(Date.now())
      if (m.k === 'state') assemble(m as unknown as StateChunk)
      else if (m.k === 'tick') { if (m.v && m.v !== vRef.current) sync() }
      else if (m.k === 'ack' && m.to === g.cid && m.err) toastRef.current(m.err)
      else if (m.k === 'closed') setClosed(true)
    })
    const ping = setInterval(() => { send({ k: 'ping' }); setNow(Date.now()) }, 5000)
    return () => { clearInterval(ping); t.close() }
  }, [code, g.cid])

  const send = (m: object) => tRef.current?.send({ r: 'g', cid: g.cid, bid: bungieAccountId() ?? undefined, id: Math.random().toString(36).slice(2, 8), ...m })
  const leave = () => {
    if (snap?.phase === 'lobby') send({ k: 'intent', scope: 'lobby', intent: { type: 'seat-leave' } })
    saveGuestSession({ cid: g.cid, code: null })
    onLeave()
  }

  const run = snap?.phase === 'run' ? snap.run : null
  const myPlayerId = run?.players.find((p) => p.clientId === g.cid)?.id ?? null
  const hostAway = !!snap && now - lastHeard > 12000

  if (!snap || closed) {
    return (
      <div className="landing">
        <div className="landing-inner narrow">
          <div className="brand big"><GhostGlyph /><div><div className="brand-name">Ghost Directive</div><div className="brand-sub">Lobby {code}</div></div></div>
          <section className="panel landing-card">
            {closed ? (
              <><h2>The host closed this lobby</h2><p className="muted">Ask your host for a new code.</p></>
            ) : net.status === 'unavailable' ? (
              <><h2>Can&rsquo;t reach lobbies here</h2><p className="muted">{net.detail}</p></>
            ) : (
              <><h2>Looking for lobby {code}&hellip;</h2><p className="muted">{net.status === 'online' ? 'Connected. Waiting for the host’s browser to answer. The host needs Ghost Directive open.' : net.detail ?? 'Connecting…'}</p><div className="scanner" aria-hidden="true" /></>
            )}
            <button className="btn btn-ghost" onClick={leave}>Leave</button>
          </section>
        </div>
      </div>
    )
  }

  const ctx: Omit<Ctx, 'openFlow' | 'go' | 'toast'> = {
    role: 'guest',
    me: g.cid,
    run,
    lobby: snap.phase === 'lobby' ? snap.lobby : null,
    online: snap.online,
    myPlayerId,
    canControl: (pid) => pid === myPlayerId,
    dispatch: (intent: Intent) => send({ k: 'intent', scope: 'run', intent }),
    lobbyAct: (intent: LobbyIntent) => send({ k: 'intent', scope: 'lobby', intent }),
    claimSeat: (playerId: string) => send({ k: 'intent', scope: 'claim', playerId }),
    host: null,
    net: { ...net, detail: hostAway ? 'The host’s browser is not answering. Changes will wait until it is back.' : net.detail, status: hostAway ? 'offline' : net.status, kind: tRef.current?.kind ?? 'none' },
    leave,
  }
  return <Shell base={ctx} toastRef={toastRef} />
}

// ====================================================================== shell

const NAV: { view: View; anchor?: string; label: string; short: string; hostOnly?: boolean }[] = [
  { view: 'briefing', label: 'Mission Briefing', short: 'Briefing' },
  { view: 'briefing', anchor: 'archive', label: 'Subclass Archive', short: 'Archive' },
  { view: 'briefing', anchor: 'artifact', label: 'Artifact Research', short: 'Artifact' },
  { view: 'briefing', anchor: 'arsenal', label: 'Field Arsenal', short: 'Arsenal' },
  { view: 'briefing', anchor: 'report', label: 'Combat Report', short: 'Report' },
  { view: 'protocols', label: 'Protocol Rulesets', short: 'Protocols', hostOnly: true },
  { view: 'history', label: 'Run History', short: 'History', hostOnly: true },
]

function Shell({ base, toastRef }: { base: Omit<Ctx, 'openFlow' | 'go' | 'toast'>; toastRef: React.MutableRefObject<(m: string) => void> }) {
  const [view, setView] = useState<View>('briefing')
  const [flow, setFlow] = useState<Flow | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [deferred, setDeferred] = useState<string[]>([])
  const [dismissedSwaps, setDismissedSwaps] = useState<string[]>([])
  toastRef.current = setToastMsg

  // Report the result of returning from Bungie's sign-in page, once.
  useEffect(() => {
    const r = takeSignInResult()
    if (r) setToastMsg(r.ok ? 'Signed in with Bungie. Reading your Vault\u2026' : r.error)
  }, [])

  useEffect(() => {
    if (!toastMsg) return
    const t = setTimeout(() => setToastMsg(null), 2800)
    return () => clearTimeout(t)
  }, [toastMsg])

  const go = useCallback((v: View, anchor?: string) => {
    setView(v)
    requestAnimationFrame(() => {
      const el = anchor ? document.getElementById(anchor) : null
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      else window.scrollTo({ top: 0 })
    })
  }, [])

  const ctx: Ctx = { ...base, openFlow: setFlow, go, toast: setToastMsg }
  const { run, lobby, myPlayerId, role } = base

  // Decisions that belong to this device open by themselves: your rewards first, then overflow swaps.
  const me = run?.players.find((p) => p.id === myPlayerId)
  useAutoSync(run, me, base.dispatch, setToastMsg)
  const myPending = run && me ? run.pending.filter((x) => x.playerId === me.id) : []
  const autoReward = myPending.find((x) => !deferred.includes(x.id))
  const swapSlot = run && me && run.ruleset.overflow === 'guided'
    ? run.ruleset.inventory.slots.find((s) => itemsIn(me, s).length > capacityOf(run, me) && !dismissedSwaps.includes(`${s}:${itemsIn(me, s).length}`))
    : undefined
  const activeFlow: Flow | null = flow
    ?? (autoReward ? { type: 'reward', pendingId: autoReward.id } : null)
    ?? (swapSlot && me ? { type: 'swap', playerId: me.id, slot: swapSlot } : null)
  const closeFlow = () => {
    if (flow) setFlow(null)
    else if (activeFlow?.type === 'reward') setDeferred((d) => [...d, activeFlow.pendingId])
    else if (activeFlow?.type === 'swap' && me) setDismissedSwaps((d) => [...d, `${activeFlow.slot}:${itemsIn(me, activeFlow.slot).length}`])
  }
  // A flow whose subject vanished (reward resolved elsewhere) closes itself.
  useEffect(() => {
    if (flow?.type === 'reward' && run && !run.pending.some((x) => x.id === flow.pendingId)) setFlow(null)
  }, [flow, run])

  const warnings = run ? computeWarnings(run) : []
  const crit = warnings.filter((w) => w.severity === 'critical').length
  const code = run?.code ?? lobby?.code ?? ''
  const nav = NAV.filter((n) => !n.hostOnly || role === 'host')
  const inRun = !!run && view === 'briefing'

  return (
    <GDContext.Provider value={ctx}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <GhostGlyph />
            <div>
              <div className="brand-name">Ghost Directive</div>
              <div className="brand-sub">{role === 'host' ? 'Hosting' : 'Joined'} &middot; lobby <span className="mono">{code}</span></div>
            </div>
          </div>
          <LobbyBadge />
          <nav className="nav">
            {nav.map((n) => (
              <button
                key={n.label}
                className={`nav-link ${!n.anchor && view === n.view ? 'is-on' : ''}`}
                onClick={() => go(n.view, n.anchor)}
                disabled={!!n.anchor && !run}
              >
                <span>{n.view === 'briefing' && !n.anchor && !run ? 'Lobby' : n.label}</span>
                {n.view === 'briefing' && !n.anchor && crit > 0 && <span className="badge-crit">{crit}</span>}
              </button>
            ))}
          </nav>
          <div className="sidebar-foot">
            <button className="link" onClick={base.leave}>{role === 'host' ? 'Back to start screen' : 'Leave lobby'}</button>
            <p>{role === 'host' ? 'The run lives in this browser. Close the window any time; it resumes here.' : 'The host’s browser keeps the run. You control your own Guardian.'}</p>
          </div>
        </aside>

        <main className="main">
          {bungieConfigured && (
            <div className="main-top">
              <SynapticLink onSignOut={() => { signOut(); if (me?.bungie) base.dispatch({ type: 'bungie-unlink' }, me.id) }} />
            </div>
          )}
          {view === 'protocols' && role === 'host' ? <Protocols />
            : view === 'history' && role === 'host' ? <History />
            : run ? <Briefing run={run} warnings={warnings} pendingDeferred={myPending.length} onOpenRewards={() => { setDeferred([]); if (myPending[0]) setFlow({ type: 'reward', pendingId: myPending[0].id }) }} />
            : lobby ? <LobbyView lobby={lobby} />
            : null}
        </main>

        <nav className="tabbar" aria-label="Sections">
          {(inRun ? nav.filter((n) => ['Briefing', 'Arsenal', 'Archive', 'Report'].includes(n.short)) : nav.filter((n) => !n.anchor)).map((n) => (
            <button key={n.short} onClick={() => go(n.view, n.anchor)} className={view === n.view && !n.anchor ? 'is-on' : ''}>
              {n.view === 'briefing' && !n.anchor && !run ? 'Lobby' : n.short}
            </button>
          ))}
          {role === 'guest' && !inRun && <button onClick={base.leave}>Leave</button>}
        </nav>
      </div>
      {activeFlow && run && <FlowHost key={JSON.stringify(activeFlow)} flow={activeFlow} run={run} onClose={closeFlow} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
      {DevTools && <Suspense fallback={null}><DevTools /></Suspense>}
    </GDContext.Provider>
  )
}

function LobbyBadge() {
  const { net, online, role } = useGD()
  const label = net.status === 'online' ? 'Lobby live' : net.status === 'connecting' ? 'Connecting' : net.status === 'unavailable' ? 'Offline mode' : 'Reconnecting'
  return (
    <div className={`net net-${net.status}`} title={net.detail}>
      <span className="dot" /> {label}
      {role === 'host' && net.status === 'online' && <span className="muted"> &middot; {online.length} device{online.length === 1 ? '' : 's'}</span>}
      {net.detail && net.status !== 'online' && <p className="small muted">{net.detail}</p>}
    </div>
  )
}

export function GhostGlyph() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true" className="ghost-glyph">
      <path d="M17 2 L24 9 L17 12 L10 9 Z" />
      <path d="M26 11 L32 17 L26 23 L23 17 Z" />
      <path d="M17 32 L10 25 L17 22 L24 25 Z" />
      <path d="M8 11 L11 17 L8 23 L2 17 Z" />
      <circle cx="17" cy="17" r="3.2" className="eye" />
    </svg>
  )
}
