// A basic DIM-style card for one of the player's own items: type, element, power, rolled stats,
// intrinsic frame, selected perks and mods. Used when picking a Vault weapon as a reward.

import { useEffect, useState } from 'react'
import { bungieConfigured, fetchItemPreviews, isSignedIn, type ItemPreview, type PreviewPlug } from './bungie'
import { ELEMENT_COLOR, type ClassType } from './data'
import { rarityClass } from './ui'

/** Previews of the player's own copies of these items, read from Bungie on this device. */
export function useItemPreviews(names: string[], enabled: boolean, cls?: ClassType) {
  const [data, setData] = useState<Record<string, ItemPreview> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = names.join('|')
  useEffect(() => {
    if (!enabled || !bungieConfigured || !isSignedIn() || !names.length) return
    let live = true
    fetchItemPreviews(names, cls).then((d) => live && setData(d), (e) => live && setError((e as Error).message))
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
          {item.element && <span className="ip-el" style={{ color: ELEMENT_COLOR[item.element] }}>{item.element}</span>}
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
