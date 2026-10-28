import { useCallback, useEffect, useRef, useState } from 'react'
import { ARTIFACTS, CLASSES, DUNGEONS, baseKit, artifactByName, chestCount, type ClassType, ELEMENT_COLOR, ELEMENTS, KIND_LABEL, STARTER_KINDS, dungeonById, subclassAbilities, type StarterKind } from './data'
import { CHECKLIST, CHRONOLOGICAL_ROUTE, MAX_SEATS, bungieDisplayName, defaultStarter, starterOf, isDefaultName, newSeat, runFromLobby, type Lobby, type Seat } from './model'
import { allProtocols, useGD } from './store'
import { ElementMark, EncounterArt, Modal, rarityClass } from './ui'
import { bungieConfigured, fetchEquipped, sendSetup, startSignIn, type EquippedPreview, type SendReport } from './bungie'
import type { Rarity, Slot } from './data'
import { reportLink, useBungie } from './BungiePanel'
import { useIcons } from './icons'

type Patch = Partial<Pick<Seat, 'name' | 'cls' | 'element' | 'starter' | 'ready' | 'artifact' | 'emblem'>> & { auto?: boolean }

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
  // A seat still called "Guardian N" takes the player's Bungie name; a name they typed stays.
  const bungieName = eq.data ? bungieDisplayName(eq.data.name) : ''
  useEffect(() => {
    if (mine && bungieName && isDefaultName(mine.name)) patchSeat(mine, { name: bungieName })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bungieName, mine?.id, mine?.name])
  // The full explanation sits in the player's seat; the bars get a one-line version.
  const notice = mine && eq.active && eq.data ? <SyncNotice eq={eq} compact short /> : undefined
  // Fetch the active character fresh and fill the player's seat from it.
  const syncSeat = () => eq.refresh().then((d) => {
    if (!d || !mine) return
    patchSeat(mine, { ...seatFromCharacter(d), auto: true })
    toast(`Synced from your ${d.cls}${d.subclass ? ` (${d.subclass.name})` : ''}.`)
  })
  // Apply the seat's setup to the character in game, then re-read it.
  const [send, setSend] = useState<{ busy: boolean; step?: string; report?: SendReport & { readied?: boolean; gearOk?: boolean }; error?: string } | null>(null)
  const sendSeat = async () => {
    if (!mine) return
    setSend({ busy: true })
    try {
      const abilities = STARTER_KINDS.map((k) => starterOf(mine)[k].split('|')[2])
      const report = await sendSetup({ cls: mine.cls, element: mine.element, abilities, artifact: mine.artifact || undefined }, (step) => setSend({ busy: true, step }))
      // Everything applied and the gear is starting gear in every slot: ready up now, no need to wait for Bungie.
      const gearOk = GEAR_SLOTS.every((slot) => report.gear.some((g) => g.slot === slot && g.instanceId && EXPECTED[slot].includes(g.rarity)))
      const readied = report.problems.length === 0 && gearOk && !!artifactByName(mine.artifact)
      if (report.problems.length === 0) eq.setSent({ at: Date.now(), gear: report.gear })
      if (readied && !mine.ready) patchSeat(mine, { ready: true })
      setSend({ busy: false, report: { ...report, readied, gearOk } })
    } catch (e) { setSend({ busy: false, error: (e as Error).message }) }
    eq.refresh()
  }
  const others = lobby.seats.filter((s) => s.clientId && s.clientId !== me && isOnline(s.clientId))
  // Share the player's in-game emblem with the lobby, for their seat's nameplate.
  const emblem = eq.data?.emblem
  useEffect(() => {
    if (mine && emblem && mine.emblem?.background !== emblem.background) patchSeat(mine, { emblem, auto: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emblem?.background, mine?.id, mine?.emblem?.background])

  return (
    <div className="lobby">
      {send && !send.busy && (
        <Modal title={send.error ? 'Couldn’t apply your setup' : 'Setup sent to your character'} kicker="Send to" onClose={() => setSend(null)} footer={<button className="btn btn-light" onClick={() => setSend(null)}>Done</button>}>
          {send.error ? <p className="tone-danger">{send.error}</p> : send.report && (
            <div className="stack restore-info">
              <p>Your {send.report.character}:</p>
              <ul>{send.report.applied.length ? send.report.applied.map((a) => <li key={a}>{a}</li>) : <li>Already matched this seat. Nothing to change.</li>}</ul>
              {send.report.readied
                ? <p className="tone-ok">&#10003; Everything checks out and your gear is starting gear in every slot. You&rsquo;re marked ready.</p>
                : send.report.problems.length === 0 && !send.report.gearOk
                  ? <p className="tone-warn">Your subclass and artifact are set, but your gear isn&rsquo;t starting gear in every slot yet, so you&rsquo;re not marked ready.</p>
                  : null}
              {send.report.already.length > 0 && <><p className="small muted">Already set:</p><ul className="small muted">{send.report.already.map((x) => <li key={x}>{x}</li>)}</ul></>}
              {send.report.problems.length > 0 && <><p className="small tone-warn">Couldn&rsquo;t apply:</p><ul className="small">{send.report.problems.map((x) => <li key={x}>{x}</li>)}</ul></>}
            </div>
          )}
        </Modal>
      )}
      {send?.busy && <div className="toast" role="status">{send.step ?? 'Reading your character…'}</div>}
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

      <SetupGuide lobby={lobby} />

      {role === 'guest' && !mine && <SeatPicker lobby={lobby} />}

      <section id="seats" className={`section-anchor seats guardian-cols players-${Math.min(3, lobby.seats.length + (role === 'host' && lobby.seats.length < MAX_SEATS ? 1 : 0))}`}>
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
              notice={undefined}
              sync={s.clientId === me && eq.active ? { busy: eq.busy, run: syncSeat, sending: !!send?.busy, send: sendSeat } : undefined}
              equipped={s.clientId === me ? <EquippedNow eq={eq} seat={s} onApply={(patch) => patchSeat(s, patch)} /> : undefined}
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

function SeatCard({ seat, you, connected, editable, onPatch, hostTools, notice, sync, equipped }: {
  seat: Seat; you: boolean; connected: boolean | null; editable: boolean
  /** Re-reads the active character from Bungie and fills this seat (signed-in player's own seat). */
  sync?: { busy: boolean; run: () => void; sending: boolean; send: () => void }
  /** Bungie sync status for the player's own seat, shown by the Ready button. */
  notice?: React.ReactNode
  /** The player's own seat: what their character has equipped right now. */
  equipped?: React.ReactNode
  onPatch: (p: Patch) => void
  hostTools?: { remove: () => void; unlink?: () => void }
}) {
  const [name, setName] = useState(seat.name)
  useEffect(() => setName(seat.name), [seat.name])
  const abil = subclassAbilities(seat.cls, seat.element)
  const art = artifactByName(seat.artifact)
  const icons = useIcons()
  const always = baseKit(seat.cls, seat.element)
  const status = seat.clientId === null ? (art ? 'No device' : 'Needs artifact') : connected ? ((seat.ready || seat.isHost) && art ? 'Ready' : 'Setting up') : 'Disconnected'
  const chip = (id: string, on: boolean, onClick?: () => void) => {
    const a = abil.find((x) => x.id === id)
    if (!a) return null
    const body = <>{icons.plug(a.name) && <img src={icons.plug(a.name)} alt="" loading="lazy" />}<span>{a.name}</span></>
    return onClick
      ? <button key={id} role="radio" aria-checked={on} className={`ab-chip is-unlocked ${on ? 'is-conf' : ''}`} onClick={onClick}>{body}</button>
      : <span key={id} className="ab-chip is-unlocked is-conf">{body}</span>
  }
  return (
    <article className={`panel guardian seat ${you ? 'is-you' : ''}`} style={{ ['--el' as string]: ELEMENT_COLOR[seat.element] }} aria-label={seat.name}>
      <header className={`player-head seat-head ${seat.emblem ? 'has-emblem' : ''}`} style={seat.emblem ? { ['--emblem' as string]: `url("https://www.bungie.net${seat.emblem.background}")` } : undefined}>
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
          <section className="g-sec" aria-label="Class and subclass">
            <header className="g-sec-head">
              <span className="eyebrow">Class and subclass</span>
              {sync && (
                <span className="row-acts seat-sync">
                  <button className="btn btn-ghost btn-sm" disabled={sync.busy || sync.sending} onClick={sync.run} title="Read your in-game character from Bungie and set this seat's class, subclass, Super, melee and grenade to match.">
                    {sync.busy ? 'Syncing\u2026' : 'Sync from'}
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={sync.busy || sync.sending} onClick={sync.send} title="Apply this seat to your character in game: its subclass, Super, melee and grenade, with aspects, fragments and artifact perks cleared. Works in orbit, a social space, or offline.">
                    {sync.sending ? 'Sending\u2026' : 'Send to'}
                  </button>
                </span>
              )}
            </header>
            <div className="seg" role="radiogroup" aria-label="Class">
              {CLASSES.map((c) => <button key={c} role="radio" aria-checked={seat.cls === c} className={seat.cls === c ? 'is-on' : ''} onClick={() => onPatch({ cls: c })}>{c}</button>)}
            </div>
            <div className="el-pick" role="radiogroup" aria-label="Committed subclass">
              {ELEMENTS.map((el) => (
                <button key={el} role="radio" aria-checked={seat.element === el} className={seat.element === el ? 'is-on' : ''} style={{ ['--el' as string]: ELEMENT_COLOR[el] }} onClick={() => onPatch({ element: el })}>
                  <ElementMark element={el} size={24} /><span>{el}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="g-sec" aria-label="Starting abilities">
            <header className="g-sec-head"><span className="eyebrow">Starting abilities</span><span className="muted small">pick one of each</span></header>
            <div className="ab-kinds">
              {STARTER_KINDS.map((k) => (
                <div key={k} className="ab-kind" data-kind={k} role="radiogroup" aria-label={`Starting ${KIND_LABEL[k].toLowerCase()}`}>
                  <span className="ab-kind-name">{KIND_LABEL[k]}</span>
                  <div className="ab-chips">
                    {abil.filter((a) => a.kind === k && !always.includes(a.id)).map((a) => chip(a.id, starterOf(seat)[k] === a.id, () => onPatch({ starter: { ...starterOf(seat), [k]: a.id } })))}
                  </div>
                  {k === 'grenade' && always.length > 0 && (
                    <small className="muted">{always.map((id) => id.split('|')[2]).join(', ')} is always available on Prismatic, on top of this.</small>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="g-sec" aria-label="Artifact">
            <header className="g-sec-head"><span className="eyebrow">Artifact</span><span className="muted small">locked for the run</span></header>
            <div className="art-pick" role="radiogroup" aria-label="Artifact" id={`art-${seat.id}`}>
              {ARTIFACTS.map((a) => (
                <button key={a.name} role="radio" aria-checked={seat.artifact === a.name} className={`art-opt ${seat.artifact === a.name ? 'is-on' : ''}`} title={`${a.name} (${a.season})${a.focus ? `: ${a.focus}` : ''}`} onClick={() => onPatch({ artifact: a.name })}>
                  {icons.artifact(a.name) ? <img src={icons.artifact(a.name)} alt="" loading="lazy" /> : <span className="art-opt-blank" aria-hidden="true">{a.name.slice(0, 2)}</span>}
                  <span className="art-opt-name">{a.name}</span>
                </button>
              ))}
            </div>
            {art ? <small className="muted">{art.name} &middot; {art.season}. {art.focus || 'All-round perks'}. Artifact research only offers this artifact&rsquo;s perks.</small>
              : <small className="tone-warn">Pick one before the run starts. All Artifact research comes from it.</small>}
          </section>

          {equipped}
          {notice}
          {!seat.isHost && seat.clientId !== null && (
            <button className={`btn ${seat.ready ? 'btn-ghost' : 'btn-light'}`} disabled={!art && !seat.ready} onClick={() => onPatch({ ready: !seat.ready })}>
              {seat.ready ? 'Not ready yet' : art ? 'I\u2019m ready' : 'Choose an artifact first'}
            </button>
          )}
        </>
      ) : (
        <>
          <section className="g-sec" aria-label="Starting abilities">
            <header className="g-sec-head"><span className="eyebrow">Starting abilities</span></header>
            <div className="ab-chips">{STARTER_KINDS.map((k) => chip(starterOf(seat)[k], true))}</div>
          </section>
          <section className="g-sec" aria-label="Artifact">
            <header className="g-sec-head"><span className="eyebrow">Artifact</span></header>
            {art ? <p className="art-name">{icons.artifact(art.name) && <img className="art-icon" src={icons.artifact(art.name)} alt="" loading="lazy" />}<strong>{art.name}</strong><span className="muted small"> &middot; {art.season}</span></p>
              : <p className="tone-warn small">Not chosen yet</p>}
          </section>
        </>
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
      <section id="route" className="panel route-summary section-anchor">
        <div>
          <div className="eyebrow">Protocol</div>
          <strong>{r.name}</strong>
          <p className="small muted">{r.integrity.start} Integrity, +{r.integrity.clear} per clear, &minus;{r.integrity.wipe} per wipe, {r.inventory.capacity} item slots per gear slot.</p>
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
    <section id="route" className="panel host-setup section-anchor">
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
        </div>
        <dl className="proto-stats">
          <div><dt>Start</dt><dd>{r.integrity.start}</dd></div>
          <div><dt>Clear</dt><dd>+{r.integrity.clear}</dd></div>
          <div><dt>Wipe</dt><dd>&minus;{r.integrity.wipe}</dd></div>
          <div><dt>Guardian death</dt><dd>{r.integrity.death ? <>&minus;{r.integrity.death}</> : '0'}</dd></div>
          <div><dt>Starting Item Slots</dt><dd>{r.inventory.capacity}</dd></div>
        </dl>
        <div className="field">
          <label htmlFor="run-name">Run name (optional)</label>
          <input id="run-name" defaultValue={lobby.name} onBlur={(e) => set((l) => { l.name = e.target.value.slice(0, 40) })} placeholder="e.g. Tuesday night Directive" />
        </div>
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
          <RouteTiles route={lobby.route} onChange={(next) => set((l) => { l.route = next })} />
        )}
        {lobby.expedition === 'chronological' && (
        <div className="route-preview">
          {lobby.route.map((id, i) => <div key={id} className="route-card"><RouteCard id={id} n={i + 1} /></div>)}
        </div>
        )}
      </div>
    </section>
  )
}

function RouteCard({ id, n }: { id: string; n?: number }) {
  const d = dungeonById(id)
  return (
    <>
      <EncounterArt dungeon={d} encounter={d.encounters[d.encounters.length - 1]} compact />
      {n !== undefined && <span className="route-num mono">{n}</span>}
      <div className="route-info"><strong>{d.name}</strong><span className="muted small">{d.destination ? <>{d.destination} &middot; </> : null}{d.encounters.length} encounters{chestCount(d) ? ` \u00b7 ${chestCount(d)} chest${chestCount(d) > 1 ? 's' : ''}` : ''}</span></div>
    </>
  )
}

/**
 * Custom route: the dungeon tiles in run order, dragged into place. Tiles dragged into the box
 * below are left out of the run. Buttons and arrow keys do the same without a mouse.
 */
function RouteTiles({ route, onChange }: { route: string[]; onChange: (next: string[]) => void }) {
  const excludedOf = (r: string[]) => DUNGEONS.map((d) => d.id).filter((id) => !r.includes(id))
  type Drag = { id: string; route: string[]; x: number; y: number; dx: number; dy: number; w: number }
  const [drag, setDragState] = useState<Drag | null>(null)
  // The latest drag, for a pointer-up that arrives before the last move has rendered.
  const live = useRef<Drag | null>(null)
  const setDrag = (d: Drag | null) => { live.current = d; setDragState(d) }
  const routeRef = useRef<HTMLOListElement>(null)
  const outRef = useRef<HTMLUListElement>(null)
  const shown = drag ? drag.route : route
  const excluded = excludedOf(shown)

  // Where in the route a point falls, reading the tiles left to right, top to bottom.
  const slotAt = (x: number, y: number, order: string[], held: string) => {
    const tiles = [...(routeRef.current?.querySelectorAll<HTMLElement>('[data-id]') ?? [])].filter((t) => t.dataset.id !== held)
    const i = tiles.findIndex((t) => { const r = t.getBoundingClientRect(); return y < r.top || (y <= r.bottom && x < r.left + r.width / 2) })
    return i === -1 ? order.filter((id) => id !== held).length : i
  }
  const inside = (el: Element | null, x: number, y: number) => { const r = el?.getBoundingClientRect(); return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom }

  const down = (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ id, route, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width })
  }
  const move = (e: React.PointerEvent) => {
    const drag = live.current
    if (!drag) return
    const { clientX: x, clientY: y } = e
    const rest = drag.route.filter((id) => id !== drag.id)
    let next = drag.route
    if (inside(outRef.current, x, y)) next = rest
    else if (inside(routeRef.current, x, y) || drag.route.includes(drag.id)) {
      const at = slotAt(x, y, drag.route, drag.id)
      next = [...rest.slice(0, at), drag.id, ...rest.slice(at)]
    }
    setDrag({ ...drag, route: next, x, y })
  }
  const up = () => {
    const drag = live.current
    if (!drag) return
    const changed = drag.route.join('|') !== route.join('|')
    setDrag(null)
    if (changed) onChange(drag.route)
  }
  const key = (e: React.KeyboardEvent, id: string) => {
    const i = route.indexOf(id)
    const to = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : -1
    if (i < 0 || to < 0 || to >= route.length) return
    e.preventDefault()
    const next = route.filter((x) => x !== id); next.splice(to, 0, id); onChange(next)
    requestAnimationFrame(() => routeRef.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus())
  }
  const held = drag && dungeonById(drag.id)
  // Near the top or bottom of the window while dragging, the page scrolls so the box below can be reached.
  const pointerY = drag?.y
  useEffect(() => {
    if (pointerY === undefined) return
    const edge = 70
    const speed = pointerY > innerHeight - edge ? 14 : pointerY < edge ? -14 : 0
    if (!speed) return
    const t = setInterval(() => scrollBy(0, speed), 16)
    return () => clearInterval(t)
  }, [pointerY])

  return (
    <div className={`route-tiles ${drag ? 'is-dragging' : ''}`} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
      <p className="small muted">Drag the dungeons into the order you&rsquo;ll run them. Drag any you want to skip into the box below.</p>
      <ol className="route-preview route-order" ref={routeRef} aria-label="Route order">
        {shown.map((id, i) => (
          <li key={id} data-id={id} tabIndex={0} className={`route-card is-draggable ${drag?.id === id ? 'is-held' : ''}`}
            aria-label={`${i + 1}. ${dungeonById(id).name}. Arrow keys move it.`}
            onPointerDown={(e) => down(e, id)} onKeyDown={(e) => key(e, id)} onDragStart={(e) => e.preventDefault()}>
            <RouteCard id={id} n={i + 1} />
            <button className="route-x" title="Exclude from the run" aria-label={`Exclude ${dungeonById(id).name}`} onClick={() => onChange(route.filter((x) => x !== id))}>&times;</button>
          </li>
        ))}
        {shown.length === 0 && <li className="route-empty muted small">No dungeons in the route. Drag one up here.</li>}
      </ol>
      <div className="route-out">
        <div className="eyebrow">Excluded &middot; {excluded.length}</div>
        <ul className="route-preview route-excluded" ref={outRef} aria-label="Excluded dungeons">
          {excluded.map((id) => (
            <li key={id} data-id={id} className={`route-card is-draggable is-out ${drag?.id === id ? 'is-held' : ''}`} onPointerDown={(e) => down(e, id)} onDragStart={(e) => e.preventDefault()}>
              <RouteCard id={id} />
              <button className="route-x route-add" title="Add to the end of the route" aria-label={`Add ${dungeonById(id).name} to the route`} onClick={() => onChange([...route, id])}>+</button>
            </li>
          ))}
          {excluded.length === 0 && <li className="route-empty muted small">Every dungeon is in the route. Drag one here to skip it.</li>}
        </ul>
      </div>
      {drag && held && (
        <div className="route-card route-ghost" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }} aria-hidden="true">
          <RouteCard id={drag.id} />
        </div>
      )}
    </div>
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
      <div className="begin-acts">
        <button className="btn btn-light" disabled={noRoute || noArtifact.length > 0 || notReady.length > 0} onClick={onBegin}>
          {notReady.length ? `Waiting on ${notReady.length} Guardian${notReady.length === 1 ? '' : 's'}` : 'Begin run and lock route'}
        </button>
        {notReady.length > 0 && !noRoute && noArtifact.length === 0 && (confirm ? (
          <div className="override">
            <p className="small tone-warn">{notReady.map((s) => s.name).join(', ')} {notReady.length === 1 ? 'isn’t' : 'aren’t'} ready. Their setup may not match the run&rsquo;s starting rules.</p>
            <div className="row-acts"><button className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>Wait</button><button className="btn btn-danger btn-sm" onClick={onBegin}>Begin anyway</button></div>
          </div>
        ) : <button className="link small" onClick={() => setConfirm(true)}>Host override</button>)}
      </div>
    </div>
  )
}

/** Optional: sign in during the lobby so the Vault syncs as soon as the run starts. */
function SeatBungie() {
  const { signedIn } = useBungie()
  if (!bungieConfigured) return null
  return signedIn
    ? <p className="small seat-bungie"><span className="tag tag-bungie">Bungie</span> Signed in. Your Vault syncs when the run starts.</p>
    : <p className="small seat-bungie"><button className="link" onClick={startSignIn}>Sign in with Bungie</button> <span className="muted">to use your real Vault (optional).</span></p>
}

/** How to prepare in Destiny 2, and the run's rules in plain words, using the chosen protocol's numbers. */
function SetupGuide({ lobby }: { lobby: Lobby }) {
  const r = lobby.ruleset
  const i = r.integrity
  const tu = r.tradeUp
  return (
    <section id="setup" className="panel setup-guide section-anchor" aria-labelledby="setup-guide-title">
      <div className="guide-part">
        <div className="eyebrow">Before the first encounter</div>
        <h2 id="setup-guide-title">Set up in Destiny 2</h2>
        <p className="section-note">Every Guardian starts the run under-geared. Do this in game before the host records anything.</p>
        <ul className="guide-list">
          {CHECKLIST.map((c) => <li key={c.key}><strong>{c.label.replace(/ equipped$/, '')}</strong><span className="muted">{c.hint}</span></li>)}
          <li><strong>Your run&rsquo;s artifact, no perks</strong><span className="muted">Equip the artifact you chose and switch every perk off. Perks come from run rewards.</span></li>
        </ul>
      </div>
      <div className="guide-part" aria-labelledby="rules-title">
        <div className="eyebrow">{r.name}</div>
        <h2 id="rules-title">How the run works</h2>
        <ul className="rules-list">
          <li><strong>Integrity is your fireteam&rsquo;s life.</strong> You start with <b>{i.start}</b> (it can go up to {i.max}). If it reaches <b>0</b>, the run is over.</li>
          <li><strong>Clear an encounter:</strong> <span className="tone-ok">+{i.clear}</span> Integrity, and each Guardian picks a reward.</li>
          <li><strong>A Guardian dies:</strong> <span className="tone-danger">&minus;{i.death ?? 0}</span> Integrity. Record it on that Guardian&rsquo;s column.</li>
          <li><strong>The fireteam wipes:</strong> <span className="tone-danger">&minus;{i.wipe}</span> Integrity.</li>
          <li className="rules-key"><strong>What counts as a wipe:</strong> every Guardian in the fireteam dead at the same time, at any point in the run. That includes traversal sections and anywhere the game would let you revive or respawn: no wipe mechanic or Darkness zone is needed. Record it as one wipe, not as separate deaths.</li>
          <li><strong>Gear:</strong> only what drops during the run, or what rewards give you. Each slot holds <b>{r.inventory.capacity}</b> items; anything over goes to your Vault.{tu.enabled ? <> Trade <b>{tu.inputs}</b> items from one slot{tu.sameRarity ? ' (same rarity)' : ''} for a Legendary from your Vault.</> : null}</li>
          <li><strong>Abilities and artifact perks</strong> start locked and are unlocked as rewards. Only use what you&rsquo;ve unlocked.</li>
          <li><strong>Honour system:</strong> the app tracks the run; it doesn&rsquo;t police it. Play it straight.</li>
        </ul>
      </div>
    </section>
  )
}

/** Starting-gear rarity per slot: grey or green weapons in every slot, grey armor. */
const WEAPON_OK: Rarity[] = ['Common', 'Uncommon']
const ARMOR_OK: Rarity[] = ['Common']
const GEAR_SLOTS: Slot[] = ['Kinetic', 'Energy', 'Power', 'Helmet', 'Gauntlets', 'Chest', 'Legs', 'Class Item']
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
  // A Send to that passed every check vouches for the subclass and artifact until Bungie's data
  // catches up (data minted after the send), and its own read of the gear stands in for the preview's.
  const [sent, setSent] = useState<{ at: number; gear: SendReport['gear'] } | null>(null)
  const vouched = !!sent && (!data?.mintedAt || data.mintedAt < sent.at) && now - sent.at < 5 * 60_000
  const gear = vouched ? sent!.gear : data?.items
  const off = gear ? gear.filter((i) => !EXPECTED[i.slot].includes(i.rarity)) : []
  const empty = gear ? GEAR_SLOTS.filter((slot) => !gear.some((i) => i.slot === slot)) : []
  // The run starts with no aspects, fragments or artifact perks switched on.
  const extras = vouched ? [] : [...(data?.subclass ? [...data.subclass.aspects, ...data.subclass.fragments] : []), ...(data?.artifact?.activePerks ?? [])]
  const stale = !data?.mintedAt || now - data.mintedAt > STALE_MS
  // "Synced" here means starting gear in every slot and no aspects, fragments or artifact perks.
  const ready = (!!data || vouched) && off.length === 0 && empty.length === 0 && extras.length === 0
  return { active: bungieConfigured && signedIn, data, busy, error, now, refresh, off, empty, extras, stale, ready, vouched, setSent }
}

/** Seat settings matching the character: class, subclass, and its slotted Super, melee and grenade. */
function seatFromCharacter(d: EquippedPreview): Patch {
  const cls = d.cls as ClassType
  const artifact = d.artifact?.matched ? { artifact: d.artifact.matched } : {}
  if (!d.subclass) return { cls, ...artifact }
  const { element, abilityIds } = d.subclass
  const base = defaultStarter(cls, element)
  const always = baseKit(cls, element)
  const pick = (kind: StarterKind) => abilityIds.find((id) => id.split('|')[1] === kind && !always.includes(id)) ?? base[kind]!
  return { cls, element, starter: { super: pick('super'), class: pick('class'), melee: pick('melee'), grenade: pick('grenade') }, ...artifact }
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

/** Inside the player's own seat: what their character has equipped right now, checked against the starting rules. */
function EquippedNow({ eq, seat, onApply }: { eq: Equipped; seat?: Seat; onApply: (p: Patch) => void }) {
  const icons = useIcons()
  if (!bungieConfigured || !eq.active) return null
  const { data, now } = eq
  const minted = data?.mintedAt ?? null
  const tip = data
    ? `${minted ? `Bungie generated this data at ${new Date(minted).toLocaleTimeString()} (${since(minted, now)}).` : 'Bungie did not say when this data was generated.'} Fetched at ${new Date(data.fetchedAt).toLocaleTimeString()}. Bungie\u2019s data can lag the game by a minute or more.`
    : ''
  const slotOf = (slot: Slot) => data?.items.find((i) => i.slot === slot)
  const gearRow = (slots: Slot[]) => (
    <div className="tiles" style={{ ['--n' as string]: slots.length }}>
      {slots.map((slot) => {
        const i = slotOf(slot)
        if (!i) return <span key={slot} className="tile tile-empty item is-off" title={`${slot}: nothing equipped`} aria-label={`${slot}: nothing equipped`} />
        const ok = EXPECTED[slot].includes(i.rarity)
        const why = ok ? `${i.rarity}, fits setup` : `${i.rarity}; setup calls for ${EXPECTED[slot].map((r) => COLOR_WORD[r]).join(' or ')}`
        return (
          <span key={slot} className={`tile item ${rarityClass(i.rarity)} ${ok ? '' : 'is-off'}`} title={`${slot}: ${i.name} \u00b7 ${why}`} aria-label={`${slot}: ${i.name}, ${why}`}>
            {icons.gear(i.name) ? <img src={icons.gear(i.name)} alt="" loading="lazy" /> : <span className="tile-initial">{i.name.slice(0, 2)}</span>}
          </span>
        )
      })}
    </div>
  )
  const plugChip = (n: string, bad?: boolean) => <span key={n} className={`ab-chip is-unlocked ${bad ? 'is-bad' : ''}`}>{icons.plug(n) && <img src={icons.plug(n)} alt="" loading="lazy" />}<span>{n}</span></span>
  return (
    <section className={`g-sec equipped-now ${data ? (eq.ready ? 'is-ready' : 'is-waiting') : ''}`} aria-labelledby="equipped-now-title">
      <header className="g-sec-head">
        <span className="eyebrow">Equipped now</span>
        {data && (
          <span className="freshness" tabIndex={0} title={tip} aria-label={tip}>
            <span className={`dot ${eq.stale ? 'is-stale' : ''}`} aria-hidden="true" />
            Updated {since(minted ?? data.fetchedAt, now)}
          </span>
        )}
      </header>
      <h4 id="equipped-now-title" className="equipped-title">{data ? `${data.cls}${data.subclass ? ` \u00b7 ${data.subclass.name}` : ''} \u00b7 ${data.light} Power` : 'Your character'}</h4>
      {data && <p className="small muted">{data.online ? <><span className="online-dot" aria-hidden="true" /> In game now</> : 'Not in game: showing your most recently played character'}</p>}
      {data && seat && data.cls !== seat.cls && <p className="small tone-warn">Your seat is set to {seat.cls}. Use my character&rsquo;s setup to match, or switch characters in game.</p>}
      <div className="row-acts">
        {data && seat && <button className="btn btn-ghost btn-sm" onClick={() => onApply(seatFromCharacter(data))}>Use my character&rsquo;s setup</button>}
        <button className="btn btn-ghost btn-sm" disabled={eq.busy} onClick={() => eq.refresh()}>{eq.busy ? 'Refreshing\u2026' : 'Refresh'}</button>
      </div>
      {eq.error && <p className="small tone-danger">{eq.error}</p>}
      {!data && !eq.error && <p className="muted small">Reading your character from Bungie\u2026</p>}
      {data && <SyncNotice eq={eq} compact />}
      {data && (
        <>
          <div className="equipped-grid" aria-label="Equipped gear">
            <span className="ab-kind-name">Weapons <span className="muted">grey or green</span></span>
            {gearRow(['Kinetic', 'Energy', 'Power'])}
            <span className="ab-kind-name">Armor <span className="muted">grey</span></span>
            {gearRow(['Helmet', 'Gauntlets', 'Chest', 'Legs', 'Class Item'])}
          </div>
          {data.subclass ? (
            <div className="equipped-subclass ab-kinds">
              <div className="ab-kind"><span className="ab-kind-name">Abilities</span><div className="ab-chips">{[data.subclass.super, data.subclass.class, data.subclass.melee, data.subclass.grenade].filter((x): x is string => !!x).map((n) => plugChip(n))}</div></div>
              <div className="ab-kind"><span className="ab-kind-name">Aspects and fragments</span>
                {data.subclass.aspects.length + data.subclass.fragments.length
                  ? <div className="ab-chips">{[...data.subclass.aspects, ...data.subclass.fragments].map((n) => plugChip(n, true))}<span className="small tone-warn">setup calls for none</span></div>
                  : <span className="small tone-ok">None, fits setup</span>}
              </div>
            </div>
          ) : <p className="small muted">Couldn&rsquo;t read your subclass, so aspects and fragments aren&rsquo;t checked.</p>}
          {data.artifact ? (
            <div className="equipped-artifact ab-kind">
              <span className="ab-kind-name">Artifact</span>
              <p className="art-name">{icons.artifact(data.artifact.name) && <img className="art-icon sm" src={icons.artifact(data.artifact.name)} alt="" loading="lazy" />}<strong>{data.artifact.name}</strong>
                {seat?.artifact && data.artifact.matched && data.artifact.matched !== seat.artifact && <span className="tone-warn small"> (your seat has {seat.artifact})</span>}</p>
              {data.artifact.activePerks.length
                ? <div className="ab-chips">{data.artifact.activePerks.map((n) => plugChip(n, true))}<span className="small tone-warn">setup calls for none</span></div>
                : <span className="small tone-ok">No perks on, fits setup</span>}
            </div>
          ) : <p className="small muted">Couldn&rsquo;t read your artifact.</p>}
          <p className="small muted">Refreshes every minute.</p>
        </>
      )}
    </section>
  )
}

/** Why to wait: the run records equipped gear at the start, and anything new after that counts as a drop. */
function SyncNotice({ eq, compact, short }: { eq: Equipped; compact?: boolean; short?: boolean }) {
  if (!eq.data) return null
  const issues = [eq.off.length && `${eq.off.length} gear slot${eq.off.length > 1 ? 's' : ''} not at starting rarity`, eq.empty.length && `${eq.empty.length} gear slot${eq.empty.length > 1 ? 's' : ''} empty`, eq.extras.length && `${eq.extras.length} aspect, fragment or artifact perk${eq.extras.length > 1 ? 's' : ''} still on`].filter(Boolean).join(' and ')
  if (short) {
    return eq.ready
      ? <p className="sync-notice is-ok small"><span aria-hidden="true">&#10003;</span> Your starting gear checks out.</p>
      : <p className="sync-notice is-wait small"><strong>Wait before readying up:</strong> {issues}. Details in your seat.</p>
  }
  if (eq.ready) {
    return <p className={`sync-notice is-ok ${compact ? 'small' : ''}`}><span aria-hidden="true">&#10003;</span> {eq.vouched ? 'Send to set your subclass and artifact, and your gear is starting gear. Safe to ready up or start. Bungie’s data here can show your old setup for a minute or two.' : 'Bungie shows your starting gear. Safe to ready up or start.'}</p>
  }
  return (
    <p className={`sync-notice is-wait ${compact ? 'small' : ''}`}>
      <strong>Wait before readying up.</strong>{' '}
      {[eq.off.length && `${eq.off.length} gear slot${eq.off.length > 1 ? 's' : ''} not at starting rarity`, eq.empty.length && `${eq.empty.length} gear slot${eq.empty.length > 1 ? 's' : ''} empty`, eq.extras.length && `${eq.extras.length} aspect, fragment or artifact perk${eq.extras.length > 1 ? 's' : ''} still on`].filter(Boolean).join(' and ')}. When the run starts, your equipped gear is recorded as starting gear and anything new after that counts as a drop. If you&rsquo;ve just changed gear, Bungie can take a minute or two to catch up: wait, then Refresh.
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
