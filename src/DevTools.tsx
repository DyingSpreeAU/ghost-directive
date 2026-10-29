// Test tools for the nightly build only. App.tsx loads this file only when CHANNEL is set, so a
// production build never loads it. Everything here acts on the run in the host's browser.

import { useRef, useState } from 'react'
import { ALL_SLOTS, RARITIES, artifactByName, dungeonById, subclassAbilities, type Rarity, type Slot } from './data'
import {
  receiveGear, artifactChoices, chestChoices, current, exoticChoices, legendaryWeaponChoices, log, uid, unlockChoices,
  type Pending, type Player, type Run,
} from './model'
import { CHANNEL } from './channel'
import { useGD } from './store'

const OPEN_KEY = 'ghost-directive:devtools-open'
const SPOT_KEY = 'ghost-directive:devtools-spot'
const SAMPLE_DROPS: Record<Slot, string[]> = {
  Kinetic: ['Fatebringer', 'Pariah', 'Hung Jury SR4'], Energy: ['Funnelweb', 'Stay Away', 'Breachlight'],
  Power: ['Tarantula', 'Hothead', 'Apex Predator'], Helmet: ['Test Helm'], Gauntlets: ['Test Grips'],
  Chest: ['Test Vest'], Legs: ['Test Strides'], 'Class Item': ['Test Cloak'],
}
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]

type Kind = 'encounter' | 'final' | 'chest' | 'expansion' | 'bonus'

/**
 * The collapsed test tools. On a wide screen a striped tab; on a phone a round floating button that
 * can be dragged out of the way (its spot is remembered) and tapped to open the tools.
 */
function ToolsButton({ onOpen }: { onOpen: () => void }) {
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(() => { try { return JSON.parse(localStorage.getItem(SPOT_KEY) ?? 'null') } catch { return null } })
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null)
  // A dragged spot only applies on a phone; on a wide screen the tab stays in its corner.
  const placed = spot && matchMedia('(max-width: 900px)').matches ? spot : null
  const clamp = (x: number, y: number) => ({ x: Math.max(6, Math.min(innerWidth - 58, x)), y: Math.max(6, Math.min(innerHeight - 130, y)) })
  return (
    <button
      className={`devtools-tab ${placed ? 'is-placed' : ''}`}
      style={placed ? { left: clamp(placed.x, placed.y).x, top: clamp(placed.x, placed.y).y } : undefined}
      aria-label="Open test tools"
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d || !matchMedia('(max-width: 900px)').matches) return
        const next = clamp(e.clientX - d.dx, e.clientY - d.dy)
        if (!d.moved && spot && Math.hypot(next.x - spot.x, next.y - spot.y) < 6) return
        d.moved = true
        setSpot(next)
      }}
      onPointerUp={() => {
        const d = drag.current
        drag.current = null
        if (d?.moved) { try { localStorage.setItem(SPOT_KEY, JSON.stringify(spot)) } catch { /* fine */ } return }
        onOpen()
      }}
    >
      <svg className="devtools-ico" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M14.7 6.3a4 4 0 0 0-5.2 5.2l-5.8 5.8a1.4 1.4 0 0 0 2 2l5.8-5.8a4 4 0 0 0 5.2-5.2l-2.4 2.4-2-.6-.6-2 2.4-2.4Z" fill="currentColor" />
      </svg>
      <span className="devtools-tab-label">Test tools</span>
    </button>
  )
}

/** Queues a reward for these Guardians without recording a clear, so the reward screens can be tried. */
function grant(run: Run, kind: Kind, who: Player[]) {
  const { dungeon, encounter } = current(run)
  for (const p of who) {
    const pend: Pending = {
      id: uid(), playerId: p.id, kind: kind === 'chest' || kind === 'expansion' || kind === 'bonus' ? 'chest' : 'clear',
      where: `Test · ${dungeon.name} · ${kind === 'final' ? 'Final boss' : kind === 'encounter' ? encounter.name : 'Secret chest'}`,
      final: kind === 'final',
      unlock: kind === 'encounter' || kind === 'final' ? unlockChoices(run, p).map((a) => a.id) : [],
      exotic: kind === 'final' ? exoticChoices(p) : [],
      legendary: kind === 'final' ? legendaryWeaponChoices(p) : [],
      artifact: kind === 'final' ? artifactChoices(p) : [],
      chest: kind === 'chest' || kind === 'bonus' ? chestChoices(run, p) : [],
      bonus: kind === 'bonus' || undefined,
    }
    if (kind === 'expansion') pend.chest = [...artifactChoices(p, 2).map((mod) => ({ kind: 'artifact' as const, mod })), { kind: 'expansion' as const }]
    run.pending.push(pend)
  }
  log(run, 'run', `Test tools: ${kind} reward for ${who.map((p) => p.name).join(', ')}.`)
}

export default function DevTools() {
  const { host, run, toast, myPlayerId } = useGD()
  // Starts open on wide screens; on a phone it would cover the page, so it starts as the tab.
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(OPEN_KEY); if (v) return v !== 'closed' } catch { /* fine */ }
    return !matchMedia('(max-width: 900px)').matches
  })
  const [target, setTarget] = useState<string>('all')
  const [slot, setSlot] = useState<Slot>('Kinetic')
  const [rarity, setRarity] = useState<Rarity>('Legendary')
  const toggle = () => { setOpen(!open); try { localStorage.setItem(OPEN_KEY, open ? 'closed' : 'open') } catch { /* fine */ } }

  // Nothing to test outside a run, and in the lobby it would cover the Begin button.
  if (!run) return null
  if (!open) return <ToolsButton onOpen={toggle} />

  const act = (label: string, fn: (r: Run) => void) => {
    if (!host || !run) return
    host.updateRun(fn)
    toast(`Test tools: ${label}`)
  }
  const players = (r: Run) => (target === 'all' ? r.players : r.players.filter((p) => p.id === target))
  const one = (r: Run) => r.players.find((p) => p.id === (target === 'all' ? myPlayerId ?? r.players[0].id : target))!
  const encounters = run ? run.route.flatMap((id, di) => dungeonById(id).encounters.map((e, ei) => ({ di, ei, label: `${dungeonById(id).name} · ${e.name}${e.type === 'final' ? ' (final)' : ''}` }))) : []

  return (
    <aside className="devtools" aria-label="Test tools">
      <header className="devtools-head">
        <strong>Test tools</strong>
        <span className="devtools-chan">{CHANNEL} only</span>
        <button className="devtools-x" onClick={toggle} aria-label="Collapse test tools">–</button>
      </header>
      {!run ? <p className="devtools-note">Start or resume a run to use these.</p>
        : !host ? <p className="devtools-note">Only the host&rsquo;s browser can change the run. Open the test tools there.</p> : (
        <div className="devtools-body">
          <label className="devtools-row">
            <span>For</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="all">Every Guardian</option>
              {run.players.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === myPlayerId ? ' (you)' : ''}</option>)}
            </select>
          </label>

          <section>
            <h4>Rewards</h4>
            <p className="devtools-note">Queues the reward screen without clearing anything.</p>
            <div className="devtools-grid">
              <button onClick={() => act('encounter reward', (r) => grant(r, 'encounter', players(r)))}>Encounter</button>
              <button onClick={() => act('final-boss reward', (r) => grant(r, 'final', players(r)))}>Final boss</button>
              <button onClick={() => act('chest reward', (r) => grant(r, 'chest', players(r)))}>Chest</button>
              <button onClick={() => act('chest with Arsenal Expansion', (r) => grant(r, 'expansion', players(r)))}>Chest + Expansion</button>
              <button onClick={() => act('chest with BONUS tier-up', (r) => grant(r, 'bonus', players(r)))}>Chest + BONUS</button>
            </div>
            <button className="devtools-wide" onClick={() => act('pending rewards cleared', (r) => { r.pending = r.pending.filter((x) => !players(r).some((p) => p.id === x.playerId)) })}>Clear waiting rewards</button>
          </section>

          <section>
            <h4>Run</h4>
            <div className="devtools-grid">
              <button onClick={() => act('Integrity −15', (r) => { r.integrity = Math.max(1, r.integrity - 15) })}>Integrity −15</button>
              <button onClick={() => act('Integrity +15', (r) => { r.integrity = Math.min(r.ruleset.integrity.max, r.integrity + 15) })}>Integrity +15</button>
            </div>
            <label className="devtools-row">
              <span>Jump to</span>
              <select value={`${run.dIdx}:${run.eIdx}`} onChange={(e) => { const [di, ei] = e.target.value.split(':').map(Number); act('jumped', (r) => { r.dIdx = di; r.eIdx = ei; r.chestsDone = 0; r.status = 'active' }) }}>
                {encounters.map((x) => <option key={`${x.di}:${x.ei}`} value={`${x.di}:${x.ei}`}>{x.label}</option>)}
              </select>
            </label>
          </section>

          <section>
            <h4>Guardian <span className="devtools-dim">({target === 'all' ? 'you' : 'selected'})</span></h4>
            <div className="devtools-row">
              <select value={slot} onChange={(e) => setSlot(e.target.value as Slot)} aria-label="Slot">{ALL_SLOTS.map((s) => <option key={s}>{s}</option>)}</select>
              <select value={rarity} onChange={(e) => setRarity(e.target.value as Rarity)} aria-label="Rarity">{RARITIES.map((x) => <option key={x}>{x}</option>)}</select>
            </div>
            <button className="devtools-wide" onClick={() => act(`${rarity} ${slot} drop`, (r) => { receiveGear(r, one(r), { name: pick(SAMPLE_DROPS[slot]), slot, rarity, source: 'test tools' }) })}>Add a drop</button>
            <div className="devtools-grid">
              <button onClick={() => act('Arsenal Expansion +1', (r) => { const p = one(r); p.capacityBonus++; log(r, 'upgrade', `Test tools: ${p.name} +1 capacity.`) })}>Expansion +1</button>
              <button onClick={() => act('ability unlocked', (r) => { const p = one(r); const a = pick(subclassAbilities(p.cls, p.element).filter((x) => !p.unlocked.includes(x.id))); if (a) p.unlocked.push(a.id) })}>Unlock ability</button>
              <button onClick={() => act('perk researched', (r) => { const p = one(r); const m = pick((artifactByName(p.artifactName)?.perks ?? []).map((x) => x.name).filter((x) => !p.artifact.includes(x))); if (m) p.artifact.push(m) })}>Research perk</button>
              <button onClick={() => act('inventory emptied', (r) => { one(r).inventory = [] })}>Empty inventory</button>
              <button onClick={() => act('every slot Legendary', (r) => { const p = one(r); if (p.tiers) for (const k of Object.keys(p.tiers)) p.tiers[k as Slot] = 'Legendary'; p.upgrades = [] })}>All slots Legendary</button>
            </div>
            <button className="devtools-wide" onClick={() => act('gear outside the run', (r) => {
              const p = one(r)
              p.bungie ??= { name: p.name, character: p.cls, syncedAt: Date.now(), vaultItems: 0, missing: [], untracked: [] }
              p.bungie.untracked = [
                { slot: 'Kinetic', name: pick(SAMPLE_DROPS.Kinetic), rarity: 'Legendary', equipped: true },
                { slot: 'Helmet', name: pick(SAMPLE_DROPS.Helmet), rarity: 'Exotic' },
                { slot: 'Power', name: pick(SAMPLE_DROPS.Power), rarity: 'Legendary', fate: 'traded' },
              ]
            })}>Gear outside the run</button>
          </section>

          <section>
            <h4>Debug</h4>
            <button className="devtools-wide" onClick={() => {
              const text = JSON.stringify(run, null, 1)
              navigator.clipboard?.writeText(text).then(() => toast('Run data copied. Paste it to Claude with your bug report.'), () => toast('Copy failed: your browser blocked the clipboard.'))
            }}>Copy run data</button>
            <p className="devtools-note">Run {run.code} · {run.players.length} Guardian{run.players.length === 1 ? '' : 's'} · {run.pending.length} waiting reward{run.pending.length === 1 ? '' : 's'}</p>
          </section>
        </div>
      )}
    </aside>
  )
}
