// Run statistics. Splits, timings, Integrity over time and highlights are worked out from the run's
// log, so they exist for every run (old saves and archived runs included). Kills and weapon stats
// come from Bungie (`Player.stats`), read on each signed-in player's device.
import { dungeonById } from './data'
import type { LogEntry, Player, Run, StatSession } from './model'

/** Log entries oldest first. */
const chrono = (run: Run): LogEntry[] => [...run.log].reverse()

/**
 * Breaks between play sessions: from the last thing recorded before a run was reopened to the
 * reopening. Times on the stats page leave these out.
 */
export function pauses(run: Run): { from: number; to: number }[] {
  const log = chrono(run)
  const out: { from: number; to: number }[] = []
  log.forEach((e, i) => {
    if (i > 0 && e.kind === 'run' && e.text.startsWith('Run reopened')) out.push({ from: log[i - 1].at, to: e.at })
  })
  return out
}

/** Play time between two moments, without the breaks. */
export function activeMs(run: Run, from: number, to: number, gaps = pauses(run)): number {
  let ms = Math.max(0, to - from)
  for (const g of gaps) ms -= Math.max(0, Math.min(to, g.to) - Math.max(from, g.from))
  return Math.max(0, ms)
}

export type Split = {
  id: string; dungeon: string; encounter: string; final: boolean
  start: number; end?: number; ms: number; wipes: number; deaths: number
  /** The encounter being played now (no end yet). */
  current?: boolean
}

const encounterOf = (run: Run, id: string) => {
  for (const d of run.route) {
    const e = dungeonById(d).encounters.find((x) => x.id === id)
    if (e) return { dungeon: dungeonById(d).name, encounter: e.name, final: e.type === 'final' }
  }
  return { dungeon: '', encounter: id, final: false }
}

/** Counts a window's wipes and deaths (a death taken back cancels one). */
function losses(log: LogEntry[], from: number, to: number) {
  const inside = log.filter((e) => e.at > from && e.at <= to)
  const died = inside.filter((e) => e.kind === 'death' && / died \(death /.test(e.text)).length
  const back = inside.filter((e) => e.kind === 'death' && /last death was taken back/.test(e.text)).length
  return { wipes: inside.filter((e) => e.kind === 'wipe').length, deaths: Math.max(0, died - back) }
}

/**
 * One row per cleared encounter, in order: the time from the previous clear (or the run's start) to
 * this one, breaks left out, with the wipes and deaths in between. While the run is on, the
 * encounter being played is the last row.
 */
export function splits(run: Run, now = Date.now()): Split[] {
  const log = chrono(run)
  const gaps = pauses(run)
  const clears = log.filter((e) => e.kind === 'clear')
  const out: Split[] = []
  let start = run.startedAt
  clears.forEach((c, i) => {
    const id = run.claimed[i]
    if (!id) return
    out.push({ id, ...encounterOf(run, id), start, end: c.at, ms: activeMs(run, start, c.at, gaps), ...losses(log, start, c.at) })
    start = c.at
  })
  if (run.status === 'active') {
    const d = dungeonById(run.route[run.dIdx])
    const e = d?.encounters[run.eIdx]
    if (e) out.push({ id: e.id, dungeon: d.name, encounter: e.name, final: e.type === 'final', start, ms: activeMs(run, start, now, gaps), ...losses(log, start, now), current: true })
  }
  return out
}

/** Integrity after every change, against play time (ms from the start, breaks left out). */
export type IntegrityPoint = { t: number; at: number; value: number; kind: LogEntry['kind'] | 'start' | 'now'; text: string; delta?: number }
export function integritySeries(run: Run, now = Date.now()): IntegrityPoint[] {
  const gaps = pauses(run)
  const pts: IntegrityPoint[] = [{ t: 0, at: run.startedAt, value: run.ruleset.integrity.start, kind: 'start', text: 'Run started' }]
  for (const e of chrono(run)) {
    if (e.delta === undefined || e.delta === 0 || e.integrity === undefined) continue
    pts.push({ t: activeMs(run, run.startedAt, e.at, gaps), at: e.at, value: e.integrity, kind: e.kind, text: e.text, delta: e.delta })
  }
  const end = run.status === 'active' ? now : run.endedAt ?? pts[pts.length - 1].at
  const last = pts[pts.length - 1]
  pts.push({ t: Math.max(last.t, activeMs(run, run.startedAt, end, gaps)), at: end, value: run.integrity, kind: 'now', text: run.status === 'active' ? 'Now' : 'Run ended' })
  return pts
}

/** A Guardian's Bungie totals across the run's post-game reports. */
export function combat(p: Player) {
  const s = p.stats?.sessions ?? []
  const sum = (k: keyof Pick<StatSession, 'kills' | 'deaths' | 'assists' | 'precision' | 'grenade' | 'melee' | 'super' | 'ability' | 'seconds'>) => s.reduce((n, x) => n + x[k], 0)
  const weapons = new Map<string, { name: string; kills: number; precision: number }>()
  for (const x of s) for (const w of x.weapons) {
    const had = weapons.get(w.name) ?? { name: w.name, kills: 0, precision: 0 }
    weapons.set(w.name, { name: w.name, kills: had.kills + w.kills, precision: had.precision + w.precision })
  }
  const live = Object.entries(p.stats?.trackers ?? {}).map(([id, t]) => ({ id, name: t.name, kills: t.now - t.base })).filter((t) => t.kills > 0).sort((a, b) => b.kills - a.kills)
  return {
    reports: s.length, kills: sum('kills'), deaths: sum('deaths'), assists: sum('assists'), precision: sum('precision'),
    grenade: sum('grenade'), melee: sum('melee'), super: sum('super'), ability: sum('ability'), seconds: sum('seconds'),
    weapons: [...weapons.values()].sort((a, b) => b.kills - a.kills), live,
  }
}

/** Run-level totals. */
export function totals(run: Run, now = Date.now()) {
  const end = run.status === 'active' ? now : run.endedAt ?? now
  const total = run.route.reduce((n, d) => n + dungeonById(d).encounters.length, 0)
  const fighters = run.players.map(combat)
  return {
    ms: activeMs(run, run.startedAt, end),
    cleared: run.claimed.length, total,
    wipes: run.log.filter((e) => e.kind === 'wipe').length,
    deaths: run.players.reduce((n, p) => n + (p.deaths ?? 0), 0),
    kills: fighters.some((f) => f.reports) ? fighters.reduce((n, f) => n + f.kills, 0) : null,
  }
}

/** The fastest time for each encounter across other runs (archived), for a "best" column. */
export function bestSplits(history: Run[], except?: string): Map<string, number> {
  const best = new Map<string, number>()
  for (const r of history) {
    if (r.id === except || r.example) continue
    for (const s of splits(r)) if (!s.current && (best.get(s.id) ?? Infinity) > s.ms) best.set(s.id, s.ms)
  }
  return best
}

export type Highlight = { label: string; value: string; note?: string }
/** A few headline facts about the run so far. */
export function highlights(run: Run, now = Date.now()): Highlight[] {
  const done = splits(run, now).filter((s) => !s.current)
  const out: Highlight[] = []
  if (done.length) {
    const fast = done.reduce((a, b) => (b.ms < a.ms ? b : a))
    out.push({ label: 'Fastest clear', value: clock(fast.ms), note: fast.encounter })
    const wall = done.reduce((a, b) => (b.wipes > a.wipes || (b.wipes === a.wipes && b.ms > a.ms) ? b : a))
    out.push({ label: 'The wall', value: wall.wipes ? `${wall.wipes} wipe${wall.wipes === 1 ? '' : 's'}` : clock(wall.ms), note: wall.encounter })
    for (const b of done.filter((s) => s.final)) out.push({ label: 'Boss kill time', value: clock(b.ms), note: b.encounter })
  }
  const dead = [...run.players].sort((a, b) => (b.deaths ?? 0) - (a.deaths ?? 0))[0]
  if (dead?.deaths) out.push({ label: 'Most deaths', value: String(dead.deaths), note: dead.name })
  const fighters = run.players.map((p) => ({ p, c: combat(p) })).filter((x) => x.c.reports)
  if (fighters.length) {
    const top = fighters.reduce((a, b) => (b.c.kills > a.c.kills ? b : a))
    out.push({ label: 'Most kills', value: top.c.kills.toLocaleString('en'), note: top.p.name })
    const sharp = fighters.filter((x) => x.c.kills >= 20).reduce<(typeof fighters)[number] | null>((a, b) => (!a || b.c.precision / b.c.kills > a.c.precision / a.c.kills ? b : a), null)
    if (sharp) out.push({ label: 'Sharpest', value: `${Math.round((100 * sharp.c.precision) / sharp.c.kills)}% precision`, note: sharp.p.name })
  }
  return out
}

/** "4:07", "1:02:45". */
export function clock(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}
