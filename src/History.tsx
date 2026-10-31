import { useState } from 'react'
import { CombatReport } from './Briefing'
import { dungeonById } from './data'
import { current } from './model'
import { useGD, type HostStore } from './store'
import { ElementMark, Empty } from './ui'
import { RunStats } from './RunStats'

export function History() {
  const { host } = useGD()
  const { store, mutate } = host!
  const setStore = (fn: (s: HostStore) => HostStore) => mutate(fn)
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="history">
      <header className="page-head">
        <div>
          <div className="eyebrow">Run History</div>
          <h1>Past Directives</h1>
          <p className="section-note">Archived runs and their Combat Reports, kept in this browser.</p>
        </div>
      </header>
      {store.history.length === 0 && <Empty>No archived runs yet. Finished or ended runs appear here after you archive them.</Empty>}
      <ul className="hist-list">
        {store.history.map((r) => {
          const c = current(r)
          const wipes = r.log.filter((l) => l.kind === 'wipe').length
          return (
            <li key={r.id} className="panel hist">
              <button className="hist-head" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                <span className={`status status-${r.status}`}>{r.status}</span>
                <span className="hist-name">
                  <strong>{r.name}</strong>
                  <span className="muted small">{r.ruleset.name} &middot; {new Date(r.startedAt).toLocaleDateString()} &middot; {r.route.map((d) => dungeonById(d).name).join(', ')}</span>
                </span>
                <span className="hist-stats mono">
                  <span>{c.done}/{c.total} enc</span>
                  <span>{wipes} wipes</span>
                  <span>{r.integrity} int</span>
                </span>
                <span className="team">{r.players.map((p) => <ElementMark key={p.id} element={p.element} />)}</span>
              </button>
              {open === r.id && (
                <div className="hist-body">
                  <RunStats run={r} history={store.history} embedded />
                  <CombatReport run={r} embedded />
                  <button className="link" onClick={() => setStore((s) => ({ ...s, history: s.history.filter((x) => x.id !== r.id) }))}>Delete this record</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
