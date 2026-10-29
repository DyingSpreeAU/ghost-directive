// The sandbox editor: every rule of a protocol, grouped into sections. Each setting is described
// once in FIELDS, which drives its control, its "changed" marker and reset, and the summary of
// differences from the protocol it was based on.

import { useState, type ReactNode } from 'react'
import { PRESETS, SANDBOX_DEFAULTS, STANDARD, sandbox, validateRuleset, type Ruleset } from './model'
import { TierWord } from './ui'
import type { Rarity } from './data'

type Value = number | boolean | string
type Field = {
  /** Where the value lives: "integrity.start", or "sandbox.bonusChance" (read with defaults). */
  path: string
  label: string
  section: SectionId
  kind: 'num' | 'pct' | 'toggle' | 'rarity' | 'select'
  min?: number
  max?: number
  options?: { value: string; label: string }[]
  hint?: string
  /** Shown only when this holds (e.g. BONUS chance only with gear progression). */
  when?: (r: Ruleset) => boolean
  /** Sub-heading inside the section. */
  group?: string
}

type SectionId = 'integrity' | 'start' | 'progression' | 'inventory' | 'rewards'
const SECTIONS: { id: SectionId; title: string; note: string }[] = [
  { id: 'integrity', title: 'Integrity', note: 'The fireteam’s shared life: what it starts at, what fills it and what drains it.' },
  { id: 'start', title: 'Starting setup', note: 'What every Guardian brings into the first encounter.' },
  { id: 'progression', title: 'Gear progression', note: 'Slots climbing from their starting tier to Legendary.' },
  { id: 'inventory', title: 'Inventory and trade-ups', note: 'How much each slot holds, and trading surplus for a Vault Legendary.' },
  { id: 'rewards', title: 'Rewards', note: 'What clears, final bosses and secret chests hand out.' },
]

const TIERS: Rarity[] = ['Common', 'Uncommon', 'Rare', 'Legendary']
const prog = (r: Ruleset) => !!r.progression
const FIELDS: Field[] = [
  { path: 'integrity.start', label: 'Starting Integrity', section: 'integrity', kind: 'num', min: 1, max: 999 },
  { path: 'integrity.max', label: 'Maximum Integrity', section: 'integrity', kind: 'num', min: 1, max: 999 },
  { path: 'integrity.clear', label: 'Per encounter clear', section: 'integrity', kind: 'num', min: 0, max: 999, hint: 'Gained' },
  { path: 'sandbox.finalClear', label: 'Final boss bonus', section: 'integrity', kind: 'num', min: 0, max: 999, hint: 'Gained on top of the clear' },
  { path: 'sandbox.chestFound', label: 'Per secret chest found', section: 'integrity', kind: 'num', min: 0, max: 999, hint: 'Gained', when: (r) => sandbox(r).secretChests },
  { path: 'integrity.death', label: 'Per Guardian death', section: 'integrity', kind: 'num', min: 0, max: 999, hint: 'Lost; at 0, deaths are still counted but cost nothing' },
  { path: 'integrity.wipe', label: 'Per wipe', section: 'integrity', kind: 'num', min: 1, max: 999, hint: 'Lost' },

  { path: 'sandbox.startGear.weapons', label: 'Kinetic and energy weapons', section: 'start', kind: 'rarity', group: 'Starting gear: highest rarity allowed', hint: 'Also the starting tier with progression' },
  { path: 'sandbox.startGear.heavy', label: 'Heavy weapon', section: 'start', kind: 'rarity', group: 'Starting gear: highest rarity allowed' },
  { path: 'sandbox.startGear.armor', label: 'Armor', section: 'start', kind: 'rarity', group: 'Starting gear: highest rarity allowed' },
  { path: 'sandbox.startAbilities', label: 'Abilities at the start', section: 'start', kind: 'select', group: 'Subclass', options: [{ value: 'one', label: 'One Super, class ability, melee and grenade' }, { value: 'all', label: 'The whole subclass, unlocked' }] },

  { path: 'progression', label: 'Gear progression', section: 'progression', kind: 'toggle', hint: 'Each slot climbs from its starting tier to Legendary; drops below Legendary raise the tier instead of joining the inventory.' },
  { path: 'sandbox.bonusChance', label: 'BONUS tier-up chance after a reward', section: 'progression', kind: 'pct', when: prog },
  { path: 'sandbox.exoticsAnyTime', label: 'Exotics can be used at any time', section: 'progression', kind: 'toggle', when: prog, hint: 'Off: an Exotic drop raises the tier like any other drop.' },

  { path: 'inventory.capacity', label: 'Starting item slots', section: 'inventory', kind: 'num', min: 1, max: 12, hint: 'Per gear slot, including the equipped item', group: 'Inventory' },
  { path: 'tradeUp.enabled', label: 'Trade-ups', section: 'inventory', kind: 'toggle', group: 'Trade-ups' },
  { path: 'tradeUp.inputs', label: 'Items traded in', section: 'inventory', kind: 'num', min: 2, max: 8, group: 'Trade-ups', when: (r) => r.tradeUp.enabled },
  { path: 'tradeUp.options', label: 'Vault options offered', section: 'inventory', kind: 'num', min: 1, max: 8, group: 'Trade-ups', when: (r) => r.tradeUp.enabled },
  { path: 'tradeUp.sameRarity', label: 'Traded-in items must share a rarity', section: 'inventory', kind: 'toggle', group: 'Trade-ups', when: (r) => r.tradeUp.enabled },
  { path: 'sandbox.tradeUpExotics', label: 'Exotics can be traded in', section: 'inventory', kind: 'toggle', group: 'Trade-ups', when: (r) => r.tradeUp.enabled },
  { path: 'sandbox.tradeUpNeedsLegendary', label: 'Only once the slot is Legendary', section: 'inventory', kind: 'toggle', group: 'Trade-ups', when: (r) => r.tradeUp.enabled && prog(r) },

  { path: 'rewards.unlockChoices', label: 'Ability choices per clear', section: 'rewards', kind: 'num', min: 1, max: 5, group: 'Every clear' },
  { path: 'rewards.allowLater', label: 'Players can put off a reward (Later)', section: 'rewards', kind: 'toggle', group: 'Every clear' },
  { path: 'rewards.finalBossGear', label: 'Exotic armor or a Vault Legendary', section: 'rewards', kind: 'toggle', group: 'Final bosses' },
  { path: 'sandbox.exoticChoices', label: 'Exotic armor options', section: 'rewards', kind: 'num', min: 1, max: 6, group: 'Final bosses', when: (r) => r.rewards.finalBossGear },
  { path: 'sandbox.legendaryChoices', label: 'Vault Legendary options', section: 'rewards', kind: 'num', min: 1, max: 6, group: 'Final bosses', when: (r) => r.rewards.finalBossGear },
  { path: 'sandbox.exoticClassItems', label: 'Prismatic Exotic class items', section: 'rewards', kind: 'toggle', group: 'Final bosses', when: (r) => r.rewards.finalBossGear, hint: 'A rolled copy from the Vault' },
  { path: 'rewards.revealCategories', label: 'Show the items in each category before picking', section: 'rewards', kind: 'toggle', group: 'Final bosses', hint: 'Easier' },
  { path: 'rewards.finalBossArtifact', label: 'Artifact research', section: 'rewards', kind: 'toggle', group: 'Final bosses' },
  { path: 'sandbox.artifactChoices', label: 'Artifact perk options', section: 'rewards', kind: 'num', min: 1, max: 6, group: 'Final bosses', when: (r) => r.rewards.finalBossArtifact },
  { path: 'sandbox.secretChests', label: 'Track secret chests', section: 'rewards', kind: 'toggle', group: 'Secret chests' },
  { path: 'rewards.chestArtifact', label: 'Chests offer Artifact research', section: 'rewards', kind: 'toggle', group: 'Secret chests', when: (r) => sandbox(r).secretChests },
  { path: 'rewards.chestUpgrades', label: 'Chests can offer an Arsenal Expansion', section: 'rewards', kind: 'toggle', group: 'Secret chests', when: (r) => sandbox(r).secretChests },
  { path: 'sandbox.expansionChance', label: 'Arsenal Expansion chance', section: 'rewards', kind: 'pct', group: 'Secret chests', when: (r) => sandbox(r).secretChests && r.rewards.chestUpgrades },

]

/** A setting's value, with sandbox defaults filled in. */
function get(r: Ruleset, path: string): Value {
  const [head, ...rest] = path.split('.')
  let v: unknown = head === 'sandbox' ? sandbox(r) : (r as Record<string, unknown>)[head]
  for (const k of rest) v = (v as Record<string, unknown> | undefined)?.[k]
  return (v ?? false) as Value
}

function set(d: Ruleset, path: string, value: Value) {
  const keys = path.split('.')
  if (keys[0] === 'sandbox') d.sandbox = { ...d.sandbox, startGear: { ...SANDBOX_DEFAULTS.startGear, ...d.sandbox?.startGear } }
  let o = d as unknown as Record<string, unknown>
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>
  o[keys[keys.length - 1]] = value
}

const show = (f: Field, v: Value) => f.kind === 'toggle' ? (v ? 'On' : 'Off') : f.kind === 'pct' ? `${v}%` : f.kind === 'select' ? f.options!.find((o) => o.value === v)?.label ?? String(v) : String(v)

/** The protocol this one is compared with: what it was based on, else Standard. */
export function basisOf(r: Ruleset, all: Ruleset[] = PRESETS): Ruleset {
  return all.find((p) => p.id === r.basedOn && p.id !== r.id) ?? STANDARD
}

/** Settings that differ from another protocol. */
export function differences(r: Ruleset, base: Ruleset) {
  return FIELDS.filter((f) => get(r, f.path) !== get(base, f.path)).map((f) => ({ field: f, from: show(f, get(base, f.path)), to: show(f, get(r, f.path)) }))
}

export function SandboxEditor({ value, all, onSave, onCancel }: { value: Ruleset; all: Ruleset[]; onSave: (r: Ruleset) => void; onCancel: () => void }) {
  const [r, setR] = useState(value)
  const [section, setSection] = useState<SectionId>('integrity')
  const base = basisOf(r, all)
  const errs = validateRuleset(r)
  const change = (fn: (d: Ruleset) => void) => setR((x) => { const d = structuredClone(x); fn(d); return d })
  const diffs = differences(r, base)
  const changed = new Set(diffs.map((d) => d.field.path))
  const sb = sandbox(r)
  const i = r.integrity

  const control = (f: Field): ReactNode => {
    const v = get(r, f.path)
    const id = `sb-${f.path.replace(/\./g, '-')}`
    const put = (x: Value) => change((d) => set(d, f.path, x))
    const isChanged = changed.has(f.path)
    const reset = isChanged && <button className="sb-reset" title={`Back to ${base.name}: ${show(f, get(base, f.path))}`} aria-label={`Reset ${f.label}`} onClick={() => put(get(base, f.path))}>&#8634;</button>
    if (f.kind === 'toggle') {
      return (
        <div key={f.path} className={`sb-field sb-toggle ${isChanged ? 'is-changed' : ''}`}>
          <label className="switch" htmlFor={id}><input id={id} type="checkbox" checked={!!v} onChange={(e) => put(e.target.checked)} /> <span>{f.label}</span></label>
          {reset}
          {f.hint && <small className="muted">{f.hint}</small>}
        </div>
      )
    }
    return (
      <div key={f.path} className={`sb-field ${isChanged ? 'is-changed' : ''}`}>
        <label htmlFor={id}>{f.label}{reset}</label>
        {f.kind === 'num' && <input id={id} type="number" min={f.min} max={f.max} value={Number(v)} onChange={(e) => put(Number(e.target.value))} />}
        {f.kind === 'pct' && (
          <div className="sb-pct">
            <input id={id} type="range" min={0} max={100} value={Number(v)} onChange={(e) => put(Number(e.target.value))} />
            <span className="mono">{Number(v)}%</span>
          </div>
        )}
        {f.kind === 'select' && (
          <select id={id} value={String(v)} onChange={(e) => put(e.target.value)}>
            {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        {f.kind === 'rarity' && (
          <div className="seg sb-rarity" role="radiogroup" aria-labelledby={id}>
            <span id={id} hidden>{f.label}</span>
            {TIERS.map((t) => <button key={t} role="radio" aria-checked={v === t} className={v === t ? 'is-on' : ''} onClick={() => put(t)}><TierWord tier={t} /></button>)}
          </div>
        )}
        {f.hint && <small className="muted">{f.hint}</small>}
      </div>
    )
  }

  const sec = SECTIONS.find((s) => s.id === section)!
  const fields = FIELDS.filter((f) => f.section === section && (!f.when || f.when(r)))
  const groups = [...new Set(fields.map((f) => f.group ?? ''))]
  const countIn = (id: SectionId) => diffs.filter((d) => d.field.section === id).length
  const wipes = Math.ceil(i.start / Math.max(1, i.wipe))

  return (
    <div className="panel sandbox">
      <div className="sb-head">
        <div className="field">
          <label htmlFor="sb-name">Protocol name</label>
          <input id="sb-name" value={r.name} maxLength={40} onChange={(e) => change((d) => { d.name = e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="sb-desc">Description</label>
          <input id="sb-desc" value={r.description} maxLength={240} onChange={(e) => change((d) => { d.description = e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="sb-base">Compare with</label>
          <select id="sb-base" value={base.id} onChange={(e) => change((d) => { d.basedOn = e.target.value })}>
            {all.filter((p) => p.id !== r.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div className="sb-body">
        <nav className="sb-nav" aria-label="Sections">
          {SECTIONS.map((s) => (
            <button key={s.id} className={s.id === section ? 'is-on' : ''} aria-current={s.id === section ? 'true' : undefined} onClick={() => setSection(s.id)}>
              {s.title}{countIn(s.id) > 0 && <span className="sb-count" title={`${countIn(s.id)} changed from ${base.name}`}>{countIn(s.id)}</span>}
            </button>
          ))}
        </nav>

        <section className="sb-section" aria-labelledby="sb-section-title">
          <h3 id="sb-section-title">{sec.title}</h3>
          <p className="section-note">{sec.note}</p>
          {groups.map((g) => (
            <div key={g} className="sb-group">
              {g && <div className="eyebrow">{g}</div>}
              <div className="sb-fields">{fields.filter((f) => (f.group ?? '') === g).map(control)}</div>
            </div>
          ))}
          {section === 'integrity' && <p className="small muted">With no clears, wipe {wipes} ends the run. {i.clear > 0 ? `${(i.wipe / i.clear).toFixed(1)} clears earn back a wipe.` : 'Clears don’t restore Integrity.'}</p>}
        </section>

        <aside className="sb-summary" aria-label="How this plays">
          <div className="eyebrow">How this plays</div>
          <dl className="sb-stats">
            <div><dt>Integrity</dt><dd>{i.start}<small>/{i.max}</small></dd></div>
            <div><dt>Wipes to fail</dt><dd>{wipes}</dd></div>
            <div><dt>Clear</dt><dd className="tone-ok">+{i.clear}{sb.finalClear ? <small> (+{sb.finalClear} boss)</small> : null}</dd></div>
            <div><dt>Death / wipe</dt><dd className="tone-danger">&minus;{i.death ?? 0} / &minus;{i.wipe}</dd></div>
            <div><dt>Slot size</dt><dd>{r.inventory.capacity}</dd></div>
            <div><dt>Progression</dt><dd>{r.progression ? 'On' : 'Off'}</dd></div>
          </dl>
          <div className="eyebrow">Changes from {base.name} ({diffs.length})</div>
          {diffs.length === 0 ? <p className="small muted">Plays exactly like {base.name}.</p> : (
            <ul className="sb-diffs">
              {diffs.map((d) => (
                <li key={d.field.path}>
                  <button className="link" onClick={() => setSection(d.field.section)}>{d.field.label}</button>
                  <span className="muted small">{d.from} &rarr; <b>{d.to}</b></span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {errs.length > 0 && <ul className="errs">{errs.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="row-acts end sb-foot">
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-light" disabled={errs.length > 0} onClick={() => onSave(r)}>Save protocol</button>
      </div>
    </div>
  )
}
