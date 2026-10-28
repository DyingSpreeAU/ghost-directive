// Item and plug icons from Bungie, by name (public/bungie-icons.json, made by tools/fetch_sources.py).
// Loaded once on first use. Where the file or bungie.net can't be reached (the claude.ai build),
// tiles fall back to a rarity-coloured initial.

import { useEffect, useState } from 'react'

type IconTable = { gear: Record<string, string>; plugs: Record<string, string> }

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

/** Icon URLs for gear and subclass/artifact plugs; both lookups return undefined until loaded. */
export function useIcons() {
  const [t, setT] = useState<IconTable | null>(loaded)
  useEffect(() => { if (!t) load().then(setT) }, [t])
  return {
    gear: (name: string) => (t?.gear[name] ? ROOT + t.gear[name] : undefined),
    plug: (name: string) => (t?.plugs[name] ? ROOT + t.plugs[name] : undefined),
  }
}
