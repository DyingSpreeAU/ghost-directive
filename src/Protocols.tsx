import { useState } from 'react'
import { PRESETS, uid, validateRuleset, type Ruleset } from './model'
import { allProtocols, useGD, type HostStore } from './store'

export function Protocols() {
  const { host, toast } = useGD()
  const { store, mutate } = host!
  const setStore = (fn: (s: HostStore) => HostStore) => mutate(fn)
  const list = allProtocols(store)
  const [editing, setEditing] = useState<Ruleset | null>(null)
  const [io, setIo] = useState<{ mode: 'export' | 'import'; text: string } | null>(null)
  const [ioErr, setIoErr] = useState('')

  const derive = (base: Ruleset, suffix: string): Ruleset => ({ ...structuredClone(base), id: uid(), preset: false, name: `${base.name} ${suffix}` })
  const saveCustom = (r: Ruleset) => setStore((s) => ({ ...s, protocols: s.protocols.some((p) => p.id === r.id) ? s.protocols.map((p) => (p.id === r.id ? r : p)) : [...s.protocols, r] }))

  const doImport = () => {
    try {
      const raw = JSON.parse(io!.text) as Ruleset
      const r: Ruleset = { ...structuredClone(PRESETS[0]), ...raw, id: uid(), preset: false }
      const errs = validateRuleset(r)
      if (errs.length) { setIoErr(errs.join(' ')); return }
      saveCustom(r)
      setIo(null)
      toast(`Imported ${r.name}`)
    } catch {
      setIoErr('That text is not valid protocol JSON. Paste the full export, starting with {.')
    }
  }

  return (
    <div className="protocols">
      <header className="page-head">
        <div>
          <div className="eyebrow">Protocol Rulesets</div>
          <h1>Directives</h1>
          <p className="section-note">Presets are fixed. Customize one to create your own protocol. Runs keep a snapshot of the protocol they started with.</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => { setIo({ mode: 'import', text: '' }); setIoErr('') }}>Import protocol</button>
      </header>

      {editing ? (
        <Editor
          value={editing}
          onCancel={() => setEditing(null)}
          onSave={(r) => { saveCustom(r); setEditing(null); toast(`Saved ${r.name}`) }}
        />
      ) : (
        <div className="proto-grid">
          {list.map((p) => (
            <article key={p.id} className="proto static">
              <span className="choice-kind">{p.preset ? 'Preset' : 'Custom protocol'}</span>
              <strong>{p.name}</strong>
              <span className="muted">{p.description}</span>
              <dl className="proto-stats">
                <div><dt>Start</dt><dd>{p.integrity.start}/{p.integrity.max}</dd></div>
                <div><dt>Clear</dt><dd>+{p.integrity.clear}</dd></div>
                <div><dt>Wipe</dt><dd>&minus;{p.integrity.wipe}</dd></div>
                <div><dt>Starting Slot Cap</dt><dd>{p.inventory.capacity}</dd></div>
                <div><dt>Trade-up</dt><dd>{p.tradeUp.enabled ? `${p.tradeUp.inputs}→${p.tradeUp.options}` : 'Off'}</dd></div>
                <div><dt>Overflow</dt><dd>{p.overflow === 'guided' ? 'Swap' : 'Warn'}</dd></div>
              </dl>
              <div className="row-acts">
                {p.preset
                  ? <button className="chip" onClick={() => setEditing(derive(p, '(custom)'))}>Customize</button>
                  : <button className="chip" onClick={() => setEditing(structuredClone(p))}>Edit</button>}
                <button className="chip" onClick={() => { saveCustom(derive(p, 'copy')); toast('Duplicated') }}>Duplicate</button>
                <button className="chip" onClick={() => { const { id: _id, preset: _p, ...rest } = p; setIo({ mode: 'export', text: JSON.stringify(rest, null, 2) }) }}>Export</button>
                {!p.preset && <button className="chip" onClick={() => setStore((s) => ({ ...s, protocols: s.protocols.filter((x) => x.id !== p.id) }))}>Delete</button>}
              </div>
            </article>
          ))}
        </div>
      )}

      {io && (
        <div className="panel io">
          <h3>{io.mode === 'export' ? 'Export protocol' : 'Import protocol'}</h3>
          <p className="section-note">{io.mode === 'export' ? 'Copy this JSON and share it. Anyone can import it as a custom protocol.' : 'Paste protocol JSON exported from Ghost Directive.'}</p>
          <textarea id="proto-io" rows={10} value={io.text} readOnly={io.mode === 'export'} onChange={(e) => setIo({ ...io, text: e.target.value })} onFocus={(e) => io.mode === 'export' && e.target.select()} />
          {ioErr && <p className="tone-danger small">{ioErr}</p>}
          <div className="row-acts">
            {io.mode === 'export'
              ? <button className="btn btn-light btn-sm" onClick={(e) => {
                  const ta = (e.currentTarget.closest('.io') as HTMLElement).querySelector('textarea')!
                  navigator.clipboard.writeText(io.text).then(() => toast('Copied'), () => { ta.select(); toast('Select-all done; press Ctrl+C to copy') })
                }}>Copy</button>
              : <button className="btn btn-light btn-sm" onClick={doImport}>Import</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => setIo(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Num({ id, label, value, onChange, hint }: { id: string; label: string; value: number; onChange: (n: number) => void; hint?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <small className="muted">{hint}</small>}
    </div>
  )
}

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (b: boolean) => void }) {
  return <label className="switch" htmlFor={id}><input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}</label>
}

function Editor({ value, onSave, onCancel }: { value: Ruleset; onSave: (r: Ruleset) => void; onCancel: () => void }) {
  const [r, setR] = useState(value)
  const errs = validateRuleset(r)
  const set = (fn: (d: Ruleset) => void) => setR((x) => { const d = structuredClone(x); fn(d); return d })
  const wipesToFail = Math.ceil(r.integrity.start / Math.max(1, r.integrity.wipe))
  const clearsPerWipe = r.integrity.clear > 0 ? (r.integrity.wipe / r.integrity.clear).toFixed(1) : '∞'
  return (
    <div className="panel editor">
      <div className="field">
        <label htmlFor="pr-name">Protocol name</label>
        <input id="pr-name" value={r.name} onChange={(e) => set((d) => { d.name = e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="pr-desc">Description</label>
        <input id="pr-desc" value={r.description} onChange={(e) => set((d) => { d.description = e.target.value })} />
      </div>

      <fieldset>
        <legend>Run Survival</legend>
        <div className="field-grid">
          <Num id="pr-start" label="Starting Integrity" value={r.integrity.start} onChange={(n) => set((d) => { d.integrity.start = n })} />
          <Num id="pr-max" label="Maximum Integrity" value={r.integrity.max} onChange={(n) => set((d) => { d.integrity.max = n })} />
          <Num id="pr-clear" label="Per clear" value={r.integrity.clear} onChange={(n) => set((d) => { d.integrity.clear = n })} />
          <Num id="pr-wipe" label="Per wipe" value={r.integrity.wipe} onChange={(n) => set((d) => { d.integrity.wipe = n })} />
        </div>
        <p className="small muted">With no clears, the run ends on wipe {wipesToFail}. {clearsPerWipe} clears offset one wipe.</p>
      </fieldset>

      <fieldset>
        <legend>Inventory</legend>
        <div className="field-grid">
          <Num id="pr-cap" label="Items per slot" value={r.inventory.capacity} onChange={(n) => set((d) => { d.inventory.capacity = n })} hint="Includes the equipped item" />
          {/* Starting loadout slots: hidden while saved loadouts are. */}
          <div className="field">
            <label htmlFor="pr-ovf">When a reward overflows</label>
            <select id="pr-ovf" value={r.overflow} onChange={(e) => set((d) => { d.overflow = e.target.value as Ruleset['overflow'] })}>
              <option value="guided">Offer a guided swap</option>
              <option value="warn">Warn and let the player proceed</option>
            </select>
          </div>
        </div>
        <div className="toggles">
          <Toggle id="pr-tu" label="Trade-ups enabled" checked={r.tradeUp.enabled} onChange={(b) => set((d) => { d.tradeUp.enabled = b })} />
          <Toggle id="pr-tur" label="Trade-up inputs must share a rarity" checked={r.tradeUp.sameRarity} onChange={(b) => set((d) => { d.tradeUp.sameRarity = b })} />
        </div>
        <div className="field-grid">
          <Num id="pr-tui" label="Trade-up inputs" value={r.tradeUp.inputs} onChange={(n) => set((d) => { d.tradeUp.inputs = n })} />
          <Num id="pr-tuo" label="Trade-up options" value={r.tradeUp.options} onChange={(n) => set((d) => { d.tradeUp.options = n })} />
        </div>
      </fieldset>

      <fieldset>
        <legend>Rewards</legend>
        <div className="field-grid">
          <Num id="pr-uc" label="Unlock choices per clear" value={r.rewards.unlockChoices} onChange={(n) => set((d) => { d.rewards.unlockChoices = n })} />
        </div>
        <div className="toggles">
          <Toggle id="pr-fbg" label="Final bosses offer Exotic armor or Vault Legendary" checked={r.rewards.finalBossGear} onChange={(b) => set((d) => { d.rewards.finalBossGear = b })} />
          <Toggle id="pr-fba" label="Final bosses offer Artifact research" checked={r.rewards.finalBossArtifact} onChange={(b) => set((d) => { d.rewards.finalBossArtifact = b })} />
          <Toggle id="pr-ca" label="Secret chests offer Artifact research" checked={r.rewards.chestArtifact} onChange={(b) => set((d) => { d.rewards.chestArtifact = b })} />
          <Toggle id="pr-cu" label="Secret chests can offer upgrades" checked={r.rewards.chestUpgrades} onChange={(b) => set((d) => { d.rewards.chestUpgrades = b })} />
          <Toggle id="pr-rc" label="Final bosses show the items in each category before picking (easier)" checked={!!r.rewards.revealCategories} onChange={(b) => set((d) => { d.rewards.revealCategories = b })} />
        </div>
      </fieldset>

      {errs.length > 0 && <ul className="errs">{errs.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="row-acts end">
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-light" disabled={errs.length > 0} onClick={() => onSave(r)}>Save protocol</button>
      </div>
    </div>
  )
}
