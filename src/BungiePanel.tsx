import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { accountName, bungieConfigured, detectDrops, fetchSnapshot, isSignedIn, onAuthChange, reconcile, restoreGuardian, signOut, startSignIn, takeSignInResult, type RestoreReport } from './bungie'
import { Modal } from './ui'
import type { Intent, Player, Run } from './model'
import { useGD } from './store'

// Link status shared by every part of the app that talks to Bungie (run sync, lobby preview),
// shown by the Synaptic Link indicator.
type SyncState = {
  busy: boolean
  error: string | null
  /** When we last read Bungie successfully. */
  fetchedAt: number | null
}
let sync: SyncState = { busy: false, error: null, fetchedAt: null }
const subs = new Set<() => void>()
const setSync = (s: Partial<SyncState>) => { sync = { ...sync, ...s }; subs.forEach((f) => f()) }
const subscribe = (f: () => void) => { subs.add(f); const off = onAuthChange(f); return () => { subs.delete(f); off() } }

/** Any Bungie read reports here so the indicator shows the true state. */
export function reportLink(r: { ok: true } | { error: string }) {
  if ('error' in r) setSync({ error: r.error })
  else setSync({ error: null, fetchedAt: Date.now() })
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
    reportLink({ ok: true })
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
      restore: snap.restore,
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
            <p className="muted">Once you&rsquo;re in a run, new drops are tracked automatically and your Vault fills your reward choices. Nothing in your game is moved or equipped unless you ask for it with Restore my Guardian.</p>
          </>
        ) : (
          <>
            <h2 id="bungie-start-title">Sign in with Bungie</h2>
            <p className="muted">Drops are tracked automatically, reward choices come from your real Vault, and you get warnings when your gear doesn&rsquo;t match the run. It can also put a saved run&rsquo;s gear back on your character when you ask. You can also skip this and enter drops and your Vault by hand.</p>
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

/** The Synaptic Link: a Ghost that glows green while this device is reading Bungie, red when it isn't. */
export function SynapticLink({ onSignOut }: { onSignOut?: () => void }) {
  const { busy, error, fetchedAt, signedIn } = useBungie()
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t) }, [])
  if (!bungieConfigured) return null
  const ok = signedIn && !error && !!fetchedAt && now - fetchedAt < LINK_STALE_MS
  const state = !signedIn ? 'Not signed in with Bungie'
    : error ? `Can't reach Bungie: ${error}`
    : !fetchedAt ? (busy ? 'Connecting to Bungie…' : 'Waiting for the first sync')
    : ok ? 'Linked and syncing' : 'No update from Bungie for a while'
  return (
    <div className={`synaptic ${ok ? 'is-ok' : 'is-down'}`}>
      <span className="synaptic-icon" tabIndex={0} role="img" aria-label={`Synaptic Link: ${state}`} aria-describedby="synaptic-tip">
        <svg width="26" height="26" viewBox="0 0 34 34" aria-hidden="true">
          <path d="M17 2 L24 9 L17 12 L10 9 Z" />
          <path d="M26 11 L32 17 L26 23 L23 17 Z" />
          <path d="M17 32 L10 25 L17 22 L24 25 Z" />
          <path d="M8 11 L11 17 L8 23 L2 17 Z" />
          <circle cx="17" cy="17" r="3.2" className="eye" />
        </svg>
      </span>
      <div className="synaptic-tip" id="synaptic-tip" role="tooltip">
        <strong>Synaptic Link</strong>
        <p>Your Ghost&rsquo;s link to Bungie&rsquo;s servers. While it&rsquo;s green, the app reads what you have equipped, your subclass and artifact, and new drops during a run. It only moves or equips items when you use Restore my Guardian.</p>
        <p className={ok ? 'tone-ok' : 'tone-danger'}>{state}</p>
        {signedIn
          ? onSignOut && <button className="link" onClick={onSignOut}>Sign out of Bungie</button>
          : <button className="link" onClick={startSignIn}>Sign in with Bungie</button>}
      </div>
    </div>
  )
}

/**
 * Puts the run's setup back on the player's character in Destiny 2: weapons and armor outside the
 * run go to the Vault, run items come to the character, and the last recorded setup is equipped.
 */
export function RestoreGuardian({ run, p }: { run: Run; p: Player }) {
  const { signedIn } = useBungie()
  const { dispatch, toast } = useGD()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState('')
  const [report, setReport] = useState<RestoreReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!bungieConfigured || !signedIn || run.status !== 'active') return null
  const point = p.bungie?.restore
  const go = async () => {
    setBusy(true); setError(null); setReport(null)
    try {
      setReport(await restoreGuardian(p, point, setStep))
      await syncBungie(run, p, dispatch, toast)
    } catch (e) { setError((e as Error).message) }
    setBusy(false); setStep('')
  }
  const close = () => { if (!busy) { setOpen(false); setReport(null); setError(null) } }
  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Restore my Guardian</button>
      {open && (
        <Modal
          title="Restore my Guardian"
          kicker={`${p.name} · ${p.cls}`}
          onClose={busy ? undefined : close}
          footer={report || error
            ? <button className="btn btn-light" onClick={close}>Done</button>
            : <><button className="btn btn-ghost" disabled={busy} onClick={close}>Cancel</button><button className="btn btn-light" disabled={busy} onClick={go}>{busy ? 'Working…' : 'Restore'}</button></>}
        >
          {!report && !error && (
            <div className="stack restore-info">
              <p>Puts this run&rsquo;s setup back on your {p.cls} in Destiny 2:</p>
              <ul>
                <li><strong>To the Vault:</strong> weapons and armor on your {p.cls} that aren&rsquo;t in your run inventory.</li>
                <li><strong>To your {p.cls}:</strong> your {p.inventory.length} run item{p.inventory.length === 1 ? '' : 's'}, from the Vault or your other characters.</li>
                <li><strong>Equip:</strong> {point ? `your last run setup (recorded ${new Date(point.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}) and its subclass` : 'the items marked equipped in your run inventory'}. Bungie only allows this in orbit, a social space like the Tower, or while you&rsquo;re offline.</li>
              </ul>
              <p className="small muted">Nothing is deleted or dismantled. Items in the Postmaster stay there. If your Vault is full, some items can&rsquo;t move.</p>
              {busy && <p className="small"><span className="scanner small" aria-hidden="true" /> {step || 'Reading your account…'}</p>}
            </div>
          )}
          {error && <p className="tone-danger">{error}</p>}
          {report && (
            <div className="stack restore-info">
              <p>Your {report.character}:</p>
              <ul>
                <li>{report.vaulted.length ? `Sent to the Vault: ${report.vaulted.join(', ')}` : 'Nothing needed to go to the Vault.'}</li>
                <li>{report.pulled.length ? `Pulled to your ${p.cls}: ${report.pulled.join(', ')}` : `Your run items were already on your ${p.cls}.`}</li>
                <li className={report.equip === 'done' ? 'tone-ok' : report.equip === 'skipped' ? '' : 'tone-warn'}>
                  {{ done: 'Run setup equipped.', partial: 'Some of your run setup couldn’t be equipped; check your character.', location: 'Not equipped: you’re in an activity. Go to orbit or a social space (or log off) and run this again to equip.', skipped: 'No recorded setup to equip yet.' }[report.equip]}
                </li>
              </ul>
              {report.problems.length > 0 && <><p className="small tone-warn">Couldn&rsquo;t handle:</p><ul className="small">{report.problems.map((x) => <li key={x}>{x}</li>)}</ul></>}
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
