import { useCallback, useEffect, useState } from 'react'
import { ARTIFACTS, CLASSES, DUNGEONS, baseKit, artifactByName, chestCount, type ClassType, ELEMENT_COLOR, ELEMENTS, KIND_LABEL, dungeonById, subclassAbilities } from './data'
import { CHECKLIST, CHRONOLOGICAL_ROUTE, MAX_SEATS, defaultStarter, newSeat, runFromLobby, type Lobby, type Seat } from './model'
import { allProtocols, useGD } from './store'
import { ElementMark, EncounterArt, SortableList, rarityClass } from './ui'
import { bungieConfigured, fetchEquipped, startSignIn, type EquippedPreview } from './bungie'
import type { Rarity, Slot } from './data'
import { reportLink, useBungie } from './BungiePanel'

type Patch = Partial<Pick<Seat, 'name' | 'cls' | 'element' | 'starter' | 'ready' | 'artifact'>> & { auto?: boolean }

export function LobbyView({ lobby }: { lobby: Lobby }) {
  const { role, me, online, host, lobbyAct, toast, net } = useGD()
  const mine = lobby.seats.find((s) => s.clientId === me)
  const isOnline = (cid: string | null) => !!cid && online.includes(cid)

  // Host edits seats with no device directly; everyone edits their own seat through an intent.
  const patchSeat = (seat: Seat, patch: Patch) => {
    if (seat.clientId === me) return lobbyAct({ type: 'seat-update', patch })
    if (host && seat.clientId === null) {
      host.updateLobby((l) => {
        const s = l.seats.find((x) => x.id === seat.id)!
        const { auto: _auto, ...changes } = patch
        Object.assign(s, changes)
        if (patch.cls || patch.element) s.starter = defaultStarter(s.cls, s.element)
      })
    }
  }

  // Signed-in players: live equipped gear, used to fill their seat once and to warn before readying up.
  const eq = useEquipped()
  useAutofill(eq, mine, (patch) => { if (mine) patchSeat(mine, patch) }, toast)
  const notice = mine && eq.active && eq.data ? <SyncNotice eq={eq} compact /> : undefined
  // Fetch the active character fresh and fill the player's seat from it.
  const syncSeat = () => eq.refresh().then((d) => {
    if (!d || !mine) return
    patchSeat(mine, { ...seatFromCharacter(d), auto: true })
    toast(`Synced from your ${d.cls}${d.subclass ? ` (${d.subclass.name})` : ''}.`)
  })
  const others = lobby.seats.filter((s) => s.clientId && s.clientId !== me && isOnline(s.clientId))

  return (
    <div className="lobby">
      <header className="page-head">
        <div>
          <div className="eyebrow">Lobby</div>
          <h1>{lobby.name.trim() || 'Prepare the Directive'}</h1>
          <p className="section-note">
            {role === 'host'
              ? 'Share the code. Each Guardian joins from their own device and sets up their own subclass and starting gear. You choose the protocol and route.'
              : 'Set up your Guardian, then mark yourself ready. The host chooses the protocol and route and starts the run.'}
          </p>
        </div>
        <CodeCard code={lobby.code} />
      </header>

      {role === 'host' && net.status === 'unavailable' && (
        <div className="warn warn-warn static"><span className="warn-sev">Solo only</span><span className="warn-title">Other players can&rsquo;t join from here.</span><span className="warn-rule">{net.detail} You can still add Guardians without a device and run them from this browser.</span></div>
      )}

      {role === 'guest' && !mine && <SeatPicker lobby={lobby} />}

      <section className="seats">
        {lobby.seats.map((s) => {
          const editable = s.clientId === me || (role === 'host' && s.clientId === null)
          return (
            <SeatCard
              key={s.id}
              seat={s}
              you={s.clientId === me}
              connected={s.clientId === null ? null : isOnline(s.clientId)}
              editable={editable}
              onPatch={(p) => patchSeat(s, p)}
              notice={s.clientId === me ? notice : undefined}
              sync={s.clientId === me && eq.active ? { busy: eq.busy, run: syncSeat } : undefined}
              hostTools={role === 'host' && !s.isHost ? {
                remove: () => host!.updateLobby((l) => { l.seats = l.seats.filter((x) => x.id !== s.id) }),
                unlink: s.clientId ? () => host!.updateLobby((l) => { const x = l.seats.find((y) => y.id === s.id)!; x.clientId = null; x.ready = false }) : undefined,
              } : undefined}
            />
          )
        })}
        {role === 'host' && lobby.seats.length < MAX_SEATS && (
          <div className="panel seat seat-empty">
            <div className="eyebrow">Open seat</div>
            <p className="muted">Waiting for a player to join with code <span className="mono">{lobby.code}</span>.</p>
            <button className="link" onClick={() => host!.updateLobby((l) => { l.seats.push(newSeat(l.seats.length + 1, null)) })}>Add a Guardian without a device</button>
            <p className="small muted">You will choose rewards for a Guardian with no device. A player can take the seat later.</p>
          </div>
        )}
      </section>

      <SetupGuide />

      <RouteAndProtocol lobby={lobby} />

      <EquippedNow eq={eq} seat={mine} onApply={(patch) => mine && patchSeat(mine, patch)} />

      {role === 'host' ? <BeginBar lobby={lobby} isOnline={isOnline} notice={notice} readyRow={others.length > 0 ? <ReadyRow lobby={lobby} isOnline={isOnline} me={me} /> : undefined} onBegin={() => {
        host!.mutate((s) => { s.active = runFromLobby(s.lobby!); s.lobby = null })
        toast('Run started. Route locked.')
      }} /> : (
        <div className="panel waiting-bar">
          <div className="waiting-text">
            <span>{mine?.ready ? <><span className="scanner small" aria-hidden="true" /> You&rsquo;re ready. Waiting for the host to begin.</> : 'Choose your artifact, set up your starting gear, then mark yourself ready.'}</span>
            <ReadyRow lobby={lobby} isOnline={isOnline} me={me} />
            {notice}
          </div>
          {mine && (
            <button className={`btn ${mine.ready ? 'btn-ghost' : 'btn-light'}`} disabled={!artifactByName(mine.artifact) && !mine.ready} onClick={() => patchSeat(mine, { ready: !mine.ready })}>
              {mine.ready ? 'Not ready yet' : artifactByName(mine.artifact) ? 'I\u2019m ready' : 'Choose an artifact first'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function CodeCard({ code }: { code: string }) {
  const { toast } = useGD()
  return (
    <div className="code-card">
      <div className="eyebrow">Lobby code</div>
      <div className="code-big mono" aria-label={`Lobby code ${code.split('').join(' ')}`}>{code}</div>
      <button className="btn btn-ghost btn-sm" onClick={(e) => {
        const el = (e.currentTarget.previousSibling as HTMLElement)
        navigator.clipboard.writeText(code).then(() => toast('Code copied'), () => {
          const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r); toast('Code selected. Copy it to share.')
        })
      }}>Copy code</button>
    </div>
  )
}

function SeatPicker({ lobby }: { lobby: Lobby }) {
  const { lobbyAct, online } = useGD()
  const free = lobby.seats.filter((s) => !s.isHost && (!s.clientId || !online.includes(s.clientId)))
  return (
    <section className="panel seat-picker">
      <h2>Take a seat</h2>
      <p className="section-note">Pick the Guardian you play, or join as a new one.</p>
      <div className="row-acts">
        {free.map((s) => <button key={s.id} className="btn btn-ghost" onClick={() => lobbyAct({ type: 'seat-claim', seatId: s.id })}>Play as {s.name}</button>)}
        {lobby.seats.length < MAX_SEATS && <button className="btn btn-light" onClick={() => lobbyAct({ type: 'seat-claim', seatId: null })}>Join as a new Guardian</button>}
        {free.length === 0 && lobby.seats.length >= MAX_SEATS && <p className="muted">The fireteam is full.</p>}
      </div>
    </section>
  )
}

function SeatCard({ seat, you, connected, editable, onPatch, hostTools, notice, sync }: {
  seat: Seat; you: boolean; connected: boolean | null; editable: boolean
  /** Re-reads the active character from Bungie and fills this seat (signed-in player's own seat). */
  sync?: { busy: boolean; run: () => void }
  /** Bungie sync status for the player's own seat, shown by the Ready button. */
  notice?: React.ReactNode
  onPatch: (p: Patch) => void
  hostTools?: { remove: () => void; unlink?: () => void }
}) {
  const [name, setName] = useState(seat.name)
  useEffect(() => setName(seat.name), [seat.name])
  const abil = subclassAbilities(seat.cls, seat.element)
  const art = artifactByName(seat.artifact)
  const status = seat.clientId === null ? (art ? 'No device' : 'Needs artifact') : connected ? ((seat.ready || seat.isHost) && art ? 'Ready' : 'Setting up') : 'Disconnected'
  return (
    <article className={`panel seat ${you ? 'is-you' : ''}`} style={{ ['--el' as string]: ELEMENT_COLOR[seat.element] }}>
      <header className="seat-head">
        <ElementMark element={seat.element} size={22} />
        <div className="seat-title">
          {editable ? (
            <input id={`seat-name-${seat.id}`} aria-label="Guardian name" className="seat-name" value={name} maxLength={24}
              onChange={(e) => setName(e.target.value)} onBlur={() => name !== seat.name && onPatch({ name })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          ) : <h3>{seat.name}</h3>}
          <div className="player-sub">
            {seat.element} {seat.cls}
            {seat.isHost && <span className="tag tag-host">Host</span>}
            {you && <span className="tag">You</span>}
          </div>
        </div>
        <span className={`seat-status st-${status.replace(/\s/g, '').toLowerCase()}`}>{status}</span>
      </header>

      {editable ? (
        <>
          {sync && (
            <div className="seat-sync">
              <span className="small muted">Class, subclass and abilities</span>
              <button className="btn btn-ghost btn-sm" disabled={sync.busy} onClick={sync.run} title="Read your in-game character from Bungie and set your class, subclass, Super, melee and grenade to match.">
                {sync.busy ? 'Syncing\u2026' : 'Sync from active character'}
              </button>
            </div>
          )}
          <div className="seg" role="radiogroup" aria-label="Class">
            {CLASSES.map((c) => <button key={c} role="radio" aria-checked={seat.cls === c} className={seat.cls === c ? 'is-on' : ''} onClick={() => onPatch({ cls: c })}>{c}</button>)}
          </div>
          <div className="el-pick" role="radiogroup" aria-label="Committed subclass">
            {ELEMENTS.map((el) => (
              <button key={el} role="radio" aria-checked={seat.element === el} className={seat.element === el ? 'is-on' : ''} style={{ ['--el' as string]: ELEMENT_COLOR[el] }} onClick={() => onPatch({ element: el })}>
                <ElementMark element={el} size={18} /><span>{el}</span>
              </button>
            ))}
          </div>
          {(['super', 'melee', 'grenade'] as const).map((k) => (
            <div key={k} className="field">
              <label htmlFor={`${k}-${seat.id}`}>Starting {KIND_LABEL[k].toLowerCase()}</label>
              <select id={`${k}-${seat.id}`} value={seat.starter[k]} onChange={(e) => onPatch({ starter: { ...seat.starter, [k]: e.target.value } })}>
                {abil.filter((a) => a.kind === k && !baseKit(seat.cls, seat.element).includes(a.id)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {k === 'grenade' && baseKit(seat.cls, seat.element).length > 0 && (
                <small className="muted">{baseKit(seat.cls, seat.element).map((id) => id.split('|')[2]).join(', ')} is always available on Prismatic, on top of this.</small>
              )}
            </div>
          ))}
          <div className="field">
            <label htmlFor={`art-${seat.id}`}>Artifact <span className="muted">(locked for the run)</span></label>
            <select id={`art-${seat.id}`} value={seat.artifact} onChange={(e) => onPatch({ artifact: e.target.value })} className={seat.artifact ? '' : 'needs-pick'}>
              <option value="" disabled>Choose an artifact</option>
              {ARTIFACTS.map((a) => <option key={a.name} value={a.name}>{a.name} ({a.season})</option>)}
            </select>
            {art ? <small className="muted">{art.focus || 'All-round perks'}. Artifact research only offers this artifact&rsquo;s perks.</small>
              : <small className="tone-warn">Pick one before the run starts. All Artifact research comes from it.</small>}
          </div>
          {notice}
          {!seat.isHost && seat.clientId !== null && (
            <button className={`btn ${seat.ready ? 'btn-ghost' : 'btn-light'}`} disabled={!art && !seat.ready} onClick={() => onPatch({ ready: !seat.ready })}>
              {seat.ready ? 'Not ready yet' : art ? 'I\u2019m ready' : 'Choose an artifact first'}
            </button>
          )}
        </>
      ) : (
        <dl className="seat-summary">
          {(['super', 'melee', 'grenade'] as const).map((k) => <div key={k}><dt>{KIND_LABEL[k]}</dt><dd>{abil.find((a) => a.id === seat.starter[k])?.name}</dd></div>)}
          <div><dt>Artifact</dt><dd>{art ? art.name : <span className="tone-warn">Not chosen</span>}</dd></div>
        </dl>
      )}

      {you && <SeatBungie />}

      {hostTools && (
        <div className="seat-tools">
          {hostTools.unlink && <button className="link" onClick={hostTools.unlink}>Unlink device</button>}
          <button className="link" onClick={hostTools.remove}>Remove seat</button>
        </div>
      )}
    </article>
  )
}

function RouteAndProtocol({ lobby }: { lobby: Lobby }) {
  const { host } = useGD()
  const [chronoCount, setChronoCount] = useState(lobby.expedition === 'chronological' ? lobby.route.length : DUNGEONS.length)
  const set = host?.updateLobby
  const protocols = host ? allProtocols(host.store) : []
  const r = lobby.ruleset

  if (!set) {
    return (
      <section className="panel route-summary">
        <div>
          <div className="eyebrow">Protocol</div>
          <strong>{r.name}</strong>
          <p className="small muted">{r.integrity.start} Integrity, +{r.integrity.clear} per clear, &minus;{r.integrity.wipe} per wipe, {r.inventory.capacity} items per slot.</p>
        </div>
        <div>
          <div className="eyebrow">{lobby.expedition === 'chronological' ? 'Chronological Expedition' : 'Custom Expedition'}</div>
          <p>{lobby.route.map((id) => dungeonById(id).name).join(' → ')}</p>
        </div>
      </section>
    )
  }

  const setChrono = (n: number) => { setChronoCount(n); set((l) => { l.route = CHRONOLOGICAL_ROUTE.slice(0, n) }) }
  return (
    <section className="panel host-setup">
      <div className="host-setup-col">
        <h2>Protocol</h2>
        <div className="field">
          <label htmlFor="lobby-protocol">Ruleset</label>
          <select id="lobby-protocol" value={lobby.protocolId} onChange={(e) => {
            const p = protocols.find((x) => x.id === e.target.value)!
            set((l) => { l.protocolId = p.id; l.ruleset = structuredClone(p) })
          }}>
            {protocols.map((p) => <option key={p.id} value={p.id}>{p.name}{p.preset ? '' : ' (custom)'}</option>)}
          </select>
          <small className="muted">{r.description}</small>
        </div>
        <dl className="proto-stats">
          <div><dt>Start</dt><dd>{r.integrity.start}</dd></div>
          <div><dt>Clear</dt><dd>+{r.integrity.clear}</dd></div>
          <div><dt>Wipe</dt><dd>&minus;{r.integrity.wipe}</dd></div>
          <div><dt>Starting Slot Cap</dt><dd>{r.inventory.capacity}</dd></div>
        </dl>
        <div className="field">
          <label htmlFor="run-name">Run name (optional)</label>
          <input id="run-name" defaultValue={lobby.name} onBlur={(e) => set((l) => { l.name = e.target.value.slice(0, 40) })} placeholder="e.g. Tuesday night Directive" />
        </div>
        <p className="small muted">Mode A, No Login. Bungie integration (Mode B) is planned.</p>
      </div>
      <div className="host-setup-col">
        <h2>Expedition</h2>
        <div className="seg">
          <button className={lobby.expedition === 'chronological' ? 'is-on' : ''} onClick={() => set((l) => { l.expedition = 'chronological'; l.route = CHRONOLOGICAL_ROUTE.slice(0, chronoCount) })}>Chronological</button>
          <button className={lobby.expedition === 'custom' ? 'is-on' : ''} onClick={() => set((l) => { l.expedition = 'custom' })}>Custom</button>
        </div>
        {lobby.expedition === 'chronological' ? (
          <div className="field inline">
            <label htmlFor="chrono-count">Dungeons</label>
            <input id="chrono-count" type="range" min={1} max={DUNGEONS.length} value={chronoCount} onChange={(e) => setChrono(+e.target.value)} />
            <span className="mono">{chronoCount}</span>
          </div>
        ) : (
          <div className="route-builder">
            <div>
              <h4 className="flow-sub">Available</h4>
              <ul className="route-list">
                {DUNGEONS.filter((d) => !lobby.route.includes(d.id)).map((d) => (
                  <li key={d.id}><span>{d.name} <small className="muted">{d.released.slice(0, 4)}</small></span><button className="chip" onClick={() => set((l) => { l.route.push(d.id) })}>Add</button></li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="flow-sub">Route order</h4>
              <SortableList
                items={lobby.route}
                keyOf={(id) => id}
                label={(id) => dungeonById(id).name}
                onReorder={(next) => set((l) => { l.route = next })}
                render={(id, i) => (
                  <>
                    <span className="sort-name"><span className="mono muted">{i + 1}.</span> {dungeonById(id).name}</span>
                    <button className="chip" onClick={() => set((l) => { l.route = l.route.filter((x) => x !== id) })}>Remove</button>
                  </>
                )}
              />
              {lobby.route.length > 1 && <p className="small muted">Drag to reorder.</p>}
            </div>
          </div>
        )}
        <div className="route-preview">
          {lobby.route.map((id) => {
            const d = dungeonById(id)
            return (
              <div key={id} className="route-card">
                <EncounterArt dungeon={d} encounter={d.encounters[d.encounters.length - 1]} compact />
                <div><strong>{d.name}</strong><span className="muted small">{d.destination ? <>{d.destination} &middot; </> : null}{d.encounters.length} encounters{chestCount(d) ? ` \u00b7 ${chestCount(d)} chest${chestCount(d) > 1 ? 's' : ''}` : ''}</span></div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function BeginBar({ lobby, isOnline, onBegin, notice, readyRow }: { lobby: Lobby; isOnline: (cid: string | null) => boolean; onBegin: () => void; notice?: React.ReactNode; readyRow?: React.ReactNode }) {
  const [confirm, setConfirm] = useState(false)
  const notReady = lobby.seats.filter((s) => !s.isHost && s.clientId !== null && (!s.ready || !isOnline(s.clientId)))
  const noArtifact = lobby.seats.filter((s) => !artifactByName(s.artifact))
  const noRoute = lobby.route.length === 0
  return (
    <div className="panel begin-bar">
      <div>
        <strong>{lobby.seats.length} Guardian{lobby.seats.length === 1 ? '' : 's'}</strong>
        <span className="muted"> &middot; {lobby.route.length} dungeon{lobby.route.length === 1 ? '' : 's'} &middot; {lobby.ruleset.name}</span>
        {readyRow ?? (notReady.length > 0 && <p className="small tone-warn">Not ready: {notReady.map((s) => s.name).join(', ')}</p>)}
        {noRoute && <p className="small tone-danger">Add at least one dungeon.</p>}
        {noArtifact.length > 0 && <p className="small tone-danger">Every Guardian needs an artifact. Still to choose: {noArtifact.map((s) => s.name).join(', ')}</p>}
        {notice}
      </div>
      {confirm && notReady.length > 0
        ? <div className="row-acts"><button className="btn btn-ghost" onClick={() => setConfirm(false)}>Wait</button><button className="btn btn-light" disabled={noArtifact.length > 0} onClick={onBegin}>Begin anyway</button></div>
        : <button className="btn btn-light" disabled={noRoute || noArtifact.length > 0} onClick={() => (notReady.length ? setConfirm(true) : onBegin())}>Begin run and lock route</button>}
    </div>
  )
}

/** Optional: sign in during the lobby so the Vault syncs as soon as the run starts. */
function SeatBungie() {
  const { signedIn } = useBungie()
  if (!bungieConfigured) return null
  return signedIn
    ? <p className="small seat-bungie"><span className="tag tag-bungie">Bungie</span> Signed in. Your Vault syncs when the run starts.</p>
    : <p className="small seat-bungie"><button className="link" onClick={startSignIn}>Sign in with Bungie</button> <span className="muted">to use your real Vault (optional, read-only).</span></p>
}

/** How to prepare in Destiny 2 before the first encounter. Information only; nothing to tick. */
function SetupGuide() {
  return (
    <section className="panel setup-guide" aria-labelledby="setup-guide-title">
      <div>
        <div className="eyebrow">Before the first encounter</div>
        <h2 id="setup-guide-title">Set up in Destiny 2</h2>
        <p className="section-note">Every Guardian starts the run under-geared. Do this in game before the host records anything.</p>
      </div>
      <ul className="guide-list">
        {CHECKLIST.map((c) => <li key={c.key}><strong>{c.label.replace(/ equipped$/, '')}</strong><span className="muted">{c.hint}</span></li>)}
        <li><strong>Your run&rsquo;s artifact, no perks</strong><span className="muted">Equip the artifact you chose and switch every perk off. Perks come from run rewards.</span></li>
      </ul>
    </section>
  )
}

/** Starting-gear rarity per slot: grey or green weapons in every slot, grey armor. */
const WEAPON_OK: Rarity[] = ['Common', 'Uncommon']
const ARMOR_OK: Rarity[] = ['Common']
const EXPECTED: Record<Slot, Rarity[]> = {
  Kinetic: WEAPON_OK, Energy: WEAPON_OK, Power: WEAPON_OK,
  Helmet: ARMOR_OK, Gauntlets: ARMOR_OK, Chest: ARMOR_OK, Legs: ARMOR_OK, 'Class Item': ARMOR_OK,
}
const COLOR_WORD: Partial<Record<Rarity, string>> = { Common: 'grey', Uncommon: 'green', Rare: 'blue', Legendary: 'purple', Exotic: 'Exotic' }
/** Bungie data older than this is treated as possibly behind the game. */
const STALE_MS = 3 * 60_000

function since(t: number, now: number) {
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return `${s} s ago`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

type Equipped = ReturnType<typeof useEquipped>

/** The signed-in player's live equipped gear, refreshed every minute while in the lobby. */
function useEquipped() {
  const { signedIn } = useBungie()
  const [data, setData] = useState<EquippedPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const refresh = useCallback((): Promise<EquippedPreview | null> => {
    setBusy(true)
    setError(null)
    return fetchEquipped()
      .then(
        (d) => { setData(d); reportLink({ ok: true }); return d },
        (e) => { setError((e as Error).message); reportLink({ error: (e as Error).message }); return null },
      )
      .finally(() => setBusy(false))
  }, [])
  useEffect(() => {
    if (!signedIn || !bungieConfigured) return
    refresh()
    const t = setInterval(refresh, 60_000)
    return () => clearInterval(t)
  }, [signedIn, refresh])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t) }, [])
  const off = data ? data.items.filter((i) => !EXPECTED[i.slot].includes(i.rarity)) : []
  // The run starts with no aspects, fragments or artifact perks switched on.
  const extras = [...(data?.subclass ? [...data.subclass.aspects, ...data.subclass.fragments] : []), ...(data?.artifact?.activePerks ?? [])]
  const stale = !data?.mintedAt || now - data.mintedAt > STALE_MS
  // "Synced" here means Bungie's data shows starting gear and no aspects or fragments.
  const ready = !!data && off.length === 0 && extras.length === 0
  return { active: bungieConfigured && signedIn, data, busy, error, now, refresh, off, extras, stale, ready }
}

/** Seat settings matching the character: class, subclass, and its slotted Super, melee and grenade. */
function seatFromCharacter(d: EquippedPreview): Patch {
  const cls = d.cls as ClassType
  const artifact = d.artifact?.matched ? { artifact: d.artifact.matched } : {}
  if (!d.subclass) return { cls, ...artifact }
  const { element, abilityIds } = d.subclass
  const base = defaultStarter(cls, element)
  const always = baseKit(cls, element)
  const pick = (kind: 'super' | 'melee' | 'grenade') => abilityIds.find((id) => id.split('|')[1] === kind && !always.includes(id)) ?? base[kind]
  return { cls, element, starter: { super: pick('super'), melee: pick('melee'), grenade: pick('grenade') }, ...artifact }
}

/**
 * Fills the player's seat from their character once, unless they've already set it up themselves
 * (the seat remembers that, across reloads and the sign-in redirect). Later changes are theirs.
 */
function useAutofill(eq: Equipped, seat: Seat | undefined, apply: (p: Patch) => void, toast: (m: string) => void) {
  useEffect(() => {
    if (!eq.data || !seat || seat.custom) return
    const key = `ghost-directive:autofill:${seat.id}`
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1') } catch { /* fill anyway */ }
    apply({ ...seatFromCharacter(eq.data), auto: true })
    toast(`Seat set from your ${eq.data.cls}${eq.data.subclass ? ` (${eq.data.subclass.element})` : ''}. Change anything you like.`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eq.data, seat?.id])
}

/** Live preview of the signed-in player's equipped gear, checked against the starting rules. */
function EquippedNow({ eq, seat, onApply }: { eq: Equipped; seat?: Seat; onApply: (p: Patch) => void }) {
  if (!bungieConfigured) return null
  if (!eq.active) {
    return (
      <section className="panel equipped-now">
        <div className="equipped-head">
          <div><div className="eyebrow">Equipped now</div><h2>Check your starting gear</h2></div>
        </div>
        <p className="section-note"><button className="link" onClick={startSignIn}>Sign in with Bungie</button> to see what your character has equipped right now, fill your seat from it, and track drops.</p>
      </section>
    )
  }
  const { data, now } = eq
  const minted = data?.mintedAt ?? null
  const tip = data
    ? `${minted ? `Bungie generated this data at ${new Date(minted).toLocaleTimeString()} (${since(minted, now)}).` : 'Bungie did not say when this data was generated.'} Fetched at ${new Date(data.fetchedAt).toLocaleTimeString()}. Bungie\u2019s data can lag the game by a minute or more.`
    : ''
  return (
    <section className={`panel equipped-now ${data ? (eq.ready ? 'is-ready' : 'is-waiting') : ''}`} aria-labelledby="equipped-now-title">
      <div className="equipped-head">
        <div>
          <div className="eyebrow">Equipped now</div>
          <h2 id="equipped-now-title">{data ? `${data.cls}${data.subclass ? ` \u00b7 ${data.subclass.name}` : ''} \u00b7 ${data.light} Power` : 'Your character'}</h2>
          {data && <p className="small muted">{data.online ? <><span className="online-dot" aria-hidden="true" /> In game now</> : 'Not in game: showing your most recently played character'}</p>}
          {data && seat && data.cls !== seat.cls && <p className="small tone-warn">Your seat is set to {seat.cls}. Use my character&rsquo;s setup to match, or switch characters in game.</p>}
        </div>
        <div className="equipped-acts">
          {data && (
            <span className="freshness" tabIndex={0} title={tip} aria-label={tip}>
              <span className={`dot ${eq.stale ? 'is-stale' : ''}`} aria-hidden="true" />
              Updated {since(minted ?? data.fetchedAt, now)}
            </span>
          )}
          {data && seat && <button className="btn btn-ghost btn-sm" onClick={() => onApply(seatFromCharacter(data))}>Use my character&rsquo;s setup</button>}
          <button className="btn btn-ghost btn-sm" disabled={eq.busy} onClick={() => eq.refresh()}>{eq.busy ? 'Refreshing\u2026' : 'Refresh'}</button>
        </div>
      </div>
      {eq.error && <p className="small tone-danger">{eq.error}</p>}
      {!data && !eq.error && <p className="muted small">Reading your character from Bungie\u2026</p>}
      {data && <SyncNotice eq={eq} />}
      {data && (
        <>
          <ul className="equipped-grid">
            {data.items.map((i) => {
              const ok = EXPECTED[i.slot].includes(i.rarity)
              return (
                <li key={i.slot} className={`item ${rarityClass(i.rarity)} ${ok ? '' : 'is-off'}`}>
                  <div className="item-main">
                    <span className="item-meta">{i.slot}</span>
                    <span className="item-name">{i.name}</span>
                    <span className={`item-meta ${ok ? 'tone-ok' : 'tone-warn'}`}>{ok ? `${i.rarity}, fits setup` : `${i.rarity}; setup calls for ${EXPECTED[i.slot].map((r) => COLOR_WORD[r]).join(' or ')}`}</span>
                  </div>
                </li>
              )
            })}
          </ul>
          {data.subclass ? (
            <dl className="equipped-subclass">
              <div><dt>Super</dt><dd>{data.subclass.super ?? '\u2014'}</dd></div>
              <div><dt>Melee</dt><dd>{data.subclass.melee ?? '\u2014'}</dd></div>
              <div><dt>Grenade</dt><dd>{data.subclass.grenade ?? '\u2014'}</dd></div>
              <div className={data.subclass.aspects.length ? 'is-off' : ''}><dt>Aspects</dt><dd>{data.subclass.aspects.length ? <span className="tone-warn">{data.subclass.aspects.join(', ')}; setup calls for none</span> : <span className="tone-ok">None, fits setup</span>}</dd></div>
              <div className={data.subclass.fragments.length ? 'is-off' : ''}><dt>Fragments</dt><dd>{data.subclass.fragments.length ? <span className="tone-warn">{data.subclass.fragments.join(', ')}; setup calls for none</span> : <span className="tone-ok">None, fits setup</span>}</dd></div>
            </dl>
          ) : <p className="small muted">Couldn&rsquo;t read your subclass, so aspects and fragments aren&rsquo;t checked.</p>}
          {data.artifact ? (
            <dl className="equipped-subclass equipped-artifact">
              <div><dt>Artifact</dt><dd>{data.artifact.name}{seat?.artifact && data.artifact.matched && data.artifact.matched !== seat.artifact && <span className="tone-warn"> (your seat has {seat.artifact})</span>}</dd></div>
              <div className={data.artifact.activePerks.length ? 'is-off' : ''}><dt>Active perks</dt><dd>{data.artifact.activePerks.length ? <span className="tone-warn">{data.artifact.activePerks.join(', ')}; setup calls for none</span> : <span className="tone-ok">None, fits setup</span>}</dd></div>
            </dl>
          ) : <p className="small muted">Couldn&rsquo;t read your artifact.</p>}
          <p className="small muted">Refreshes every minute.</p>
        </>
      )}
    </section>
  )
}

/** Why to wait: the run records equipped gear at the start, and anything new after that counts as a drop. */
function SyncNotice({ eq, compact }: { eq: Equipped; compact?: boolean }) {
  if (!eq.data) return null
  if (eq.ready) {
    return <p className={`sync-notice is-ok ${compact ? 'small' : ''}`}><span aria-hidden="true">&#10003;</span> Bungie shows your starting gear. Safe to ready up or start.</p>
  }
  return (
    <p className={`sync-notice is-wait ${compact ? 'small' : ''}`}>
      <strong>Wait before readying up.</strong>{' '}
      {[eq.off.length && `${eq.off.length} gear slot${eq.off.length > 1 ? 's' : ''} not at starting rarity`, eq.extras.length && `${eq.extras.length} aspect, fragment or artifact perk${eq.extras.length > 1 ? 's' : ''} still on`].filter(Boolean).join(' and ')}. When the run starts, your equipped gear is recorded as starting gear and anything new after that counts as a drop. If you&rsquo;ve just changed gear, Bungie can take a minute or two to catch up: wait, then Refresh.
    </p>
  )
}

/** Everyone's ready state at a glance, for the bottom bar. */
function ReadyRow({ lobby, isOnline, me }: { lobby: Lobby; isOnline: (cid: string | null) => boolean; me: string }) {
  return (
    <ul className="ready-row" aria-label="Who is ready">
      {lobby.seats.map((s) => {
        const state = s.isHost ? 'host' : s.clientId === null ? 'nodevice' : !isOnline(s.clientId) ? 'offline' : s.ready && artifactByName(s.artifact) ? 'ready' : 'waiting'
        const label = { host: 'Host', nodevice: 'No device', offline: 'Offline', ready: 'Ready', waiting: 'Not ready' }[state]
        return (
          <li key={s.id} className={`ready-chip is-${state}`}>
            <span className="ready-dot" aria-hidden="true" />{s.name}{s.clientId === me ? ' (you)' : ''}<span className="ready-state">{label}</span>
          </li>
        )
      })}
    </ul>
  )
}
