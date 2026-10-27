import { useState } from 'react'
import {
  ABILITY_KINDS, ALL_SLOTS, DAMAGE_ELEMENTS, ELEMENT_COLOR, KIND_LABEL, RARITIES, WEAPON_SLOTS,
  abilityById, dungeonById, subclassAbilities, type Element, type Rarity, type Slot,
} from './data'
import {
  capacityOf, chestsAhead, createLobby, current, itemsIn, loadoutSlotsOf, loadoutValid, nextEncounter, vaultPool,
  type LogKind, type Player, type Run, type Warning,
} from './model'
import { makeLobbyCode } from './net'
import { BungiePanel } from './BungiePanel'
import { useGD } from './store'
import { ElementMark, Empty, EncounterArt, Meter, rarityClass } from './ui'

export function Briefing({ run, warnings, pendingDeferred, onOpenRewards }: { run: Run; warnings: Warning[]; pendingDeferred: number; onOpenRewards: () => void }) {
  const { openFlow, host, go, toast, role, myPlayerId } = useGD()
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
        {active && isHost && <button className="btn btn-ghost btn-sm" onClick={() => openFlow({ type: 'abandon' })}>End run</button>}
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
        <div className="panel integrity">
          <div className="eyebrow">Fireteam Integrity</div>
          <div className="int-value">
            <span className={`num tone-${tone}`}>{run.integrity}</span>
            <span className="of">/ {r.max}</span>
          </div>
          <Meter value={run.integrity} max={r.max} tone={tone} />
          <dl className="int-rules">
            <div><dt>Clear</dt><dd>+{r.clear}</dd></div>
            <div><dt>Wipe</dt><dd>&minus;{r.wipe}</dd></div>
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
              {myPlayerId && active && <button className="btn btn-ghost btn-big" onClick={() => openFlow({ type: 'register', playerId: myPlayerId })}>Register my drop<small>Weapons and armor you earned</small></button>}
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
            <button key={w.id} className={`warn warn-${w.severity}`} onClick={() => go('briefing', w.where === 'integrity' ? undefined : w.where === 'setup' ? 'players' : w.where)}>
              <span className="warn-sev">{w.severity === 'critical' ? 'Discrepancy' : w.severity === 'warn' ? 'Check' : 'Note'}</span>
              <span className="warn-title">
                {w.playerId && <b>{run.players.find((p) => p.id === w.playerId)?.name}: </b>}
                {w.title}
              </span>
              <span className="warn-rule">{w.rule}</span>
            </button>
          ))}
        </section>
      )}

      <section id="players" className={`players players-${run.players.length}`}>
        {run.players.map((p) => <PlayerPanel key={p.id} run={run} p={p} warnings={warnings.filter((w) => w.playerId === p.id)} />)}
      </section>

      <div className="fold-label"><span>Buildcrafting and records</span></div>

      <SubclassArchive run={run} />
      <ArtifactResearch run={run} />
      <FieldArsenal run={run} />
      <CombatReport run={run} />
    </div>
  )
}

function PlayerPanel({ run, p, warnings }: { run: Run; p: Player; warnings: Warning[] }) {
  const { dispatch, canControl, online, me, role, openFlow } = useGD()
  const control = canControl(p.id)
  const pend = run.pending.filter((x) => x.playerId === p.id)
  const device = p.clientId === null ? 'No device' : p.clientId === me ? 'You' : online.includes(p.clientId) ? 'Online' : 'Offline'
  const [showChecklist, setShowChecklist] = useState(false)
  const cap = capacityOf(run, p)
  const counts = ABILITY_KINDS.map((k) => ({ k, n: p.unlocked.filter((id) => abilityById(id).kind === k).length, of: subclassAbilities(p.cls, p.element).filter((a) => a.kind === k).length }))
  const setupOpen = run.claimed.length === 0 && run.status === 'active'
  const checked = Object.values(p.checklist).filter(Boolean).length
  return (
    <article className="panel player" style={{ ['--el' as string]: ELEMENT_COLOR[p.element] }}>
      <header className="player-head">
        <ElementMark element={p.element} size={22} />
        <div>
          <h3>{p.name}</h3>
          <div className="player-sub">{p.element} {p.cls}{p.isHost && <span className="tag tag-host">Host</span>}</div>
        </div>
        <span className={`device dev-${device.replace(' ', '').toLowerCase()}`}>{device}</span>
      </header>
      {pend.length > 0 && (
        <div className="pending-row">
          <span className="mod-hex" aria-hidden="true" />
          <span>{p.clientId === me ? 'Your rewards are waiting' : `Choosing ${pend.length} reward${pend.length > 1 ? 's' : ''}…`}</span>
          {role === 'host' && p.clientId === null && <button className="link" onClick={() => openFlow({ type: 'reward', pendingId: pend[0].id })}>Resolve for them</button>}
        </div>
      )}
      <div className="unlock-row">
        {counts.map(({ k, n, of }) => (
          <div key={k} className="unlock-stat">
            <span className="num">{n}<small>/{of}</small></span>
            <span className="lbl">{KIND_LABEL[k]}s</span>
          </div>
        ))}
      </div>
      <div className="cap-grid">
        {ALL_SLOTS.map((slot) => {
          const n = itemsIn(p, slot).length
          return (
            <div key={slot} className={`cap-cell ${n > cap ? 'is-over' : n === cap ? 'is-full' : ''}`} title={`${slot}: ${n} of ${cap}`}>
              <span className="cap-slot">{slot === 'Class Item' ? 'Class' : slot === 'Gauntlets' ? 'Arms' : slot}</span>
              <span className="cap-n">{n}/{cap}</span>
            </div>
          )
        })}
      </div>
      <div className="player-foot">
        <span>{p.artifact.length} artifact mod{p.artifact.length === 1 ? '' : 's'}</span>
        <span>{p.loadouts.length}/{loadoutSlotsOf(run, p)} loadouts</span>
        {p.bungie && <span className="tag tag-bungie" title={`${p.bungie.name} \u00b7 ${p.bungie.character}`}>Bungie linked</span>}
        {setupOpen && <button className="link" onClick={() => setShowChecklist((v) => !v)}>Starting gear {checked}/6</button>}
      </div>
      {setupOpen && showChecklist && (
        <ul className="checklist">
          {(Object.keys(p.checklist) as (keyof Player['checklist'])[]).map((k) => (
            <li key={k}>
              <label>
                <input type="checkbox" disabled={!control} checked={p.checklist[k]} onChange={(e) => dispatch({ type: 'checklist', key: k, value: e.target.checked }, p.id)} />
                {CHECK_LABELS[k]}
              </label>
            </li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="player-warnings">
          {warnings.map((w) => <li key={w.id} className={`sev-${w.severity}`}>{w.title}</li>)}
        </ul>
      )}
    </article>
  )
}

const CHECK_LABELS: Record<keyof Player['checklist'], string> = {
  greyKinetic: 'Grey kinetic equipped', greyEnergy: 'Grey energy equipped', greenHeavy: 'Green heavy equipped',
  greyArmor: 'Grey armor on all slots', noAspects: 'Aspects unequipped', noFragments: 'Fragments unequipped',
}

function PlayerTabs({ run, value, onChange }: { run: Run; value: string; onChange: (id: string) => void }) {
  const { myPlayerId } = useGD()
  return (
    <div className="ptabs" role="tablist">
      {run.players.map((p) => (
        <button key={p.id} role="tab" aria-selected={value === p.id} title={p.id === myPlayerId ? 'Your Guardian' : undefined} className={value === p.id ? 'is-on' : ''} onClick={() => onChange(p.id)} style={{ ['--el' as string]: ELEMENT_COLOR[p.element] }}>
          <ElementMark element={p.element} /> {p.name}{p.id === myPlayerId && <span className="muted small">(you)</span>}
        </button>
      ))}
    </div>
  )
}

function usePlayerTab(run: Run) {
  const { myPlayerId } = useGD()
  const [id, setId] = useState(myPlayerId ?? run.players[0].id)
  const p = run.players.find((x) => x.id === id) ?? run.players[0]
  return [p, setId] as const
}

function SubclassArchive({ run }: { run: Run }) {
  const { dispatch, canControl } = useGD()
  const [p, setId] = usePlayerTab(run)
  const [showLocked, setShowLocked] = useState(false)
  const all = subclassAbilities(p.cls, p.element)
  const control = canControl(p.id)
  const toggle = (id: string) => dispatch({ type: 'configure', abilityId: id }, p.id)
  return (
    <section id="archive" className="section">
      <header className="section-head">
        <div>
          <div className="eyebrow">Subclass Archive</div>
          <h2>Unlocked abilities</h2>
          <p className="section-note">Unlocking and equipping are separate. Tick what you have actually equipped in Destiny 2; anything equipped but not unlocked is flagged. Each player keeps their own Guardian up to date.</p>
        </div>
        <label className="switch"><input type="checkbox" checked={showLocked} onChange={(e) => setShowLocked(e.target.checked)} /> Show locked</label>
      </header>
      <PlayerTabs run={run} value={p.id} onChange={setId} />
      <div className="kind-grid">
        {ABILITY_KINDS.map((k) => {
          const list = all.filter((a) => a.kind === k && (showLocked || p.unlocked.includes(a.id) || p.configured.includes(a.id)))
          return (
            <div key={k} className="kind-col">
              <h3>{KIND_LABEL[k]}s <span className="muted">{all.filter((a) => a.kind === k && p.unlocked.includes(a.id)).length}/{all.filter((a) => a.kind === k).length}</span></h3>
              {list.length === 0 && <Empty>None unlocked yet</Empty>}
              <ul className="ability-list">
                {list.map((a) => {
                  const unlocked = p.unlocked.includes(a.id)
                  const conf = p.configured.includes(a.id)
                  return (
                    <li key={a.id} className={`ability ${unlocked ? 'is-unlocked' : 'is-locked'} ${conf && !unlocked ? 'is-bad' : ''}`}>
                      <label>
                        <input type="checkbox" disabled={!control} checked={conf} onChange={() => toggle(a.id)} aria-label={`${a.name} equipped in game`} />
                        <span className="ab-name">{a.name}</span>
                      </label>
                      <span className="ab-state">{unlocked ? (conf ? 'Equipped' : 'Unlocked') : conf ? 'Out of order' : 'Locked'}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ArtifactResearch({ run }: { run: Run }) {
  const { dispatch, canControl } = useGD()
  return (
    <section id="artifact" className="section">
      <header className="section-head">
        <div>
          <div className="eyebrow">Artifact Research</div>
          <h2>Artifact mods</h2>
          <p className="section-note">The Artifact starts empty. Final bosses and secret chests offer research; configure the actual Artifact in Destiny 2.</p>
        </div>
      </header>
      <div className={`art-cols players-${run.players.length}`}>
        {run.players.map((p) => (
          <div key={p.id} className="panel art-col">
            <h3><ElementMark element={p.element} /> {p.name}</h3>
            {p.artifact.length === 0 ? <Empty>No mods researched</Empty> : (
              <ul className="mod-list">
                {p.artifact.map((m) => (
                  <li key={m}>
                    <span className="mod-hex" aria-hidden="true" />{m}
                    {canControl(p.id) && <button className="icon-btn sm" aria-label={`Remove ${m}`} onClick={() => dispatch({ type: 'artifact-remove', mod: m }, p.id)}>×</button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function FieldArsenal({ run }: { run: Run }) {
  const { dispatch, canControl, openFlow, toast } = useGD()
  const [p, setId] = usePlayerTab(run)
  const cap = capacityOf(run, p)
  const tu = run.ruleset.tradeUp
  const control = canControl(p.id)
  const active = run.status === 'active' && control
  const toggleEquip = (itemId: string) => dispatch({ type: 'equip', itemId }, p.id)

  const eligibleForTrade = (slot: Slot) => {
    const items = itemsIn(p, slot).filter((i) => i.rarity !== 'Exotic')
    if (!tu.sameRarity) return items.length >= tu.inputs
    return RARITIES.some((rr) => items.filter((i) => i.rarity === rr).length >= tu.inputs)
  }

  return (
    <section id="arsenal" className="section">
      <header className="section-head">
        <div>
          <div className="eyebrow">Field Arsenal</div>
          <h2>Run inventory</h2>
          <p className="section-note">Only items declared as run acquisitions count. Each slot holds {run.ruleset.inventory.capacity} items including the equipped one{p.capacityBonus ? `, +${p.capacityBonus} from Arsenal Expansion for ${p.name}` : ''}. Keep extras in the Vault; nothing needs dismantling.</p>
        </div>
        {control ? <button className="btn btn-light" disabled={!active} onClick={() => openFlow({ type: 'register', playerId: p.id })}>Register drop</button> : <span className="muted small">Viewing {p.name}. Only their player can change this.</span>}
      </header>
      <PlayerTabs run={run} value={p.id} onChange={setId} />
      <div className="slot-grid">
        {ALL_SLOTS.map((slot) => {
          const items = itemsIn(p, slot)
          const over = items.length > cap
          return (
            <div key={slot} className={`panel slot ${over ? 'is-over' : ''}`}>
              <header>
                <h3>{slot}</h3>
                <span className={`cap ${over ? 'tone-danger' : items.length === cap ? 'tone-warn' : ''}`}>{items.length}/{cap}</span>
              </header>
              <div className="cap-ticks">
                {Array.from({ length: Math.max(cap, items.length) }, (_, i) => <span key={i} className={i < items.length ? (i >= cap ? 'over' : 'on') : ''} />)}
              </div>
              {items.length === 0 ? <Empty>Empty</Empty> : (
                <ul className="items">
                  {items.map((it) => (
                    <li key={it.id} className={`item ${rarityClass(it.rarity)} ${it.equipped ? 'is-eq' : ''}`}>
                      <div className="item-main">
                        <span className="item-name">{it.name}</span>
                        <span className="item-meta">{it.rarity} &middot; {it.source}</span>
                      </div>
                      {control ? (
                        <div className="item-acts">
                          <button className="chip" onClick={() => toggleEquip(it.id)} aria-pressed={it.equipped}>{it.equipped ? 'Equipped' : 'Equip'}</button>
                          <button className="chip" onClick={() => { dispatch({ type: 'vault', itemIds: [it.id], why: 'player choice' }, p.id); toast(`${it.name} moved to the Vault`) }}>To Vault</button>
                        </div>
                      ) : it.equipped && <span className="chip static">Equipped</span>}
                    </li>
                  ))}
                </ul>
              )}
              {control && <div className="slot-foot">
                <button className="link" disabled={!active} onClick={() => openFlow({ type: 'register', playerId: p.id, slot })}>+ Add</button>
                {tu.enabled && <button className="link" disabled={!active || !eligibleForTrade(slot)} onClick={() => openFlow({ type: 'tradeup', playerId: p.id, slot })}>Trade up {tu.inputs}&rarr;1</button>}
              </div>}
            </div>
          )
        })}
      </div>
      <div className="arsenal-lower">
        <Loadouts run={run} p={p} />
        <VaultPool p={p} />
      </div>
    </section>
  )
}

function Loadouts({ run, p }: { run: Run; p: Player }) {
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

function VaultPool({ p }: { p: Player }) {
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
  { label: 'Encounters', kinds: ['clear', 'wipe', 'chest', 'run'] },
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

function ClaimBanner({ run }: { run: Run }) {
  const { claimSeat, online } = useGD()
  const free = run.players.filter((p) => !p.clientId || !online.includes(p.clientId))
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

/** The host's one forward button. When secret chests sit before the next encounter it splits into found / skipped. */
function ProgressControl({ run, disabled }: { run: Run; disabled: boolean }) {
  const { openFlow } = useGD()
  const [asking, setAsking] = useState(false)
  const { encounter } = current(run)
  const next = nextEncounter(run)
  const { count: ahead, first } = chestsAhead(run)
  const chestNames = ahead === 1 ? `Secret Chest ${first}` : `Secret Chests ${Array.from({ length: ahead }, (_, k) => first + k).join(' and ').replace(/ and (?=.* and )/g, ', ')}`
  const r = run.ruleset.integrity
  // Reset the split whenever the encounter changes.
  const [forEnc, setForEnc] = useState(encounter.id)
  if (forEnc !== encounter.id) { setForEnc(encounter.id); setAsking(false) }

  const label = encounter.type === 'final' ? 'Clear final boss' : 'Clear encounter'
  if (!asking || ahead === 0) {
    return (
      <button className="btn btn-light btn-big progress-btn" disabled={disabled} onClick={() => (ahead > 0 ? setAsking(true) : openFlow({ type: 'clear', chests: 0 }))}>
        {label}
        <small>+{r.clear} Integrity{ahead > 0 ? ` \u00b7 ${chestNames} to check` : next ? ` \u00b7 then ${next.encounter.name}` : ' \u00b7 completes the route'}</small>
      </button>
    )
  }
  return (
    <div className="progress-split" role="group" aria-label="Secret chest">
      <p className="split-q">{ahead === 1 ? `Did you get ${chestNames}?` : `How many of ${chestNames} did you get?`}</p>
      <div className="split-btns">
        {Array.from({ length: ahead }, (_, k) => ahead - k).map((n) => (
          <button key={n} className="btn btn-light" onClick={() => openFlow({ type: 'clear', chests: n })}>
            {ahead === 1 ? 'Got the chest' : `Got ${n}`}
            <small>Chest reward{n > 1 ? 's' : ''} for everyone</small>
          </button>
        ))}
        <button className="btn btn-ghost" onClick={() => openFlow({ type: 'clear', chests: 0 })}>
          {ahead === 1 ? 'No chest' : 'None'}
          <small>Clear reward only</small>
        </button>
      </div>
      <button className="link" onClick={() => setAsking(false)}>Back</button>
    </div>
  )
}
