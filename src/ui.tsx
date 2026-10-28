import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ELEMENT_COLOR, dungeonArt, type DungeonDef, type EncounterDef, type Element, type Rarity } from './data'

export function Modal(props: { title: string; kicker?: string; onClose?: () => void; children: ReactNode; wide?: boolean; xwide?: boolean; footer?: ReactNode }) {
  const { onClose } = props
  useEffect(() => {
    if (!onClose) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${props.wide ? 'modal-wide' : ''} ${props.xwide ? 'modal-xwide' : ''}`} role="dialog" aria-modal="true" aria-label={props.title}>
        <header className="modal-head">
          <div>
            {props.kicker && <div className="eyebrow">{props.kicker}</div>}
            <h2>{props.title}</h2>
          </div>
          {onClose && <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>}
        </header>
        <div className="modal-body">{props.children}</div>
        {props.footer && <footer className="modal-foot">{props.footer}</footer>}
      </div>
    </div>
  )
}

export const rarityClass = (r: Rarity) => `r-${r.toLowerCase()}`

export function ElementMark({ element, size = 14 }: { element: Element; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="el-mark">
      <path d="M8 1 L15 8 L8 15 L1 8 Z" fill="none" stroke={ELEMENT_COLOR[element]} strokeWidth="1.6" />
      <path d="M8 5 L11 8 L8 11 L5 8 Z" fill={ELEMENT_COLOR[element]} />
    </svg>
  )
}

export function Meter({ value, max, tone }: { value: number; max: number; tone?: 'danger' | 'warn' | 'ok' | 'light' }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100))
  return (
    <div className={`meter meter-${tone ?? 'light'}`} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Generated destination art: palette gradient, horizon bands and a sigil per encounter type. */
export function EncounterArt({ dungeon, encounter, compact }: { dungeon: DungeonDef; encounter?: EncounterDef; compact?: boolean }) {
  const [a, b, c] = dungeon.palette
  const final = encounter?.type === 'final'
  const seed = dungeon.id.length * 7
  // Bungie's banner for the dungeon, over the drawn art; if it can't load, the drawn art shows.
  const banner = dungeonArt(dungeon.id)
  const [broken, setBroken] = useState(false)
  const photo = !!banner && !broken
  return (
    <div className={`art ${compact ? 'art-compact' : ''} ${photo ? 'has-photo' : ''}`} style={{ background: `radial-gradient(120% 90% at 70% 10%, ${b} 0%, ${a} 60%)` }}>
      {photo && <img className="art-photo" src={banner} alt="" loading="lazy" onError={() => setBroken(true)} />}
      {!photo && <svg viewBox="0 0 400 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id={`h-${dungeon.id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={c} stopOpacity="0.5" />
            <stop offset="1" stopColor={a} stopOpacity="0" />
          </linearGradient>
        </defs>
        <>
          <circle cx={250 + (seed % 30)} cy="52" r="34" fill={c} fillOpacity="0.16" />
          <circle cx={250 + (seed % 30)} cy="52" r="20" fill={c} fillOpacity="0.28" />
          <path d={`M0 ${120 + (seed % 9)} L60 ${96} L120 ${118} L190 ${84} L250 ${116} L320 ${92} L400 ${112} L400 180 L0 180 Z`} fill={a} fillOpacity="0.85" />
          <path d="M0 140 L80 124 L150 138 L230 120 L300 136 L400 126 L400 180 L0 180 Z" fill={a} />
          <rect x="0" y="90" width="400" height="90" fill={`url(#h-${dungeon.id})`} opacity="0.35" />
        </>
        <g transform="translate(160 70)" stroke={c} fill="none" strokeOpacity="0.85">
          {final ? (
            <>
              <circle r="26" strokeWidth="1.5" />
              <circle r="18" strokeWidth="1" strokeDasharray="3 4" />
              <path d="M0 -26 L22.5 13 L-22.5 13 Z" strokeWidth="1.5" />
              <path d="M0 26 L22.5 -13 L-22.5 -13 Z" strokeWidth="1" />
            </>
          ) : (
            <>
              <path d="M0 -22 L19 11 L-19 11 Z" strokeWidth="1.5" />
              <path d="M0 -10 L9 5 L-9 5 Z" strokeWidth="1" fill={c} fillOpacity="0.4" />
            </>
          )}
        </g>
      </svg>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

/** Vertical list reordered by dragging a row (mouse or touch) or with arrow keys on its grip. */
export function SortableList<T>({ items, keyOf, render, onReorder, label }: {
  items: T[]
  keyOf: (t: T) => string
  render: (t: T, index: number) => ReactNode
  onReorder: (next: T[]) => void
  label: (t: T) => string
}) {
  const [drag, setDrag] = useState<{ key: string; order: T[] } | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const shown = drag ? drag.order : items
  const move = (arr: T[], from: number, to: number) => { const a = [...arr]; const [x] = a.splice(from, 1); a.splice(to, 0, x); return a }

  const onPointerDown = (e: React.PointerEvent<HTMLLIElement>, t: T) => {
    if ((e.target as HTMLElement).closest('button:not(.drag-grip), a, input, select')) return
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ key: keyOf(t), order: items })
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || !listRef.current) return
    const rows = [...listRef.current.children] as HTMLElement[]
    const from = drag.order.findIndex((x) => keyOf(x) === drag.key)
    let to = rows.findIndex((r) => e.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2)
    if (to === -1) to = rows.length - 1
    else if (to > from) to -= 1
    if (to !== from) setDrag({ ...drag, order: move(drag.order, from, to) })
  }
  const finish = () => {
    if (!drag) return
    const changed = drag.order.some((x, i) => keyOf(x) !== keyOf(items[i]))
    setDrag(null)
    if (changed) onReorder(drag.order)
  }
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1
    if (to < 0 || to >= items.length) return
    e.preventDefault()
    onReorder(move(items, i, to))
    requestAnimationFrame(() => (listRef.current?.children[to]?.querySelector('.drag-grip') as HTMLElement | null)?.focus())
  }

  return (
    <ol className={`sortable ${drag ? 'is-dragging' : ''}`} ref={listRef}>
      {shown.map((t, i) => (
        <li
          key={keyOf(t)}
          className={drag?.key === keyOf(t) ? 'is-held' : ''}
          onPointerDown={(e) => onPointerDown(e, t)}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={() => setDrag(null)}
        >
          <button className="drag-grip" aria-label={`Reorder ${label(t)}, position ${i + 1} of ${shown.length}. Use arrow keys to move.`} onKeyDown={(e) => onKey(e, i)}>
            <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
              {[3, 8, 13].flatMap((y) => [2, 8].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.5" />))}
            </svg>
          </button>
          {render(t, i)}
        </li>
      ))}
    </ol>
  )
}
