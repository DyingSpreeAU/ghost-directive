// A basic DIM-style card for one of the player's own items: type, element, power, rolled stats,
// intrinsic frame, selected perks and mods. Used when picking a Vault weapon as a reward.

import { useEffect, useState } from 'react'
import { bungieConfigured, fetchItemPreviews, isSignedIn, type AmmoType, type ItemPreview, type PreviewPlug } from './bungie'
import { ELEMENT_COLOR, type ClassType } from './data'
import { rarityClass } from './ui'

/** Previews of the player's own copies of these items, read from Bungie on this device. */
export function useItemPreviews(names: string[], enabled: boolean, cls?: ClassType, pinned?: Record<string, string>) {
  const [data, setData] = useState<Record<string, ItemPreview> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = names.join('|') + JSON.stringify(pinned ?? {})
  useEffect(() => {
    if (!enabled || !bungieConfigured || !isSignedIn() || !names.length) return
    let live = true
    fetchItemPreviews(names, cls, pinned).then((d) => live && setData(d), (e) => live && setError((e as Error).message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])
  return { data, error, loading: enabled && bungieConfigured && isSignedIn() && !data && !error }
}

function Plug({ plug, round }: { plug: PreviewPlug; round?: boolean }) {
  return (
    <span className={`ip-plug ${round ? 'is-round' : ''}`} title={plug.description ? `${plug.name}: ${plug.description}` : plug.name}>
      {plug.icon ? <img src={plug.icon} alt="" loading="lazy" /> : <span className="ip-plug-blank" aria-hidden="true" />}
      <span className="ip-plug-name">{plug.name}</span>
    </span>
  )
}

/** The in-game ammo mark: a round, white for primary, green for special, purple with a white outline for heavy. */
export function AmmoMark({ ammo }: { ammo: AmmoType }) {
  const fill = ammo === 'Primary' ? '#f2f2f2' : ammo === 'Special' ? '#7ed957' : '#9b5fd6'
  return (
    <span className={`ammo ammo-${ammo.toLowerCase()}`} title={`${ammo} ammo`}>
      <svg viewBox="0 0 12 20" width="10" height="17" aria-hidden="true">
        <path d="M6 1.2C3.6 3 2.6 5.6 2.6 8.4V17.4h6.8V8.4C9.4 5.6 8.4 3 6 1.2Z" fill={fill} stroke={ammo === 'Heavy' ? '#fff' : 'none'} strokeWidth="1.3" strokeLinejoin="round" />
        <rect x="2" y="17.6" width="8" height="1.6" rx="0.4" fill={fill} stroke={ammo === 'Heavy' ? '#fff' : 'none'} strokeWidth="0.8" />
      </svg>
      <span>{ammo}</span>
    </span>
  )
}

/** Short stat names for side-by-side cards. */
const SHORT: Record<string, string> = { 'Rounds Per Minute': 'RPM', 'Reload Speed': 'Reload', 'Aim Assistance': 'Aim Assist', 'Ammo Generation': 'Ammo Gen', 'Recoil Direction': 'Recoil', 'Guard Resistance': 'Guard Res.', 'Ammo Capacity': 'Ammo Cap.' }

/** The highest value of each bar stat across several items, for highlighting in a comparison. */
export function bestStats(items: ItemPreview[]) {
  const best: Record<string, number> = {}
  for (const it of items) for (const s of it.stats) if (s.bar) best[s.name] = Math.max(best[s.name] ?? 0, s.value)
  return best
}

export function ItemCard({ item, compact, best }: { item: ItemPreview; compact?: boolean; best?: Record<string, number> }) {
  return (
    <article className={`item-card ${rarityClass(item.rarity)} ${compact ? 'is-compact' : ''}`} aria-label={`${item.name} details`}>
      <header className="ip-head">
        {item.icon && <img className="ip-icon" src={item.icon} alt="" />}
        <div className="ip-title">
          <h3>{item.name}</h3>
          <span>{item.type}</span>
        </div>
        <div className="ip-power">
          {(item.ammo || item.element) && (
            <span className="ip-tags">
              {item.ammo && <AmmoMark ammo={item.ammo} />}
              {item.element && <span className="ip-el" style={{ color: ELEMENT_COLOR[item.element] }}>{item.element}</span>}
            </span>
          )}
          {item.power && <span className="mono">{item.power}</span>}
        </div>
      </header>
      {item.stats.length > 0 && (
        <dl className="ip-stats">
          {item.stats.map((s) => (
            <div key={s.name} className={`ip-stat ${best && s.bar && best[s.name] === s.value ? 'is-best' : ''}`}>
              <dt title={s.name}>{compact ? SHORT[s.name] ?? s.name : s.name}</dt>
              <dd className="mono">{s.value}</dd>
              {s.bar ? <span className="ip-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (s.value / s.max) * 100)}%` }} /></span> : <span />}
            </div>
          ))}
        </dl>
      )}
      {!item.owned && <p className="ip-note">Not on your account yet. Claim it from Collections in Destiny 2; its stats roll when you do.</p>}
      {item.intrinsic && (
        <div className="ip-intrinsic">
          <Plug plug={item.intrinsic} />
          {item.intrinsic.description && <p className="small muted">{item.intrinsic.description}</p>}
        </div>
      )}
      {item.perks.length > 0 && (
        <div className="ip-section">
          <span className="eyebrow">Perks</span>
          <div className="ip-perks">{item.perks.map((pk) => <Plug key={pk.name} plug={pk} round />)}</div>
        </div>
      )}
      {item.mods.length > 0 && (
        <div className="ip-section">
          <span className="eyebrow">Mods</span>
          <div className="ip-perks">{item.mods.map((m) => <Plug key={m.name} plug={m} />)}</div>
        </div>
      )}
      {item.flavor && <p className="ip-flavor">{item.flavor}</p>}
    </article>
  )
}
