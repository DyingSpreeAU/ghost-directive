import { useState } from 'react'
import { RestoreGuardian } from './BungiePanel'
import { endResume, type Player, type Run } from './model'
import { useGD } from './store'
import { ElementMark, rarityClass } from './ui'

/**
 * A reopened run waits here until every Guardian has put their character back the way the run
 * left it. Signed-in players restore in one press; anyone else does it by hand and marks it done,
 * and the host marks it for Guardians with no device.
 */
export function ResumeGate({ run }: { run: Run }) {
  const { role, host, toast } = useGD()
  const [confirm, setConfirm] = useState(false)
  const ready = run.resume?.ready ?? []
  const waiting = run.players.filter((p) => !ready.includes(p.id))
  return (
    <section className="resume-gate" aria-labelledby="resume-title">
      <header className="resume-head">
        <span className="eyebrow">Run paused</span>
        <h2 id="resume-title">Restore your Guardians</h2>
        <p className="muted">
          Before play picks back up, every Guardian puts their character back the way the run left it: run gear equipped,
          anything else in the Vault. Gear picked up while the run was paused won&rsquo;t count as a drop.
        </p>
        <p className="small">{ready.length}/{run.players.length} restored</p>
      </header>
      <div className="resume-list">
        {run.players.map((p) => <ResumeSeat key={p.id} run={run} p={p} ready={ready.includes(p.id)} />)}
      </div>
      {role === 'host' && waiting.length > 0 && (confirm ? (
        <div className="override">
          <p className="small"><strong>Continue without {waiting.map((p) => p.name).join(', ')}?</strong> Their characters may not match the run.</p>
          <div className="row-acts">
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>Wait</button>
            <button className="btn btn-danger btn-sm" onClick={() => { host!.updateRun((r) => endResume(r, true)); toast('Run continued.') }}>Continue anyway</button>
          </div>
        </div>
      ) : <button className="link small" onClick={() => setConfirm(true)}>Host override</button>)}
      {role !== 'host' && <p className="small muted">The run continues once everyone is restored, or when the host carries on.</p>}
    </section>
  )
}

function ResumeSeat({ run, p, ready }: { run: Run; p: Player; ready: boolean }) {
  const { me, canControl, dispatch, toast } = useGD()
  const own = p.clientId === me
  const control = canControl(p.id)
  // The last clean run setup, if one was recorded; a sync during the break marks whatever the game has on.
  const point = p.bungie?.restore?.equipped
  const atPoint = point?.length ? p.inventory.filter((i) => i.instanceId && point.includes(i.instanceId)) : []
  const equipped = atPoint.length ? atPoint : p.inventory.filter((i) => i.equipped)
  const extra = p.bungie?.untracked.length ?? 0
  return (
    <article className={`resume-seat ${ready ? 'is-ready' : ''}`} aria-label={`${p.name}: ${ready ? 'restored' : 'waiting'}`}>
      <div className="resume-seat-head">
        <ElementMark element={p.element} />
        <div>
          <div className="resume-name">{p.name}</div>
          <div className="small muted">{p.cls} &middot; {p.element}{own ? ' · You' : !p.clientId ? ' · No device' : ''}</div>
        </div>
        <span className={`seat-status ${ready ? 'tone-ok' : 'tone-warn'}`}>{ready ? 'Restored' : 'Waiting'}</span>
      </div>
      {!ready && (
        <>
          <p className="small">Equip:</p>
          <ul className="resume-gear">
            {equipped.length ? equipped.map((i) => <li key={i.id} className={rarityClass(i.rarity)}><span className="muted">{i.slot}</span> {i.name}</li>) : <li className="muted">Nothing marked equipped in the run inventory.</li>}
          </ul>
          {extra > 0 && <p className="small tone-warn">Last sync: {extra} item{extra === 1 ? '' : 's'} on the character not in the run.</p>}
        </>
      )}
      {control && (
        <div className="row-acts">
          {!ready && own && p.bungie && (
            <RestoreGuardian
              run={run}
              p={p}
              className="btn btn-light btn-sm"
              onRestored={(r) => {
                if (r.problems.length === 0 && r.equip !== 'partial' && r.equip !== 'location') {
                  dispatch({ type: 'resume-ready', ready: true }, p.id)
                  toast(`${p.name} restored${r.vaulted.length ? `; sent to the Vault: ${r.vaulted.join(', ')}` : ''}.`)
                }
                else toast('Not fully restored yet. Fix what the report lists, then restore again or mark it done.')
              }}
            />
          )}
          {ready
            ? <button className="btn btn-ghost btn-sm" onClick={() => dispatch({ type: 'resume-ready', ready: false }, p.id)}>Not yet</button>
            : <button className="btn btn-ghost btn-sm" onClick={() => dispatch({ type: 'resume-ready', ready: true }, p.id)}>{own ? 'I’ve restored it myself' : 'Mark restored'}</button>}
        </div>
      )}
    </article>
  )
}
