import { useState } from 'react'
import { STANDARD, uid, validateRuleset, type Ruleset } from './model'
import { allProtocols, useGD, type HostStore } from './store'
import { SandboxEditor, basisOf, differences } from './Sandbox'

export function Protocols() {
  const { host, toast, run, lobby } = useGD()
  const { store, mutate } = host!
  // The protocol the current run started with, or the one picked in the lobby.
  const inUse = run?.ruleset.id ?? lobby?.protocolId
  const setStore = (fn: (s: HostStore) => HostStore) => mutate(fn)
  const list = allProtocols(store)
  const [editing, setEditing] = useState<Ruleset | null>(null)
  const [io, setIo] = useState<{ mode: 'export' | 'import'; text: string } | null>(null)
  const [ioErr, setIoErr] = useState('')

  const derive = (base: Ruleset, suffix: string): Ruleset => ({ ...structuredClone(base), id: uid(), preset: false, name: `${base.name} ${suffix}`, basedOn: base.id })
  const saveCustom = (r: Ruleset) => setStore((s) => ({ ...s, protocols: s.protocols.some((p) => p.id === r.id) ? s.protocols.map((p) => (p.id === r.id ? r : p)) : [...s.protocols, r] }))

  const doImport = () => {
    try {
      const raw = JSON.parse(io!.text) as Ruleset
      const r: Ruleset = { ...structuredClone(STANDARD), ...raw, id: uid(), preset: false }
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
        <SandboxEditor
          value={editing}
          all={list}
          onCancel={() => setEditing(null)}
          onSave={(r) => { saveCustom(r); setEditing(null); toast(`Saved ${r.name}`) }}
        />
      ) : (
        <div className="proto-grid">
          {list.map((p) => (
            <article key={p.id} className={`proto static ${p.id === inUse ? 'is-in-use' : ''}`} aria-current={p.id === inUse ? 'true' : undefined}>
              <span className="choice-kind">{p.preset ? 'Preset' : 'Custom protocol'}{p.id === inUse && <span className="in-use-tag">{run ? 'This run' : 'This lobby'}</span>}</span>
              <strong>{p.name}</strong>
              <span className="muted">{p.description}</span>
              {!p.preset && (() => { const b = basisOf(p, list); const n = differences(p, b).length; return <span className="small muted">{n ? `${n} change${n === 1 ? '' : 's'} from ${b.name}` : `Same rules as ${b.name}`}</span> })()}
              <dl className="proto-stats">
                <div><dt>Start</dt><dd>{p.integrity.start}/{p.integrity.max}</dd></div>
                <div><dt>Clear</dt><dd>+{p.integrity.clear}</dd></div>
                <div><dt>Wipe</dt><dd>&minus;{p.integrity.wipe}</dd></div>
                <div><dt>Guardian death</dt><dd>{p.integrity.death ? <>&minus;{p.integrity.death}</> : '0'}</dd></div>
                <div><dt>Starting Item Slots</dt><dd>{p.inventory.capacity}</dd></div>
                <div><dt>Trade-up</dt><dd>{p.tradeUp.enabled ? `${p.tradeUp.inputs}→${p.tradeUp.options}` : 'Off'}</dd></div>
                <div><dt>Progression</dt><dd>{p.progression ? 'On' : 'Off'}</dd></div>
              </dl>
              <div className="row-acts">
                {p.preset
                  ? <button className="chip" onClick={() => setEditing(derive(p, '(custom)'))}>Customize</button>
                  : <button className="chip" onClick={() => setEditing(structuredClone(p))}>Edit</button>}
                {lobby && !run && p.id !== inUse && <button className="chip" onClick={() => { host!.updateLobby((l) => { l.protocolId = p.id; l.ruleset = structuredClone(p) }); toast(`${p.name} set for this lobby`) }}>Use in lobby</button>}
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
