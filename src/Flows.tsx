import { useState, type ReactNode } from 'react'
import { ALL_SLOTS, KIND_LABEL, RARITIES, abilityById, abilityDesc, dungeonById, type Rarity, type Slot, type VaultEntry } from './data'
import {
  capacityOf, changeIntegrity, chestsAhead, current, itemsIn, log, recordClear, tradeUpChoices,
  type ChestReward, type NewItem, type Pending, type Run,
} from './model'
import { useGD, type Flow } from './store'
import { ElementMark, Modal, rarityClass } from './ui'

export function FlowHost({ flow, run, onClose }: { flow: Flow; run: Run; onClose: () => void }) {
  switch (flow.type) {
    case 'clear': return <ClearFlow run={run} chests={flow.chests} onClose={onClose} />
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

function ChoiceGrid({ children, five }: { children: ReactNode; five?: boolean }) {
  return <div className={`choices ${five ? 'five' : ''}`}>{children}</div>
}

// ------------------------------------------------------------------ Host: record clear

function ClearFlow({ run, chests, onClose }: { run: Run; chests: number; onClose: () => void }) {
  const { host, toast, online } = useGD()
  const { dungeon, encounter } = current(run)
  const rr = run.ruleset
  const after = Math.min(rr.integrity.max, run.integrity + rr.integrity.clear)
  const dup = run.claimed.includes(encounter.id)
  const final = encounter.type === 'final'
  const ahead = chestsAhead(run).count
  const commit = () => {
    host!.updateRun((r) => recordClear(r, chests))
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
          <div><div className="eyebrow">Each Guardian gets</div><span>1 of {rr.rewards.unlockChoices} unlocks{final && rr.rewards.finalBossGear ? ', a final-boss item' : ''}{final && rr.rewards.finalBossArtifact ? ', Artifact research' : ''}{chests > 0 ? `, ${chests === 1 ? 'a chest reward' : `${chests} chest rewards`}` : ''}, and their own drops</span></div>
          {ahead > 0 && <div><div className="eyebrow">Secret chest{ahead > 1 ? 's' : ''}</div><span>{chests === 0 ? 'Skipped' : `${chests} of ${ahead} found`}</span></div>}
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

type Step = 'unlock' | 'gear' | 'artifact' | 'chest' | 'drops' | 'confirm'

function RewardFlow({ run, pend, onClose }: { run: Run; pend: Pending; onClose: () => void }) {
  const { dispatch, toast, me } = useGD()
  const p = run.players.find((x) => x.id === pend.playerId)!
  const gearAvail = pend.exotic.length + pend.legendary.length > 0
  const steps: Step[] = [
    ...(pend.unlock.length ? ['unlock' as const] : []),
    ...(gearAvail ? ['gear' as const] : []),
    ...(pend.artifact.length ? ['artifact' as const] : []),
    ...(pend.chest.length ? ['chest' as const] : []),
    'drops', 'confirm',
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

  const submit = () => {
    dispatch({ type: 'resolve', pendingId: pend.id, unlock, gear: gear?.name, mod, chest, drops }, p.id)
    toast('Rewards recorded')
    onClose()
  }
  const chestLabel = (c: ChestReward) => c.kind === 'artifact' ? c.mod : c.kind === 'expansion' ? 'Arsenal Expansion' : 'Loadout Archive'

  const title = { unlock: 'Choose an unlock', gear: 'Final-boss reward', artifact: 'Artifact research', chest: 'Chest reward', drops: 'Register your drops', confirm: 'Confirm your rewards' }[step]
  return (
    <Modal
      kicker={`${forSomeoneElse ? `For ${p.name} · ` : ''}${pend.where} · step ${i + 1} of ${steps.length}`}
      title={title}
      onClose={onClose}
      wide
      footer={<>
        {i === 0 ? <button className="btn btn-ghost" onClick={onClose}>Later</button> : <button className="btn btn-ghost" onClick={() => setI(i - 1)}>Back</button>}
        {step === 'confirm'
          ? <button className="btn btn-light" onClick={submit}>Claim rewards</button>
          : <button className="btn btn-light" disabled={!canNext} onClick={() => setI(i + 1)}>{step === 'drops' && drops.length === 0 ? 'No drops, continue' : 'Continue'}</button>}
      </>}
    >
      {step === 'unlock' && (
        <div className="stack">
          <p>Pick one {p.element} ability to unlock for the rest of the run. Equipping it in Destiny 2 is up to you.</p>
          <ChoiceGrid>
            {pend.unlock.map((id) => {
              const a = abilityById(id)
              return (
                <button key={id} className={`choice el-${a.element.toLowerCase()} ${unlock === id ? 'is-on' : ''}`} onClick={() => setUnlock(id)}>
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
          <p>Choose a reward category first. You see three options after choosing.</p>
          <ChoiceGrid>
            <button className="choice" disabled={!pend.exotic.length} onClick={() => setCat('exotic')}>
              <span className="choice-kind r-exotic-text">Exotic armor</span>
              <strong>Three {p.cls} Exotics</strong>
              <span className="muted">{p.element} synergy favored where available.</span>
            </button>
            <button className="choice" disabled={!pend.legendary.length} onClick={() => setCat('legendary')}>
              <span className="choice-kind r-legendary-text">Vault Legendary weapon</span>
              <strong>Three weapons from your Vault</strong>
              <span className="muted">{p.vault.length ? 'From your Vault pool.' : 'From the example Vault pool.'}</span>
            </button>
          </ChoiceGrid>
        </div>
      ) : (
        <div className="stack">
          <p>{cat === 'exotic' ? 'Exotic armor' : 'Vault Legendary weapon'}: pick one, then move it from your Vault in Destiny 2.</p>
          <ChoiceGrid>
            {pend[cat].map((g) => (
              <button key={g.name} className={`choice ${rarityClass(g.rarity)} ${gear?.name === g.name ? 'is-on' : ''}`} onClick={() => setGear(g)}>
                <span className="choice-kind">{g.rarity} {g.slot}</span>
                <strong>{g.name}</strong>
                <span className="muted">{g.archetype}{g.element ? ` · ${g.element}` : ''}{g.element === p.element ? ' · synergy' : ''}</span>
                {g.note && <span className="choice-desc">{g.note}</span>}
                {itemsIn(p, g.slot).length >= capacityOf(run, p) && <span className="tone-warn small">{g.slot} is full; a swap will follow</span>}
              </button>
            ))}
          </ChoiceGrid>
          {pend[cat].length === 0 && <p>No eligible items in this pool.</p>}
        </div>
      ))}

      {step === 'artifact' && (
        <ChoiceGrid>
          {pend.artifact.map((m) => (
            <button key={m} className={`choice ${mod === m ? 'is-on' : ''}`} onClick={() => setMod(m)}>
              <span className="choice-kind">Artifact mod</span>
              <strong>{m}</strong>
            </button>
          ))}
        </ChoiceGrid>
      )}

      {step === 'chest' && (
        <ChoiceGrid>
          {pend.chest.map((c, k) => (
            <button key={chestLabel(c)} className={`choice ${chest === k ? 'is-on' : ''} ${c.kind !== 'artifact' ? 'choice-upgrade' : ''}`} onClick={() => setChest(k)}>
              <span className="choice-kind">{c.kind === 'artifact' ? 'Artifact mod' : 'Upgrade'}</span>
              <strong>{chestLabel(c)}</strong>
              {c.kind === 'expansion' && <span className="muted">+1 capacity in every slot</span>}
              {c.kind === 'archive' && <span className="muted">+1 saved loadout. Rare.</span>}
            </button>
          ))}
        </ChoiceGrid>
      )}

      {step === 'drops' && <DropsEditor run={run} playerId={p.id} drops={drops} setDrops={setDrops} source={pend.kind === 'chest' ? 'secret chest' : 'encounter drop'} />}

      {step === 'confirm' && (
        <ul className="summary">
          {unlock && <li><span className="eyebrow">Unlock</span> {abilityById(unlock).name}</li>}
          {gear && <li><span className="eyebrow">Item</span> {gear.name} ({gear.rarity} {gear.slot})</li>}
          {mod && <li><span className="eyebrow">Artifact</span> {mod}</li>}
          {chest !== undefined && <li><span className="eyebrow">Chest</span> {chestLabel(pend.chest[chest])}</li>}
          <li><span className="eyebrow">Drops</span> {drops.length ? drops.map((d) => d.name).join(', ') : 'none'}</li>
        </ul>
      )}
    </Modal>
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
  const submit = () => {
    if (!name.trim()) return
    dispatch({ type: 'register', item: { name: name.trim(), slot: s, rarity, source } }, playerId)
    toast(`${name.trim()} registered`)
    onClose()
  }
  return (
    <Modal title="Register drop" kicker={`Field Arsenal · ${p.name}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-light" disabled={!name.trim()} onClick={submit}>Register</button>
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
      <p className={`small ${n >= cap ? 'tone-warn' : 'muted'}`}>
        Your {s} slot holds {n} of {cap}.{n >= cap && (run.ruleset.overflow === 'guided' ? ' You will choose an item to move to the Vault.' : ' This will show an over-capacity warning.')}
      </p>
    </Modal>
  )
}

// ------------------------------------------------------------------ Player: swap (overflow)

function SwapFlow({ run, onClose, playerId, slot }: { run: Run; onClose: () => void; playerId: string; slot: Slot }) {
  const { dispatch, toast } = useGD()
  const p = run.players.find((x) => x.id === playerId)!
  const items = itemsIn(p, slot)
  const cap = capacityOf(run, p)
  const excess = items.length - cap
  const [sel, setSel] = useState<string[]>([])
  if (excess <= 0) return null
  return (
    <Modal kicker={`${p.name} · ${slot}`} title={`Over capacity: ${items.length} of ${cap}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={() => { toast('Kept over capacity; the warning stays visible'); onClose() }}>Keep all for now</button>
        <button className="btn btn-light" disabled={sel.length < excess} onClick={() => { dispatch({ type: 'vault', itemIds: sel, why: 'over capacity' }, playerId); onClose() }}>
          Move {sel.length || excess} to Vault
        </button>
      </>}
    >
      <p>Choose {excess} item{excess > 1 ? 's' : ''} to leave the run inventory. Move {excess > 1 ? 'them' : 'it'} to the Vault in Destiny 2; dismantling is never required.</p>
      <ul className="pick-list">
        {items.map((it) => (
          <li key={it.id}>
            <label className={`item ${rarityClass(it.rarity)} ${sel.includes(it.id) ? 'is-picked' : ''}`}>
              <input type="checkbox" checked={sel.includes(it.id)} onChange={() => setSel(sel.includes(it.id) ? sel.filter((x) => x !== it.id) : [...sel, it.id])} />
              <div className="item-main">
                <span className="item-name">{it.name}{it.equipped && <span className="tag">Equipped</span>}</span>
                <span className="item-meta">{it.rarity} &middot; {it.source}</span>
              </div>
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

// ------------------------------------------------------------------ Player: trade-up

function TradeUpFlow({ run, onClose, playerId, slot }: { run: Run; onClose: () => void; playerId: string; slot: Slot }) {
  const { dispatch, toast } = useGD()
  const tu = run.ruleset.tradeUp
  const p = run.players.find((x) => x.id === playerId)!
  const items = itemsIn(p, slot).filter((i) => i.rarity !== 'Exotic')
  const [sel, setSel] = useState<string[]>([])
  const [stage, setStage] = useState<'inputs' | 'pick'>('inputs')
  const [options, setOptions] = useState<VaultEntry[]>([])
  const [choice, setChoice] = useState<VaultEntry | null>(null)
  const selRarity = sel.length ? items.find((i) => i.id === sel[0])?.rarity : null
  const canPick = (id: string) => {
    if (sel.includes(id)) return true
    if (sel.length >= tu.inputs) return false
    return !tu.sameRarity || !selRarity || items.find((i) => i.id === id)!.rarity === selRarity
  }
  const commit = () => {
    if (!choice) return
    dispatch({ type: 'tradeup', inputIds: sel, choice }, playerId)
    toast(`Traded up for ${choice.name}`)
    onClose()
  }
  return (
    <Modal kicker={`${p.name} · ${slot}`} title={stage === 'inputs' ? `Trade up: select ${tu.inputs} items` : 'Choose your Legendary'} onClose={onClose} wide
      footer={stage === 'inputs' ? <>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-light" disabled={sel.length !== tu.inputs} onClick={() => { setOptions(tradeUpChoices(run, p, slot)); setStage('pick') }}>I moved these to the Vault</button>
      </> : <>
        <button className="btn btn-ghost" onClick={() => setStage('inputs')}>Back</button>
        <button className="btn btn-light" disabled={!choice} onClick={commit}>Register {choice?.name ?? 'choice'}</button>
      </>}
    >
      {stage === 'inputs' ? (
        <div className="stack">
          <p>Pick {tu.inputs} {slot} items{tu.sameRarity ? ' of the same rarity' : ''}. Move them to your Vault in Destiny 2, then choose from {tu.options} Legendary {slot} options from your Vault.</p>
          <ul className="pick-list">
            {items.map((it) => (
              <li key={it.id}>
                <label className={`item ${rarityClass(it.rarity)} ${sel.includes(it.id) ? 'is-picked' : ''} ${canPick(it.id) ? '' : 'is-disabled'}`}>
                  <input type="checkbox" disabled={!canPick(it.id)} checked={sel.includes(it.id)} onChange={() => setSel(sel.includes(it.id) ? sel.filter((x) => x !== it.id) : [...sel, it.id])} />
                  <div className="item-main">
                    <span className="item-name">{it.name}</span>
                    <span className="item-meta">{it.rarity} &middot; {it.source}</span>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : options.length === 0 ? (
        <p>No eligible Legendary {slot} items in your Vault pool. Add some under Field Arsenal &rsaquo; Vault pool.</p>
      ) : (
        <ChoiceGrid five>
          {options.map((o) => (
            <button key={o.name} className={`choice r-legendary ${choice?.name === o.name ? 'is-on' : ''}`} onClick={() => setChoice(o)}>
              <span className="choice-kind">Legendary {o.slot}</span>
              <strong>{o.name}</strong>
              <span className="muted">{o.archetype}{o.element ? ` · ${o.element}` : ''}</span>
            </button>
          ))}
        </ChoiceGrid>
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
