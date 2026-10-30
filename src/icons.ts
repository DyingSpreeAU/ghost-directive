// Item and plug icons from Bungie, by name (public/bungie-icons.json, made by tools/fetch_sources.py).
// Loaded once on first use. Where the file or bungie.net can't be reached (the claude.ai build),
// tiles fall back to a rarity-coloured initial.

import { useEffect, useState } from 'react'

type IconTable = {
  gear: Record<string, string>; plugs: Record<string, string>; artifacts?: Record<string, string>
  /** "name|slot" icons for names shared across slots (an armor set's pieces all share its name). */
  gearBySlot?: Record<string, string>
  /** Each artifact's own perk icons: perk names repeat across seasons with different art. */
  artifactPerks?: Record<string, Record<string, string>>
}

const ROOT = 'https://www.bungie.net/common/destiny2_content/icons/'
let table: Promise<IconTable | null> | null = null
let loaded: IconTable | null = null

function load() {
  table ??= fetch('/bungie-icons.json')
    .then((r) => (r.ok ? (r.json() as Promise<IconTable>) : null))
    .then((t) => (loaded = t))
    .catch(() => null)
  return table
}

/** Icon URLs for gear, subclass/artifact plugs and artifacts; each lookup returns undefined until loaded. */
export function useIcons() {
  const [t, setT] = useState<IconTable | null>(loaded)
  useEffect(() => { if (!t) load().then(setT) }, [t])
  return {
    /** Pass the slot wherever it's known: armor set pieces share a name, so the name alone may give another piece's icon. */
    gear: (name: string, slot?: string) => { const hit = (slot && t?.gearBySlot?.[`${name}|${slot}`]) || t?.gear[name]; return hit ? ROOT + hit : undefined },
    plug: (name: string) => (t?.plugs[name] ? ROOT + t.plugs[name] : undefined),
    artifact: (name: string) => (t?.artifacts?.[name] ? ROOT + t.artifacts[name] : undefined),
    /** An artifact perk's icon as that artifact has it, else the icon for the name. */
    artifactPerk: (artifact: string | undefined, perk: string) => {
      const own = artifact ? t?.artifactPerks?.[artifact] : undefined
      const hit = own && (own[perk] ?? Object.entries(own).find(([n]) => n.toLowerCase() === perk.toLowerCase())?.[1])
      return hit ? ROOT + hit : t?.plugs[perk] ? ROOT + t.plugs[perk] : undefined
    },
  }
}
