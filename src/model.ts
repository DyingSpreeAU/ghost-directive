import type { RestorePoint } from './bungie'
import {
  ALL_SLOTS, CLASSES, artifactByName, DAMAGE_ELEMENTS, DUNGEONS, ELEMENTS, EXAMPLE_VAULT, EXOTIC_ARMOR, KIND_LABEL, RARITIES, STARTER_KINDS, WEAPON_SLOTS,
  abilityById, baseKit, dungeonById, nextTier, subclassAbilities, tierArmor,
  type ClassType, type Element, type StarterKind, type Rarity, type Slot, type VaultEntry,
} from './data'

// ---------------------------------------------------------------- Rulesets

export type Ruleset = {
  id: string
  name: string
  description: string
  preset: boolean
  /** `death`: Integrity lost when one Guardian dies (rulesets from before deaths existed have none). */
  integrity: { start: number; max: number; clear: number; wipe: number; death?: number }
  inventory: { capacity: number; slots: Slot[] }
  rewards: {
    unlockChoices: number
    finalBossGear: boolean
    finalBossArtifact: boolean
    chestArtifact: boolean
    chestUpgrades: boolean
    /** Show the three items inside each final-boss category before a player picks one (an easier-mode option). */
    revealCategories?: boolean
    /** Players may put off a reward choice ("Later"). Off by default: they commit when the screen opens. */
    allowLater?: boolean
  }
  tradeUp: { enabled: boolean; inputs: number; options: number; sameRarity: boolean }
  /** Gear progression: each slot climbs Common > Uncommon > Rare > Legendary. Off for rulesets from before it existed. */
  progression?: boolean
  overflow: 'guided' | 'warn'
  loadouts: { baseSlots: number }
}

/** Listed easiest to hardest; Standard is the default. */
export const PRESETS: Ruleset[] = [
  {
    id: 'grace', name: 'Vanguard Directive', preset: true,
    description: 'A softer run for learning a route: start at 75, wipes cost 10, a player death costs 2, clears restore 10, and slots hold five items.',
    integrity: { start: 75, max: 100, clear: 10, wipe: 10, death: 2 },
    inventory: { capacity: 5, slots: [...ALL_SLOTS] },
    rewards: { unlockChoices: 3, finalBossGear: true, finalBossArtifact: true, chestArtifact: true, chestUpgrades: true },
    tradeUp: { enabled: true, inputs: 4, options: 5, sameRarity: false },
    progression: true,
    overflow: 'guided',
    loadouts: { baseSlots: 2 },
  },
  {
    id: 'standard', name: 'Standard Directive', preset: true,
    description: 'The baseline: start at 50 Integrity (cap 100), +5 per clear, −20 per wipe, −5 per player death, four items per slot. Two wipes before any clears leave 10; a third ends the run.',
    integrity: { start: 50, max: 100, clear: 5, wipe: 20, death: 5 },
    inventory: { capacity: 4, slots: [...ALL_SLOTS] },
    rewards: { unlockChoices: 3, finalBossGear: true, finalBossArtifact: true, chestArtifact: true, chestUpgrades: true },
    tradeUp: { enabled: true, inputs: 4, options: 5, sameRarity: false },
    progression: true,
    overflow: 'guided',
    loadouts: { baseSlots: 1 },
  },
  {
    id: 'iron', name: 'Iron Directive', preset: true,
    description: 'Start at 40 Integrity (cap 60), wipes cost 20, a player death costs 7, three items per slot, and trade-ups need matching rarity. A second wipe before any clears ends the run.',
    integrity: { start: 40, max: 60, clear: 5, wipe: 20, death: 7 },
    inventory: { capacity: 3, slots: [...ALL_SLOTS] },
    rewards: { unlockChoices: 3, finalBossGear: true, finalBossArtifact: false, chestArtifact: true, chestUpgrades: false },
    tradeUp: { enabled: true, inputs: 4, options: 5, sameRarity: true },
    progression: true,
    overflow: 'warn',
    loadouts: { baseSlots: 0 },
  },
]

export const STANDARD = PRESETS.find((r) => r.id === 'standard')!

/**
 * Abilities equipped in game that the run hasn't unlocked. Runs started before class abilities were
 * tracked have none unlocked; their class ability isn't held against them.
 */
export function equippedNotUnlocked(p: Player): string[] {
  const legacy = !p.unlocked.some((id) => id.split('|')[1] === 'class')
  return p.configured.filter((id) => !p.unlocked.includes(id) && !(legacy && id.split('|')[1] === 'class'))
}

export function validateRuleset(r: Ruleset): string[] {
  const errs: string[] = []
  const { start, max, clear, wipe } = r.integrity
  if (!r.name.trim()) errs.push('Give the protocol a name.')
  if (max < 1) errs.push('Maximum Integrity must be at least 1.')
  if (start < 1 || start > max) errs.push('Starting Integrity must be between 1 and the maximum.')
  if (clear < 0) errs.push('Clear reward cannot be negative.')
  if (wipe < 1) errs.push('Wipe penalty must be at least 1.')
  if ((r.integrity.death ?? 0) < 0 || (r.integrity.death ?? 0) > wipe) errs.push('A player death costs 0 up to the wipe penalty.')
  if (r.inventory.capacity < 1 || r.inventory.capacity > 12) errs.push('Slot capacity must be 1–12.')
  if (r.rewards.unlockChoices < 1 || r.rewards.unlockChoices > 5) errs.push('Unlock choices must be 1–5.')
  if (r.tradeUp.inputs < 2 || r.tradeUp.inputs > 8) errs.push('Trade-up inputs must be 2–8.')
  if (r.tradeUp.options < 1 || r.tradeUp.options > 8) errs.push('Trade-up options must be 1–8.')
  if (r.loadouts.baseSlots < 0 || r.loadouts.baseSlots > 10) errs.push('Loadout slots must be 0–10.')
  return errs
}

// ---------------------------------------------------------------- Run state

export type Item = {
  id: string
  name: string
  slot: Slot
  rarity: Rarity
  equipped: boolean
  source: string
  /** Bungie item instance, when the item was detected from the player's account. */
  instanceId?: string
}

export type Loadout = { id: string; name: string; itemIds: string[]; abilityIds: string[] }

export type ChecklistKey = 'weapons' | 'greyArmor' | 'noAspects' | 'noFragments'

export const CHECKLIST: { key: ChecklistKey; label: string; hint: string }[] = [
  { key: 'weapons', label: 'Grey weapons, green heavy allowed', hint: 'Common (grey) kinetic and energy weapons. The heavy weapon can be grey or Uncommon (green), since grey heavies are scarce. Pull them from Collections where available.' },
  { key: 'greyArmor', label: 'Grey armor on every slot', hint: 'The lowest-rarity armor you can pull, in all five slots.' },
  { key: 'noAspects', label: 'No aspects', hint: 'Unequip all aspects. They unlock during the run.' },
  { key: 'noFragments', label: 'No fragments', hint: 'Unequip all fragments. They unlock during the run.' },
]

/** A slot going up a tier. Below Legendary the player dismantles the drop and uses `item`, the tier's piece. */
export type Upgrade = {
  id: string
  slot: Slot
  from: Rarity
  to: Rarity
  /** What did it: a drop (dismantle it, or keep it on reaching Legendary), a reward, or a bonus. */
  reason: 'drop' | 'reward' | 'bonus'
  drop?: { name: string; instanceId?: string }
  /** The piece to use at the new tier; chosen once (weapons are any of the rarity, armor is a fixed set). */
  item?: string
}

export type Player = {
  id: string
  /** The device that controls this Guardian; null when no device is linked. */
  clientId: string | null
  name: string
  cls: ClassType
  element: Element
  isHost: boolean
  unlocked: string[]
  /** What the player reports as configured in Destiny 2 (confirmed state). */
  configured: string[]
  checklist: Record<ChecklistKey, boolean>
  inventory: Item[]
  vault: VaultEntry[]
  /** The artifact this player committed to for the run; research only offers its perks. */
  artifactName?: string
  /** Artifact perks researched so far. */
  artifact: string[]
  capacityBonus: number
  loadoutBonus: number
  loadouts: Loadout[]
  /** Set when the player's device has synced their Bungie account (Netlify build only). */
  bungie?: BungieLink
  /** Individual deaths recorded this run. */
  deaths?: number
  /** Gear progression: each slot's tier (missing on runs from before progression: no limits). */
  tiers?: Partial<Record<Slot, Rarity>>
  /** Slots that just went up a tier, waiting for the player to swap their gear in game. */
  upgrades?: Upgrade[]
  /** A trade-up in progress: inputs already given up, options rolled once by the host. Cleared when one is picked. */
  trade?: { slot: Slot; inputs: string[]; options: VaultEntry[] }
  /** Bungie instances the player removed from the run (app only), so they aren't detected again. */
  dismissed?: string[]
  /** The Bungie.net account of the player's device, so a new device or session finds this Guardian again. */
  bungieId?: string
}

/** A weapon or armor piece that appeared on the player's account during the run. */
export type DetectedDrop = { name: string; slot: Slot; rarity: Rarity; instanceId: string; starting?: boolean }

/** What a player's device reports after reading their Destiny profile. Tokens never leave that device. */
export type BungieLink = {
  name: string
  character: string
  syncedAt: number
  vaultItems: number
  /** Tracked run items not found anywhere in their Destiny inventory or Vault. */
  missing: string[]
  /** Equipped in game on the synced character but not in the run inventory. */
  untracked: { slot: Slot; name: string }[]
  /** The subclass equipped in game at the last sync; while set, `configured` comes from Bungie. */
  subclass?: { name: string; element: Element }
  /** The artifact equipped in game at the last sync and the perks switched on in it. */
  artifact?: { name: string; matched?: string; activePerks: string[] }
  /** The synced character's emblem (bungie.net paths), shown on their Guardian's column. */
  emblem?: { icon: string; background: string }
  /** Exotic armor for this class unlocked in Collections, and which of those are on the account. Exotic rewards come only from `unlocked`. */
  exotics?: { unlocked: string[]; held: string[] }
  /** This class's Exotic class item copies on the account, each with its two rolled perks. */
  classItems?: { instanceId: string; perks: { name: string; desc?: string }[] }[]
  /** The last synced setup where everything equipped was part of the run, for "Restore my Guardian". */
  restore?: RestorePoint & { at: number }
}

export type LogKind = 'clear' | 'wipe' | 'death' | 'chest' | 'unlock' | 'drop' | 'gear' | 'artifact' | 'upgrade' | 'trade' | 'vault' | 'run'

export type LogEntry = { at: number; kind: LogKind; text: string; delta?: number; integrity?: number; where?: string }

export type RunStatus = 'active' | 'victory' | 'defeat' | 'abandoned'

export type Run = {
  id: string
  name: string
  ruleset: Ruleset
  expedition: 'custom' | 'chronological'
  route: string[]
  dIdx: number
  eIdx: number
  integrity: number
  status: RunStatus
  players: Player[]
  claimed: string[]
  chests: string[]
  /** Rewards rolled by the host, waiting for each player to choose on their own device. */
  pending: Pending[]
  /** Secret chests already answered in the gap before the current encounter. */
  chestsDone?: number
  log: LogEntry[]
  code: string
  /** Set by "Sync all": every signed-in player's device re-reads Bungie when this changes. */
  syncRequest?: number
  startedAt: number
  endedAt?: number
  example?: boolean
  /** Guardians the host removed after they left, so their device can be told. */
  departed?: { name: string; clientId: string | null }[]
}

export const uid = () => Math.random().toString(36).slice(2, 10)

/** True for a name the app gave a seat or Guardian ("Guardian 2"), which a Bungie name may replace. */
export const isDefaultName = (name: string) => /^Guardian \d+$/.test(name.trim())
/** A Bungie name without its trailing "#1234" code; only the last "#" and its digits go. */
export const bungieDisplayName = (bungieName: string) => bungieName.replace(/#\d+$/, '').trim().slice(0, 24)

export function newPlayer(n: number, cls: ClassType, element: Element): Player {
  return {
    id: uid(), clientId: null, name: `Guardian ${n}`, cls, element, isHost: n === 1,
    unlocked: [], configured: [],
    checklist: { weapons: false, greyArmor: false, noAspects: false, noFragments: false },
    inventory: [], vault: [], artifact: [], capacityBonus: 0, loadoutBonus: 0, loadouts: [],
  }
}

export function createRun(opts: {
  ruleset: Ruleset
  players: Player[]
  expedition: 'custom' | 'chronological'
  route: string[]
  code: string
  name?: string
}): Run {
  const run: Run = {
    id: uid(),
    name: opts.name || `Run ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    ruleset: structuredClone(opts.ruleset), // snapshot: later preset edits do not touch this run
    expedition: opts.expedition,
    route: opts.route,
    dIdx: 0, eIdx: 0,
    integrity: opts.ruleset.integrity.start,
    status: 'active',
    players: structuredClone(opts.players),
    claimed: [], chests: [], pending: [], log: [],
    startedAt: Date.now(),
    code: opts.code,
  }
  for (const p of run.players) {
    p.configured = [...p.unlocked]
    if (run.ruleset.progression) p.tiers = startingTiers()
  }
  log(run, 'run', `Run started under ${run.ruleset.name}. Route: ${run.route.map((d) => dungeonById(d).name).join(' → ')}.`)
  return run
}

export const CHRONOLOGICAL_ROUTE = [...DUNGEONS].sort((a, b) => a.released.localeCompare(b.released)).map((d) => d.id)

// ---------------------------------------------------------------- Queries

export function current(run: Run) {
  const dungeon = dungeonById(run.route[Math.min(run.dIdx, run.route.length - 1)])
  const encounter = dungeon.encounters[Math.min(run.eIdx, dungeon.encounters.length - 1)]
  const total = run.route.reduce((n, id) => n + dungeonById(id).encounters.length, 0)
  let done = 0
  for (let i = 0; i < run.dIdx; i++) done += dungeonById(run.route[i]).encounters.length
  done += run.eIdx
  return { dungeon, encounter, done: run.status === 'victory' ? total : done, total }
}

export function nextEncounter(run: Run) {
  const d = dungeonById(run.route[run.dIdx])
  if (run.eIdx + 1 < d.encounters.length) return { dungeon: d, encounter: d.encounters[run.eIdx + 1] }
  if (run.dIdx + 1 < run.route.length) {
    const nd = dungeonById(run.route[run.dIdx + 1])
    return { dungeon: nd, encounter: nd.encounters[0] }
  }
  return null
}

export const capacityOf = (run: Run, p: Player) => run.ruleset.inventory.capacity + p.capacityBonus
export const loadoutSlotsOf = (run: Run, p: Player) => run.ruleset.loadouts.baseSlots + p.loadoutBonus
export const itemsIn = (p: Player, slot: Slot) => p.inventory.filter((i) => i.slot === slot)
export const isOverCapacity = (run: Run, p: Player, slot: Slot) => itemsIn(p, slot).length > capacityOf(run, p)

export function loadoutValid(p: Player, l: Loadout) {
  return l.itemIds.every((id) => p.inventory.some((i) => i.id === id)) && l.abilityIds.every((id) => p.unlocked.includes(id))
}

// ---------------------------------------------------------------- Mutations (operate on a draft copy)

export function log(run: Run, kind: LogKind, text: string, delta?: number) {
  const { dungeon, encounter } = current(run)
  run.log.unshift({ at: Date.now(), kind, text, delta, integrity: run.integrity, where: `${dungeon.name} · ${encounter.name}` })
}

export function changeIntegrity(run: Run, delta: number, reason: string, kind: LogKind) {
  const before = run.integrity
  run.integrity = Math.max(0, Math.min(run.ruleset.integrity.max, run.integrity + delta))
  const applied = run.integrity - before
  const capped = delta > 0 && applied < delta ? ` (capped at ${run.ruleset.integrity.max})` : ''
  log(run, kind, `${reason}${capped}`, applied)
  if (run.integrity <= 0 && run.status === 'active') {
    run.status = 'defeat'
    run.endedAt = Date.now()
    log(run, 'run', 'Fireteam Integrity reached zero. The run has ended.')
  }
}

/** Items that can go into a trade-up: Legendary or Exotic, in any mix. */
export const tradeable = (i: Item) => (i.rarity === 'Legendary' || i.rarity === 'Exotic') && i.source !== 'starting gear'

/**
 * A Guardian left the fireteam: the host takes them out of the run so the rest can carry on.
 * Their gear, unlocks and waiting rewards go with them; Integrity is untouched.
 */
export function removePlayer(run: Run, playerId: string) {
  const p = run.players.find((x) => x.id === playerId)
  if (!p || p.isHost || run.players.length <= 1) return
  run.players = run.players.filter((x) => x !== p)
  run.pending = run.pending.filter((x) => x.playerId !== playerId)
  run.departed = [...(run.departed ?? []), { name: p.name, clientId: p.clientId }]
  log(run, 'run', `${p.name} left the fireteam and was removed from the run. ${run.players.length} Guardian${run.players.length === 1 ? '' : 's'} carry on.`)
}

/** One Guardian died: Integrity drops by the protocol's death cost and their death count goes up. */
export function recordDeath(run: Run, p: Player) {
  p.deaths = (p.deaths ?? 0) + 1
  changeIntegrity(run, -(run.ruleset.integrity.death ?? 0), `${p.name} died (death ${p.deaths}).`, 'death')
}

/** Takes back a Guardian's last recorded death (a mis-tap): restores the Integrity it cost. */
export function undoDeath(run: Run, p: Player) {
  if (!p.deaths) return
  p.deaths--
  const cost = run.ruleset.integrity.death ?? 0
  if (run.status === 'defeat' && cost > 0) { run.status = 'active'; run.endedAt = undefined }
  changeIntegrity(run, cost, `${p.name}'s last death was taken back.`, 'death')
}

export function advance(run: Run) {
  run.chestsDone = 0
  const d = dungeonById(run.route[run.dIdx])
  if (run.eIdx + 1 < d.encounters.length) run.eIdx++
  else if (run.dIdx + 1 < run.route.length) { run.dIdx++; run.eIdx = 0 }
  else {
    run.status = 'victory'
    run.endedAt = Date.now()
    log(run, 'run', 'Route complete. The fireteam survived the Directive.')
  }
}

export function addItem(run: Run, p: Player, item: Omit<Item, 'id' | 'equipped'>) {
  const it: Item = { ...item, id: uid(), equipped: false }
  p.inventory.push(it)
  log(run, 'gear', `${p.name} registered ${it.name} (${it.rarity} ${it.slot}) from ${it.source}.`)
  return it
}

/** Gear progression start: Common everywhere, except the heavy weapon at Uncommon. */
export function startingTiers(): Partial<Record<Slot, Rarity>> {
  return Object.fromEntries(ALL_SLOTS.map((s) => [s, s === 'Power' ? 'Uncommon' : 'Common']))
}

/** A slot's tier; Legendary when progression is off (or the run predates it), which means no limit. */
export function slotTier(run: Run, p: Player, slot: Slot): Rarity {
  return run.ruleset.progression && p.tiers ? p.tiers[slot] ?? 'Legendary' : 'Legendary'
}

/** Raises a slot one tier and queues the in-game swap for the player. */
export function raiseTier(run: Run, p: Player, slot: Slot, reason: Upgrade['reason'], drop?: Upgrade['drop']): Upgrade | null {
  const from = slotTier(run, p, slot)
  if (from === 'Legendary' || !p.tiers) return null
  const to = nextTier(from)
  p.tiers[slot] = to
  const up: Upgrade = { id: uid(), slot, from, to, reason, drop }
  const armor = tierArmor(p.cls, slot, to)
  if (armor) up.item = armor
  p.upgrades = [...(p.upgrades ?? []), up]
  const why = reason === 'bonus' ? 'BONUS' : reason === 'reward' ? 'a final-boss reward' : `a drop (${drop?.name ?? 'unknown'})`
  log(run, 'upgrade', `${p.name}'s ${slot} went up a tier: ${from} \u2192 ${to}, from ${why}.`)
  return up
}

/**
 * Gear arriving in the run. With progression, a non-Exotic item in a slot below Legendary raises
 * the slot one tier instead of joining the inventory; reaching Legendary keeps a dropped item.
 */
export function receiveGear(run: Run, p: Player, item: Omit<Item, 'id' | 'equipped'>, reason: 'drop' | 'reward' = 'drop'): Item | null {
  if (item.rarity === 'Exotic' || item.source === 'starting gear' || slotTier(run, p, item.slot) === 'Legendary') return addItem(run, p, item)
  const up = raiseTier(run, p, item.slot, reason, { name: item.name, instanceId: item.instanceId })
  if (up?.to === 'Legendary' && item.rarity === 'Legendary') return addItem(run, p, item)
  return null
}

/** Items leaving the run; detected ones are remembered so a Bungie sync doesn't add them back. */
function dismiss(p: Player, items: Item[]) {
  const ids = items.map((i) => i.instanceId).filter((x): x is string => !!x)
  if (ids.length) p.dismissed = [...(p.dismissed ?? []), ...ids].slice(-500)
}

export function sendToVault(run: Run, p: Player, itemIds: string[], why: string) {
  const gone = p.inventory.filter((i) => itemIds.includes(i.id))
  dismiss(p, gone)
  p.inventory = p.inventory.filter((i) => !itemIds.includes(i.id))
  if (gone.length) log(run, 'vault', `${p.name} moved ${gone.map((g) => g.name).join(', ')} to the Vault (${why}).`)
}

// ---------------------------------------------------------------- Reward generation

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Synergy is a preference, not a filter: matching items sort first, ties random. */
function favor<T>(items: T[], score: (t: T) => number): T[] {
  return shuffle(items).map((t) => ({ t, s: score(t) + Math.random() * 0.9 })).sort((a, b) => b.s - a.s).map((x) => x.t)
}

export function unlockChoices(run: Run, p: Player) {
  const eligible = subclassAbilities(p.cls, p.element).filter((a) => !p.unlocked.includes(a.id))
  return shuffle(eligible).slice(0, run.ruleset.rewards.unlockChoices)
}

export function exoticChoices(p: Player): VaultEntry[] {
  const owned = new Set(p.inventory.map((i) => i.name))
  // Signed in with Bungie: only Exotics unlocked in their Collections, which they can pull in game.
  const unlocked = p.bungie?.exotics ? new Set(p.bungie.exotics.unlocked) : null
  const pool = EXOTIC_ARMOR[p.cls].filter((e) => !owned.has(e.name) && (!unlocked || unlocked.has(e.name)))
  // Prismatic draws on every element, so any element-synergy Exotic counts as a partial match.
  const picks = favor(pool, (e) => (e.synergy === p.element ? 1 : p.element === 'Prismatic' && e.synergy ? 0.6 : e.synergy ? 0 : 0.4))
    .slice(0, 3)
    .map((e): VaultEntry => ({ name: e.name, slot: e.slot, rarity: 'Exotic' as Rarity, element: e.synergy, archetype: e.perk ? `Exotic Armor \u00b7 ${e.perk}` : 'Exotic Armor', note: e.brief }))
  // Prismatic only: now and then an Exotic class item takes a spot, but only one the player has in their Vault.
  const classItem = EXOTIC_CLASS_ITEM[p.cls]
  // The offer is one specific copy: its roll is fixed, and its two perks are shown.
  const rolls = p.bungie?.classItems ?? []
  if (p.element === 'Prismatic' && rolls.length && !owned.has(classItem) && Math.random() < 0.5) {
    const roll = rolls[Math.floor(Math.random() * rolls.length)]
    picks.splice(Math.floor(Math.random() * Math.max(1, picks.length)), picks.length >= 3 ? 1 : 0, {
      name: classItem, slot: 'Class Item', rarity: 'Exotic', element: 'Prismatic', archetype: 'Exotic Class Item',
      instanceId: roll.instanceId, perks: roll.perks,
      note: `${roll.perks.map((x) => x.name).join(' + ')}. This exact copy, from your Vault.`,
    })
  }
  return picks
}

/** Each class's Prismatic Exotic class item. */
const EXOTIC_CLASS_ITEM: Record<ClassType, string> = { Titan: 'Stoicism', Hunter: 'Relativism', Warlock: 'Solipsism' }

export const vaultPool = (p: Player) => (p.vault.length ? p.vault : EXAMPLE_VAULT)

export function legendaryWeaponChoices(p: Player): VaultEntry[] {
  const owned = new Set(p.inventory.map((i) => i.name))
  const pool = vaultPool(p).filter((v) => v.rarity === 'Legendary' && WEAPON_SLOTS.includes(v.slot) && !owned.has(v.name))
  return favor(pool, (v) => (v.element === p.element ? 1 : 0)).slice(0, 3)
}

export function tradeUpChoices(run: Run, p: Player, slot: Slot): VaultEntry[] {
  const owned = new Set(p.inventory.map((i) => i.name))
  const pool = vaultPool(p).filter((v) => v.rarity === 'Legendary' && v.slot === slot && !owned.has(v.name))
  return favor(pool, (v) => (v.element === p.element ? 1 : 0)).slice(0, run.ruleset.tradeUp.options)
}

export function artifactChoices(p: Player, n = 3) {
  const perks = artifactByName(p.artifactName)?.perks ?? []
  return shuffle(perks.map((x) => x.name).filter((m) => !p.artifact.includes(m))).slice(0, n)
}

export type ChestReward =
  | { kind: 'artifact'; mod: string }
  | { kind: 'expansion' }
  | { kind: 'archive' }

export function chestChoices(run: Run, p: Player): ChestReward[] {
  const out: ChestReward[] = []
  if (run.ruleset.rewards.chestArtifact) artifactChoices(p, 3).forEach((mod) => out.push({ kind: 'artifact', mod }))
  if (run.ruleset.rewards.chestUpgrades) {
    // Arsenal Expansion is uncommon. Loadout Archive is off while saved loadouts are hidden.
    if (Math.random() < 0.28) out.splice(Math.min(out.length, 2), 1, { kind: 'expansion' })
  }
  return out.slice(0, 3)
}

// ---------------------------------------------------------------- Compliance

export type Severity = 'critical' | 'warn' | 'info'
export type Warning = { id: string; severity: Severity; playerId?: string; title: string; rule: string; where: string }

export function computeWarnings(run: Run): Warning[] {
  const out: Warning[] = []
  const r = run.ruleset
  if (run.status === 'active' && run.integrity <= r.integrity.wipe) {
    out.push({ id: 'int-low', severity: 'critical', title: 'One more wipe ends the run', rule: `A wipe costs ${r.integrity.wipe} Integrity and the fireteam has ${run.integrity}.`, where: 'integrity' })
  }
  for (const p of run.players) {
    const cap = capacityOf(run, p)
    for (const slot of r.inventory.slots) {
      const n = itemsIn(p, slot).length
      if (n > cap) out.push({ id: `cap-${p.id}-${slot}`, severity: 'critical', playerId: p.id, title: `${slot} over capacity (${n}/${cap})`, rule: `Each slot holds ${cap} run items, including the equipped one. Move extras to the Vault.`, where: 'arsenal' })
      const eq = itemsIn(p, slot).filter((i) => i.equipped).length
      if (eq > 1) out.push({ id: `eq-${p.id}-${slot}`, severity: 'warn', playerId: p.id, title: `${eq} items marked equipped in ${slot}`, rule: 'Only one item per slot can be equipped in Destiny 2.', where: 'arsenal' })
    }
    const outOfOrder = equippedNotUnlocked(p)
    if (outOfOrder.length) out.push({ id: `abl-${p.id}`, severity: 'critical', playerId: p.id, title: `Equipped but not unlocked: ${outOfOrder.map((id) => abilityById(id).name).join(', ')}`, rule: `${outOfOrder.length === 1 ? 'It isn\u2019t' : 'They aren\u2019t'} unlocked in this run yet. Unequip ${outOfOrder.length === 1 ? 'it' : 'them'} in Destiny 2, or unlock ${outOfOrder.length === 1 ? 'it' : 'them'} from a run reward first.`, where: 'archive' })
    if (p.bungie?.subclass && p.bungie.subclass.element !== p.element) out.push({ id: `bs-${p.id}`, severity: 'critical', playerId: p.id, title: `Wrong subclass equipped: ${p.bungie.subclass.name}`, rule: `This run is committed to ${p.element}. Switch to your ${p.element} subclass in Destiny 2.`, where: 'archive' })
    const ga = p.bungie?.artifact
    if (ga && p.artifactName) {
      if (ga.matched !== p.artifactName) {
        out.push({ id: `ba-${p.id}`, severity: 'critical', playerId: p.id, title: `Wrong artifact equipped: ${ga.name}`, rule: `This run uses ${p.artifactName}. Switch artifacts in Destiny 2.`, where: 'artifact' })
      } else {
        const extra = ga.activePerks.filter((n) => !p.artifact.includes(n))
        if (extra.length) out.push({ id: `bp-${p.id}`, severity: 'critical', playerId: p.id, title: `Artifact perks on but not researched: ${extra.join(', ')}`, rule: `Only perks researched in this run should be active. Turn ${extra.length === 1 ? 'it' : 'them'} off in Destiny 2, or research ${extra.length === 1 ? 'it' : 'them'} from a run reward first.`, where: 'artifact' })
      }
    }
    if (p.bungie?.missing.length) out.push({ id: `bm-${p.id}`, severity: 'warn', playerId: p.id, title: `${p.bungie.missing.length} tracked item${p.bungie.missing.length === 1 ? '' : 's'} not found in Destiny`, rule: `Not in your characters or Vault at the last Bungie sync: ${p.bungie.missing.join(', ')}.`, where: 'arsenal' })
    if (p.bungie?.untracked.length) out.push({ id: `bu-${p.id}`, severity: 'critical', playerId: p.id, title: `Equipped in game but not in the run (${p.bungie.untracked.length})`, rule: `${p.bungie.untracked.map((u) => `${u.name} (${u.slot})`).join(', ')}. Register it if you earned it this run, or swap it out in Destiny 2.`, where: 'arsenal' })
  }
  return out
}

// ---------------------------------------------------------------- Pending rewards
// The host rolls every option when a clear or chest is recorded, so a player who
// reloads sees the same choices. Each player resolves theirs on their own device.

export type Pending = {
  id: string
  playerId: string
  kind: 'clear' | 'chest'
  where: string
  final: boolean
  unlock: string[]
  exotic: VaultEntry[]
  legendary: VaultEntry[]
  artifact: string[]
  chest: ChestReward[]
  /** BONUS: after the rewards, raise any slot one tier (gear progression, 1 in 10). */
  bonus?: boolean
}

/**
 * The next secret chest to ask about, or null. Chests sit between encounters, so they are asked
 * about one at a time after the previous encounter is cleared (or at the start of the dungeon)
 * and before the next encounter can be cleared.
 */
export function pendingChest(run: Run): { number: number; remaining: number } | null {
  if (run.status !== 'active') return null
  const { dungeon } = current(run)
  const i = run.eIdx
  const gap = i === 0 ? dungeon.chestsAtStart : dungeon.chestsAfter[i - 1] ?? 0
  const done = run.chestsDone ?? 0
  if (done >= gap) return null
  const before = i === 0 ? 0 : dungeon.chestsAtStart + dungeon.chestsAfter.slice(0, i - 1).reduce((x, y) => x + y, 0)
  return { number: before + done + 1, remaining: gap - done }
}

/** 1 in 10: a BONUS tier-up after the rewards (gear progression, while a slot is below Legendary). */
const rollBonus = (run: Run, p: Player) => !!run.ruleset.progression && ALL_SLOTS.some((s) => slotTier(run, p, s) !== 'Legendary') && Math.random() < 0.1

/** Records whether the fireteam got the next secret chest; a found chest gives everyone a chest reward. */
export function recordChest(run: Run, found: boolean) {
  const next = pendingChest(run)
  if (!next) return
  const { dungeon } = current(run)
  run.chestsDone = (run.chestsDone ?? 0) + 1
  if (!found) { log(run, 'chest', `Secret Chest ${next.number} skipped in ${dungeon.name}.`); return }
  run.chests.push(`${dungeon.id}#${next.number}`)
  log(run, 'chest', `Secret Chest ${next.number} found in ${dungeon.name}.`)
  for (const p of run.players) {
    run.pending.push({
      id: uid(), playerId: p.id, kind: 'chest', where: `${dungeon.name} \u00b7 Secret Chest ${next.number}`, final: false,
      unlock: [], exotic: [], legendary: [], artifact: [], chest: chestChoices(run, p),
      bonus: rollBonus(run, p),
    })
  }
}

/** Records a clear: Integrity, every player's reward, then on to the next encounter. */
export function recordClear(run: Run) {
  if (pendingChest(run)) return
  const { dungeon, encounter } = current(run)
  const final = encounter.type === 'final'
  const rw = run.ruleset.rewards
  run.claimed.push(encounter.id)
  changeIntegrity(run, run.ruleset.integrity.clear, `Cleared ${encounter.name}.`, 'clear')
  for (const p of run.players) {
    run.pending.push({
      id: uid(), playerId: p.id, kind: 'clear', where: `${dungeon.name} \u00b7 ${encounter.name}`, final,
      unlock: unlockChoices(run, p).map((a) => a.id),
      exotic: final && rw.finalBossGear ? exoticChoices(p) : [],
      legendary: final && rw.finalBossGear ? legendaryWeaponChoices(p) : [],
      artifact: final && rw.finalBossArtifact ? artifactChoices(p) : [],
      chest: [],
      bonus: rollBonus(run, p),
    })
  }
  if (run.status === 'active') advance(run)
}

// ---------------------------------------------------------------- Player intents
// Everything a player may change about their own Guardian. The host applies these,
// whether they come from the host's own UI or from a player's device over the lobby.

export type NewItem = Omit<Item, 'id' | 'equipped'>

export type Intent =
  | { type: 'checklist'; key: ChecklistKey; value: boolean }
  | { type: 'configure'; abilityId: string }
  | { type: 'register'; item: NewItem }
  | { type: 'equip'; itemId: string }
  | { type: 'vault'; itemIds: string[]; why: string }
  | { type: 'tradeup-start'; inputIds: string[] }
  | { type: 'tradeup'; choice: VaultEntry }
  | { type: 'loadout-save'; name: string }
  | { type: 'loadout-update'; id: string }
  | { type: 'loadout-delete'; id: string }
  | { type: 'vault-add'; entry: VaultEntry }
  | { type: 'vault-clear' }
  | { type: 'artifact-remove'; mod: string }
  | { type: 'sync-request' }
  | { type: 'death' }
  | { type: 'resolve'; pendingId: string; unlock?: string; gear?: string; mod?: string; chest?: number; drops: NewItem[]; bonusSlot?: Slot }
  | { type: 'upgrade-pick'; upgradeId: string; item: string }
  | { type: 'upgrade-done'; upgradeId: string }
  | { type: 'bungie-sync'; name: string; character: string; vault: VaultEntry[]; vaultItems: number; missing: string[]; untracked: { slot: Slot; name: string }[]; drops?: DetectedDrop[]; subclass?: { name: string; element: Element } | null; configured?: string[]; artifact?: { name: string; matched?: string; activePerks: string[] } | null; restore?: RestorePoint | null; emblem?: { icon: string; background: string } | null; exotics?: { unlocked: string[]; held: string[] } | null; equipped?: { slot: Slot; name: string; instanceId?: string }[]; classItems?: { instanceId: string; perks: { name: string; desc?: string }[] }[] }
  | { type: 'remove-item'; itemId: string; dismantled?: boolean }
  | { type: 'bungie-unlink' }

const str = (v: unknown, max = 60) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function cleanItem(raw: unknown): NewItem | string {
  const it = (raw ?? {}) as Partial<NewItem>
  const name = str(it.name)
  if (!name) return 'Item needs a name.'
  if (!ALL_SLOTS.includes(it.slot as Slot)) return 'Unknown slot.'
  if (!RARITIES.includes(it.rarity as Rarity)) return 'Unknown rarity.'
  if (it.rarity === 'Exotic' && it.slot === 'Class Item') return 'Exotic class items aren\u2019t part of runs yet.'
  return { name, slot: it.slot as Slot, rarity: it.rarity as Rarity, source: str(it.source, 30) || 'world drop' }
}

/** Applies one player's intent to the run. Returns an error message, or null on success. */
export function applyIntent(run: Run, playerId: string, raw: Intent): string | null {
  const p = run.players.find((x) => x.id === playerId)
  if (!p) return 'Guardian not found.'
  const it = raw as Intent & Record<string, unknown>
  const active = run.status === 'active'
  switch (it.type) {
    case 'checklist': {
      if (!(it.key in p.checklist)) return 'Unknown checklist item.'
      p.checklist[it.key] = !!it.value
      return null
    }
    case 'configure': {
      if (!subclassAbilities(p.cls, p.element).some((a) => a.id === it.abilityId)) return 'That ability is not on your subclass.'
      p.configured = p.configured.includes(it.abilityId) ? p.configured.filter((x) => x !== it.abilityId) : [...p.configured, it.abilityId]
      return null
    }
    case 'register': {
      if (!active) return 'The run has ended.'
      const item = cleanItem(it.item)
      if (typeof item === 'string') return item
      receiveGear(run, p, item)
      return null
    }
    case 'equip': {
      const item = p.inventory.find((i) => i.id === it.itemId)
      if (!item) return 'Item not in your run inventory.'
      const was = item.equipped
      p.inventory.forEach((i) => { if (i.slot === item.slot) i.equipped = false })
      item.equipped = !was
      return null
    }
    case 'vault': {
      if (!Array.isArray(it.itemIds)) return 'Bad request.'
      sendToVault(run, p, it.itemIds.filter((x) => typeof x === 'string'), str(it.why, 30) || 'player choice')
      return null
    }
    case 'upgrade-pick': {
      // A weapon tier piece is picked on the player's device (preferring one they own), then fixed here.
      const up = p.upgrades?.find((x) => x.id === it.upgradeId)
      if (!up) return 'That upgrade is already done.'
      if (!up.item) up.item = str(it.item, 60) || undefined
      return null
    }
    case 'upgrade-done': {
      const up = p.upgrades?.find((x) => x.id === it.upgradeId)
      if (!up) return null
      p.upgrades = p.upgrades!.filter((x) => x !== up)
      // The tier's piece joins the run; the previous tier's item stays as a spare.
      if (up.to !== 'Legendary' && up.item) addItem(run, p, { name: up.item, slot: up.slot, rarity: up.to, source: `${up.to} tier` })
      return null
    }
    case 'tradeup-start': {
      // The inputs are given up and the options rolled here, once: backing out can't re-roll them.
      if (!active) return 'The run has ended.'
      if (p.trade) return 'Finish your current trade-up first.'
      const tu = run.ruleset.tradeUp
      if (!tu.enabled) return 'Trade-ups are off in this protocol.'
      const ids = Array.isArray(it.inputIds) ? [...new Set(it.inputIds)] : []
      const inputs = p.inventory.filter((i) => ids.includes(i.id))
      if (inputs.length !== tu.inputs || ids.length !== tu.inputs) return `Pick exactly ${tu.inputs} items.`
      const slot = inputs[0].slot
      if (inputs.some((i) => i.slot !== slot || !tradeable(i))) return 'Inputs must share a slot and be Legendary or Exotic.'
      if (slotTier(run, p, slot) !== 'Legendary') return `Trade-ups need your ${slot} at Legendary.`
      if (tu.sameRarity && inputs.some((i) => i.rarity !== inputs[0].rarity)) return 'This protocol needs inputs of one rarity.'
      const options = tradeUpChoices(run, p, slot)
      if (!options.length) return `No eligible Legendary ${slot} items in your Vault pool.`
      dismiss(p, inputs)
      p.inventory = p.inventory.filter((i) => !ids.includes(i.id))
      p.trade = { slot, inputs: inputs.map((i) => i.name), options }
      log(run, 'trade', `${p.name} traded in ${inputs.map((i) => i.name).join(', ')}.`)
      return null
    }
    case 'tradeup': {
      const t = p.trade
      if (!t) return 'No trade-up in progress.'
      const choice = t.options.find((v) => v.name === str(it.choice?.name))
      if (!choice) return 'Pick one of the options you were offered.'
      p.trade = undefined
      log(run, 'trade', `${p.name} took ${choice.name} from a trade-up.`)
      addItem(run, p, { name: choice.name, slot: t.slot, rarity: 'Legendary', source: 'trade-up' })
      return null
    }
    case 'loadout-save': {
      if (p.loadouts.length >= loadoutSlotsOf(run, p)) return 'All loadout slots are used.'
      p.loadouts.push({
        id: uid(), name: str(it.name, 40) || `Loadout ${p.loadouts.length + 1}`,
        itemIds: p.inventory.filter((i) => i.equipped).map((i) => i.id),
        abilityIds: p.configured.filter((id) => p.unlocked.includes(id)),
      })
      return null
    }
    case 'loadout-update': {
      const l = p.loadouts.find((x) => x.id === it.id)
      if (!l) return 'Loadout not found.'
      l.itemIds = p.inventory.filter((i) => i.equipped).map((i) => i.id)
      l.abilityIds = p.configured.filter((id) => p.unlocked.includes(id))
      return null
    }
    case 'loadout-delete': {
      p.loadouts = p.loadouts.filter((x) => x.id !== it.id)
      return null
    }
    case 'vault-add': {
      const e = (it.entry ?? {}) as Partial<VaultEntry>
      const name = str(e.name)
      if (!name) return 'Entry needs a name.'
      if (!ALL_SLOTS.includes(e.slot as Slot)) return 'Unknown slot.'
      if (p.vault.length >= 200) return 'Vault pool is full.'
      p.vault.push({ name, slot: e.slot as Slot, rarity: 'Legendary', element: DAMAGE_ELEMENTS.includes(e.element as never) ? e.element : undefined })
      return null
    }
    case 'vault-clear': {
      p.vault = []
      return null
    }
    case 'artifact-remove': {
      p.artifact = p.artifact.filter((m) => m !== it.mod)
      return null
    }
    case 'bungie-sync': {
      // Replaces the Vault pool with what Bungie reports; reward choices then come from real items.
      const vault: VaultEntry[] = []
      const seen = new Set<string>()
      for (const raw of Array.isArray(it.vault) ? it.vault.slice(0, 800) : []) {
        const e = (raw ?? {}) as Partial<VaultEntry>
        const name = str(e.name)
        if (!name || !ALL_SLOTS.includes(e.slot as Slot) || !RARITIES.includes(e.rarity as Rarity)) continue
        const key = `${name}|${e.slot}`
        if (seen.has(key)) continue
        seen.add(key)
        vault.push({ name, slot: e.slot as Slot, rarity: e.rarity as Rarity, element: DAMAGE_ELEMENTS.includes(e.element as never) ? e.element : undefined, archetype: str(e.archetype, 40) || undefined })
      }
      const strs = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n).map((x) => str(x)).filter(Boolean) : [])
      const untracked = (Array.isArray(it.untracked) ? it.untracked.slice(0, 8) : [])
        .map((u) => ({ slot: (u as { slot: Slot }).slot, name: str((u as { name: unknown }).name) }))
        .filter((u) => ALL_SLOTS.includes(u.slot) && u.name)
      const first = !p.bungie
      const prevRestore = p.bungie?.restore
      const prevExotics = p.bungie?.exotics
      const prevClassItems = p.bungie?.classItems
      const shown = bungieDisplayName(str(it.name, 40))
      if (shown && isDefaultName(p.name)) { log(run, 'run', `${p.name} is now ${shown} (Bungie name).`); p.name = shown }
      p.vault = vault
      const sub = it.subclass && typeof it.subclass === 'object' && ELEMENTS.includes((it.subclass as { element: Element }).element)
        ? { name: str((it.subclass as { name: unknown }).name, 40), element: (it.subclass as { element: Element }).element } : undefined
      p.bungie = {
        name: str(it.name, 40) || 'Guardian', character: str(it.character, 40), syncedAt: Date.now(),
        vaultItems: Math.max(0, Math.floor(Number(it.vaultItems) || 0)), missing: strs(it.missing, 30), untracked, subclass: sub,
      }
      const art = it.artifact && typeof it.artifact === 'object' ? it.artifact as { name?: unknown; matched?: unknown; activePerks?: unknown } : null
      if (art && str(art.name)) {
        p.bungie.artifact = { name: str(art.name, 60), matched: artifactByName(str(art.matched, 60))?.name, activePerks: strs(art.activePerks, 30) }
      }
      const em = (it.emblem ?? {}) as { icon?: unknown; background?: unknown }
      if (iconPath(em.icon) && iconPath(em.background)) p.bungie.emblem = { icon: iconPath(em.icon), background: iconPath(em.background) }
      const ex = (it.exotics ?? null) as { unlocked?: unknown; held?: unknown } | null
      p.bungie.exotics = ex && Array.isArray(ex.unlocked) ? { unlocked: strs(ex.unlocked, 80), held: strs(ex.held, 80) } : prevExotics
      if (Array.isArray(it.classItems)) {
        p.bungie.classItems = it.classItems.slice(0, 20).map((c) => (c ?? {}) as { instanceId?: unknown; perks?: unknown })
          .map((c) => ({
            instanceId: str(c.instanceId, 30),
            perks: (Array.isArray(c.perks) ? c.perks.slice(0, 2) : []).map((x) => (x ?? {}) as { name?: unknown; desc?: unknown })
              .map((x) => ({ name: str(x.name, 60), desc: str(x.desc, 400) || undefined })).filter((x) => x.name),
          }))
          .filter((c) => c.instanceId && c.perks.length)
      } else if (prevClassItems) p.bungie.classItems = prevClassItems
      // Remember the setup only while it's a clean run setup, so playing something else doesn't overwrite it.
      p.bungie.restore = (untracked.length === 0 && sub?.element === p.element && cleanRestore(it.restore)) || prevRestore
      // What's equipped in game is the confirmed configuration; unlocked-vs-equipped warnings follow from it.
      if (sub && Array.isArray(it.configured)) {
        const valid = new Set(subclassAbilities(p.cls, p.element).map((a) => a.id))
        p.configured = it.configured.filter((x): x is string => typeof x === 'string' && valid.has(x))
      }
      if (first) log(run, 'run', `${p.name} linked their Bungie account (${vault.length} eligible Vault items).`)
      // New items on the account since the run started count as drops; equipped gear at the start is starting gear.
      const dismissed = new Set(p.dismissed ?? [])
      for (const raw of Array.isArray(it.drops) ? it.drops.slice(0, 40) : []) {
        const d = (raw ?? {}) as Partial<DetectedDrop>
        const instanceId = str(d.instanceId, 30)
        if (!instanceId || dismissed.has(instanceId) || p.inventory.some((x) => x.instanceId === instanceId)) continue
        // A reward pulled from Collections (or moved in by hand) is already tracked by name: link that copy instead.
        const twin = !d.starting && p.inventory.find((x) => !x.instanceId && x.name === str(d.name) && x.slot === d.slot)
        if (twin) { twin.instanceId = instanceId; continue }
        const item = cleanItem({ name: d.name, slot: d.slot, rarity: d.rarity, source: d.starting ? 'starting gear' : 'detected drop' })
        if (typeof item === 'string') continue
        const added = d.starting ? addItem(run, p, item) : receiveGear(run, p, { ...item, instanceId })
        if (added) { added.instanceId = instanceId; added.equipped = !!d.starting }
      }
      // What the character has equipped in game right now, so every device sees it on the run items.
      if (Array.isArray(it.equipped)) {
        const eq = it.equipped.slice(0, 20).map((e) => (e ?? {}) as { slot?: unknown; name?: unknown; instanceId?: unknown })
        const ids = new Set(eq.map((e) => str(e.instanceId, 30)).filter(Boolean))
        const names = new Set(eq.map((e) => `${str(e.slot)}|${str(e.name)}`))
        for (const item of p.inventory) item.equipped = item.instanceId ? ids.has(item.instanceId) : names.has(`${item.slot}|${item.name}`)
      }
      return null
    }
    case 'remove-item': {
      const item = p.inventory.find((x) => x.id === it.itemId)
      if (!item) return 'Item not in your run inventory.'
      p.inventory = p.inventory.filter((x) => x !== item)
      dismiss(p, [item])
      log(run, 'vault', it.dismantled ? `${p.name} dismantled ${item.name}.` : `${p.name} removed ${item.name} from the run (app only; it\u2019s still in Destiny 2).`)
      return null
    }
    case 'death': {
      if (run.status !== 'active') return 'The run has ended.'
      recordDeath(run, p)
      return null
    }
    case 'sync-request': {
      run.syncRequest = Date.now()
      return null
    }
    case 'bungie-unlink': {
      if (p.bungie) log(run, 'run', `${p.name} unlinked their Bungie account.`)
      p.bungie = undefined
      p.vault = []
      return null
    }
    case 'resolve': {
      const pend = run.pending.find((x) => x.id === it.pendingId && x.playerId === p.id)
      if (!pend) return 'That reward was already resolved.'
      const drops: NewItem[] = []
      for (const d of Array.isArray(it.drops) ? it.drops.slice(0, 12) : []) {
        const c = cleanItem(d)
        if (typeof c === 'string') return c
        drops.push(c)
      }
      if (it.unlock && !pend.unlock.includes(it.unlock)) return 'That unlock was not offered.'
      if (pend.unlock.length && !it.unlock) return 'Choose an unlock.'
      const gear = it.gear ? [...pend.exotic, ...pend.legendary].find((g) => g.name === it.gear) : undefined
      if (it.gear && !gear) return 'That item was not offered.'
      if (it.mod && !pend.artifact.includes(it.mod)) return 'That mod was not offered.'
      const chest = typeof it.chest === 'number' ? pend.chest[it.chest] : undefined
      if (typeof it.chest === 'number' && !chest) return 'That chest reward was not offered.'

      run.pending = run.pending.filter((x) => x.id !== pend.id)
      if (it.unlock) {
        p.unlocked.push(it.unlock)
        const a = abilityById(it.unlock)
        log(run, 'unlock', `${p.name} unlocked ${a.name} (${KIND_LABEL[a.kind]}).`)
      }
      if (gear) {
        // Below Legendary, a Vault weapon raises the slot a tier instead (gear progression).
        const added = receiveGear(run, p, { name: gear.name, slot: gear.slot, rarity: gear.rarity, source: 'final-boss reward' }, 'reward')
        // A specific copy (an Exotic class item's roll) is tracked as that exact item.
        if (added && gear.instanceId) added.instanceId = gear.instanceId
      }
      if (pend.bonus && it.bonusSlot && ALL_SLOTS.includes(it.bonusSlot) && slotTier(run, p, it.bonusSlot) !== 'Legendary') raiseTier(run, p, it.bonusSlot, 'bonus')
      if (it.mod) { p.artifact.push(it.mod); log(run, 'artifact', `${p.name} researched ${it.mod}.`) }
      if (chest?.kind === 'artifact') { p.artifact.push(chest.mod); log(run, 'artifact', `${p.name} researched ${chest.mod}.`) }
      if (chest?.kind === 'expansion') { p.capacityBonus++; log(run, 'upgrade', `${p.name} earned Arsenal Expansion: +1 capacity per slot.`) }
      if (chest?.kind === 'archive') { p.loadoutBonus++; log(run, 'upgrade', `${p.name} earned Loadout Archive: +1 loadout slot.`) }
      drops.forEach((d) => receiveGear(run, p, d))
      return null
    }
  }
  return 'Unknown action.'
}

// ---------------------------------------------------------------- Lobby

export type Seat = {
  id: string
  clientId: string | null
  name: string
  cls: ClassType
  element: Element
  /** Starting ability ids. Lobbies saved before class abilities existed have no `class`; see starterOf. */
  starter: { super: string; class?: string; melee: string; grenade: string }
  checklist: Record<ChecklistKey, boolean>
  /** Artifact chosen for the run; '' until picked. Required before the run starts. */
  artifact: string
  /** The player changed class, subclass or abilities themselves, so Bungie auto-fill leaves the seat alone. */
  custom?: boolean
  /** The Bungie.net account of the seat's device (see bindBungieId). */
  bungieId?: string
  /** The player's in-game emblem (bungie.net paths), shared by their signed-in device. */
  emblem?: { icon: string; background: string }
  ready: boolean
  isHost: boolean
}

export type Lobby = {
  code: string
  name: string
  protocolId: string
  ruleset: Ruleset
  expedition: 'custom' | 'chronological'
  route: string[]
  seats: Seat[]
}

export const MAX_SEATS = 3

export function defaultStarter(cls: ClassType, el: Element): Seat['starter'] {
  const base = baseKit(cls, el)
  const a = subclassAbilities(cls, el).filter((x) => !base.includes(x.id))
  const first = (k: string) => a.find((x) => x.kind === k)!.id
  return { super: first('super'), class: first('class'), melee: first('melee'), grenade: first('grenade') }
}

/** A seat's starting abilities, with the default class ability filled in for older saved lobbies. */
export function starterOf(seat: Seat): Record<StarterKind, string> {
  return { ...seat.starter, class: seat.starter.class ?? defaultStarter(seat.cls, seat.element).class! }
}

export function newSeat(n: number, clientId: string | null, isHost = false): Seat {
  const cls = CLASSES[(n - 1) % 3]
  const element = ELEMENTS[(n - 1) % 5]
  return {
    id: uid(), clientId, name: `Guardian ${n}`, cls, element, starter: defaultStarter(cls, element),
    checklist: { weapons: false, greyArmor: false, noAspects: false, noFragments: false },
    artifact: '', ready: false, isHost,
  }
}

export function createLobby(code: string, hostCid: string, ruleset: Ruleset): Lobby {
  return {
    code, name: '', protocolId: ruleset.id, ruleset: structuredClone(ruleset),
    expedition: 'chronological', route: [...CHRONOLOGICAL_ROUTE],
    seats: [newSeat(1, hostCid, true)],
  }
}

/** A bungie.net icon path (emblems), or '' when it isn't one. */
const iconPath = (x: unknown) => (typeof x === 'string' && /^\/common\/destiny2_content\/icons\/[\w./-]{1,120}$/.test(x) ? x : '')

function cleanRestore(raw: unknown): BungieLink['restore'] | undefined {
  const r = (raw ?? {}) as Partial<RestorePoint>
  const id = (x: unknown) => (typeof x === 'string' && /^\d{1,30}$/.test(x) ? x : '')
  if (!id(r.characterId) || !Array.isArray(r.equipped)) return undefined
  const withPlugs = (x: RestorePoint['subclass']) => x && id(x.itemId) && Array.isArray(x.plugs)
    ? { itemId: x.itemId, plugs: x.plugs.slice(0, 40).filter((y): y is [number, number] => Array.isArray(y) && Number.isInteger(y[0]) && Number.isInteger(y[1])).map(([a, b]) => [a, b] as [number, number]) }
    : undefined
  const sub = withPlugs(r.subclass)
  return { characterId: r.characterId!, equipped: r.equipped.slice(0, 20).map(id).filter(Boolean), subclass: sub, artifact: withPlugs(r.artifact), at: Date.now() }
}

/**
 * Records which Bungie account a device belongs to, and puts a returning player (new device or
 * session) back on their Guardian or seat when its old device isn't connected. Returns whether
 * anything changed.
 */
export function bindBungieId(target: { run: Run | null; lobby: Lobby | null }, clientId: string, bungieId: string, online: (cid: string) => boolean): boolean {
  if (!/^\d{1,30}$/.test(bungieId)) return false
  const list: (Player | Seat)[] = target.run ? target.run.players : target.lobby ? target.lobby.seats : []
  const mine = list.find((x) => x.clientId === clientId)
  if (mine) {
    if (mine.bungieId === bungieId) return false
    mine.bungieId = bungieId
    return true
  }
  const match = list.find((x) => x.bungieId === bungieId && !(x.clientId && online(x.clientId)))
  if (!match) return false
  match.clientId = clientId
  if (target.run) log(target.run, 'run', `${match.name} rejoined (matched by Bungie account).`)
  else if ('ready' in match) match.ready = false
  return true
}

export function runFromLobby(l: Lobby): Run {
  const players: Player[] = l.seats.map((s, i) => {
    const p = newPlayer(i + 1, s.cls, s.element)
    return { ...p, id: s.id, clientId: s.clientId, name: s.name.trim() || `Guardian ${i + 1}`, isHost: s.isHost, unlocked: [...STARTER_KINDS.map((k) => starterOf(s)[k]), ...baseKit(s.cls, s.element)], checklist: { ...s.checklist }, artifactName: s.artifact || undefined, bungieId: s.bungieId }
  })
  return createRun({ ruleset: l.ruleset, players, expedition: l.expedition, route: l.route, code: l.code, name: l.name.trim() || undefined })
}

export type LobbyIntent =
  | { type: 'seat-claim'; seatId: string | null }
  | { type: 'seat-update'; patch: Partial<Pick<Seat, 'name' | 'cls' | 'element' | 'starter' | 'checklist' | 'ready' | 'artifact' | 'emblem'>> & { auto?: boolean } }
  | { type: 'seat-leave' }

/** Seat changes from a player's device (or the host for their own seat). */
export function applyLobbyIntent(l: Lobby, clientId: string, raw: LobbyIntent, online: (cid: string) => boolean): string | null {
  const it = raw as LobbyIntent & Record<string, unknown>
  const mine = l.seats.find((s) => s.clientId === clientId)
  switch (it.type) {
    case 'seat-claim': {
      if (mine) return null
      if (it.seatId === null) {
        if (l.seats.length >= MAX_SEATS) return 'The fireteam is full.'
        l.seats.push(newSeat(l.seats.length + 1, clientId))
        return null
      }
      const seat = l.seats.find((s) => s.id === it.seatId)
      if (!seat) return 'Seat not found.'
      if (seat.clientId && online(seat.clientId)) return 'Someone is already in that seat.'
      seat.clientId = clientId
      seat.ready = false
      return null
    }
    case 'seat-update': {
      if (!mine) return 'Join a seat first.'
      const pt = (it.patch ?? {}) as Record<string, unknown>
      if (!pt.auto && (pt.cls !== undefined || pt.element !== undefined || pt.starter !== undefined)) mine.custom = true
      if (typeof pt.name === 'string') mine.name = pt.name.slice(0, 24)
      if (CLASSES.includes(pt.cls as ClassType) && pt.cls !== mine.cls) { mine.cls = pt.cls as ClassType; mine.starter = defaultStarter(mine.cls, mine.element) }
      if (ELEMENTS.includes(pt.element as Element) && pt.element !== mine.element) { mine.element = pt.element as Element; mine.starter = defaultStarter(mine.cls, mine.element) }
      if (pt.starter && typeof pt.starter === 'object') {
        const ids = subclassAbilities(mine.cls, mine.element)
        const st = pt.starter as Record<string, unknown>
        for (const k of STARTER_KINDS) {
          if (typeof st[k] === 'string' && ids.some((a) => a.id === st[k] && a.kind === k) && !baseKit(mine.cls, mine.element).includes(st[k] as string)) mine.starter[k] = st[k] as string
        }
      }
      if (pt.checklist && typeof pt.checklist === 'object') {
        for (const [k, v] of Object.entries(pt.checklist as Record<string, unknown>)) if (k in mine.checklist) mine.checklist[k as ChecklistKey] = !!v
      }
      if (typeof pt.artifact === 'string' && artifactByName(pt.artifact)) mine.artifact = pt.artifact
      const em = (pt.emblem ?? {}) as { icon?: unknown; background?: unknown }
      if (iconPath(em.icon) && iconPath(em.background)) mine.emblem = { icon: iconPath(em.icon), background: iconPath(em.background) }
      if (typeof pt.ready === 'boolean') mine.ready = pt.ready && !!mine.artifact
      return null
    }
    case 'seat-leave': {
      if (!mine || mine.isHost) return null
      l.seats = l.seats.filter((s) => s !== mine)
      return null
    }
  }
  return 'Unknown action.'
}

/** A player reclaiming their Guardian mid-run from a new device or browser. */
export function claimRunSeat(run: Run, clientId: string, playerId: string, online: (cid: string) => boolean): string | null {
  if (run.players.some((p) => p.clientId === clientId)) return null
  const p = run.players.find((x) => x.id === playerId)
  if (!p) return 'Guardian not found.'
  if (p.clientId && online(p.clientId)) return 'That Guardian is already controlled by a connected device.'
  p.clientId = clientId
  log(run, 'run', `${p.name} linked a device.`)
  return null
}

// ---------------------------------------------------------------- Example run

export function exampleRun(code: string, hostCid: string): Run {
  const a = newPlayer(1, 'Warlock', 'Solar')
  a.name = 'Ikora’s Pupil'
  a.clientId = hostCid
  const b = newPlayer(2, 'Titan', 'Void')
  b.name = 'Shieldwall'
  b.isHost = false
  const c = newPlayer(3, 'Hunter', 'Strand')
  c.name = 'Threadrunner'
  c.isHost = false
  const starters: [Player, string[]][] = [
    [a, ['Solar|super|Well of Radiance', 'Solar|class|Phoenix Dive', 'Solar|melee|Incinerator Snap', 'Solar|grenade|Healing Grenade']],
    [b, ['Void|super|Sentinel Shield', 'Void|class|Towering Barricade', 'Void|melee|Shield Throw', 'Void|grenade|Suppressor Grenade']],
    [c, ['Strand|super|Silkstrike', 'Strand|class|Gambler\'s Dodge', 'Strand|melee|Threaded Spike', 'Strand|grenade|Grapple']],
  ]
  const arts = ['Tablet of Ruin', 'Slayer Baron Apothecary Satchel', 'NPA Repulsion Regulator']
  starters.forEach(([p, ids], i) => {
    p.unlocked = ids
    p.artifactName = artifactByName(arts[i])?.name
    for (const k of Object.keys(p.checklist) as ChecklistKey[]) p.checklist[k] = true
  })
  // The example is a sandbox: its reward screens can be put off so every part can be explored.
  const ruleset = structuredClone(STANDARD)
  ruleset.rewards.allowLater = true
  const run = createRun({ ruleset, players: [a, b, c], expedition: 'chronological', route: CHRONOLOGICAL_ROUTE.slice(0, 3), code, name: 'Example run' })
  run.example = true
  const [pa, pb, pc] = run.players
  const gear: [Player, string, Slot, Rarity][] = [
    [pa, 'Prosecutor', 'Energy', 'Common'], [pa, 'Pillager', 'Kinetic', 'Common'], [pa, 'Tarantula', 'Power', 'Uncommon'],
    [pb, 'Bad Neighbors', 'Kinetic', 'Common'], [pb, 'Chain of Command', 'Energy', 'Common'], [pb, 'Pentatonic-48', 'Power', 'Uncommon'],
    [pc, 'Nightshade', 'Kinetic', 'Common'], [pc, 'Dead-Eye', 'Energy', 'Common'], [pc, 'Pentatonic-48', 'Power', 'Uncommon'],
  ]
  for (const [p, name, slot, rarity] of gear) addItem(run, p, { name, slot, rarity, source: 'starting gear' }).equipped = true
  const resolveFirst = (picks: string[]) => {
    run.players.forEach((p, i) => {
      const pend = run.pending.find((x) => x.playerId === p.id && x.kind === 'clear')!
      pend.unlock = [picks[i], ...pend.unlock.filter((x) => x !== picks[i])].slice(0, 3)
      applyIntent(run, p.id, { type: 'resolve', pendingId: pend.id, unlock: picks[i], drops: [] })
    })
  }
  changeIntegrity(run, -run.ruleset.integrity.wipe, 'Team wipe recorded.', 'wipe')
  recordClear(run)
  recordChest(run, true)
  resolveFirst(['Solar|aspect|Touch of Flame', 'Void|aspect|Controlled Demolition', 'Strand|aspect|Whirling Maelstrom'])
  addItem(run, pb, { name: 'Dreaded Venture', slot: 'Energy', rarity: 'Rare', source: 'encounter drop' })
  recordClear(run)
  // The host resolves their own reward; the other two are still choosing.
  const mine = run.pending.filter((x) => x.playerId === pa.id && x.kind === 'clear').pop()!
  applyIntent(run, pa.id, { type: 'resolve', pendingId: mine.id, unlock: mine.unlock[0], drops: [] })
  changeIntegrity(run, -run.ruleset.integrity.wipe, 'Team wipe recorded.', 'wipe')
  // Left on the chests between Vorgeth and D\u00fbl Incaru, so the chest prompt shows.
  pc.configured.push("Strand|aspect|Widow's Silk")
  return run
}
