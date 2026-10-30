// "How it works": an animated briefing on the mode, in the style of Destiny's own screens. Shown once
// as an intro on a first visit (clicked past to the start screen) and from the start screen any time.
// Each section animates when it scrolls into view; reduced-motion users get the finished frames.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { STANDARD } from './model'
import './explainer.css'

const I = STANDARD.integrity

/** Adds `is-in` to each section the first time it's mostly on screen. */
function useReveal() {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = root.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target) }
    }, { root: el, threshold: 0.35 })
    el.querySelectorAll('.xp-sec').forEach((s) => io.observe(s))
    return () => io.disconnect()
  }, [])
  return root
}

function Section({ n, kicker, title, children, art }: { n: string; kicker: string; title: string; children: ReactNode; art: ReactNode }) {
  return (
    <section className="xp-sec">
      <div className="xp-copy">
        <div className="xp-kicker"><span className="xp-n">{n}</span>{kicker}</div>
        <h2>{title}</h2>
        {children}
      </div>
      <div className="xp-art" aria-hidden="true">{art}</div>
    </section>
  )
}

/** Slow-turning rings and spokes behind the hero, like the Traveler's geometry. */
function Rings() {
  return (
    <svg className="xp-rings" viewBox="-200 -200 400 400" aria-hidden="true">
      <g className="xp-ring r1"><circle r="180" /><circle r="172" strokeDasharray="2 10" /></g>
      <g className="xp-ring r2">{Array.from({ length: 12 }, (_, i) => <line key={i} x1="0" y1="-150" x2="0" y2="-120" transform={`rotate(${i * 30})`} />)}<circle r="135" /></g>
      <g className="xp-ring r3"><polygon points="0,-100 87,50 -87,50" /><polygon points="0,100 87,-50 -87,-50" /></g>
      <circle className="xp-core" r="34" />
    </svg>
  )
}

function Ghost() {
  return (
    <svg className="xp-ghost" viewBox="0 0 34 34" aria-hidden="true">
      <path d="M17 2 L24 9 L17 12 L10 9 Z" />
      <path d="M26 11 L32 17 L26 23 L23 17 Z" />
      <path d="M17 32 L10 25 L17 22 L24 25 Z" />
      <path d="M8 11 L11 17 L8 23 L2 17 Z" />
      <circle cx="17" cy="17" r="3.2" className="eye" />
    </svg>
  )
}

/** A chain of dungeons drawing itself, each with encounter pips and a chest. */
function RouteArt() {
  const nodes = [[40, 150], [140, 90], [240, 140], [340, 70], [430, 120]]
  return (
    <svg viewBox="0 0 480 220" className="xp-svg">
      <polyline className="xp-draw" points={nodes.map((n) => n.join(',')).join(' ')} />
      {nodes.map(([x, y], i) => (
        <g key={i} className="xp-pop" style={{ ['--d' as string]: `${0.3 + i * 0.25}s` }}>
          <rect x={x - 14} y={y - 14} width="28" height="28" transform={`rotate(45 ${x} ${y})`} className={i === nodes.length - 1 ? 'xp-boss' : 'xp-node'} />
          {i < nodes.length - 1 && <circle cx={x + 50} cy={(y + nodes[i + 1][1]) / 2 - 6} r="4" className="xp-chest" />}
        </g>
      ))}
      <text x="430" y="170" className="xp-label" textAnchor="middle">Final boss</text>
      <text x="40" y="195" className="xp-label" textAnchor="middle">Start</text>
    </svg>
  )
}

type Beat = { v: number; kind?: 'clear' | 'death' | 'wipe' }

/**
 * The gauge's script, from the Standard protocol's numbers: a start, a few clears and a death, then
 * deaths and wipes draining it to zero.
 */
function integrityScript(): Beat[] {
  const death = I.death || 5
  let v = I.start
  const beats: Beat[] = [{ v }]
  const add = (kind: Beat['kind'], d: number) => { v = Math.max(0, Math.min(I.max, v + d)); beats.push({ v, kind }) }
  add('clear', I.clear); add('clear', I.clear); add('death', -death); add('clear', I.clear)
  const fall: ('death' | 'wipe')[] = ['death', 'wipe', 'death', 'death', 'wipe']
  for (let k = 0; v > 0 && k < 60; k++) add(fall[k % fall.length], fall[k % fall.length] === 'wipe' ? -I.wipe : -death)
  return beats
}
const SCRIPT = integrityScript()
const BEAT_MS = 1150
const OVER_MS = 3000
const LABEL = { clear: 'Clear', death: 'Death', wipe: 'Wipe' }

/** Counts from the shown number to the target over a short ease. */
function useTween(target: number, ms = 450) {
  const [shown, setShown] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    const a = from.current, t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      const v = Math.round(a + (target - a) * (1 - (1 - k) ** 3))
      setShown(v); from.current = v
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return shown
}

/**
 * The Integrity gauge, played out: clears fill it, deaths and wipes drain it, and at zero the run
 * ends. Then it starts over. The arc and the number always show the same value.
 */
function IntegrityArt() {
  const [i, setI] = useState(0)
  const [over, setOver] = useState(false)
  const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  useEffect(() => {
    if (still) return
    const last = i >= SCRIPT.length - 1
    const t = setTimeout(() => {
      if (!last) return setI(i + 1)
      if (!over) return setOver(true)
      setOver(false); setI(0)
    }, last ? (over ? OVER_MS : BEAT_MS) : i === 0 ? 1600 : BEAT_MS)
    return () => clearTimeout(t)
  }, [i, over, still])
  const beat = SCRIPT[i]
  const shown = useTween(beat.v)
  const pct = (shown / I.max) * 100
  const delta = beat.kind && i > 0 ? beat.v - SCRIPT[i - 1].v : 0
  return (
    <div className={`xp-int ${over ? 'is-over' : ''} ${pct <= 20 ? 'is-low' : ''}`}>
      <svg viewBox="0 0 200 120" className="xp-svg">
        <path d="M20 110 A80 80 0 0 1 180 110" className="xp-track" />
        <path d="M20 110 A80 80 0 0 1 180 110" className="xp-gauge" pathLength={100} style={{ strokeDashoffset: 100 - pct, opacity: shown === 0 ? 0 : 1 }} />
      </svg>
      <div className="xp-int-num">
        {over ? <span className="xp-runover">Run over</span> : <span className="xp-count">{shown}</span>}
        {beat.kind && !over && <span key={i} className={`xp-delta t-${beat.kind}`}>{delta > 0 ? '+' : '\u2212'}{Math.abs(delta)} {LABEL[beat.kind]}</span>}
      </div>
      {over && <div className="xp-shatter" />}
      <ul className="xp-int-steps">
        <li className={`t-ok ${beat.kind === 'clear' && !over ? 'is-on' : ''}`}>Clear <b>+{I.clear}</b></li>
        <li className={`t-bad ${beat.kind === 'death' && !over ? 'is-on' : ''}`}>Death <b>&minus;{I.death}</b></li>
        <li className={`t-bad ${beat.kind === 'wipe' && !over ? 'is-on' : ''}`}>Wipe <b>&minus;{I.wipe}</b></li>
      </ul>
    </div>
  )
}

/** A subclass diamond with ability slots unlocking one at a time. */
function KitArt() {
  const slots = [[100, 30], [160, 90], [100, 150], [40, 90]]
  return (
    <svg viewBox="0 0 200 180" className="xp-svg">
      <rect x="64" y="54" width="72" height="72" transform="rotate(45 100 90)" className="xp-diamond" />
      {slots.map(([x, y], i) => (
        <g key={i} className="xp-unlock" style={{ ['--d' as string]: `${0.4 + i * 0.5}s` }}>
          <polygon points={`${x},${y - 16} ${x + 14},${y - 8} ${x + 14},${y + 8} ${x},${y + 16} ${x - 14},${y + 8} ${x - 14},${y - 8}`} />
        </g>
      ))}
      <circle cx="100" cy="90" r="10" className="xp-core-sm" />
    </svg>
  )
}

/** The gear ladder: a drop climbs from Common to Legendary. */
function TierArt() {
  const tiers = [['Common', 't-common'], ['Uncommon', 't-uncommon'], ['Rare', 't-rare'], ['Legendary', 't-legendary']]
  return (
    <div className="xp-ladder">
      {tiers.slice().reverse().map(([name, cls], i) => (
        <div key={name} className={`xp-rung ${cls}`} style={{ ['--d' as string]: `${0.3 + (3 - i) * 0.45}s` }}>
          <span className="xp-chev" />{name}
        </div>
      ))}
      <span className="xp-climber" />
    </div>
  )
}

/** Three reward cards turn over; then, separately, a BONUS tier-up for one slot. */
function RewardArt() {
  return (
    <div className="xp-rewards">
      <div className="xp-cards">
        {['Ability', 'Exotic', 'Artifact perk'].map((t, i) => (
          <div key={t} className="xp-card" style={{ ['--d' as string]: `${0.2 + i * 0.25}s` }}>
            <span className="xp-card-face">{t}</span>
          </div>
        ))}
      </div>
      <div className="xp-bonus">
        <span className="xp-bonus-tag">BONUS!</span>
        <span className="xp-bonus-slot">Kinetic</span>
        <span className="tier-word t-uncommon">Uncommon</span>
        <span className="xp-bonus-arrow">&rarr;</span>
        <span className="tier-word t-rare">Rare</span>
      </div>
    </div>
  )
}

/** Four Legendaries fold into one: the trade-up. */
function ArsenalArt() {
  return (
    <div className="xp-trade">
      {[0, 1, 2, 3].map((i) => <span key={i} className="xp-in" style={{ ['--i' as string]: i }} />)}
      <span className="xp-out" />
      <span className="xp-trade-label">4 &rarr; 1</span>
    </div>
  )
}

/** Devices linking to the host's browser. */
function FireteamArt() {
  const devs = [[50, 40], [250, 40], [150, 165]]
  return (
    <svg viewBox="0 0 300 200" className="xp-svg">
      {devs.map(([x, y], i) => <line key={i} x1={x} y1={y} x2="150" y2="95" className="xp-link" style={{ ['--d' as string]: `${i * 0.3}s` }} />)}
      <circle cx="150" cy="95" r="22" className="xp-host" />
      <text x="150" y="99" textAnchor="middle" className="xp-label">Host</text>
      {devs.map(([x, y], i) => <rect key={i} x={x - 16} y={y - 12} width="32" height="24" rx="3" className="xp-dev" />)}
    </svg>
  )
}

export function Explainer({ onDone, intro }: { onDone: () => void; intro?: boolean }) {
  const root = useReveal()
  const [atEnd, setAtEnd] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onDone])
  return (
    <div className="xp" ref={root} role="dialog" aria-modal="true" aria-label="How Ghost Directive works"
      onScroll={(e) => { const t = e.currentTarget; setAtEnd(t.scrollTop + t.clientHeight >= t.scrollHeight - 40) }}>
      <button className="xp-skip" onClick={onDone}>{intro ? 'Skip intro' : 'Close'}</button>

      <header className="xp-hero xp-sec is-in">
        <Rings />
        <div className="xp-hero-copy">
          <Ghost />
          <div className="xp-kicker">A Destiny 2 dungeon challenge</div>
          <h1>Ghost Directive</h1>
          <p>Strip your Guardian back to almost nothing. Fight through a chain of dungeons as a fireteam, and earn every ability, perk and piece of gear along the way. One shared life bar. No second chances.</p>
          <span className="xp-scroll">Scroll to learn the Directive</span>
        </div>
      </header>

      <Section n="01" kicker="The route" title="A chain of dungeons" art={<RouteArt />}>
        <p>The host picks the dungeons and their order: every dungeon in release order, or a custom route. The route locks when the run begins. Clear every encounter, find the secret chests, and beat the final boss of the last dungeon to fulfil the Directive.</p>
      </Section>

      <Section n="02" kicker="Fireteam Integrity" title="One shared life" art={<IntegrityArt />}>
        <p>The whole fireteam shares <b>Integrity</b>. It starts at {I.start}. Every clear restores {I.clear}; a Guardian&rsquo;s death costs {I.death}; a wipe costs {I.wipe}. Everyone dead at the same time, anywhere in the run, is a wipe. At zero, the run is over.</p>
      </Section>

      <Section n="03" kicker="Earn your kit" title="Start with a bare subclass" art={<KitArt />}>
        <p>Each Guardian commits to one subclass and starts with just a Super, a class ability, a melee and a grenade. Aspects, fragments and the rest of your kit are unlocked one at a time: every clear offers a choice of {STANDARD.rewards.unlockChoices}, and you keep one.</p>
      </Section>

      <Section n="04" kicker="Gear progression" title="Climb from grey to Legendary" art={<TierArt />}>
        <p>You start in grey gear, with a green heavy weapon. Each slot climbs <span className="tier-word t-uncommon">Uncommon</span> &rarr; <span className="tier-word t-rare">Rare</span> &rarr; <span className="tier-word t-legendary">Legendary</span>: every non-Exotic drop in a slot below Legendary moves it up one tier. Dismantle or vault the drop, and the app hands you that tier&rsquo;s weapon or armor piece. Exotics can be used at any time.</p>
      </Section>

      <Section n="05" kicker="Rewards" title="Choose one. Commit." art={<RewardArt />}>
        <p>Every encounter, secret chest and final boss hands each Guardian a choice. Final bosses offer Exotic armor from your Collections or a Legendary from your Vault, plus artifact perks from the one artifact you chose. Now and then, a <b>BONUS</b> lets you push any slot up a tier.</p>
      </Section>

      <Section n="06" kicker="Field Arsenal" title="Every slot has a limit" art={<ArsenalArt />}>
        <p>Each slot holds {STANDARD.inventory.capacity} items, and an Arsenal Expansion adds one. Once a slot reaches Legendary, trade {STANDARD.tradeUp.inputs} Legendaries or Exotics from it for your pick of {STANDARD.tradeUp.options} Legendaries from your Vault. When a slot overflows, trade up or let something go. Once you trade in, the options are locked: pick one.</p>
      </Section>

      <Section n="07" kicker="The fireteam" title="One run, every device" art={<FireteamArt />}>
        <p>The host&rsquo;s browser keeps the run. Every Guardian joins with a code from their own phone or PC, picks their own rewards and manages their own gear. Sign in with Bungie and the app reads your drops, gear and subclass for you, and moves items for you.</p>
      </Section>

      <section className="xp-sec xp-end">
        <Ghost />
        <h2>Ready, Guardian?</h2>
        <p>The app tracks the run; it doesn&rsquo;t police it. Play it straight.</p>
        <button className="btn btn-light xp-go" onClick={onDone}>{intro ? 'Enter' : 'Back to the start screen'}</button>
      </section>
      {intro && !atEnd && <button className="xp-enter" onClick={onDone}>Enter &rarr;</button>}
    </div>
  )
}
