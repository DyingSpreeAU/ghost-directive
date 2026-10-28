import { useEffect, useState, type ReactNode } from 'react'
import { ALL_SLOTS, KIND_LABEL, RARITIES, WEAPON_SLOTS, abilityById, abilityDesc, artifactPerk, dungeonById, type Rarity, type Slot, type VaultEntry } from './data'
import {
  capacityOf, changeIntegrity, current, itemsIn, log, recordClear,
  type ChestReward, type NewItem, type Pending, type Player, type Run,
} from './model'
import { useGD, type Flow } from './store'
import { ElementMark, Modal, rarityClass } from './ui'
import { useIcons } from './icons'
import { canMoveInGame, moveInGame } from './gearMoves'
import { bungieConfigured, isSignedIn } from './bungie'
import { ItemCard, bestStats, useItemPreviews } from './ItemPreview'

export function FlowHost({ flow, run, onClose }: { flow: Flow; run: Run; onClose: () => void }) {
  switch (flow.type) {
    case 'clear': return <ClearFlow run={run} onClose={onClose} />
    case 'wipe': return <WipeFlow run={run} onClose={onClose} />
    case 'reward': {
      const pend = run.pending.find((x) => x.id === flow.pendingId)
      return pend ? <RewardFlow run={run} pend={pend} onClose={onClose} /> : null
    }
    case 'register': return <RegisterFlow run={run} onClose={onClose} playerId={flow.playerId} slot={flow.slot} />
    case 'tradeup': return <TradeUpFlow run={run} onClose={onClose} playerId={flow.playerId} slot={flow.slot} />
    case 'swap': return <SwapFlow run={run} onClose={onClose} playerId={flow.playerId} slot={flow.slot} />
    case 'abandon': return <AbandonFlow onClose={onClose} />
  }
}

const SOURCES = ['encounter drop', 'secret chest', 'world drop', 'final-boss reward', 'starting gear']

/** Arsenal Expansion: an extra slot added to a row of slots. */
function ExpansionGlyph() {
  return (
    <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="14" width="9" height="12" /><rect x="15" y="14" width="9" height="12" />
        <rect x="27" y="14" width="9" height="12" strokeDasharray="3 2" />
      </g>
      <path d="M31.5 17v6M28.5 20h6" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function ChoiceGrid({ children, five }: { children: ReactNode; five?: boolean }) {
  return <div className={`choices ${five ? 'five' : ''}`}>{children}</div>
}

// ------------------------------------------------------------------ Host: record clear

function ClearFlow({ run, onClose }: { run: Run; onClose: () => void }) {
  const { host, toast, online } = useGD()
  const { dungeon, encounter } = current(run)
  const rr = run.ruleset
  const after = Math.min(rr.integrity.max, run.integrity + rr.integrity.clear)
  const dup = run.claimed.includes(encounter.id)
  const final = encounter.type === 'final'
  const commit = () => {
    host!.updateRun((r) => recordClear(r))
    toast(`${encounter.name} cleared. Reward screens sent.`)
    onClose()
  }
  return (
    <Modal kicker={`${dungeon.name} · ${encounter.name}`} title="Record clear" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-light" onClick={commit}>Record clear and advance</button>
      </>}
    >
      <div className="stack">
        {dup && <div className="warn warn-critical static"><span className="warn-sev">Duplicate</span><span className="warn-title">This encounter&rsquo;s reward was already claimed this run.</span><span className="warn-rule">Standard mode allows one completion reward per encounter. Continue only if the earlier record was a mistake.</span></div>}
        <div className="delta-row">
          <div><div className="eyebrow">Integrity</div><span className="big mono">{run.integrity} &rarr; {after}</span>{after - run.integrity < rr.integrity.clear && <span className="muted small"> capped at {rr.integrity.max}</span>}</div>
          <div><div className="eyebrow">Each Guardian gets</div><span>1 of {rr.rewards.unlockChoices} unlocks{final && rr.rewards.finalBossGear ? ', a final-boss item' : ''}{final && rr.rewards.finalBossArtifact ? ', Artifact research' : ''}, and their own drops</span></div>
        </div>
        <p>Every player gets their own reward screen on their own device. The run moves on to the next encounter right away; rewards can be chosen while you play.</p>
        <ul className="summary">
          {run.players.map((p) => (
            <li key={p.id}>
              <ElementMark element={p.element} /> <b>{p.name}</b>
              <span className="muted small">{p.clientId === null ? 'no device linked: you can resolve it from their panel' : online.includes(p.clientId) ? 'reward screen opens on their device' : 'offline: it will wait for them'}</span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ Player: resolve a reward

type Step = 'unlock' | 'gear' | 'artifact' | 'chest' | 'drops'

function RewardFlow({ run, pend, onClose }: { run: Run; pend: Pending; onClose: () => void }) {
  const { dispatch, toast, me } = useGD()
  const p = run.players.find((x) => x.id === pend.playerId)!
  const gearAvail = pend.exotic.length + pend.legendary.length > 0
  const steps: Step[] = [
    ...(pend.unlock.length ? ['unlock' as const] : []),
    ...(gearAvail ? ['gear' as const] : []),
    ...(pend.artifact.length ? ['artifact' as const] : []),
    ...(pend.chest.length ? ['chest' as const] : []),
    // Signed-in players' drops are detected from Bungie, so they skip typing them in.
    ...(p.bungie ? [] : ['drops' as const]),
  ]
  const [i, setI] = useState(0)
  const [unlock, setUnlock] = useState<string | undefined>()
  const [cat, setCat] = useState<'exotic' | 'legendary' | null>(null)
  const [gear, setGear] = useState<VaultEntry | null>(null)
  const [mod, setMod] = useState<string | undefined>()
  const [chest, setChest] = useState<number | undefined>()
  const [drops, setDrops] = useState<NewItem[]>([])
  const step = steps[i]
  const canNext = step === 'unlock' ? !!unlock : step === 'gear' ? !!gear || (!!cat && pend[cat].length === 0) : step === 'artifact' ? !!mod : step === 'chest' ? chest !== undefined : true
  const forSomeoneElse = p.clientId !== me
  const icons = useIcons()
  // Vault weapons: the player's own copies, read from Bungie on their device, with a DIM-style card.
  // Reward items: the player's own copies (or Bungie's definition for Exotics not owned), with DIM-style cards.
  const previews = useItemPreviews(cat ? pend[cat].map((g) => g.name) : [], !!cat && !forSomeoneElse && !!p.bungie, p.cls)
  const [compare, setCompare] = useState(false)
  const comparing = compare && step === 'gear' && cat === 'exotic' && !!previews.data
  // Expanded info needs the player's own Bungie account on this device.
  const previewable = !!cat && !forSomeoneElse && !!p.bungie && bungieConfigured && isSignedIn()
  // Players commit to their choice; "Later" is a protocol option (off by default). The host resolving
  // for a Guardian with no device can always close it.
  const canLater = !!run.ruleset.rewards.allowLater || forSomeoneElse

  const submit = () => {
    dispatch({ type: 'resolve', pendingId: pend.id, unlock, gear: gear?.name, mod, chest, drops }, p.id)
    toast('Rewards recorded')
    onClose()
    // A Vault weapon or an owned Exotic comes to the run character in Destiny 2 (signed-in player's own device).
    // An Exotic they don't hold yet has to be pulled from Collections in game; the next sync links that copy.
    if (gear && notHeld(p, gear)) toast(`Pull ${gear.name} from Collections in Destiny 2. The app links that copy to this reward on its next sync.`)
    else if (gear && canMoveInGame(p, me)) moveInGame(p, [{ name: gear.name, to: 'character' }], toast)
  }
  const chestLabel = (c: ChestReward) => c.kind === 'artifact' ? c.mod : c.kind === 'expansion' ? 'Arsenal Expansion' : 'Loadout Archive'

  // Nothing to choose (all abilities unlocked, drops tracked by Bungie): claim it straight away.
  useEffect(() => { if (steps.length === 0) submit() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!step) return null
  const last = i === steps.length - 1

  const n = (xs: unknown[]) => xs.length
  const title = {
    unlock: `Choose 1 of ${n(pend.unlock)} abilities`,
    gear: cat ? `Choose 1 of ${n(pend[cat])} ${cat === 'exotic' ? 'Exotic armor pieces' : 'Vault weapons'}` : 'Final-boss reward: pick a category',
    artifact: `Research 1 of ${n(pend.artifact)} artifact perks`,
    chest: `Choose 1 of ${n(pend.chest)} chest rewards`,
    drops: 'Register your drops',
  }[step]
  return (
    <Modal
      kicker={`${forSomeoneElse ? `For ${p.name} · ` : ''}${pend.where} · step ${i + 1} of ${steps.length}`}
      title={title}
      onClose={canLater ? onClose : undefined}
      wide
      xwide={comparing}
      footer={<>
        {i === 0 ? (canLater ? <button className="btn btn-ghost" onClick={onClose}>{forSomeoneElse ? 'Close' : 'Later'}</button> : null) : <button className="btn btn-ghost" onClick={() => setI(i - 1)}>Back</button>}
        {last
          ? <button className="btn btn-light" disabled={!canNext} onClick={submit}>{step === 'drops' && drops.length === 0 ? 'No drops, claim rewards' : 'Claim rewards'}</button>
          : <button className="btn btn-light" disabled={!canNext} onClick={() => setI(i + 1)}>{step === 'drops' && drops.length === 0 ? 'No drops, continue' : 'Continue'}</button>}
      </>}
    >
      {step === 'unlock' && (
        <div className="stack">
          <p>You keep <strong>one</strong> of these {pend.unlock.length}. The {p.element} ability you pick stays unlocked for the rest of the run; the others are not kept. Equipping it in Destiny 2 is up to you.</p>
          <ChoiceGrid>
            {pend.unlock.map((id) => {
              const a = abilityById(id)
              return (
                <button key={id} className={`choice el-${a.element.toLowerCase()} ${icons.plug(a.name) ? 'choice-item' : ''} ${unlock === id ? 'is-on' : ''}`} onClick={() => setUnlock(id)}>
                  {icons.plug(a.name) && <img className="choice-icon" src={icons.plug(a.name)} alt="" loading="lazy" />}
                  <span className="choice-kind"><ElementMark element={a.element} /> {a.element} {KIND_LABEL[a.kind]}</span>
                  <strong>{a.name}</strong>
                  {abilityDesc(id) && <span className="choice-desc">{abilityDesc(id)}</span>}
                </button>
              )
            })}
          </ChoiceGrid>
        </div>
      )}

      {step === 'gear' && (!cat ? (
        <div className="stack">
          <p>First pick a category; you can&rsquo;t change it afterwards. Then you choose <strong>1 of 3</strong> items from it, and you keep only the one you choose.</p>
          <ChoiceGrid>
            <button className="choice" disabled={!pend.exotic.length} onClick={() => setCat('exotic')}>
              <span className="choice-kind r-exotic-text">Exotic armor</span>
              <strong>1 of 3 {p.cls} Exotics</strong>
              <span className="muted">{p.element} synergy favored where available.</span>
              {run.ruleset.rewards.revealCategories && <span className="choice-thumbs">{pend.exotic.map((g) => icons.gear(g.name) && <img key={g.name} src={icons.gear(g.name)} alt="" title={g.name} />)}</span>}
            </button>
            <button className="choice" disabled={!pend.legendary.length} onClick={() => setCat('legendary')}>
              <span className="choice-kind r-legendary-text">Vault Legendary weapon</span>
              <strong>1 of 3 weapons from your Vault</strong>
              <span className="muted">{p.vault.length ? 'From your Vault pool.' : 'From the example Vault pool.'}</span>
              {run.ruleset.rewards.revealCategories && <span className="choice-thumbs">{pend.legendary.map((g) => icons.gear(g.name) && <img key={g.name} src={icons.gear(g.name)} alt="" title={g.name} />)}</span>}
            </button>
          </ChoiceGrid>
        </div>
      ) : (
        <div className="stack">
          <p>{pend[cat].length === 1 ? <>This is the only eligible {cat === 'exotic' ? 'Exotic' : 'weapon'}.</> : <>You keep <strong>one</strong> of these {pend[cat].length}{cat === 'exotic' ? ' Exotics' : ' weapons'}.</>} {cat === 'exotic' && p.bungie?.exotics ? 'Each is unlocked in your Collections, so you can pull any of them in Destiny 2.' : 'Pick it, then move it from your Vault (or Collections) in Destiny 2.'}</p>
          <GearPicker run={run} p={p} options={pend[cat]} chosen={gear} onChoose={setGear} previews={previews} previewable={previewable} compare={compare} setCompare={setCompare} />
          {pend[cat].length === 0 && <p>No eligible items in this pool.</p>}
        </div>
      ))}

      {step === 'artifact' && (
        <div className="stack">
        <p>You research <strong>one</strong> of these {pend.artifact.length} {p.artifactName ?? 'artifact'} perks; the others are not kept. Switch it on in Destiny 2 once it&rsquo;s researched.</p>
        <ChoiceGrid>
          {pend.artifact.map((m) => (
            <button key={m} className={`choice choice-artifact ${icons.plug(m) ? 'choice-item' : ''} ${mod === m ? 'is-on' : ''}`} onClick={() => setMod(m)}>
              {icons.plug(m) && <img className="choice-icon" src={icons.plug(m)} alt="" loading="lazy" />}
              <span className="choice-kind">{p.artifactName} &middot; Tier {artifactPerk(p.artifactName, m)?.tier ?? '?'}</span>
              <strong>{m}</strong>
              {artifactPerk(p.artifactName, m)?.desc && <span className="choice-desc">{artifactPerk(p.artifactName, m)!.desc}</span>}
            </button>
          ))}
        </ChoiceGrid>
        </div>
      )}

      {step === 'chest' && (
        <div className="stack">
        <p>You keep <strong>one</strong> of these {pend.chest.length} rewards; the others are not kept.</p>
        <ChoiceGrid>
          {pend.chest.map((c, k) => (
            <button key={chestLabel(c)} className={`choice choice-item ${chest === k ? 'is-on' : ''} ${c.kind !== 'artifact' ? 'choice-upgrade' : 'choice-artifact'}`} onClick={() => setChest(k)}>
              {c.kind === 'artifact' ? (icons.plug(c.mod) ? <img className="choice-icon" src={icons.plug(c.mod)} alt="" loading="lazy" /> : <span className="choice-icon choice-glyph" aria-hidden="true"><span className="mod-hex" /></span>)
                : <span className="choice-icon choice-glyph" aria-hidden="true"><ExpansionGlyph /></span>}
              <span className="choice-kind">{c.kind === 'artifact' ? `${p.artifactName} \u00b7 Tier ${artifactPerk(p.artifactName, c.mod)?.tier ?? '?'}` : 'Upgrade'}</span>
              <strong>{chestLabel(c)}</strong>
              {c.kind === 'artifact' && artifactPerk(p.artifactName, c.mod)?.desc && <span className="choice-desc">{artifactPerk(p.artifactName, c.mod)!.desc}</span>}
              {c.kind === 'expansion' && <span className="muted">+1 capacity in every slot</span>}
              {c.kind === 'archive' && <span className="muted">+1 saved loadout. Rare.</span>}
            </button>
          ))}
        </ChoiceGrid>
        </div>
      )}

      {step === 'drops' && <DropsEditor run={run} playerId={p.id} drops={drops} setDrops={setDrops} source={pend.kind === 'chest' ? 'secret chest' : 'encounter drop'} />}

    </Modal>
  )
}

/** An Exotic that's unlocked in Collections but not on the account yet: it has to be pulled in game. */
const notHeld = (p: Player, g: VaultEntry) => g.rarity === 'Exotic' && !!p.bungie?.exotics && !p.bungie.exotics.held.includes(g.name)

/**
 * Item choices with real icons, and details read from the player's own account. Weapons show the
 * selected one's card underneath; armor offers every option side by side on request.
 */
function GearPicker({ run, p, options, chosen, onChoose, previews, previewable, compare, setCompare, five, tradeUp }: {
  run: Run; p: Player; options: VaultEntry[]; chosen: VaultEntry | null; onChoose: (g: VaultEntry) => void
  previews: ReturnType<typeof useItemPreviews>; previewable: boolean; compare: boolean; setCompare: (on: boolean) => void
  five?: boolean; tradeUp?: boolean
}) {
  const icons = useIcons()
  const weapons = options.length > 0 && options.every((g) => WEAPON_SLOTS.includes(g.slot))
  const data = previews.data
  const compared = data ? options.filter((g) => data[g.name]) : []
  const selected = chosen && data?.[chosen.name]
  return (
    <>
      <ChoiceGrid five={five}>
        {options.map((g) => {
          const icon = icons.gear(g.name) ?? data?.[g.name]?.icon
          const info = data?.[g.name]
          const pull = notHeld(p, g)
          return (
            <button key={g.name} className={`choice choice-item ${rarityClass(g.rarity)} ${chosen?.name === g.name ? 'is-on' : ''}`} aria-pressed={chosen?.name === g.name} onClick={() => onChoose(g)}>
              {icon && <img className="choice-icon" src={icon} alt="" loading="lazy" />}
              <span className="choice-kind">{g.rarity} {info?.type ?? g.slot}</span>
              <strong>{g.name}</strong>
              <span className="muted">
                {g.element && <><ElementMark element={g.element} /> {g.element}</>}
                {info?.power ? `${g.element ? ' · ' : ''}${info.power} Power` : ''}
                {g.element === p.element ? ' · synergy' : ''}
                {!g.element && !info?.power && g.archetype}
              </span>
              {g.note && <span className="choice-desc">{g.note}</span>}
              {pull && <span className="choice-tag">In Collections · not on your account</span>}
              {!tradeUp && itemsIn(p, g.slot).length >= capacityOf(run, p) && <span className="tone-warn small">{g.slot} is full; a swap will follow</span>}
            </button>
          )
        })}
      </ChoiceGrid>
      {chosen && notHeld(p, chosen) && (
        <div className="callout">
          <strong>Pull {chosen.name} from Collections.</strong> You don&rsquo;t have a copy on your account yet. After you claim this reward, open Collections in Destiny 2 (Armor &rarr; Exotic) and pull it to your {p.cls}. The app links that copy to this reward on its next sync.
        </div>
      )}
      {previewable && previews.loading && <p className="small muted">Reading these items from your account&hellip;</p>}
      {previewable && previews.error && <p className="small tone-warn">Couldn&rsquo;t read your account for details: {previews.error}</p>}
      {weapons ? (
        // Weapons: only the selected one, full size.
        selected ? <div className="gear-preview"><ItemCard item={selected} /></div>
          : previewable && data ? <p className="small muted">Select a weapon to see its stats, perks and mods.</p> : null
      ) : previewable && (
        <>
          <div className="compare-bar">
            <button className="btn btn-ghost btn-sm" aria-expanded={compare} onClick={() => setCompare(!compare)}>{compare ? 'Hide expanded info' : 'Show expanded info'}</button>
            <span className="small muted">{compare ? 'All of them side by side; the best value for each stat is highlighted. Select a card to choose it.' : 'Stats, perks and mods for each, side by side.'}</span>
          </div>
          {compare && compared.length > 0 && (
            <div className={`compare-grid n-${Math.min(compared.length, 3)}`}>
              {compared.map((g) => (
                <button key={g.name} className={`compare-pick ${chosen?.name === g.name ? 'is-on' : ''}`} aria-pressed={chosen?.name === g.name} onClick={() => onChoose(g)}>
                  <ItemCard item={data![g.name]} compact best={compared.length > 1 ? bestStats(compared.map((x) => data![x.name])) : undefined} />
                  <span className="compare-choose">{chosen?.name === g.name ? 'Chosen' : `Choose ${g.name}`}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}

function DropsEditor({ run, playerId, drops, setDrops, source }: { run: Run; playerId: string; drops: NewItem[]; setDrops: (d: NewItem[]) => void; source: string }) {
  const p = run.players.find((x) => x.id === playerId)!
  const [name, setName] = useState('')
  const [slot, setSlot] = useState<Slot>('Kinetic')
  const [rarity, setRarity] = useState<Rarity>('Legendary')
  const add = () => {
    if (!name.trim()) return
    setDrops([...drops, { name: name.trim(), slot, rarity, source }])
    setName('')
  }
  return (
    <div className="drops">
      <p className="section-note">Register only weapons and armor that dropped for you during this run. Items already in your Vault or inventory don&rsquo;t count.</p>
      <div className="inline-form wrap">
        <input id="drop-name" placeholder="Item name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <select id="drop-slot" value={slot} onChange={(e) => setSlot(e.target.value as Slot)} aria-label="Slot">
          {ALL_SLOTS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select id="drop-rarity" value={rarity} onChange={(e) => setRarity(e.target.value as Rarity)} aria-label="Rarity">
          {RARITIES.map((r) => <option key={r}>{r}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={add}>Add drop</button>
      </div>
      {drops.length > 0 && (
        <ul className="drop-list">
          {drops.map((d, i) => {
            const after = itemsIn(p, d.slot).length + drops.filter((x) => x.slot === d.slot).length
            return (
              <li key={i} className={`item ${rarityClass(d.rarity)}`}>
                <div className="item-main">
                  <span className="item-name">{d.name}</span>
                  <span className="item-meta">{d.rarity} {d.slot}{after > capacityOf(run, p) ? ' · will exceed capacity' : ''}</span>
                </div>
                <button className="chip" onClick={() => setDrops(drops.filter((_, j) => j !== i))}>Remove</button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ Host: wipe

function WipeFlow({ run, onClose }: { run: Run; onClose: () => void }) {
  const { host, toast } = useGD()
  const { encounter } = current(run)
  const cost = run.ruleset.integrity.wipe
  const after = Math.max(0, run.integrity - cost)
  return (
    <Modal kicker={encounter.name} title="Record team wipe" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-danger" onClick={() => { host!.updateRun((r) => changeIntegrity(r, -cost, 'Team wipe recorded.', 'wipe')); toast(after === 0 ? 'Run failed' : `Wipe recorded, ${after} Integrity left`); onClose() }}>
          Apply &minus;{cost} Integrity
        </button>
      </>}
    >
      <div className="stack">
        <div className="delta-row">
          <div><div className="eyebrow">Fireteam Integrity</div><span className="big mono">{run.integrity} &rarr; <span className={after === 0 ? 'tone-danger' : ''}>{after}</span></span></div>
        </div>
        {after === 0
          ? <p className="tone-danger">This wipe drops Integrity to zero and ends the run.</p>
          : <p>The fireteam stays on {encounter.name}. Clears restore {run.ruleset.integrity.clear} each.</p>}
        <p className="small muted">A wipe is every Guardian dead at the same time, anywhere in the run, traversal included. Record it once; don&rsquo;t also record each death.</p>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ Player: register drop

function RegisterFlow({ run, onClose, playerId, slot }: { run: Run; onClose: () => void; playerId: string; slot?: Slot }) {
  const { dispatch, toast } = useGD()
  const [name, setName] = useState('')
  const [s, setS] = useState<Slot>(slot ?? 'Kinetic')
  const [rarity, setRarity] = useState<Rarity>('Legendary')
  const [source, setSource] = useState(SOURCES[0])
  const p = run.players.find((x) => x.id === playerId)!
  const n = itemsIn(p, s).length
  const cap = capacityOf(run, p)
  const exoticClass = rarity === 'Exotic' && s === 'Class Item'
  const submit = () => {
    if (!name.trim() || exoticClass) return
    dispatch({ type: 'register', item: { name: name.trim(), slot: s, rarity, source } }, playerId)
    toast(`${name.trim()} registered`)
    onClose()
  }
  return (
    <Modal title="Register drop" kicker={`Field Arsenal · ${p.name}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-light" disabled={!name.trim() || exoticClass} onClick={submit}>Register</button>
      </>}
    >
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <label htmlFor="reg-name">Item name</label>
        <input id="reg-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fatebringer" />
        <label htmlFor="reg-slot">Slot</label>
        <select id="reg-slot" value={s} onChange={(e) => setS(e.target.value as Slot)}>
          {ALL_SLOTS.map((x) => <option key={x}>{x}</option>)}
        </select>
        <label htmlFor="reg-rarity">Rarity</label>
        <select id="reg-rarity" value={rarity} onChange={(e) => setRarity(e.target.value as Rarity)}>
          {RARITIES.map((x) => <option key={x}>{x}</option>)}
        </select>
        <label htmlFor="reg-source">Source</label>
        <select id="reg-source" value={source} onChange={(e) => setSource(e.target.value)}>
          {SOURCES.map((x) => <option key={x}>{x}</option>)}
        </select>
      </form>
      {exoticClass && <p className="small tone-danger">Exotic class items aren&rsquo;t part of runs yet.</p>}
      <p className={`small ${n >= cap ? 'tone-warn' : 'muted'}`}>
        Your {s} slot holds {n} of {cap}.{n >= cap && (run.ruleset.overflow === 'guided' ? ' You will choose an item to move to the Vault.' : ' This will show an over-capacity warning.')}
      </p>
    </Modal>
  )
}

// ------------------------------------------------------------------ Player: swap (overflow)

function SwapFlow({ run, onClose, playerId, slot }: { run: Run; onClose: () => void; playerId: string; slot: Slot }) {
  const { dispatch, toast, me, openFlow } = useGD()
  const [moving, setMoving] = useState<string | null>(null)
  const [stage, setStage] = useState<'choose' | 'remove'>('choose')
  const p = run.players.find((x) => x.id === playerId)!
  const items = itemsIn(p, slot)
  const cap = capacityOf(run, p)
  const excess = items.length - cap
  const tu = run.ruleset.tradeUp
  const tradeable = items.filter((i) => i.rarity !== 'Exotic')
  const canTrade = p.clientId === me && !p.trade && tu.enabled && (tu.sameRarity ? RARITIES.some((r) => tradeable.filter((i) => i.rarity === r).length >= tu.inputs) : tradeable.length >= tu.inputs)
  const inGame = canMoveInGame(p, me)
  if (excess <= 0) return null
  const toVault = async (it: (typeof items)[number]) => {
    if (inGame) {
      setMoving(it.id)
      const r = await moveInGame(p, [{ name: it.name, instanceId: it.instanceId, to: 'vault' }], toast)
      setMoving(null)
      if (!r || r.problems.length) return
    }
    dispatch({ type: 'vault', itemIds: [it.id], why: 'over capacity' }, playerId)
  }
  return (
    <Modal kicker={`${p.name} · ${slot}`} title={`${slot} is over capacity: ${items.length} of ${cap}`} onClose={onClose}
      footer={stage === 'choose'
        ? <button className="btn btn-ghost" onClick={() => { toast('Kept over capacity; the warning stays visible'); onClose() }}>Decide later</button>
        : <><button className="btn btn-ghost" onClick={() => setStage('choose')}>Back</button><span className="small muted">{excess} more to go</span></>}
    >
      {stage === 'choose' ? (
        <div className="stack">
          <p>Your {slot} slot holds {cap} item{cap === 1 ? '' : 's'}, and you now have {items.length}. Make room in one of two ways:</p>
          <ChoiceGrid>
            <button className="choice" disabled={!canTrade} onClick={() => openFlow({ type: 'tradeup', playerId, slot })}>
              <span className="choice-kind">Trade up</span>
              <strong>Trade {tu.inputs} for 1 Legendary</strong>
              <span className="muted">{canTrade ? `Give up ${tu.inputs} ${slot} items${tu.sameRarity ? ' of the same rarity' : ''} and pick a Legendary from your Vault.` : !tu.enabled ? 'Trade-ups are off in this protocol.' : p.clientId !== me ? 'Only this Guardian\u2019s player can trade up.' : `Needs ${tu.inputs} non-Exotic ${slot} items${tu.sameRarity ? ' of the same rarity' : ''}.`}</span>
            </button>
            <button className="choice" onClick={() => setStage('remove')}>
              <span className="choice-kind">Remove items</span>
              <strong>Dismantle or vault {excess === 1 ? 'one item' : `${excess} items`}</strong>
              <span className="muted">Take {excess === 1 ? 'it' : 'them'} out of your run inventory.</span>
            </button>
          </ChoiceGrid>
        </div>
      ) : (
        <div className="stack">
          <p>For each item you let go: in Destiny 2, <strong>dismantle it</strong>, or <strong>move it to your Vault</strong> if you want to keep it for normal play. Then mark it here to take it out of the run. Remove {excess} to get back to {cap}.</p>
          <ul className="pick-list">
            {items.map((it) => (
              <li key={it.id}>
                <div className={`item ${rarityClass(it.rarity)}`}>
                  <div className="item-main">
                    <span className="item-name">{it.name}{it.equipped && <span className="tag">Equipped</span>}</span>
                    <span className="item-meta">{it.rarity} &middot; {it.source}</span>
                  </div>
                  <div className="item-acts row">
                    <button className="chip" disabled={!!moving} title={inGame ? 'Send it to your Vault in Destiny 2 and take it out of the run.' : 'You moved it to your Vault in Destiny 2: take it out of the run.'} onClick={() => toVault(it)}>{moving === it.id ? 'Moving\u2026' : inGame ? 'Send to Vault' : 'Vaulted'}</button>
                    <button className="chip chip-danger" disabled={!!moving} title="You dismantled it in Destiny 2: take it out of the run." onClick={() => { dispatch({ type: 'remove-item', itemId: it.id, dismantled: true }, playerId); toast(`${it.name} dismantled`) }}>Dismantled</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------ Player: trade-up

function TradeUpFlow({ run, onClose, playerId, slot: asked }: { run: Run; onClose: () => void; playerId: string; slot: Slot }) {
  const { dispatch, toast, me } = useGD()
  const [moving, setMoving] = useState(false)
  const tu = run.ruleset.tradeUp
  const p = run.players.find((x) => x.id === playerId)!
  // Once the inputs are traded in, the options are fixed on the run until one is picked.
  const trade = p.trade
  const slot = trade?.slot ?? asked
  const items = itemsIn(p, slot).filter((i) => i.rarity !== 'Exotic')
  const [sel, setSel] = useState<string[]>([])
  const [starting, setStarting] = useState(false)
  const [choice, setChoice] = useState<VaultEntry | null>(null)
  const options = trade?.options ?? []
  const selRarity = sel.length ? items.find((i) => i.id === sel[0])?.rarity : null
  const canPick = (id: string) => {
    if (sel.includes(id)) return true
    if (sel.length >= tu.inputs) return false
    return !tu.sameRarity || !selRarity || items.find((i) => i.id === id)!.rarity === selRarity
  }
  const inGame = canMoveInGame(p, me)
  const previews = useItemPreviews(trade ? options.map((o) => o.name) : [], !!trade && inGame, p.cls)
  const previewable = inGame && bungieConfigured && isSignedIn()
  const [compare, setCompare] = useState(false)
  // If the host refused the trade-in (shown as a toast), let the player try again.
  useEffect(() => {
    if (!starting || trade) return
    const t = setTimeout(() => setStarting(false), 6000)
    return () => clearTimeout(t)
  }, [starting, trade])
  // A player trades up for themselves only.
  if (p.clientId !== me) return null
  const start = async () => {
    // Signed in on their own device: the inputs go to the Vault in game first.
    if (inGame) {
      setMoving(true)
      const r = await moveInGame(p, items.filter((i) => sel.includes(i.id)).map((i) => ({ name: i.name, instanceId: i.instanceId, to: 'vault' as const })), toast)
      setMoving(false)
      if (!r) return
    }
    setStarting(true)
    dispatch({ type: 'tradeup-start', inputIds: sel }, playerId)
  }
  const commit = async () => {
    if (!choice) return
    if (inGame) {
      setMoving(true)
      const r = await moveInGame(p, [{ name: choice.name, to: 'character' }], toast)
      setMoving(false)
      if (!r) return
    } else toast(`Traded up for ${choice.name}. Move it to your character in Destiny 2.`)
    dispatch({ type: 'tradeup', choice }, playerId)
    onClose()
  }
  const kind = slot === 'Class Item' ? 'class items' : WEAPON_SLOTS.includes(slot) ? 'weapons' : `${slot.toLowerCase()} pieces`
  return (
    <Modal kicker={`${p.name} · ${slot}`} title={trade ? `Choose 1 of ${options.length} Legendary ${kind}` : `Trade up: select ${tu.inputs} items`}
      onClose={trade || starting ? undefined : onClose} wide
      xwide={compare && !WEAPON_SLOTS.includes(slot) && !!previews.data}
      footer={trade ? (
        <button className="btn btn-light" disabled={!choice || moving} onClick={commit}>{moving ? 'Moving in Destiny 2\u2026' : inGame ? `Take ${choice?.name ?? 'your choice'}` : `Register ${choice?.name ?? 'choice'}`}</button>
      ) : <>
        <button className="btn btn-ghost" disabled={starting || moving} onClick={onClose}>Cancel</button>
        <button className="btn btn-light" disabled={sel.length !== tu.inputs || starting || moving} onClick={start}>{moving ? 'Moving in Destiny 2\u2026' : starting ? 'Trading in\u2026' : inGame ? 'Trade these in' : 'I moved these to the Vault'}</button>
      </>}
    >
      {!trade ? (
        <div className="stack">
          <p>Pick {tu.inputs} {slot} items{tu.sameRarity ? ' of the same rarity' : ''}. {inGame ? 'They go to your Vault in Destiny 2 when you confirm.' : 'Move them to your Vault in Destiny 2 first.'} Then you choose <strong>1 of {tu.options}</strong> Legendary {slot} options from your Vault.</p>
          <p className="callout"><strong>No take-backs.</strong> Once you trade these in, they leave the run and the options are fixed: you can&rsquo;t go back, re-roll or cancel, only pick one.</p>
          <ul className="pick-list">
            {items.map((it) => (
              <li key={it.id}>
                <label className={`item ${rarityClass(it.rarity)} ${sel.includes(it.id) ? 'is-picked' : ''} ${canPick(it.id) ? '' : 'is-disabled'}`}>
                  <input type="checkbox" disabled={!canPick(it.id) || starting} checked={sel.includes(it.id)} onChange={() => setSel(sel.includes(it.id) ? sel.filter((x) => x !== it.id) : [...sel, it.id])} />
                  <div className="item-main">
                    <span className="item-name">{it.name}</span>
                    <span className="item-meta">{it.rarity} &middot; {it.source}</span>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="stack">
          <p>You traded in {trade.inputs.join(', ')}. {options.length === 1 ? 'This is the only eligible one in your Vault; take it to finish.' : <>Keep <strong>one</strong> of these {options.length}; the others stay in your Vault. You have to pick one to finish.</>}</p>
          <GearPicker run={run} p={p} options={options} chosen={choice} onChoose={setChoice} previews={previews} previewable={previewable} compare={compare} setCompare={setCompare} five={options.length > 3} tradeUp />
        </div>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------ Host: end run

function AbandonFlow({ onClose }: { onClose: () => void }) {
  const { host } = useGD()
  return (
    <Modal title="End this run?" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Keep playing</button>
        <button className="btn btn-danger" onClick={() => { host!.updateRun((r) => { r.status = 'abandoned'; r.endedAt = Date.now(); log(r, 'run', 'Run ended by the host.') }); onClose() }}>End run</button>
      </>}
    >
      <p>The run is marked abandoned. Its Combat Report is kept, and you can archive it to Run History.</p>
    </Modal>
  )
}

export const routeLabel = (run: Run) => run.route.map((d) => dungeonById(d).name).join(' → ')
