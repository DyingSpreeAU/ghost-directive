import { useEffect, useState, useSyncExternalStore } from 'react'
import { bungieConfigured, fetchSnapshot, isSignedIn, onAuthChange, reconcile, signOut, startSignIn } from './bungie'
import type { Intent, Player } from './model'

// Sync status shared by the panel and the automatic sync in the shell.
type SyncState = { busy: boolean; error: string | null }
let sync: SyncState = { busy: false, error: null }
const subs = new Set<() => void>()
const setSync = (s: SyncState) => { sync = s; subs.forEach((f) => f()) }
const subscribe = (f: () => void) => { subs.add(f); const off = onAuthChange(f); return () => { subs.delete(f); off() } }

export function useBungie() {
  const state = useSyncExternalStore(subscribe, () => sync)
  const signedIn = useSyncExternalStore(subscribe, isSignedIn)
  return { ...state, signedIn }
}

/** Reads the player's Destiny profile on this device and sends the result to the host. */
export async function syncBungie(p: Player, dispatch: (i: Intent, pid?: string) => void) {
  if (sync.busy || !isSignedIn()) return
  setSync({ busy: true, error: null })
  try {
    const snap = await fetchSnapshot(p.cls)
    const { missing, untracked } = reconcile(snap, p)
    dispatch({ type: 'bungie-sync', name: snap.name, character: snap.character, vault: snap.vault, vaultItems: snap.vaultItems, missing, untracked }, p.id)
    setSync({ busy: false, error: null })
  } catch (e) {
    setSync({ busy: false, error: (e as Error).message })
  }
}

const AUTO_SYNC_MS = 10 * 60_000

/** Keeps a signed-in player's Bungie data fresh: on load, after sign-in, and every 10 minutes. */
export function useAutoSync(me: Player | undefined, dispatch: (i: Intent, pid?: string) => void) {
  const { signedIn } = useBungie()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])
  const stale = !me?.bungie || Date.now() - me.bungie.syncedAt > AUTO_SYNC_MS
  useEffect(() => {
    if (bungieConfigured && signedIn && me && stale) syncBungie(me, dispatch)
    // Re-run when the player, sign-in state or the clock changes; dispatch is stable enough here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, signedIn, stale, tick])
}

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

/** Sign-in and sync controls for the player's own Guardian. */
export function BungiePanel({ p, dispatch }: { p: Player; dispatch: (i: Intent, pid?: string) => void }) {
  const { busy, error, signedIn } = useBungie()
  if (!bungieConfigured) return null
  if (!signedIn) {
    return (
      <div className="bungie-box">
        <div>
          <strong>Use your real Vault</strong>
          <p className="small muted">Sign in with Bungie to fill this pool from your Vault and check your run gear against your account. Read-only: nothing is moved or equipped.</p>
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
            : p.bungie ? `${p.bungie.character} · ${p.vault.length} eligible of ${p.bungie.vaultItems} Vault items · synced ${ago(p.bungie.syncedAt)}`
            : 'Not synced yet.'}
        </p>
        {error && <p className="small tone-danger">{error}</p>}
      </div>
      <div className="row-acts">
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => syncBungie(p, dispatch)}>{busy ? 'Syncing…' : 'Sync now'}</button>
        <button className="link" onClick={() => { signOut(); if (p.bungie) dispatch({ type: 'bungie-unlink' }, p.id) }}>Sign out</button>
      </div>
    </div>
  )
}
