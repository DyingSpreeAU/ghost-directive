import { useState } from 'react'
import {
  ALL_SLOTS, DAMAGE_ELEMENTS, WEAPON_SLOTS, dungeonById, type Element, type Rarity, type Slot,
} from './data'
import {
  createLobby, current, pendingChest, recordChest, loadoutSlotsOf, loadoutValid, nextEncounter, vaultPool,
  type LogKind, type Player, type Run, type Warning,
} from './model'
import { makeLobbyCode } from './net'
import { bungieConfigured } from './bungie'
import { Fireteam } from './Fireteam'
import { BungiePanel } from './BungiePanel'
import { useGD } from './store'
import { ElementMark, Empty, EncounterArt, Meter } from './ui'

export function Briefing({ run, warnings, pendingDeferred, onOpenRewards }: { run: Run; warnings: Warning[]; pendingDeferred: number; onOpenRewards: () => void }) {
  const { openFlow, host, go, toast, role, myPlayerId, dispatch } = useGD()
  const isHost = role === 'host'
  const { dungeon, encounter, done, total } = current(run)
  const next = nextEncounter(run)
  const r = run.ruleset.integrity
  const active = run.status === 'active'
  const claimed = run.claimed.includes(encounter.id)
  const wipes = run.log.filter((l) => l.kind === 'wipe').length
  const tone = run.integrity <= r.wipe ? 'danger' : run.integrity <= r.wipe * 2 ? 'warn' : 'light'

  // Archive the run and reopen the lobby on the same code so the fireteam stays connected.
  const nextLobby = (keepCode: boolean) => {
    host!.mutate((s) => {
      const r = s.active!
      if (!r.example) s.history.unshift({ ...r, status: r.status === 'active' ? 'abandoned' : r.status, endedAt: r.endedAt ?? Date.now() })
      const l = createLobby(keepCode ? r.code : makeLobbyCode(), s.hostCid, r.ruleset)
      l.protocolId = r.ruleset.id
      s.active = null
      s.lobby = l
    })
    toast(run.example ? 'Example closed. New lobby open.' : 'Run archived. Lobby reopened.')
    go('briefing')
  }
  const hostName = run.players.find((p) => p.isHost)?.name ?? 'The host'
  const waitingOn = run.players.filter((p) => run.pending.some((x) => x.playerId === p.id))

  return (
    <div className="briefing">
      {run.example && isHost && (
        <div className="example-banner">
          <strong>Example run.</strong> Sample data so you can try every flow. The other two Guardians have no device linked, so their pending rewards wait for a player, or you can resolve them.
          <button className="btn btn-ghost btn-sm" onClick={() => nextLobby(false)}>Open a real lobby</button>
        </div>
      )}

      {!myPlayerId && role === 'guest' && <ClaimBanner run={run} />}

      {pendingDeferred > 0 && (
        <button className="reward-banner" onClick={onOpenRewards}>
          <span className="mod-hex" aria-hidden="true" />
          <span><strong>{pendingDeferred} reward{pendingDeferred > 1 ? 's' : ''} waiting for you.</strong> Choose your unlock{pendingDeferred > 1 ? 's' : ''} and register your drops.</span>
          <span className="btn btn-light btn-sm">Choose now</span>
        </button>
      )}

      <header className="page-head">
        <div>
          <div className="eyebrow">Mission Briefing</div>
          <h1>{run.name}</h1>
          <div className="meta-row">
            <span>{run.ruleset.name}</span>
            <span>{run.expedition === 'chronological' ? 'Chronological Expedition' : 'Custom Expedition'}</span>
            <span>{run.route.length} dungeon{run.route.length > 1 ? 's' : ''}, route locked</span>
          </div>
        </div>
        <div className="row-acts">
          {active && myPlayerId && bungieConfigured && (
            <button className="btn btn-ghost btn-sm" title="Ask every signed-in Guardian's device to read Bungie now: drops, equipped gear, subclass and artifact." onClick={() => { dispatch({ type: 'sync-request' }); toast('Sync requested for every signed-in Guardian.') }}>Sync all</button>
          )}
          {active && isHost && <button className="btn btn-ghost btn-sm" onClick={() => openFlow({ type: 'abandon' })}>End run</button>}
        </div>
      </header>

      {!active && (
        <section className={`end-banner end-${run.status}`}>
          <div>
            <div className="eyebrow">{run.status === 'victory' ? 'Route complete' : run.status === 'defeat' ? 'Integrity depleted' : 'Run ended'}</div>
            <h2>{run.status === 'victory' ? 'The Directive is fulfilled' : run.status === 'defeat' ? 'Fireteam lost' : 'Run abandoned'}</h2>
            <p>{run.claimed.length} encounters cleared, {wipes} wipes, {run.players.reduce((n, p) => n + p.unlocked.length, 0)} abilities unlocked across the fireteam.</p>
          </div>
          {isHost
            ? <button className="btn btn-light" onClick={() => nextLobby(true)}>{run.example ? 'Open a real lobby' : 'Archive and reopen lobby'}</button>
            : <span className="muted">Waiting for {hostName} to reopen the lobby.</span>}
        </section>
      )}

      <section className="command">
        <div className="panel integrity" data-flash="integrity">
          <div className="eyebrow">Fireteam Integrity</div>
          <div className="int-value">
            <span className={`num tone-${tone}`}>{run.integrity}</span>
            <span className="of">/ {r.max}</span>
          </div>
          <Meter value={run.integrity} max={r.max} tone={tone} />
          <dl className="int-rules">
            <div><dt>Clear</dt><dd>+{r.clear}</dd></div>
            <div><dt>Wipe</dt><dd>&minus;{r.wipe}</dd></div>
            {!!r.death && <div><dt>Death</dt><dd>&minus;{r.death}</dd></div>}
            <div><dt>Wipes left</dt><dd>{Math.max(0, Math.ceil(run.integrity / r.wipe) - 1)}</dd></div>
          </dl>
        </div>

        <div className="panel encounter">
          <EncounterArt dungeon={dungeon} encounter={encounter} />
          <div className="enc-body">
            <div className="eyebrow">{dungeon.destination ? <>{dungeon.destination} &middot; </> : null}{dungeon.name}</div>
            <h2 className="enc-name">
              {encounter.name}
              {encounter.type === 'final' && <span className="tag tag-final">Final boss</span>}
            </h2>
            {(!active || encounter.brief) && <p className="enc-brief">{active ? encounter.brief : 'No further encounters.'}</p>}
            <div className="route-pips" aria-label={`${done} of ${total} encounters complete`}>
              {run.route.map((id, di) => (
                <div key={id} className="pip-group" title={dungeonById(id).name}>
                  {dungeonById(id).encounters.map((e, ei) => {
                    const state = run.claimed.includes(e.id) ? 'done' : di === run.dIdx && ei === run.eIdx && active ? 'now' : 'todo'
                    return <span key={e.id} className={`pip pip-${state} ${e.type === 'final' ? 'pip-final' : ''}`} />
                  })}
                </div>
              ))}
              <span className="pip-count">{done}/{total}</span>
            </div>
            {active && next && <p className="next">Next: {next.encounter.name}{next.dungeon.id !== dungeon.id ? ` (${next.dungeon.name})` : ''}</p>}
          </div>
        </div>

        <div className="panel actions">
          <div className="eyebrow">{isHost ? 'Host actions' : `${hostName} records encounters`}</div>
          {!isHost ? (
            <div className="guest-actions">
              <p className="muted small">When the host records a clear, your reward screen opens here.</p>
              {waitingOn.length > 0 && <p className="small">Still choosing: {waitingOn.map((p) => p.name).join(', ')}</p>}
              {myPlayerId && active && (run.players.find((x) => x.id === myPlayerId)?.bungie
                ? <p className="small"><span className="tag tag-bungie">Bungie</span> Your drops are detected automatically.</p>
                : <button className="btn btn-ghost btn-big" onClick={() => openFlow({ type: 'register', playerId: myPlayerId })}>Register my drop<small>Weapons and armor you earned</small></button>)}
            </div>
          ) : <>
          <ProgressControl run={run} disabled={!active || claimed} />
          <button className="btn btn-danger btn-big" disabled={!active} onClick={() => openFlow({ type: 'wipe' })}>
            Record Wipe
            <small>&minus;{r.wipe} Integrity</small>
          </button>
          {waitingOn.length > 0 && <p className="small muted">Still choosing rewards: {waitingOn.map((p) => p.name).join(', ')}</p>}
          </>}
        </div>
      </section>

      {warnings.length > 0 && (
        <section className="warnings" aria-label="Warnings">
          {warnings.map((w) => (
            <button key={w.id} className={`warn warn-${w.severity}`} onClick={() => { if (!flashTargets(w.flash ?? [])) go('briefing', w.where === 'integrity' ? undefined : w.where === 'setup' ? 'arsenal' : w.where) }}>
              <span className="warn-sev">{w.discrepancy ? 'Discrepancy' : w.severity === 'info' ? 'Note' : 'Warning'}</span>
              <span className="warn-title">
                {w.playerId && <b>{run.players.find((p) => p.id === w.playerId)?.name}: </b>}
                {w.title}
              </span>
              <span className="warn-rule">{w.rule}</span>
            </button>
          ))}
        </section>
      )}

      <Fireteam run={run} warnings={warnings} />

      <div className="fold-label"><span>Records</span></div>

      <CombatReport run={run} />
    </div>
  )
}

/** Hidden for now (not rendered); kept so it can come back. */
export function Loadouts({ run, p }: { run: Run; p: Player }) {
  const { dispatch, canControl } = useGD()
  const [name, setName] = useState('')
  const slots = loadoutSlotsOf(run, p)
  const control = canControl(p.id)
  const save = () => {
    dispatch({ type: 'loadout-save', name }, p.id)
    setName('')
  }
  return (
    <div className="panel lower-panel">
      <h3>Saved loadouts <span className="muted">{p.loadouts.length}/{slots}</span></h3>
      <p className="section-note">A loadout records equipped run items and unlocked abilities. It never equips anything in Destiny 2.</p>
      {p.loadouts.length === 0 && <Empty>No loadouts saved</Empty>}
      <ul className="loadouts">
        {p.loadouts.map((l) => {
          const ok = loadoutValid(p, l)
          return (
            <li key={l.id} className={ok ? '' : 'is-bad'}>
              <div>
                <strong>{l.name}</strong> {!ok && <span className="tag tag-bad">Invalid</span>}
                <div className="muted small">
                  {l.itemIds.map((id) => p.inventory.find((i) => i.id === id)?.name ?? 'Missing item').join(', ') || 'No items'}
                  {' · '}{l.abilityIds.length} abilities
                </div>
              </div>
              {control && <div className="row-acts">
                <button className="chip" onClick={() => dispatch({ type: 'loadout-update', id: l.id }, p.id)}>Update to current</button>
                <button className="chip" onClick={() => dispatch({ type: 'loadout-delete', id: l.id }, p.id)}>Delete</button>
              </div>}
            </li>
          )
        })}
      </ul>
      {control && <div className="inline-form">
        <input id={`lo-name-${p.id}`} placeholder="Loadout name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-ghost btn-sm" disabled={p.loadouts.length >= slots} onClick={save}>Save current</button>
      </div>}
      {control && p.loadouts.length >= slots && <p className="muted small">{slots === 0 ? 'This protocol starts with no loadout slots. Loadout Archive rewards add one.' : 'All loadout slots used. Loadout Archive rewards add one.'}</p>}
    </div>
  )
}

/** Hidden for now (not rendered); the Vault pool still feeds rewards, filled by Bungie sync or the example pool. */
export function VaultPool({ p }: { p: Player }) {
  const { dispatch, canControl, myPlayerId } = useGD()
  const [name, setName] = useState('')
  const [slot, setSlot] = useState<Slot>('Kinetic')
  const [element, setElement] = useState<Element | ''>('')
  const pool = vaultPool(p)
  const add = () => {
    if (!name.trim()) return
    dispatch({ type: 'vault-add', entry: { name: name.trim(), slot, rarity: 'Legendary' as Rarity, element: element || undefined } }, p.id)
    setName('')
  }
  const mine = p.id === myPlayerId
  return (
    <div className="panel lower-panel">
      <h3>Vault pool <span className="muted">{p.bungie ? `${p.vault.length} from Bungie` : p.vault.length ? `${p.vault.length} entered` : 'example pool'}</span></h3>
      {mine && <BungiePanel p={p} dispatch={dispatch} />}
      <p className="section-note">
        Final-boss weapons and trade-ups draw from Legendaries in {p.name}&rsquo;s Vault.
        {p.bungie ? ' This list comes from their Bungie account and refreshes on each sync.' : ' In No Login mode, list them here.'}
        {!p.vault.length && !p.bungie && ' Until you do, an example pool of well-known Legendaries stands in.'}
      </p>
      <div className="vault-list">
        {WEAPON_SLOTS.map((s) => (
          <div key={s}>
            <h4>{s}</h4>
            <p className="small">{pool.filter((v) => v.slot === s).map((v) => v.name).join(', ') || 'None'}</p>
          </div>
        ))}
        <div>
          <h4>Armor</h4>
          <p className="small">{pool.filter((v) => !WEAPON_SLOTS.includes(v.slot)).length} pieces</p>
        </div>
      </div>
      {canControl(p.id) && !p.bungie && <div className="inline-form wrap">
        <input id={`vault-name-${p.id}`} placeholder="Legendary name" value={name} onChange={(e) => setName(e.target.value)} />
        <select id={`vault-slot-${p.id}`} value={slot} onChange={(e) => setSlot(e.target.value as Slot)}>
          {ALL_SLOTS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select id={`vault-el-${p.id}`} value={element} onChange={(e) => setElement(e.target.value as Element | '')}>
          <option value="">No element</option>
          {DAMAGE_ELEMENTS.map((el) => <option key={el}>{el}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={add}>Add</button>
        {p.vault.length > 0 && <button className="link" onClick={() => dispatch({ type: 'vault-clear' }, p.id)}>Clear list</button>}
      </div>}
    </div>
  )
}

const FILTERS: { label: string; kinds: LogKind[] | null }[] = [
  { label: 'All', kinds: null },
  { label: 'Encounters', kinds: ['clear', 'wipe', 'death', 'chest', 'run'] },
  { label: 'Unlocks', kinds: ['unlock', 'artifact', 'upgrade'] },
  { label: 'Gear', kinds: ['gear', 'drop', 'trade', 'vault'] },
]

export function CombatReport({ run, embedded }: { run: Run; embedded?: boolean }) {
  const [f, setF] = useState(0)
  const kinds = FILTERS[f].kinds
  const list = run.log.filter((l) => !kinds || kinds.includes(l.kind))
  return (
    <section id={embedded ? undefined : 'report'} className={embedded ? '' : 'section'}>
      {!embedded && (
        <header className="section-head">
          <div>
            <div className="eyebrow">Combat Report</div>
            <h2>Run log</h2>
          </div>
        </header>
      )}
      <div className="filters" role="tablist">
        {FILTERS.map((x, i) => <button key={x.label} role="tab" aria-selected={f === i} className={f === i ? 'is-on' : ''} onClick={() => setF(i)}>{x.label}</button>)}
      </div>
      <div className="log-wrap">
        <table className="log">
          <thead><tr><th>Time</th><th>Event</th><th>Detail</th><th className="r">Integrity</th></tr></thead>
          <tbody>
            {list.map((l, i) => (
              <tr key={i}>
                <td className="mono">{new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                <td><span className={`kind kind-${l.kind}`}>{l.kind}</span></td>
                <td>{l.text}{l.where && <div className="muted small">{l.where}</div>}</td>
                <td className="r mono">
                  {l.delta !== undefined && <span className={l.delta < 0 ? 'tone-danger' : 'tone-ok'}>{l.delta > 0 ? '+' : ''}{l.delta} </span>}
                  {l.integrity !== undefined && <span className="muted">{l.integrity}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <Empty>Nothing recorded yet</Empty>}
      </div>
    </section>
  )
}

/**
 * Scrolls to the screen parts a warning is about and flashes them red three times. Returns false
 * when none of them is on screen (e.g. hidden locked abilities), so the caller can fall back.
 */
function flashTargets(keys: string[]) {
  const els = keys.flatMap((k) => [...document.querySelectorAll<HTMLElement>(`[data-flash="${CSS.escape(k)}"]`)])
  if (!els.length) return false
  els[0].scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
  for (const el of els) {
    el.classList.remove('is-flash')
    void el.offsetWidth // restart the animation on a second click
    el.classList.add('is-flash')
    el.addEventListener('animationend', () => el.classList.remove('is-flash'), { once: true })
  }
  return true
}

function ClaimBanner({ run }: { run: Run }) {
  const { claimSeat, online, me, leave } = useGD()
  const free = run.players.filter((p) => !p.clientId || !online.includes(p.clientId))
  const gone = me ? run.departed?.find((d) => d.clientId === me) : undefined
  if (gone) {
    return (
      <section className="panel seat-picker">
        <h2>You&rsquo;ve been removed from this run</h2>
        <p className="section-note">The host took {gone.name} out of the run, so the rest of the fireteam can carry on. You can keep watching, or leave.</p>
        <div className="row-acts"><button className="btn btn-ghost" onClick={leave}>Leave the run</button></div>
      </section>
    )
  }
  return (
    <section className="panel seat-picker">
      <h2>Which Guardian are you?</h2>
      <p className="section-note">The run is underway. Link this device to your Guardian to choose rewards and manage your gear.</p>
      <div className="row-acts">
        {free.map((p) => <button key={p.id} className="btn btn-light" onClick={() => claimSeat(p.id)}><ElementMark element={p.element} /> {p.name}</button>)}
        {free.length === 0 && <p className="muted">Every Guardian is already linked to a connected device. You can watch the run.</p>}
      </div>
    </section>
  )
}

/**
 * The host's one forward button. Clearing an encounter records it and sends rewards at once.
 * Then, for each secret chest before the next encounter, it splits into "got it" / "missed it".
 */
function ProgressControl({ run, disabled }: { run: Run; disabled: boolean }) {
  const { openFlow, host, toast } = useGD()
  const { encounter } = current(run)
  const next = nextEncounter(run)
  const chest = pendingChest(run)
  const r = run.ruleset.integrity

  if (chest) {
    const answer = (found: boolean) => {
      host!.updateRun((x) => recordChest(x, found))
      toast(found ? `Secret Chest ${chest.number} found. Chest rewards sent.` : `Secret Chest ${chest.number} skipped.`)
    }
    return (
      <div className="progress-split" role="group" aria-label={`Secret Chest ${chest.number}`}>
        <p className="split-q">Did you get <strong>Secret Chest {chest.number}</strong>?</p>
        <div className="split-btns">
          <button className="btn btn-light" disabled={disabled} onClick={() => answer(true)}>
            Got it
            <small>Chest reward for everyone</small>
          </button>
          <button className="btn btn-ghost" disabled={disabled} onClick={() => answer(false)}>
            Missed it
            <small>No extra reward</small>
          </button>
        </div>
        <p className="small muted">{chest.remaining > 1 ? `${chest.remaining - 1} more chest after this, then ` : 'Then '}{encounter.name}.</p>
      </div>
    )
  }
  return (
    <button className="btn btn-light btn-big progress-btn" disabled={disabled} onClick={() => openFlow({ type: 'clear' })}>
      {encounter.type === 'final' ? 'Clear final boss' : 'Clear encounter'}
      <small>+{r.clear} Integrity{next ? ` \u00b7 then ${next.encounter.name}` : ' \u00b7 completes the route'}</small>
    </button>
  )
}
