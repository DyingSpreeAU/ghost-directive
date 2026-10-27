import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { accountName, bungieConfigured, detectDrops, fetchSnapshot, isSignedIn, onAuthChange, reconcile, signOut, startSignIn, takeSignInResult } from './bungie'
import type { Intent, Player, Run } from './model'
import { useGD } from './store'

// Link status shared by every part of the app that talks to Bungie (run sync, lobby preview),
// shown by the Synaptic Link indicator.
type SyncState = {
  busy: boolean
  error: string | null
  /** When Bungie generated the newest data we've received, and when we last fetched successfully. */
  mintedAt: number | null
  fetchedAt: number | null
}
let sync: SyncState = { busy: false, error: null, mintedAt: null, fetchedAt: null }
const subs = new Set<() => void>()
const setSync = (s: Partial<SyncState>) => { sync = { ...sync, ...s }; subs.forEach((f) => f()) }
const subscribe = (f: () => void) => { subs.add(f); const off = onAuthChange(f); return () => { subs.delete(f); off() } }

/** Parts of the app that can re-read Bungie on demand; the Synaptic Link runs them all. */
const refreshers = new Set<() => unknown>()
export function useRefresher(fn: (() => unknown) | null) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const run = () => ref.current?.()
    refreshers.add(run)
    return () => { refreshers.delete(run) }
  }, [])
}
export function refreshAll() { refreshers.forEach((f) => f()) }

/** Any Bungie read reports here so the indicator shows the true state. */
export function reportLink(ok: { mintedAt: number | null } | { error: string }) {
  if ('error' in ok) setSync({ error: ok.error })
  else setSync({ error: null, fetchedAt: Date.now(), mintedAt: Math.max(ok.mintedAt ?? 0, sync.mintedAt ?? 0) || null })
}

export function useBungie() {
  const state = useSyncExternalStore(subscribe, () => sync)
  const signedIn = useSyncExternalStore(subscribe, isSignedIn)
  return { ...state, signedIn }
}

/**
 * Reads the player's Destiny profile on this device and sends the result to the host:
 * Vault pool, mismatch checks, and any drops detected since the run started.
 */
export async function syncBungie(run: Run, p: Player, dispatch: (i: Intent, pid?: string) => void, notify?: (msg: string) => void) {
  if (sync.busy || !isSignedIn()) return
  setSync({ busy: true })
  try {
    const snap = await fetchSnapshot(p.cls)
    reportLink({ mintedAt: snap.mintedAt })
    const drops = run.status === 'active' ? detectDrops(run.id, p, snap) : []
    // Check mismatches as if the detected drops were already registered.
    const withDrops = { ...p, inventory: [...p.inventory, ...drops.map((d) => ({ id: d.instanceId, name: d.name, slot: d.slot, rarity: d.rarity, equipped: false, source: '' }))] }
    const { missing, untracked } = reconcile(snap, withDrops)
    const sub = snap.subclass
    dispatch({
      type: 'bungie-sync', name: snap.name, character: snap.character, vault: snap.vault, vaultItems: snap.vaultItems, missing, untracked, drops,
      subclass: sub ? { name: sub.name, element: sub.element } : null,
      configured: sub && sub.element === p.element ? sub.abilityIds : [],
      artifact: snap.artifact,
    }, p.id)
    const found = drops.filter((d) => !d.starting)
    if (found.length) notify?.(`New drop${found.length > 1 ? 's' : ''} detected: ${found.map((d) => d.name).join(', ')}`)
    else if (drops.length) notify?.(`Starting gear registered from Bungie: ${drops.map((d) => d.name).join(', ')}`)
    setSync({ busy: false })
  } catch (e) {
    setSync({ busy: false, error: (e as Error).message })
  }
}

/** During a run, drops are checked every minute; otherwise every 10. */
const RUN_SYNC_MS = 60_000
const IDLE_SYNC_MS = 10 * 60_000
/** Bungie's profile data lags the game a little, so check again shortly after each clear. */
const AFTER_CLEAR_MS = 45_000

/** Keeps a signed-in player's Bungie data fresh: on load, after sign-in, on a timer, and after clears. */
export function useAutoSync(run: Run | null, me: Player | undefined, dispatch: (i: Intent, pid?: string) => void, notify: (msg: string) => void) {
  const { signedIn } = useBungie()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000)
    return () => clearInterval(t)
  }, [])
  const live = run?.status === 'active'
  const stale = !me?.bungie || Date.now() - me.bungie.syncedAt > (live ? RUN_SYNC_MS : IDLE_SYNC_MS)
  const ready = bungieConfigured && signedIn && !!run && !!me
  // The Synaptic Link's "sync everything" includes this run sync.
  useRefresher(ready ? () => syncBungie(run!, me!, dispatch, notify) : null)
  useEffect(() => {
    if (ready && stale) syncBungie(run!, me!, dispatch, notify)
    // Re-run when the player, sign-in state or the clock changes; run/dispatch are read fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, ready, stale, tick])
  const progress = (run?.claimed.length ?? 0) + (run?.chests.length ?? 0)
  const latest = useRef({ run, me })
  latest.current = { run, me }
  useEffect(() => {
    if (!ready || progress === 0) return
    const t = setTimeout(() => { const { run: r, me: m } = latest.current; if (r && m) syncBungie(r, m, dispatch, notify) }, AFTER_CLEAR_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, ready])
}

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

/** Sign-in and sync controls for the player's own Guardian. */
export function BungiePanel({ p, dispatch }: { p: Player; dispatch: (i: Intent, pid?: string) => void }) {
  const { busy, error, signedIn } = useBungie()
  const { run, toast } = useGD()
  if (!bungieConfigured) return null
  if (!signedIn) {
    return (
      <div className="bungie-box">
        <div>
          <strong>Use your real Vault and track drops automatically</strong>
          <p className="small muted">Sign in with Bungie to fill this pool from your Vault, pick up new drops without typing them in, and check your run gear against your account. Read-only: nothing is moved or equipped.</p>
          {error && <p className="small tone-danger">{error}</p>}
        </div>
        <button className="btn btn-light btn-sm" onClick={startSignIn}>Sign in with Bungie</button>
      </div>
    )
  }
  return (
    <div className="bungie-box is-linked">
      <div>
        <strong>{p.bungie ? p.bungie.name : 'Signed in with Bungie'}</strong>
        <p className="small muted">
          {busy ? 'Reading your Destiny profile…'
            : p.bungie ? `${p.bungie.character} · ${p.vault.length} eligible of ${p.bungie.vaultItems} Vault items · drops tracked automatically · synced ${ago(p.bungie.syncedAt)}`
            : 'Not synced yet.'}
        </p>
        {error && <p className="small tone-danger">{error}</p>}
      </div>
      <div className="row-acts">
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run && syncBungie(run, p, dispatch, toast)}>{busy ? 'Syncing…' : 'Sync now'}</button>
        <button className="link" onClick={() => { signOut(); if (p.bungie) dispatch({ type: 'bungie-unlink' }, p.id) }}>Sign out</button>
      </div>
    </div>
  )
}

/** First step on the start screen: optional Bungie sign-in before hosting or joining. */
export function BungieStart() {
  const { signedIn } = useBungie()
  const [name, setName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const r = takeSignInResult()
    if (r && !r.ok) setError(r.error)
  }, [])
  useEffect(() => {
    if (!signedIn) { setName(null); return }
    let live = true
    accountName().then((n) => live && setName(n)).catch((e) => live && setError((e as Error).message))
    return () => { live = false }
  }, [signedIn])
  if (!bungieConfigured) return null
  return (
    <section className={`panel bungie-start ${signedIn ? 'is-linked' : ''}`} aria-labelledby="bungie-start-title">
      <div className="bungie-start-text">
        <div className="eyebrow">Step 1 &middot; Bungie account <span className="muted">(optional)</span></div>
        {signedIn ? (
          <>
            <h2 id="bungie-start-title">Signed in{name ? <> as <span className="bungie-name">{name}</span></> : null}</h2>
            <p className="muted">Once you&rsquo;re in a run, new drops are tracked automatically and your Vault fills your reward choices. Read-only: nothing in your game is moved or equipped.</p>
          </>
        ) : (
          <>
            <h2 id="bungie-start-title">Sign in with Bungie</h2>
            <p className="muted">Drops are tracked automatically, reward choices come from your real Vault, and you get warnings when your gear doesn&rsquo;t match the run. Read-only. You can also skip this and enter drops and your Vault by hand.</p>
          </>
        )}
        {error && <p className="small tone-danger">{error}</p>}
      </div>
      {signedIn
        ? <button className="btn btn-ghost btn-sm" onClick={() => { signOut(); setError(null) }}>Sign out</button>
        : <button className="btn btn-light" onClick={startSignIn}>Sign in with Bungie</button>}
    </section>
  )
}

/** A link that hasn't reached Bungie in this long counts as down. */
const LINK_STALE_MS = 5 * 60_000

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The Synaptic Link: shows whether this device is reading Bungie's servers, and how long since
 * Bungie last updated the data. Clicking it re-reads everything that uses the API.
 */
export function SynapticLink({ onSignOut }: { onSignOut?: () => void }) {
  const { busy, error, mintedAt, fetchedAt, signedIn } = useBungie()
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  if (!bungieConfigured) return null
  const ok = signedIn && !error && !!fetchedAt && now - fetchedAt < LINK_STALE_MS
  const state = !signedIn ? 'Not signed in with Bungie'
    : error ? `Can't reach Bungie: ${error}`
    : !fetchedAt ? (busy ? 'Connecting to Bungie…' : 'Waiting for the first sync')
    : ok ? 'Linked and syncing' : 'No update from Bungie for a while'
  const onClick = () => (signedIn ? refreshAll() : startSignIn())
  return (
    <div className={`synaptic ${ok ? 'is-ok' : 'is-down'} ${busy ? 'is-busy' : ''}`}>
      <button className="synaptic-btn" onClick={onClick} aria-describedby="synaptic-tip" aria-label={signedIn ? 'Synaptic Link: sync with Bungie now' : 'Synaptic Link: sign in with Bungie'}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="4" cy="9" r="2.4" /><circle cx="14" cy="4" r="2.4" /><circle cx="14" cy="14" r="2.4" />
          <path d="M6.2 8 L11.8 5 M6.2 10 L11.8 13" />
        </svg>
        <span className="synaptic-time mono">{busy ? 'sync…' : signedIn && mintedAt ? clock(now - mintedAt) : signedIn ? '--:--' : 'offline'}</span>
      </button>
      <div className="synaptic-tip" id="synaptic-tip" role="tooltip">
        <strong>Synaptic Link</strong>
        <p>Reads your Guardian from Bungie&rsquo;s servers: what you have equipped, your subclass and artifact, and new drops during a run. Read-only.</p>
        <p className={ok ? 'tone-ok' : 'tone-danger'}>{state}</p>
        {mintedAt && <p className="muted">Bungie last updated your data {clock(now - mintedAt)} ago ({new Date(mintedAt).toLocaleTimeString()}).</p>}
        <p className="muted">{signedIn ? 'Click to sync everything now.' : 'Click to sign in.'}</p>
        {signedIn && onSignOut && <button className="link" onClick={onSignOut}>Sign out of Bungie</button>}
      </div>
    </div>
  )
}
