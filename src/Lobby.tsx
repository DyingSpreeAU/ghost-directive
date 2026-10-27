import { useEffect, useState } from 'react'
import { CLASSES, DUNGEONS, chestCount, ELEMENT_COLOR, ELEMENTS, KIND_LABEL, dungeonById, subclassAbilities } from './data'
import { CHECKLIST, CHRONOLOGICAL_ROUTE, MAX_SEATS, defaultStarter, newSeat, runFromLobby, type Lobby, type Seat } from './model'
import { allProtocols, useGD } from './store'
import { ElementMark, EncounterArt, SortableList } from './ui'
import { bungieConfigured, startSignIn } from './bungie'
import { useBungie } from './BungiePanel'

type Patch = Partial<Pick<Seat, 'name' | 'cls' | 'element' | 'starter' | 'checklist' | 'ready'>>

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
        Object.assign(s, patch)
        if (patch.cls || patch.element) s.starter = defaultStarter(s.cls, s.element)
      })
    }
  }

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

      <RouteAndProtocol lobby={lobby} />

      {role === 'host' ? <BeginBar lobby={lobby} isOnline={isOnline} onBegin={() => {
        host!.mutate((s) => { s.active = runFromLobby(s.lobby!); s.lobby = null })
        toast('Run started. Route locked.')
      }} /> : (
        <div className="panel waiting-bar">
          <span className="scanner small" aria-hidden="true" />
          {mine?.ready ? 'You’re ready. Waiting for the host to begin.' : 'Mark yourself ready when your gear matches the checklist.'}
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

function SeatCard({ seat, you, connected, editable, onPatch, hostTools }: {
  seat: Seat; you: boolean; connected: boolean | null; editable: boolean
  onPatch: (p: Patch) => void
  hostTools?: { remove: () => void; unlink?: () => void }
}) {
  const [name, setName] = useState(seat.name)
  useEffect(() => setName(seat.name), [seat.name])
  const abil = subclassAbilities(seat.cls, seat.element)
  const checked = Object.values(seat.checklist).filter(Boolean).length
  const status = seat.clientId === null ? 'No device' : connected ? (seat.ready || seat.isHost ? 'Ready' : 'Setting up') : 'Disconnected'
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
                {abil.filter((a) => a.kind === k).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          ))}
          <details className="gear-details" open={you && checked < 6}>
            <summary>Starting gear checklist <span className="mono muted">{checked}/6</span></summary>
            <ul className="checklist">
              {CHECKLIST.map((c) => (
                <li key={c.key}>
                  <label>
                    <input type="checkbox" checked={seat.checklist[c.key]} onChange={(e) => onPatch({ checklist: { ...seat.checklist, [c.key]: e.target.checked } })} />
                    <span>{c.label}<small>{c.hint}</small></span>
                  </label>
                </li>
              ))}
            </ul>
          </details>
          {!seat.isHost && seat.clientId !== null && (
            <button className={`btn ${seat.ready ? 'btn-ghost' : 'btn-light'}`} onClick={() => onPatch({ ready: !seat.ready })}>
              {seat.ready ? 'Not ready yet' : 'I’m ready'}
            </button>
          )}
        </>
      ) : (
        <dl className="seat-summary">
          {(['super', 'melee', 'grenade'] as const).map((k) => <div key={k}><dt>{KIND_LABEL[k]}</dt><dd>{abil.find((a) => a.id === seat.starter[k])?.name}</dd></div>)}
          <div><dt>Gear</dt><dd>{checked}/6 confirmed</dd></div>
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
  const [chronoCount, setChronoCount] = useState(lobby.expedition === 'chronological' ? lobby.route.length : 3)
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

function BeginBar({ lobby, isOnline, onBegin }: { lobby: Lobby; isOnline: (cid: string | null) => boolean; onBegin: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const notReady = lobby.seats.filter((s) => !s.isHost && s.clientId !== null && (!s.ready || !isOnline(s.clientId)))
  const noRoute = lobby.route.length === 0
  return (
    <div className="panel begin-bar">
      <div>
        <strong>{lobby.seats.length} Guardian{lobby.seats.length === 1 ? '' : 's'}</strong>
        <span className="muted"> &middot; {lobby.route.length} dungeon{lobby.route.length === 1 ? '' : 's'} &middot; {lobby.ruleset.name}</span>
        {notReady.length > 0 && <p className="small tone-warn">Not ready: {notReady.map((s) => s.name).join(', ')}</p>}
        {noRoute && <p className="small tone-danger">Add at least one dungeon.</p>}
      </div>
      {confirm && notReady.length > 0
        ? <div className="row-acts"><button className="btn btn-ghost" onClick={() => setConfirm(false)}>Wait</button><button className="btn btn-light" onClick={onBegin}>Begin anyway</button></div>
        : <button className="btn btn-light" disabled={noRoute} onClick={() => (notReady.length ? setConfirm(true) : onBegin())}>Begin run and lock route</button>}
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
