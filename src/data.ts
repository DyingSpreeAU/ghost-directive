import { COMPENDIUM } from './compendium'

// Static game content. Everything here is data-driven so it can be revised
// when Destiny 2 content changes without touching run logic.

export type ClassType = 'Hunter' | 'Titan' | 'Warlock'
/** A committed subclass. Prismatic is a subclass, not a damage type. */
export type Element = 'Solar' | 'Arc' | 'Void' | 'Stasis' | 'Strand' | 'Prismatic'
export type DamageElement = Exclude<Element, 'Prismatic'>
export type AbilityKind = 'super' | 'grenade' | 'melee' | 'aspect' | 'fragment'
export type Rarity = 'Common' | 'Uncommon' | 'Rare' | 'Legendary' | 'Exotic'
export type Slot =
  | 'Kinetic' | 'Energy' | 'Power'
  | 'Helmet' | 'Gauntlets' | 'Chest' | 'Legs' | 'Class Item'

export const CLASSES: ClassType[] = ['Hunter', 'Titan', 'Warlock']
export const ELEMENTS: Element[] = ['Solar', 'Arc', 'Void', 'Stasis', 'Strand', 'Prismatic']
export const DAMAGE_ELEMENTS: DamageElement[] = ['Solar', 'Arc', 'Void', 'Stasis', 'Strand']
export const ABILITY_KINDS: AbilityKind[] = ['super', 'grenade', 'melee', 'aspect', 'fragment']
export const RARITIES: Rarity[] = ['Common', 'Uncommon', 'Rare', 'Legendary', 'Exotic']
export const WEAPON_SLOTS: Slot[] = ['Kinetic', 'Energy', 'Power']
export const ARMOR_SLOTS: Slot[] = ['Helmet', 'Gauntlets', 'Chest', 'Legs', 'Class Item']
export const ALL_SLOTS: Slot[] = [...WEAPON_SLOTS, ...ARMOR_SLOTS]

export const KIND_LABEL: Record<AbilityKind, string> = {
  super: 'Super', grenade: 'Grenade', melee: 'Melee', aspect: 'Aspect', fragment: 'Fragment',
}

export const ELEMENT_COLOR: Record<Element, string> = {
  Solar: '#f2721b', Arc: '#7fe3f0', Void: '#b38be8', Stasis: '#5b8cff', Strand: '#3ddc84', Prismatic: '#f39ad9',
}

// Abilities and Exotic armor come from the Destiny Data Compendium (src/compendium.ts, generated).
const C = COMPENDIUM as unknown as {
  fragments: Record<Element, string[]>
  grenades: Record<Element, string[]>
  /** Prismatic kits carry their own grenade list; element subclasses share theirs. */
  kits: Record<ClassType, Record<Element, { super: string[]; melee: string[]; aspect: string[]; grenade?: string[] }>>
  desc: Record<string, string>
  exotics: Record<ClassType, { name: string; perk: string; brief: string; slot: Slot; synergy: Element | null }[]>
}

export type Ability = { id: string; kind: AbilityKind; name: string; element: Element }

export function abilityId(element: Element, kind: AbilityKind, name: string) {
  return `${element}|${kind}|${name}`
}

/** Every ability a class can unlock on one committed subclass. */
/** Each class's Prismatic grenade is part of the Prismatic base kit: always available, never a choice. */
const PRISMATIC_BASE_GRENADES = ['Hailfire Spike', 'Electrified Snare', 'Freezing Singularity']

/** Abilities a subclass always has, without unlocking them. */
export function baseKit(cls: ClassType, element: Element): string[] {
  if (element !== 'Prismatic') return []
  return subclassAbilities(cls, element).filter((a) => a.kind === 'grenade' && PRISMATIC_BASE_GRENADES.includes(a.name)).map((a) => a.id)
}

export function subclassAbilities(cls: ClassType, element: Element): Ability[] {
  const kit = C.kits[cls][element]
  const make = (kind: AbilityKind, names: string[]) =>
    names.map((name) => ({ id: abilityId(element, kind, name), kind, name, element }))
  return [
    ...make('super', kit.super),
    ...make('grenade', kit.grenade ?? C.grenades[element]),
    ...make('melee', kit.melee),
    ...make('aspect', kit.aspect),
    ...make('fragment', C.fragments[element]),
  ]
}

/** One-line description from the compendium, if it has one. */
export const abilityDesc = (id: string): string | undefined => C.desc[id]

export function abilityById(id: string): Ability {
  const [element, kind, name] = id.split('|') as [Element, AbilityKind, string]
  return { id, element, kind, name }
}

// ---- Exotic armor (slots from Bungie's manifest; synergy inferred from the perk text)

export type ExoticArmor = { name: string; slot: Slot; synergy?: Element; perk: string; brief: string }

export const EXOTIC_ARMOR: Record<ClassType, ExoticArmor[]> = Object.fromEntries(
  (['Hunter', 'Titan', 'Warlock'] as const).map((cls) => [cls, C.exotics[cls].map((e) => ({ ...e, synergy: e.synergy ?? undefined }))]),
) as Record<ClassType, ExoticArmor[]>

// ---- Example Vault pool, used in No Login mode until a player enters their own

export type VaultEntry = { name: string; slot: Slot; rarity: Rarity; element?: Element; archetype?: string; note?: string }

export const EXAMPLE_VAULT: VaultEntry[] = [
  { name: 'Fatebringer', slot: 'Kinetic', rarity: 'Legendary', archetype: 'Hand Cannon' },
  { name: 'Rose', slot: 'Kinetic', rarity: 'Legendary', archetype: 'Hand Cannon' },
  { name: 'Krait', slot: 'Kinetic', rarity: 'Legendary', archetype: 'Auto Rifle' },
  { name: 'Succession', slot: 'Kinetic', rarity: 'Legendary', archetype: 'Sniper Rifle' },
  { name: 'Rufus’s Fury', slot: 'Kinetic', rarity: 'Legendary', element: 'Strand', archetype: 'Auto Rifle' },
  { name: 'Hung Jury SR4', slot: 'Kinetic', rarity: 'Legendary', archetype: 'Scout Rifle' },
  { name: 'Calus Mini-Tool', slot: 'Energy', rarity: 'Legendary', element: 'Solar', archetype: 'Submachine Gun' },
  { name: 'Zaouli’s Bane', slot: 'Energy', rarity: 'Legendary', element: 'Solar', archetype: 'Hand Cannon' },
  { name: 'Funnelweb', slot: 'Energy', rarity: 'Legendary', element: 'Void', archetype: 'Submachine Gun' },
  { name: 'Riptide', slot: 'Energy', rarity: 'Legendary', element: 'Stasis', archetype: 'Fusion Rifle' },
  { name: 'Trinary System', slot: 'Energy', rarity: 'Legendary', element: 'Arc', archetype: 'Fusion Rifle' },
  { name: 'Indebted Kindness', slot: 'Energy', rarity: 'Legendary', element: 'Void', archetype: 'Sidearm' },
  { name: 'Apex Predator', slot: 'Power', rarity: 'Legendary', element: 'Solar', archetype: 'Rocket Launcher' },
  { name: 'Hothead', slot: 'Power', rarity: 'Legendary', element: 'Solar', archetype: 'Rocket Launcher' },
  { name: 'Cataclysmic', slot: 'Power', rarity: 'Legendary', element: 'Solar', archetype: 'Linear Fusion Rifle' },
  { name: 'Edge Transit', slot: 'Power', rarity: 'Legendary', element: 'Void', archetype: 'Grenade Launcher' },
  { name: 'Falling Guillotine', slot: 'Power', rarity: 'Legendary', element: 'Void', archetype: 'Sword' },
  { name: 'Ignition Code', slot: 'Power', rarity: 'Legendary', element: 'Arc', archetype: 'Grenade Launcher' },
  ...(['Iron Forerunner', 'Deep Explorer', 'Collective Psyche', 'Pathfinder', 'Lustrous', 'Techsec'] as const).flatMap(
    (set) => ARMOR_SLOTS.map((slot) => ({ name: `${set} ${slot === 'Class Item' ? 'Mark/Bond/Cloak' : slot}`, slot, rarity: 'Legendary' as Rarity, archetype: 'Armor' })),
  ),
]

// ---- Artifacts (from the compendium). Each player commits to one for the run.

export type ArtifactPerk = { name: string; tier: 1 | 2 | 3; desc: string }
export type ArtifactDef = { name: string; season: string; focus: string; perks: ArtifactPerk[] }
export const ARTIFACTS: ArtifactDef[] = (COMPENDIUM as unknown as { artifacts: ArtifactDef[] }).artifacts
export const artifactByName = (name: string | undefined) => ARTIFACTS.find((a) => a.name === name)
export const artifactPerk = (artifact: string | undefined, perk: string) => artifactByName(artifact)?.perks.find((p) => p.name === perk)

// ---- Dungeon art: each dungeon's activity banner (pgcrImage in Bungie's DestinyActivityDefinition).
// Bungie has no separate images for encounters, so every encounter uses its dungeon's banner.
const DUNGEON_ART: Record<string, string> = {
  'shattered-throne': 'mission_labyrinth.jpg',
  'pit-of-heresy': 'dungeon_pit_of_heresy.jpg',
  'prophecy': 'dungeon_prophecy.jpg',
  'grasp-of-avarice': '30th-anniversary-grasp-of-avarice.jpg',
  'duality': 'dungeon_duality.jpg',
  'spire-of-the-watcher': 'dungeon_spire_of_the_watcher.jpg',
  'ghosts-of-the-deep': 'dungeon_ghosts_of_the_deep.jpg',
  'warlords-ruin': 'dungeon_ridgeline.jpg',
  'vespers-host': 'vespers_host.jpg',
  'sundered-doctrine': 'dungeon_delver.jpg',
  'equilibrium': 'dungeon_equilibrium.jpg',
}
export const dungeonArt = (id: string) => (DUNGEON_ART[id] ? `https://www.bungie.net/img/destiny_content/pgcr/${DUNGEON_ART[id]}` : undefined)

// ---- Dungeons

export type EncounterType = 'encounter' | 'final'
export type EncounterDef = { id: string; name: string; type: EncounterType; brief?: string }
export type DungeonDef = {
  id: string
  name: string
  released: string
  destination: string
  palette: [string, string, string]
  /** Secret chests before the first encounter. They are asked about when the first encounter is cleared. */
  chestsAtStart: number
  /** Secret chests between encounter i and i+1 (index i). */
  chestsAfter: number[]
  encounters: EncounterDef[]
}

/**
 * A dungeon's layout in play order, as sourced: 'E:' encounter, 'F:' final boss, 'C' a secret chest.
 * Text after ' :: ' is the encounter's one-line blurb (drafts, awaiting proofreading).
 * Encounter ids are the dungeon id plus position, so keep the order stable once runs exist.
 */
function dungeon(d: Omit<DungeonDef, 'chestsAtStart' | 'chestsAfter' | 'encounters'>, layout: string[]): DungeonDef {
  const encounters: EncounterDef[] = []
  let chestsAtStart = 0
  const chestsAfter: number[] = []
  for (const step of layout) {
    if (step === 'C') {
      if (encounters.length === 0) chestsAtStart++
      else chestsAfter[encounters.length - 1]++
      continue
    }
    const kind = step.slice(0, 2)
    const [name, brief] = step.slice(2).split(' :: ').map((x) => x.trim())
    encounters.push({ id: `${d.id}-${encounters.length}`, name, type: kind === 'F:' ? 'final' : 'encounter', brief })
    chestsAfter.push(0)
  }
  return { ...d, chestsAtStart, chestsAfter, encounters }
}

export const DUNGEONS: DungeonDef[] = [
  dungeon({ id: 'shattered-throne', name: 'The Shattered Throne', released: '2018-09', destination: 'Dreaming City', palette: ['#1d1430', '#6a3fa0', '#d9b8ff'] }, [
    'E:Erebus: The Labyrinth :: Find your way through the twisting, Taken-corrupted paths of Erebus.', 'C', 'E:Vorgeth, The Boundless Hunger :: Gather Wards of Dawn to hold off the corruption and bring the Ogre down.', 'C', 'C', 'F:D\u00fbl Incaru, the Eternal Return :: Read the sigils, kill the matching Knights, and defeat the Taken Wizard.',
  ]),
  dungeon({ id: 'pit-of-heresy', name: 'Pit of Heresy', released: '2019-10', destination: 'Moon', palette: ['#1f0d0d', '#7a1f1a', '#ff8a6a'] }, [
    'E:Necropolis :: Bank Essences of Sorrow to open the way into the Scarlet Keep.', 'E:Chamber of Suffering :: Push through the dark tunnels and the Harrow toward Zulmak.', 'F:Zulmak, Instrument of Torment :: Bank essence at the shrines and break Zulmak\u2019s shield.',
  ]),
  dungeon({ id: 'prophecy', name: 'Prophecy', released: '2020-06', destination: 'Nine\u2019s Realm', palette: ['#0b1a1f', '#246b73', '#e9ffd6'] }, [
    'E:Phalanx Echo :: Collect motes of Light and Dark and cleanse the Phalanx Echo.', 'C', 'E:Hexahedron :: Clear the Hexahedron\u2019s rooms as they shift between Light and Dark.', 'C', 'F:Kell Echo :: Bank motes, dunk the beam, and take down the Kell Echo.',
  ]),
  dungeon({ id: 'grasp-of-avarice', name: 'Grasp of Avarice', released: '2021-12', destination: 'Cosmodrome', palette: ['#14121a', '#3d5a6c', '#ffd27a'] }, [
    'C', 'E:Phry\u2019zhia The Insatiable :: Collect the Engrams and burn the Ogre down.', 'E:Sparrow Bomb Defusal :: Race the explosive Sparrow run and defuse the bombs to keep moving.', 'C', 'E:The Cannons :: Take control of the cannons and clear the deck.', 'F:Captain Avarokk the Covetous :: Break the captain\u2019s shields and take back the treasure.',
  ]),
  dungeon({ id: 'duality', name: 'Duality', released: '2022-05', destination: 'Leviathan', palette: ['#170c18', '#8a2d4d', '#ffc37a'] }, [
    'E:Sorrow Bearer, Gahlran defeated :: Find the real Gahlran among his deceivers in the Nightmare realm.', 'C', 'E:Vault Unlock :: Ring the bells and unlock the Leviathan\u2019s hidden vaults.', 'C', 'F:Nightmare of Caiatl, Princess Imperial :: Shift between realms and break the Nightmare\u2019s shield.',
  ]),
  dungeon({ id: 'spire-of-the-watcher', name: 'Spire of the Watcher', released: '2023-03', destination: 'Mars', palette: ['#1d120b', '#a3541f', '#ffd9a8'] }, [
    'C', 'E:Spire Ascent :: Power the arc conductors and climb the spire.', 'E:Akelous, the Siren\u2019s Current :: Keep the generators charged and take down the Hydra.', 'C', 'F:Persys, Primordial Ruin :: Route power through the arc nodes and burn the final Hydra.',
  ]),
  dungeon({ id: 'ghosts-of-the-deep', name: 'Ghosts of the Deep', released: '2023-05', destination: 'Titan', palette: ['#081419', '#15606f', '#a8f0ff'] }, [
    'E:Hive Ritual :: Disrupt the Lucent Hive\u2019s ritual on Titan\u2019s rigs.', 'C', 'E:Ecthar, the Shield of Savath\u00fbn :: Hunt Ecthar through the depths and break the Shield of Savath\u00fbn.', 'C', 'F:\u0160immumah ur-Nokru :: Take the shrine boons and banish the Lucent Hive priestess.',
  ]),
  dungeon({ id: 'warlords-ruin', name: 'Warlord\u2019s Ruin', released: '2023-12', destination: 'EDZ', palette: ['#0f1418', '#3b4f5e', '#ffe0b0'] }, [
    'E:Rathil, Broken Knight Chieftain :: Survive the Scorn and bring down the Broken Knight Chieftain.', 'C', 'E:Locus of Wailing Grief :: Use the buffs to fight through the frozen halls.', 'C', 'F:Hefnd\u2019s Vengeance :: Escape the Warlord\u2019s fire and defeat Hefnd.',
  ]),
  dungeon({ id: 'vespers-host', name: 'Vesper\u2019s Host', released: '2024-10', destination: 'Vesper Station', palette: ['#0a0f1d', '#2c3e8f', '#9ec4ff'] }, [
    'E:Activation :: Bring Vesper Station back online.', 'C', 'E:Raneiks Unified :: Split the Servitor and stop it from reunifying.', 'C', 'F:The Corrupted Puppeteer :: Track down the clones and destroy the Corrupted Puppeteer.',
  ]),
  dungeon({ id: 'sundered-doctrine', name: 'Sundered Doctrine', released: '2025-02', destination: 'Pale Heart', palette: ['#0f1112', '#4a5560', '#f4f1ff'] }, [
    'E:Flooded Inspection :: Read the triangle glyphs to make it through the flooded halls.', 'C', 'E:Zoetic Lockset :: Align the lenses while the Witness\u2019s disciples attack.', 'C', 'F:Kerrev, The Erased :: Solve the final doctrine and defeat Kerrev.',
  ]),
  dungeon({ id: 'equilibrium', name: 'Equilibrium', released: '2025-12', destination: 'Venus', palette: ['#10120f', '#55603a', '#e9f2c4'] }, [
    'E:Harvester :: Defeat the Harvester.', 'C', 'E:Harrow, Dregen-Apprentice :: Defeat Harrow, the Dregen-Apprentice.', 'C', 'F:Dregen Sere :: Defeat Dregen Sere.',
  ]),
]

export const dungeonById = (id: string) => DUNGEONS.find((d) => d.id === id)!

export const chestCount = (d: DungeonDef) => d.chestsAtStart + d.chestsAfter.reduce((a, b) => a + b, 0)
