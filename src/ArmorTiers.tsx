import { tierArmor, type ClassType, type Rarity } from './data'
import type { ArmorMode } from './model'
import { useIcons } from './icons'

/** A grey helmet and a Legendary one for each class, for the first and last steps (real Bungie items). */
const ENDS: Record<ClassType, { grey: string; legendary: string }> = {
  Titan: { grey: 'Brave Titan Helm', legendary: 'Calamity Rig Helm' },
  Hunter: { grey: 'Daring Hunter Mask', legendary: 'Calamity Rig Mask' },
  Warlock: { grey: 'Wise Warlock Hood', legendary: 'Calamity Rig Cover' },
}

const STEPS: { tier: Rarity; label: string }[] = [
  { tier: 'Common', label: 'Grey' }, { tier: 'Uncommon', label: 'Green' }, { tier: 'Rare', label: 'Blue' }, { tier: 'Legendary', label: 'Legendary drop' },
]

/** A helmet outline, for steps with no real icon. */
function Helmet() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="at-glyph">
      <path d="M6 19c0-6.4 4.5-11 10-11s10 4.6 10 11v4h-6.5l-1.5-4h-4l-1.5 4H6z" />
      <path d="M11 15h10" />
    </svg>
  )
}

/**
 * The two ways armor climbs, side by side: real pieces change the item at each tier; simulated keeps
 * the same grey piece and only its colour in the app changes. Both end on a Legendary drop.
 */
export function ArmorTiersGraphic({ cls, chosen }: { cls: ClassType; chosen?: ArmorMode }) {
  const icons = useIcons()
  // The class's own pieces: its grey helmet, the tier pieces (real) or the grey one again (simulated), a Legendary.
  const piece = (mode: ArmorMode, tier: Rarity) => {
    const name = tier === 'Common' || (mode === 'simulated' && tier !== 'Legendary') ? ENDS[cls].grey
      : tier === 'Legendary' ? ENDS[cls].legendary : tierArmor(cls, 'Helmet', tier)
    return name ? icons.gear(name, 'Helmet', tier === 'Legendary' || tier === 'Common' || mode === 'collections' ? tier : 'Common') : undefined
  }
  const row = (mode: ArmorMode) => (
    <div className={`at-row ${chosen === mode ? 'is-chosen' : ''}`}>
      <span className="at-mode">{mode === 'collections' ? 'Real pieces' : 'Simulated'}</span>
      <ol className="at-steps">
        {STEPS.map((s, i) => {
          const icon = piece(mode, s.tier)
          return (
            <li key={s.tier} className={`at-step r-${s.tier.toLowerCase()}`} style={{ ['--i' as string]: i }}>
              <span className={`at-tile ${mode === 'simulated' && i > 0 && i < 3 ? 'is-tinted' : ''}`}>{icon ? <img src={icon} alt="" loading="lazy" /> : <Helmet />}</span>
              <span className="at-label">{s.label}</span>
            </li>
          )
        })}
      </ol>
      <span className="at-note">{mode === 'collections' ? 'A different piece at each tier, pulled in game.' : 'The same grey piece all the way; only the app’s colour changes.'}</span>
    </div>
  )
  return (
    <figure className="armor-tiers" aria-label="Real pieces versus simulated armor tiers">
      {row('collections')}
      {row('simulated')}
      <figcaption className="muted small">Either way the slot climbs on the same drops, and reaching Legendary works the same. Weapons always use real pieces.</figcaption>
    </figure>
  )
}
