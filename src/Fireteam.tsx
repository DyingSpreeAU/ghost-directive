// The run screen's fireteam: one column per Guardian with their run inventory (slot by slot, as
// item tiles), unlocked subclass abilities and artifact perks, so all three read side by side.

import { useState } from 'react'
import {
  ABILITY_KINDS, ALL_SLOTS, KIND_PLURAL, ELEMENT_COLOR, RARITIES, abilityById, artifactByName, artifactPerk, abilityDesc, subclassAbilities, type Slot,
} from './data'
import { FATE_LABEL, capacityOf, equippedNotUnlocked, itemsIn, slotTier, tradeable, recordDeath, removePlayer, undoDeath, type Fate, type Item, type Player, type Run, type Warning } from './model'
import { RestoreGuardian, syncBungie, useBungie } from './BungiePanel'
import { useIcons } from './icons'
import { canMoveInGame, moveInGame } from './gearMoves'
import { useGD } from './store'
import { ElementMark, Empty, SwipeCols, TierWord, rarityClass } from './ui'

const GUIDE_KEY = 'ghost-directive:fireteam-guide'

export function Fireteam({ run, warnings }: { run: Run; warnings: Warning[] }) {
  const { me } = useGD()
  const [showLocked, setShowLocked] = useState(true)
  // Open by default on wide screens; on a phone it would push the Guardians far down, so it starts closed.
  const [guideOpen, setGuideOpen] = useState(() => {
    try { const v = localStorage.getItem(GUIDE_KEY); if (v) return v !== 'closed' } catch { /* fine */ }
    return !matchMedia('(max-width: 900px)').matches
  })
  const toggleGuide = (open: boolean) => { setGuideOpen(open); try { localStorage.setItem(GUIDE_KEY, open ? 'open' : 'closed') } catch { /* fine */ } }
  return (
    <section id="arsenal" className="section fireteam" aria-labelledby="fireteam-title">
      <header className="section-head">
        <div>
          <div className="eyebrow">Fireteam</div>
          <h2 id="fireteam-title">Guardians</h2>
        </div>
        <label className="switch"><input type="checkbox" checked={showLocked} onChange={(e) => setShowLocked(e.target.checked)} /> Show locked abilities</label>
      </header>
      <details className="fireteam-guide" open={guideOpen} onToggle={(e) => toggleGuide((e.target as HTMLDetailsElement).open)}>
        <summary>How these columns work</summary>
        <div className="guide-cols">
          <div>
            <div className="eyebrow">Field Arsenal</div>
            <h3>Run inventory</h3>
            <p className="section-note">Only items declared as run acquisitions count. Each slot holds {run.ruleset.inventory.capacity} items including the equipped one; Arsenal Expansion adds more. Keep extras in the Vault; nothing needs dismantling. Select an item to send it to the Vault (signed-in players: it moves in Destiny 2 too) or remove it from the app only.</p>
          </div>
          <div id="archive">
            <div className="eyebrow">Subclass Archive</div>
            <h3>Unlocked abilities</h3>
            <p className="section-note">Unlocking and equipping are separate. Highlighted abilities are equipped in Destiny 2; anything equipped but not unlocked is flagged. Without Bungie sign-in, select an ability to mark it equipped.</p>
          </div>
          <div id="artifact">
            <div className="eyebrow">Artifact Research</div>
            <h3>Artifact perks</h3>
            <p className="section-note">Each Guardian committed to one artifact for the run, and it starts with nothing researched. Final bosses and secret chests offer perks from that artifact only. Set the perks up in Destiny 2 to match.</p>
          </div>
        </div>
      </details>
      <SwipeCols className={`guardian-cols players-${run.players.length}`} tabs={run.players.map((p) => ({ key: p.id, label: <>{p.name}{p.clientId === me ? <span className="swipe-you">You</span> : null}{run.pending.some((x) => x.playerId === p.id) ? <span className="swipe-flag" title="Rewards waiting" /> : null}</> }))}>
        {run.players.map((p) => <GuardianColumn key={p.id} run={run} p={p} warnings={warnings.filter((w) => w.playerId === p.id)} showLocked={showLocked} />)}
      </SwipeCols>
    </section>
  )
}

function GuardianColumn({ run, p, warnings, showLocked }: { run: Run; p: Player; warnings: Warning[]; showLocked: boolean }) {
  const { online, me, role, openFlow, canControl, host, dispatch, toast } = useGD()
  const pend = run.pending.filter((x) => x.playerId === p.id)
  const [removing, setRemoving] = useState(false)
  const device = p.clientId === null ? 'No device' : p.clientId === me ? 'You' : online.includes(p.clientId) ? 'Online' : 'Offline'
  return (
    <article className={`panel guardian ${p.clientId === me ? 'is-you' : ''}`} style={{ ['--el' as string]: ELEMENT_COLOR[p.element] }} aria-label={p.name}>
      <header className={`player-head ${p.bungie?.emblem ? 'has-emblem' : ''}`} style={p.bungie?.emblem ? { ['--emblem' as string]: `url("https://www.bungie.net${p.bungie.emblem.background}")` } : undefined}>
        <ElementMark element={p.element} size={22} />
        <div>
          <h3>{p.name}</h3>
          <div className="player-sub">{p.element} {p.cls}{p.isHost && <span className="tag tag-host">Host</span>}{p.bungie && <span className="tag tag-bungie" title={`${p.bungie.name} · ${p.bungie.character}`}>Bungie</span>}</div>
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
      <DeathRow run={run} p={p} isHost={role === 'host'} mine={p.clientId === me}
        record={() => {
          // The host records for anyone; a player records their own through the host.
          if (role === 'host') host!.updateRun((r) => recordDeath(r, r.players.find((x) => x.id === p.id)!))
          else dispatch({ type: 'death' }, p.id)
          toast(`${p.clientId === me ? 'Your' : `${p.name}'s`} death recorded.`)
        }}
        undo={() => { host!.updateRun((r) => undoDeath(r, r.players.find((x) => x.id === p.id)!)); toast(`${p.name}'s last death taken back.`) }} />
      {warnings.length > 0 && (
        <ul className="player-warnings">
          {warnings.map((w) => <li key={w.id} className={`sev-${w.severity}`}>{w.title}</li>)}
        </ul>
      )}
      <Inventory run={run} p={p} control={canControl(p.id)} />
      <Abilities p={p} showLocked={showLocked} control={canControl(p.id) && !p.bungie?.subclass} />
      <ArtifactPerks p={p} control={canControl(p.id)} />
      {role === 'host' && !p.isHost && run.status === 'active' && (
        removing ? (
          <div className="remove-player" role="group" aria-label={`Remove ${p.name}`}>
            <p className="small"><strong>Remove {p.name} from the run?</strong> Use this if they&rsquo;ve left the fireteam. Their gear, unlocks and waiting rewards leave with them; the rest of you carry on. This can&rsquo;t be undone.</p>
            <div className="row-acts">
              <button className="btn btn-ghost btn-sm" onClick={() => setRemoving(false)}>Keep</button>
              <button className="btn btn-danger btn-sm" onClick={() => { host!.updateRun((r) => removePlayer(r, p.id)); toast(`${p.name} removed from the run.`) }}>Remove {p.name}</button>
            </div>
          </div>
        ) : <button className="link small remove-player-link" onClick={() => setRemoving(true)}>Remove from run</button>
      )}
    </article>
  )
}

function Inventory({ run, p, control }: { run: Run; p: Player; control: boolean }) {
  const { dispatch, openFlow, toast, me } = useGD()
  const [moving, setMoving] = useState(false)
  const inGame = canMoveInGame(p, me)
  const bungie = useBungie()
  const icons = useIcons()
  const cap = capacityOf(run, p)
  const tu = run.ruleset.tradeUp
  const active = run.status === 'active' && control
  const [selected, setSelected] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const sel = p.inventory.find((i) => i.id === selected)
  // Gear on the character that isn't part of the run, as of the last Bungie sync.
  const outside = (p.bungie?.untracked ?? []).map((u, k) => ({ ...u, key: `out-${k}` }))
  const selOut = outside.find((u) => u.key === selected)
  const select = (id: string) => { setSelected(selected === id ? null : id); setRemoving(false) }

  const eligibleForTrade = (slot: Slot) => {
    if (slotTier(run, p, slot) !== 'Legendary') return false
    const items = itemsIn(p, slot).filter(tradeable)
    if (!tu.sameRarity) return items.length >= tu.inputs
    return RARITIES.some((rr) => items.filter((i) => i.rarity === rr).length >= tu.inputs)
  }

  return (
    <section className="g-sec" aria-label={`${p.name}: run inventory`}>
      <header className="g-sec-head">
        <span className="eyebrow">Run inventory{p.capacityBonus ? ` · +${p.capacityBonus} Arsenal Expansion` : ''}</span>
        {control && (p.bungie
          ? <button className="link" disabled={!active} onClick={() => openFlow({ type: 'register', playerId: p.id })}>Add manually</button>
          : <button className="btn btn-light btn-sm" disabled={!active} onClick={() => openFlow({ type: 'register', playerId: p.id })}>Register drop</button>)}
      </header>
      {control && p.bungie && (
        <div className="auto-drops">
          <span><span className="tag tag-bungie">Bungie</span> Drops are checked automatically every minute.</span>
          {bungie.signedIn && <button className="btn btn-ghost btn-sm" disabled={bungie.busy} onClick={() => syncBungie(run, p, dispatch, (m) => toast(m))}>{bungie.busy ? 'Syncing…' : 'Sync drops now'}</button>}
          <RestoreGuardian run={run} p={p} />
        </div>
      )}
      <div className="g-slots">
        {ALL_SLOTS.map((slot) => {
          const items = itemsIn(p, slot)
          const over = items.length > cap
          return (
            <div key={slot} className={`g-slot ${over ? 'is-over' : ''}`} data-flash={`slot:${p.id}:${slot}`}>
              <div className="g-slot-head">
                <span className="g-slot-name">{slot}</span>
                {run.ruleset.progression && p.tiers && <span title={`Gear progression: your ${slot} is at ${slotTier(run, p, slot)}.${slotTier(run, p, slot) === 'Legendary' ? '' : ' A non-Exotic drop here moves it up a tier.'}`}><TierWord tier={slotTier(run, p, slot)} /></span>}
                <span className={`cap ${over ? 'tone-danger' : items.length === cap ? 'tone-warn' : ''}`}>{items.length}/{cap}</span>
                {control && tu.enabled && (p.trade?.slot === slot || (!p.trade && eligibleForTrade(slot))) && <button className="link" disabled={!active} onClick={() => openFlow({ type: 'tradeup', playerId: p.id, slot })}>{p.trade ? 'Finish trade-up' : <>Trade up {tu.inputs}&rarr;1</>}</button>}
              </div>
              <div className="tiles" style={{ ['--n' as string]: Math.max(cap, items.length, 4) }}>
                {items.map((it, i) => (
                  <Tile key={it.id} flash={`item:${p.id}:${it.name}`} it={it} icon={icons.gear(it.name)} over={i >= cap} selected={selected === it.id} onSelect={() => select(it.id)} />
                ))}
                {Array.from({ length: Math.max(0, cap - items.length) }, (_, i) => (
                  control && !p.bungie
                    ? <button key={i} className="tile tile-empty" disabled={!active} aria-label={`Add a ${slot} item`} onClick={() => openFlow({ type: 'register', playerId: p.id, slot })}>+</button>
                    : <span key={i} className="tile tile-empty" aria-hidden="true" />
                ))}
                {outside.filter((u) => u.slot === slot).map((u) => (
                  <OutsideTile key={u.key} u={u} icon={icons.gear(u.name)} flash={`out:${p.id}:${u.slot}:${u.name}`} selected={selected === u.key} onSelect={() => select(u.key)} />
                ))}
              </div>
              {selOut && selOut.slot === slot && (
                <div className={`tile-detail is-outside ${rarityClass(selOut.rarity ?? 'Legendary')}`} role="group" aria-label={selOut.name}>
                  <div className="item-main">
                    <span className="item-name">{selOut.name}</span>
                    <span className="item-meta">
                      <span className="tag tag-bad">Not in the run</span>{' '}
                      {[selOut.rarity, selOut.equipped ? 'Equipped' : 'In inventory', selOut.fate ? `${FATE_LABEL[selOut.fate]} earlier` : ''].filter(Boolean).join(' · ')}
                    </span>
                    <span className="item-meta">{selOut.fate
                      ? 'This item left the run but is on your character again. Put it away, or dismantle it if that was its fate.'
                      : 'On your character in Destiny 2 but not part of the run. Put it in your Vault, or add it if it was a run drop the app missed.'}</span>
                  </div>
                  {control && (
                    <div className="item-acts row">
                      {inGame && <button className="chip" disabled={moving || !!selOut.equipped} title={selOut.equipped ? 'Equip something else in Destiny 2 first, or use Restore my Guardian.' : 'Send it to your Vault in Destiny 2.'} onClick={async () => {
                        setMoving(true)
                        const r = await moveInGame(p, [{ name: selOut.name, instanceId: selOut.instanceId, slot: selOut.slot, to: 'vault' }], toast)
                        setMoving(false)
                        if (r && !r.problems.length) { setSelected(null); void syncBungie(run, p, dispatch, () => {}) }
                      }}>{moving ? 'Moving\u2026' : 'To Vault'}</button>}
                      {!selOut.fate && <button className="chip chip-quiet" disabled={!active} title="It was a run drop: add it to the run inventory." onClick={() => openFlow({ type: 'register', playerId: p.id, slot })}>Add to run</button>}
                    </div>
                  )}
                </div>
              )}
              {sel && sel.slot === slot && (
                <div className={`tile-detail ${rarityClass(sel.rarity)}`} role="group" aria-label={sel.name}>
                  <div className="item-main">
                    <span className="item-name">{removing ? `Dismantled ${sel.name}?` : sel.name}</span>
                    <span className="item-meta">{removing ? 'It comes out of your run inventory. Press this only once you’ve dismantled it in Destiny 2.' : <>{sel.rarity} &middot; {sel.source}{sel.equipped ? ' · Equipped' : ''}</>}</span>
                  </div>
                  {control && (removing ? (
                    <div className="item-acts row">
                      <button className="chip chip-danger" onClick={() => { dispatch({ type: 'remove-item', itemId: sel.id, dismantled: true }, p.id); setSelected(null); setRemoving(false); toast(`${sel.name} dismantled and removed from the run`) }}>Yes, dismantled</button>
                      <button className="chip" onClick={() => setRemoving(false)}>Cancel</button>
                    </div>
                  ) : (
                    <div className="item-acts row">
                      <button className="chip" disabled={moving} title={inGame ? 'Send it to your Vault in Destiny 2 and take it out of the run.' : 'Take it out of the run; move it to your Vault in Destiny 2 yourself.'} onClick={async () => {
                        // Signed in on their own device: move it in game first, and only drop it from the run if that worked.
                        if (inGame) {
                          setMoving(true)
                          const r = await moveInGame(p, [{ name: sel.name, instanceId: sel.instanceId, to: 'vault' }], toast)
                          setMoving(false)
                          if (!r || r.problems.length) return
                        }
                        dispatch({ type: 'vault', itemIds: [sel.id], why: 'player choice' }, p.id); setSelected(null)
                        if (!inGame) toast(`${sel.name} taken out of the run. Move it to your Vault in Destiny 2.`)
                      }}>{moving ? 'Moving\u2026' : 'To Vault'}</button>
                      <button className="chip chip-quiet" title="You dismantled it in Destiny 2: take it out of the run." onClick={() => setRemoving(true)}>Dismantled</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {(p.retired?.length ?? 0) > 0 && (
        <details className="retired">
          <summary>Left the run ({p.retired!.length})</summary>
          <ul>
            {p.retired!.map((r, k) => (
              <li key={`${r.id}-${k}`}>
                <span className={`retired-name ${rarityClass(r.rarity)}`}>{r.name}</span>
                <span className="muted small">{r.slot}</span>
                <span className={`fate fate-${r.fate}`}>{FATE_LABEL[r.fate]}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

/** Gear on the character that isn't in the run: shown in its slot, struck through in red. */
function OutsideTile({ u, icon, selected, onSelect, flash }: { u: { name: string; rarity?: Item['rarity']; equipped?: boolean; fate?: Fate }; icon?: string; selected: boolean; onSelect: () => void; flash: string }) {
  const [broken, setBroken] = useState(false)
  const label = `${u.name}: not in the run${u.equipped ? ', equipped' : ''}${u.fate ? `, ${FATE_LABEL[u.fate].toLowerCase()} earlier` : ''}`
  return (
    <button data-flash={flash} className={`tile item is-outside ${rarityClass(u.rarity ?? 'Legendary')} ${u.equipped ? 'is-eq' : ''} ${selected ? 'is-selected' : ''}`} title={label} aria-label={label} aria-pressed={selected} onClick={onSelect}>
      {icon && !broken ? <img src={icon} alt="" loading="lazy" onError={() => setBroken(true)} /> : <span className="tile-initial">{u.name.slice(0, 2)}</span>}
      <span className="tile-out" aria-hidden="true">!</span>
      {u.equipped && <span className="tile-eq" aria-hidden="true" />}
    </button>
  )
}

/** One item: its Bungie icon where known, otherwise a rarity-coloured initial. */
function Tile({ it, icon, over, selected, onSelect, flash }: { it: Item; icon?: string; over: boolean; selected: boolean; onSelect: () => void; flash?: string }) {
  const [broken, setBroken] = useState(false)
  return (
    <button
      data-flash={flash}
      className={`tile item ${rarityClass(it.rarity)} ${it.equipped ? 'is-eq' : ''} ${over ? 'is-over' : ''} ${selected ? 'is-selected' : ''}`}
      title={`${it.name} · ${it.rarity}${it.equipped ? ' · Equipped' : ''}`}
      aria-label={`${it.name}, ${it.rarity}${it.equipped ? ', equipped' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {icon && !broken ? <img src={icon} alt="" loading="lazy" onError={() => setBroken(true)} /> : <span className="tile-initial">{it.name.slice(0, 2)}</span>}
      <span className="item-name sr-only">{it.name}</span>
      {it.equipped && <span className="tile-eq" aria-hidden="true" />}
    </button>
  )
}

function Abilities({ p, showLocked, control }: { p: Player; showLocked: boolean; control: boolean }) {
  const { dispatch } = useGD()
  const icons = useIcons()
  const all = subclassAbilities(p.cls, p.element)
  const outOfOrder = equippedNotUnlocked(p).map(abilityById)
  return (
    <section className="g-sec" aria-label={`${p.name}: subclass`} data-flash={`abilities:${p.id}`}>
      <header className="g-sec-head">
        <span className="eyebrow">Subclass{p.bungie?.subclass ? ` · ${p.bungie.subclass.name}` : ''}</span>
        <span className="muted small">{p.unlocked.length}/{all.length} unlocked</span>
      </header>
      <div className="ab-kinds">
        {ABILITY_KINDS.map((k) => {
          const list = all.filter((a) => a.kind === k && (showLocked || p.unlocked.includes(a.id) || p.configured.includes(a.id)))
          return (
            <div key={k} className="ab-kind">
              <span className="ab-kind-name">{KIND_PLURAL[k]} <span className="muted">{all.filter((a) => a.kind === k && p.unlocked.includes(a.id)).length}/{all.filter((a) => a.kind === k).length}</span></span>
              <div className="ab-chips">
                {list.length === 0 && <span className="muted small">None yet</span>}
                {list.map((a) => {
                  const unlocked = p.unlocked.includes(a.id)
                  const conf = p.configured.includes(a.id)
                  const state = unlocked ? (conf ? 'Equipped' : 'Unlocked') : conf ? 'Out of order' : 'Locked'
                  const icon = icons.plug(a.name)
                  const body = <>{icon ? <img src={icon} alt="" loading="lazy" /> : null}<span>{a.name}</span></>
                  return control
                    ? <button key={a.id} data-flash={`ability:${p.id}:${a.id}`} className={`ab-chip ${unlocked ? 'is-unlocked' : 'is-locked'} ${conf ? 'is-conf' : ''} ${conf && !unlocked ? 'is-bad' : ''}`} title={`${a.name}: ${state}. Select to mark ${conf ? 'not ' : ''}equipped in game.${abilityDesc(a.id) ? `\n\n${abilityDesc(a.id)}` : ''}`} aria-pressed={conf} onClick={() => dispatch({ type: 'configure', abilityId: a.id }, p.id)}>{body}</button>
                    : <span key={a.id} data-flash={`ability:${p.id}:${a.id}`} className={`ab-chip ${unlocked ? 'is-unlocked' : 'is-locked'} ${conf ? 'is-conf' : ''} ${conf && !unlocked ? 'is-bad' : ''}`} title={`${a.name}: ${state}${abilityDesc(a.id) ? `\n\n${abilityDesc(a.id)}` : ''}`}>{body}</span>
                })}
              </div>
            </div>
          )
        })}
      </div>
      {outOfOrder.length > 0 && <p className="small tone-danger">Equipped but not unlocked: {outOfOrder.map((a) => a.name).join(', ')}</p>}
    </section>
  )
}

function ArtifactPerks({ p, control }: { p: Player; control: boolean }) {
  const { dispatch } = useGD()
  const icons = useIcons()
  const art = artifactByName(p.artifactName)
  return (
    <section className="g-sec" aria-label={`${p.name}: artifact`} data-flash={`artifact:${p.id}`}>
      <header className="g-sec-head">
        <span className="eyebrow">Artifact</span>
        <span className="muted small">{p.artifact.length}/21 researched</span>
      </header>
      <p className="art-name">{p.artifactName && icons.artifact(p.artifactName) && <img className="art-icon" src={icons.artifact(p.artifactName)} alt="" loading="lazy" />}{p.artifactName ? <><strong>{p.artifactName}</strong>{art?.season && <span className="muted small"> &middot; {art.season}</span>}</> : <span className="tone-warn small">No artifact chosen</span>}</p>
      {art?.focus && <p className="small muted">{art.focus}</p>}
      {p.artifact.length === 0 ? <Empty>No perks researched</Empty> : (
        <ul className="mod-list">
          {p.artifact.map((m) => {
            const perk = artifactPerk(p.artifactName, m)
            const icon = icons.artifactPerk(p.artifactName, m)
            return (
              <li key={m} title={perk?.desc}>
                {icon ? <img className="mod-icon" src={icon} alt="" loading="lazy" /> : <span className="mod-hex" aria-hidden="true" />}
                <span>{m}{perk && <span className="muted small"> &middot; Tier {perk.tier}</span>}</span>
                {control && <button className="icon-btn sm" aria-label={`Remove ${m}`} onClick={() => dispatch({ type: 'artifact-remove', mod: m }, p.id)}>×</button>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** Each Guardian's death count, with Record death (host: any Guardian; players: their own) and the host's undo. */
function DeathRow({ run, p, isHost, mine, record, undo }: { run: Run; p: Player; isHost: boolean; mine: boolean; record: () => void; undo: () => void }) {
  const cost = run.ruleset.integrity.death ?? 0
  const deaths = p.deaths ?? 0
  const active = run.status === 'active'
  return (
    <div className="death-row">
      <span className={`death-count ${deaths ? 'has-deaths' : ''}`} title={`${deaths} death${deaths === 1 ? '' : 's'} recorded for ${p.name} this run`}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1.5C4.4 1.5 2 3.9 2 7c0 1.9.9 3.3 2.2 4.1V13.5h1.6v-1.3h1.4v1.3h1.6v-1.3h1.4v1.3h1.6v-2.4C13.1 10.3 14 8.9 14 7c0-3.1-2.4-5.5-6-5.5zM5.6 9.3a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8zm4.8 0a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8z" fill="currentColor" /></svg>
        Deaths <strong className="mono">{deaths}</strong>
      </span>
      {active && (isHost || mine) && (
        <button className="btn btn-danger btn-sm" onClick={record}>{mine ? 'Record my death' : 'Record death'}{cost > 0 && <small> &minus;{cost}</small>}</button>
      )}
      {isHost && deaths > 0 && <button className="link" onClick={undo}>Undo last</button>}
    </div>
  )
}
