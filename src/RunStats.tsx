import { useEffect, useRef, useState } from 'react'
import type { Player, Run } from './model'
import { bestSplits, clock, combat, highlights, integritySeries, splits, totals, type IntegrityPoint } from './stats'
import { ElementMark, Empty } from './ui'

/** Ticks once a second while `live`, for running timers. */
function useNow(live: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [live])
  return now
}

/**
 * The run's stats: headline numbers, Integrity over time, splits per encounter (with the best time
 * from archived runs), highlights, and each Guardian's combat stats. On the run page while it's on
 * and after it ends, and in Run History for archived runs.
 */
export function RunStats({ run, history = [], embedded }: { run: Run; history?: Run[]; embedded?: boolean }) {
  const live = run.status === 'active'
  const now = useNow(live && !run.example)
  const t = totals(run, now)
  const rows = splits(run, now)
  const best = bestSplits(history, run.id)
  const hl = highlights(run, now)
  const current = rows.find((s) => s.current)
  return (
    <section id={embedded ? undefined : 'stats'} className={`run-stats ${embedded ? '' : 'section'}`} aria-label="Run stats">
      {!embedded && (
        <header className="section-head">
          <div>
            <div className="eyebrow">Run Stats</div>
            <h2>{live ? 'So far' : 'Final stats'}</h2>
          </div>
          <p className="section-note">Times leave out breaks between sessions. Kills come from Bungie&rsquo;s post-game reports, which arrive after each dungeon session ends, for Guardians signed in with Bungie.</p>
        </header>
      )}

      <div className="stat-tiles">
        <Tile label="Run time" value={clock(t.ms)} />
        {current && <Tile label="This encounter" value={clock(current.ms)} note={current.encounter} />}
        <Tile label="Encounters" value={`${t.cleared}/${t.total}`} />
        <Tile label="Wipes" value={String(t.wipes)} />
        <Tile label="Deaths" value={String(t.deaths)} />
        <Tile label="Kills" value={t.kills === null ? '–' : t.kills.toLocaleString('en')} note={t.kills === null ? 'After a session ends' : undefined} />
      </div>

      <div className="panel stat-panel">
        <div className="stat-panel-head"><span className="eyebrow">Fireteam Integrity</span><ChartKey /></div>
        <IntegrityChart run={run} now={now} />
      </div>

      <div className="stat-cols">
        <div className="panel stat-panel">
          <div className="stat-panel-head"><span className="eyebrow">Splits</span>{best.size > 0 && <span className="muted small">Best: fastest in archived runs</span>}</div>
          {rows.length === 0 ? <Empty>No encounters yet</Empty> : (
            <div className="log-wrap">
              <table className="splits">
                <thead><tr><th>#</th><th>Encounter</th><th className="r">Time</th><th className="r">Wipes</th><th className="r">Deaths</th>{best.size > 0 && <th className="r">Best</th>}</tr></thead>
                <tbody>
                  {rows.map((s, i) => {
                    const pb = best.get(s.id)
                    const record = !s.current && pb !== undefined && s.ms < pb
                    return (
                      <tr key={`${s.id}-${i}`} className={s.current ? 'is-now' : ''}>
                        <td className="mono muted">{i + 1}</td>
                        <td>
                          <span className="split-name">{s.encounter}{s.final && <span className="tag tag-final">Final boss</span>}{s.current && <span className="tag tag-now">In progress</span>}{record && <span className="tag tag-pb">New best</span>}</span>
                          <span className="muted small">{s.dungeon}</span>
                        </td>
                        <td className="r mono">{clock(s.ms)}</td>
                        <td className={`r mono ${s.wipes ? 'tone-danger' : 'muted'}`}>{s.wipes}</td>
                        <td className={`r mono ${s.deaths ? '' : 'muted'}`}>{s.deaths}</td>
                        {best.size > 0 && <td className="r mono muted">{pb === undefined ? '–' : clock(pb)}</td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="panel stat-panel">
          <div className="stat-panel-head"><span className="eyebrow">Highlights</span></div>
          {hl.length === 0 ? <Empty>Highlights appear after the first clear</Empty> : (
            <ul className="highlights">
              {hl.map((h, i) => <li key={i}><span className="hl-label">{h.label}</span><strong className="hl-value">{h.value}</strong>{h.note && <span className="muted small">{h.note}</span>}</li>)}
            </ul>
          )}
        </div>
      </div>

      <div className="guardian-stats">
        {run.players.map((p) => <GuardianStats key={p.id} run={run} p={p} />)}
      </div>
    </section>
  )
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="panel stat-tile">
      <span className="eyebrow">{label}</span>
      <strong className="stat-value mono">{value}</strong>
      {note && <span className="muted small stat-note">{note}</span>}
    </div>
  )
}

const MARK: Partial<Record<IntegrityPoint['kind'], { label: string; cls: string }>> = {
  clear: { label: 'Clear', cls: 'mk-clear' }, chest: { label: 'Secret chest', cls: 'mk-clear' },
  death: { label: 'Death', cls: 'mk-death' }, wipe: { label: 'Wipe', cls: 'mk-wipe' },
}

function ChartKey() {
  return (
    <ul className="chart-key" aria-hidden="true">
      <li><span className="mk mk-clear" />Clear or chest</li>
      <li><span className="mk mk-death" />Death</li>
      <li><span className="mk mk-wipe" />Wipe</li>
    </ul>
  )
}

/**
 * Integrity as a step line against play time, with a marker on every change (clear, chest, death,
 * wipe) and a dashed line at one wipe's cost. Hover or tap for the event at that point.
 */
function IntegrityChart({ run, now }: { run: Run; now: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(640)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const pts = integritySeries(run, now)
  const H = 180, L = 36, R = 14, T = 12, B = 26
  const max = Math.max(run.ruleset.integrity.max, ...pts.map((p) => p.value))
  const span = Math.max(1, pts[pts.length - 1].t)
  const x = (t: number) => L + (t / span) * (w - L - R)
  const y = (v: number) => T + (1 - v / max) * (H - T - B)
  let d = `M${x(0)},${y(pts[0].value)}`
  for (const p of pts.slice(1)) d += `H${x(p.t)}V${y(p.value)}`
  const area = `${d}V${y(0)}H${x(0)}Z`
  const marks = pts.map((p, i) => ({ p, i })).filter(({ p }) => MARK[p.kind])
  const wipe = run.ruleset.integrity.wipe
  const pick = (clientX: number) => {
    const r = box.current?.getBoundingClientRect()
    if (!r || !marks.length) return
    const px = clientX - r.left
    setHover(marks.reduce((a, b) => (Math.abs(x(b.p.t) - px) < Math.abs(x(a.p.t) - px) ? b : a)).i)
  }
  const h = hover === null ? null : pts[hover]
  return (
    <div className="int-chart" ref={box} onMouseMove={(e) => pick(e.clientX)} onMouseLeave={() => setHover(null)} onTouchStart={(e) => pick(e.touches[0].clientX)}>
      <svg width={w} height={H} role="img" aria-label={`Integrity over the run: started at ${pts[0].value}, now ${run.integrity} of ${max}. ${marks.length} changes.`}>
        <line className="ic-grid" x1={L} x2={w - R} y1={y(max)} y2={y(max)} />
        <line className="ic-axis" x1={L} x2={w - R} y1={y(0)} y2={y(0)} />
        {wipe < max && <>
          <line className="ic-wipe" x1={L} x2={w - R} y1={y(wipe)} y2={y(wipe)} />
          <text className="ic-label" x={w - R} y={y(wipe) - 4} textAnchor="end">One wipe ({wipe})</text>
        </>}
        <text className="ic-label" x={L - 6} y={y(max) + 4} textAnchor="end">{max}</text>
        <text className="ic-label" x={L - 6} y={y(0) + 4} textAnchor="end">0</text>
        <text className="ic-label" x={L} y={H - 6}>0:00</text>
        <text className="ic-label" x={w - R} y={H - 6} textAnchor="end">{clock(span)}</text>
        <path className="ic-area" d={area} />
        <path className="ic-line" d={d} />
        {h && <line className="ic-cross" x1={x(h.t)} x2={x(h.t)} y1={T} y2={y(0)} />}
        {marks.map(({ p, i }) => <circle key={i} className={`ic-mark ${MARK[p.kind]!.cls}`} cx={x(p.t)} cy={y(p.value)} r={hover === i ? 6 : 4.5} />)}
        <circle className="ic-now" cx={x(span)} cy={y(pts[pts.length - 1].value)} r={3} />
      </svg>
      {h && (
        <div className="ic-tip" style={{ left: Math.min(Math.max(x(h.t), 90), w - 90) }}>
          <strong>{MARK[h.kind]?.label} &middot; {clock(h.t)}</strong>
          <span>{h.text}</span>
          <span className="mono">Integrity {h.value}{h.delta ? ` (${h.delta > 0 ? '+' : '−'}${Math.abs(h.delta)})` : ''}</span>
        </div>
      )}
    </div>
  )
}

/** A Guardian's numbers: deaths and progress from the run, combat from Bungie. */
function GuardianStats({ run, p }: { run: Run; p: Player }) {
  const c = combat(p)
  const tierUps = run.log.filter((e) => e.kind === 'upgrade' && e.text.startsWith(`${p.name}'s `)).length
  const pct = c.kills ? Math.round((100 * c.precision) / c.kills) : 0
  return (
    <article className="panel g-stats" aria-label={`${p.name} stats`}>
      <header className="g-stats-head"><ElementMark element={p.element} size={18} /><strong>{p.name}</strong><span className="muted small">{p.element} {p.cls}</span></header>
      <dl className="g-stats-grid">
        <div><dt>Deaths</dt><dd>{p.deaths ?? 0}</dd></div>
        <div><dt>Unlocked</dt><dd>{p.unlocked.length}</dd></div>
        <div><dt>Artifact perks</dt><dd>{p.artifact.length}</dd></div>
        <div><dt>Tier-ups</dt><dd>{tierUps}</dd></div>
      </dl>
      {c.reports > 0 ? <>
        <div className="eyebrow g-stats-sub">From Bungie &middot; {c.reports} session{c.reports === 1 ? '' : 's'}</div>
        <dl className="g-stats-grid">
          <div><dt>Kills</dt><dd>{c.kills.toLocaleString('en')}</dd></div>
          <div><dt>Assists</dt><dd>{c.assists.toLocaleString('en')}</dd></div>
          <div><dt>Precision</dt><dd>{pct}%</dd></div>
          <div><dt>Super</dt><dd>{c.super}</dd></div>
          <div><dt>Grenade</dt><dd>{c.grenade}</dd></div>
          <div><dt>Melee</dt><dd>{c.melee}</dd></div>
        </dl>
        {c.weapons.length > 0 && (
          <ol className="weapon-kills">
            {c.weapons.slice(0, 4).map((w) => (
              <li key={w.name}><span>{w.name}</span><span className="wk-bar" style={{ ['--w' as string]: `${(100 * w.kills) / c.weapons[0].kills}%` }} /><span className="mono">{w.kills}</span></li>
            ))}
          </ol>
        )}
      </> : <p className="small muted g-stats-note">{p.bungie ? 'Kills appear when a dungeon session ends (Bungie’s post-game report).' : 'Not signed in with Bungie, so no kill stats.'}</p>}
      {c.live.length > 0 && (
        <div className="g-live">
          <div className="eyebrow g-stats-sub">Kill trackers, live</div>
          <ul>{c.live.slice(0, 4).map((t) => <li key={t.id}><span>{t.name}</span><span className="mono">+{t.kills}</span></li>)}</ul>
        </div>
      )}
    </article>
  )
}
